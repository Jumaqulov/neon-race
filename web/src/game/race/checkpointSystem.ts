import {
  findNearestTrackPoint,
  type TrackDefinition,
  type TrackGate,
} from './trackDefinition.ts';

export interface GateCrossing {
  gate: TrackGate;
  isFinishGate: boolean;
  t: number;
  x: number;
  y: number;
}

export interface CheckpointStepEvent {
  checkpointsPassed: number[];
  lapCompleted: boolean;
  missedCheckpointIndex: number | null;
  wrongWay: boolean;
}

export interface CheckpointStateSnapshot {
  /** 0-based index into track.checkpoints (0 .. N-1), or N when all checkpoints in current lap are done and waiting for Finish */
  nextCheckpointIndex: number;
  totalCheckpoints: number;
  passedInCurrentLap: number;
  allCheckpointsPassedForLap: boolean;
  lastValidGate: TrackGate;
  missedCheckpointIndex: number | null;
  wrongWay: boolean;
}

/**
 * Tests if segment P0 -> P1 crosses finite gate A -> B in the forward direction (gate.nx, gate.ny).
 * Returns crossing parameter t in [0, 1] or null if no valid forward crossing.
 */
export function intersectGateForward(
  p0x: number,
  p0y: number,
  p1x: number,
  p1y: number,
  gate: TrackGate,
): { t: number; x: number; y: number } | null {
  const dx = p1x - p0x;
  const dy = p1y - p0y;
  const forwardDot = dx * gate.nx + dy * gate.ny;
  // Must move in forward direction of the gate
  if (forwardDot <= 1e-6) {
    return null;
  }

  // Signed distances from gate line passing through (gate.x, gate.y) with normal (gate.nx, gate.ny)
  const d0 = (p0x - gate.x) * gate.nx + (p0y - gate.y) * gate.ny;
  const d1 = (p1x - gate.x) * gate.nx + (p1y - gate.y) * gate.ny;

  // P0 must be on or behind the gate line, and P1 strictly ahead of the gate line
  if (d0 > 1e-7 || d1 <= 1e-7) {
    return null;
  }

  const denom = d1 - d0;
  if (denom <= 1e-9) {
    return null;
  }

  const t = Math.max(0, Math.min(1, -d0 / denom));
  const ix = p0x + dx * t;
  const iy = p0y + dy * t;

  // Finite gate width check: distance from gate center along the gate line
  const lateralDist = Math.hypot(ix - gate.x, iy - gate.y);
  if (lateralDist > gate.halfWidth) {
    return null;
  }

  return { t, x: ix, y: iy };
}

/**
 * Checks whether the movement segment [p0 -> p1] stays inside the valid track corridor.
 */
export function isSegmentInCorridor(
  track: TrackDefinition,
  p0x: number,
  p0y: number,
  p1x: number,
  p1y: number,
): boolean {
  const maxDist = track.corridorHalfWidth;
  // Check endpoints and intermediate points to reject cross-infield shortcuts
  const steps = Math.max(2, Math.min(16, Math.ceil(Math.hypot(p1x - p0x, p1y - p0y) / 4)));
  for (let i = 0; i <= steps; i++) {
    const alpha = i / steps;
    const x = p0x + (p1x - p0x) * alpha;
    const y = p0y + (p1y - p0y) * alpha;
    const nearest = findNearestTrackPoint(track, x, y);
    if (nearest.distance > maxDist) {
      return false;
    }
  }
  return true;
}

export class CheckpointSystem {
  private readonly track: TrackDefinition;
  private prevX: number;
  private prevY: number;
  private nextCheckpointIndex = 0;
  private lastValidGate: TrackGate;
  private missedCheckpointIndex: number | null = null;
  private wrongWay = false;
  private wrongWayTimer = 0;

  constructor(track: TrackDefinition) {
    this.track = track;
    this.prevX = track.startSpawn.x;
    this.prevY = track.startSpawn.y;
    this.lastValidGate = {
      ...track.startFinishGate,
      respawn: { ...track.startSpawn },
    };
  }

  reset(spawnX = this.track.startSpawn.x, spawnY = this.track.startSpawn.y): void {
    this.prevX = spawnX;
    this.prevY = spawnY;
    this.nextCheckpointIndex = 0;
    this.lastValidGate = {
      ...this.track.startFinishGate,
      respawn: { ...this.track.startSpawn },
    };
    this.missedCheckpointIndex = null;
    this.wrongWay = false;
    this.wrongWayTimer = 0;
  }

  /**
   * Updates previous pose without evaluating any segment crossings.
   * Must be called on respawn, reset, or teleport so the jump segment never triggers a gate.
   */
  rebasePose(x: number, y: number): void {
    this.prevX = x;
    this.prevY = y;
    this.wrongWay = false;
    this.wrongWayTimer = 0;
  }

