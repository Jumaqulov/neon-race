import type { BoostPadDefinition, TrackDefinition } from './trackDefinition.ts';

export type BoostStatus = 'empty' | 'ready' | 'active';

export interface BoostConfig {
  duration: number;
  boostAccel: number;
  maxBoostSpeed: number;
}

export const DEFAULT_BOOST_CONFIG: BoostConfig = {
  duration: 2.0,
  boostAccel: 6.0,
  maxBoostSpeed: 60.0,
};

export interface BoostStateSnapshot {
  status: BoostStatus;
  hasBoost: boolean;
  isActive: boolean;
  remainingTime: number;
  duration: number;
  fractionRemaining: number;
  boostsUsed: number;
  availablePadIds: number[];
}

export interface BoostStepResult {
  pickedUpPadId: number | null;
  activated: boolean;
  expired: boolean;
  currentBoostAccel: number;
  maxBoostSpeed: number;
}

/**
 * Shortest distance from point (px, py) to segment (ax, ay) -> (bx, by).
 */
export function distancePointToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const abx = bx - ax;
  const aby = by - ay;
  const lenSq = abx * abx + aby * aby;
  if (lenSq <= 1e-9) {
    return Math.hypot(px - ax, py - ay);
  }
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / lenSq));
  const cx = ax + abx * t;
  const cy = ay + aby * t;
  return Math.hypot(px - cx, py - cy);
}

export class BoostSystem {
  private readonly pads: readonly BoostPadDefinition[];
  private readonly config: BoostConfig;
  private readonly collectedInCurrentLap = new Set<number>();
  private status: BoostStatus = 'empty';
  private remainingTime = 0;
  private boostsUsed = 0;
  private prevX: number;
  private prevY: number;
  private pendingActivation = false;

  constructor(track: TrackDefinition, config: BoostConfig = DEFAULT_BOOST_CONFIG) {
    this.pads = track.boostPads;
    this.config = config;
    this.prevX = track.startSpawn.x;
    this.prevY = track.startSpawn.y;
  }

  reset(spawnX: number, spawnY: number): void {
    this.collectedInCurrentLap.clear();
    this.status = 'empty';
    this.remainingTime = 0;
    this.boostsUsed = 0;
    this.prevX = spawnX;
    this.prevY = spawnY;
    this.pendingActivation = false;
  }

  /**
   * Restores all pickup pads at the start of a new valid lap.
   */
  onNewLap(): void {
    this.collectedInCurrentLap.clear();
  }

  /**
   * Clears active boost and inventory slot on respawn, while preserving current lap's consumed pickups.
   */
  onRespawn(x: number, y: number): void {
    this.status = 'empty';
    this.remainingTime = 0;
    this.pendingActivation = false;
    this.prevX = x;
    this.prevY = y;
  }

  rebasePose(x: number, y: number): void {
    this.prevX = x;
    this.prevY = y;
  }

  /**
   * Queues a boost activation request (e.g. from KeyE or touch button).
   */
  requestActivate(): void {
    this.pendingActivation = true;
  }

  isPadAvailable(id: number): boolean {
    return !this.collectedInCurrentLap.has(id);
  }

  getSnapshot(): BoostStateSnapshot {
    const availablePadIds: number[] = [];
    for (const pad of this.pads) {
      if (!this.collectedInCurrentLap.has(pad.id)) {
        availablePadIds.push(pad.id);
      }
    }
    return {
      status: this.status,
      hasBoost: this.status === 'ready',
      isActive: this.status === 'active',
      remainingTime: this.remainingTime,
      duration: this.config.duration,
      fractionRemaining:
        this.status === 'active'
          ? Math.max(0, Math.min(1, this.remainingTime / this.config.duration))
          : this.status === 'ready'
            ? 1
            : 0,
      boostsUsed: this.boostsUsed,
      availablePadIds,
    };
  }

  /**
   * Steps boost pickup, activation, and timer in fixed simulation time.
   */
  step(params: {
    x: number;
    y: number;
    forwardSpeed: number;
    forwardInput: boolean;
    brakeInput: boolean;
    handbrakeInput: boolean;
    canActivate: boolean;
    dt: number;
  }): BoostStepResult {
    const {
      x,
      y,
      forwardSpeed,
      forwardInput,
      brakeInput,
      handbrakeInput,
      canActivate,
      dt,
    } = params;

    const p0x = this.prevX;
    const p0y = this.prevY;
    this.prevX = x;
    this.prevY = y;

    const result: BoostStepResult = {
      pickedUpPadId: null,
      activated: false,
      expired: false,
      currentBoostAccel: 0,
      maxBoostSpeed: this.config.maxBoostSpeed,
    };

    if (!canActivate) {
      this.pendingActivation = false;
      return result;
    }

    // 1. Check pickup collision only when inventory is empty (do not consume if ready or active)
    if (this.status === 'empty') {
      for (const pad of this.pads) {
        if (this.collectedInCurrentLap.has(pad.id)) continue;
        const dist = distancePointToSegment(pad.x, pad.y, p0x, p0y, x, y);
        if (dist <= pad.radius) {
          this.collectedInCurrentLap.add(pad.id);
          this.status = 'ready';
          result.pickedUpPadId = pad.id;
          break;
        }
      }
    }

    // 2. Process activation request if boost is ready and car is driving/moving forward without brake/handbrake
    if (this.pendingActivation) {
      this.pendingActivation = false;
      const canDriveForward =
        !brakeInput && !handbrakeInput && (forwardInput || forwardSpeed > 0.25);
      if (this.status === 'ready' && canDriveForward) {
        this.status = 'active';
        this.remainingTime = this.config.duration;
        this.boostsUsed++;
        result.activated = true;
      }
    }

    // 3. Advance active boost timer by fixed dt
    if (this.status === 'active') {
      const applyingForce =
        !brakeInput && !handbrakeInput && (forwardInput || forwardSpeed > 0.5);
      if (applyingForce) {
        result.currentBoostAccel = this.config.boostAccel;
      }
      this.remainingTime = Math.max(0, this.remainingTime - dt);
      if (this.remainingTime <= 1e-6) {
        this.remainingTime = 0;
        this.status = 'empty';
        result.expired = true;
      }
    }

    return result;
  }
}