  getSnapshot(): CheckpointStateSnapshot {
    const total = this.track.checkpoints.length;
    return {
      nextCheckpointIndex: this.nextCheckpointIndex,
      totalCheckpoints: total,
      passedInCurrentLap: this.nextCheckpointIndex,
      allCheckpointsPassedForLap: this.nextCheckpointIndex >= total,
      lastValidGate: this.lastValidGate,
      missedCheckpointIndex: this.missedCheckpointIndex,
      wrongWay: this.wrongWay,
    };
  }

  getRespawnPose(): { x: number; y: number; heading: number } {
    return { ...this.lastValidGate.respawn };
  }

  /**
   * Evaluates a single simulation step from previous pose to (x, y).
   */
  step(
    x: number,
    y: number,
    heading: number,
    vx: number,
    vy: number,
    dt: number,
  ): CheckpointStepEvent {
    const p0x = this.prevX;
    const p0y = this.prevY;
    this.prevX = x;
    this.prevY = y;

    const event: CheckpointStepEvent = {
      checkpointsPassed: [],
      lapCompleted: false,
      missedCheckpointIndex: this.missedCheckpointIndex,
      wrongWay: false,
    };

    // Update wrong-way indicator
    this.updateWrongWay(x, y, heading, vx, vy, dt);
    event.wrongWay = this.wrongWay;

    // Verify corridor validity for the segment
    if (!isSegmentInCorridor(this.track, p0x, p0y, x, y)) {
      return event;
    }

    // Collect all forward crossings across checkpoints and Start/Finish gate within this step, sorted by t in [0, 1]
    const crossings: GateCrossing[] = [];
    for (const cp of this.track.checkpoints) {
      const hit = intersectGateForward(p0x, p0y, x, y, cp);
      if (hit) {
        crossings.push({
          gate: cp,
          isFinishGate: false,
          t: hit.t,
          x: hit.x,
          y: hit.y,
        });
      }
    }

    const finishHit = intersectGateForward(p0x, p0y, x, y, this.track.startFinishGate);
    if (finishHit) {
      crossings.push({
        gate: this.track.startFinishGate,
        isFinishGate: true,
        t: finishHit.t,
        x: finishHit.x,
        y: finishHit.y,
      });
    }

    if (crossings.length === 0) {
      return event;
    }

    crossings.sort((a, b) => a.t - b.t);

    const totalCheckpoints = this.track.checkpoints.length;

    for (const crossing of crossings) {
      if (crossing.isFinishGate) {
        if (this.nextCheckpointIndex >= totalCheckpoints) {
          // Valid lap completion!
          event.lapCompleted = true;
          this.nextCheckpointIndex = 0;
          this.lastValidGate = this.track.startFinishGate;
          this.missedCheckpointIndex = null;
        } else if (this.nextCheckpointIndex > 0) {
          // Crossed finish line before completing all checkpoints in this lap
          this.missedCheckpointIndex = this.nextCheckpointIndex + 1;
        }
        // Note: if nextCheckpointIndex === 0, crossing Start/Finish right after launch or lap start is normal and ignored
      } else {
        const expectedGate =
          this.nextCheckpointIndex < totalCheckpoints
            ? this.track.checkpoints[this.nextCheckpointIndex]
            : null;
        if (expectedGate && crossing.gate.index === expectedGate.index) {
          this.nextCheckpointIndex++;
          this.lastValidGate = crossing.gate;
          this.missedCheckpointIndex = null;
          event.checkpointsPassed.push(crossing.gate.index);
        } else if (
          expectedGate &&
          crossing.gate.index > expectedGate.index
        ) {
          // Skipped an earlier checkpoint
          this.missedCheckpointIndex = expectedGate.index;
        }
      }
    }

    event.missedCheckpointIndex = this.missedCheckpointIndex;
    return event;
  }

  private updateWrongWay(
    x: number,
    y: number,
    heading: number,
    vx: number,
    vy: number,
    dt: number,
  ): void {
    const speed = Math.hypot(vx, vy);
    const nearest = findNearestTrackPoint(this.track, x, y);
    const tx = nearest.sample.tx;
    const ty = nearest.sample.ty;

    if (speed > 3.5) {
      const velDot = (vx * tx + vy * ty) / speed;
      const headDot = Math.cos(heading) * tx + Math.sin(heading) * ty;
      if (velDot < -0.45 && headDot < -0.25) {
        this.wrongWayTimer += dt;
        if (this.wrongWayTimer >= 0.25) {
          this.wrongWay = true;
        }
        return;
      }
    }

    this.wrongWayTimer = Math.max(0, this.wrongWayTimer - dt * 3);
    if (this.wrongWayTimer < 0.1 || speed < 1.5) {
      this.wrongWay = false;
    }
  }
}
