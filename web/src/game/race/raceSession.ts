import {
  BoostSystem,
  DEFAULT_BOOST_CONFIG,
  type BoostConfig,
  type BoostStateSnapshot,
} from './boostSystem.ts';
import {
  CheckpointSystem,
  type CheckpointStateSnapshot,
} from './checkpointSystem.ts';
import {
  NEON_CIRCUIT_TRACK,
  type TrackDefinition,
} from './trackDefinition.ts';

export type RacePhase = 'ready' | 'countdown' | 'racing' | 'paused' | 'finished';

export const TOTAL_RACE_LAPS = 3;
export const COUNTDOWN_SECONDS = 3.0;
export const RESPAWN_PENALTY_SECONDS = 5.0;

export interface RaceBanner {
  text: string;
  tone: 'info' | 'accent' | 'warn' | 'success';
}

export interface RaceSessionSnapshot {
  phase: RacePhase;
  pausedFromPhase: 'countdown' | 'racing' | null;
  currentLap: number;
  totalLaps: number;
  countdownRemaining: number;
  countdownNumber: 3 | 2 | 1 | 0 | null;
  currentLapTime: number;
  rawTotalTime: number;
  penaltyTime: number;
  finalTime: number;
  lapTimes: number[];
  bestLapTime: number | null;
  respawnCount: number;
  boost: BoostStateSnapshot;
  checkpoint: CheckpointStateSnapshot;
  banner: RaceBanner | null;
}

export interface RaceStepInput {
  x: number;
  y: number;
  heading: number;
  vx: number;
  vy: number;
  forwardSpeed: number;
  forwardInput: boolean;
  brakeInput: boolean;
  handbrakeInput: boolean;
  dt: number;
}

export interface RaceStepResult {
  phase: RacePhase;
  lockDrive: boolean;
  postFinishBrake: boolean;
  boostAccel: number;
  boostMaxSpeed: number;
  countdownTick: 3 | 2 | 1 | 0 | null;
  checkpointsPassed: number[];
  lapCompleted: number | null;
  raceFinished: boolean;
  boostPickedUp: number | null;
  boostActivated: boolean;
}

export function formatRaceTime(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const totalMs = Math.round(clamped * 1000);
  const mins = Math.floor(totalMs / 60000);
  const secs = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

export class RaceSession {
  public readonly track: TrackDefinition;
  public readonly checkpoints: CheckpointSystem;
  public readonly boost: BoostSystem;
  private readonly totalLaps: number;

  private phase: RacePhase = 'ready';
  private pausedFromPhase: 'countdown' | 'racing' | null = null;
  private countdownRemaining = COUNTDOWN_SECONDS;
  private lastEmittedCountdownNum: 3 | 2 | 1 | null = null;
  private goBannerTimer = 0;

  private currentLap = 1;
  private currentLapTime = 0;
  private rawTotalTime = 0;
  private penaltyTime = 0;
  private finalTime = 0;
  private lapTimes: number[] = [];
  private bestLapTime: number | null = null;
  private respawnCount = 0;

  private transientBanner: RaceBanner | null = null;
  private transientBannerTimer = 0;

  constructor(
    track: TrackDefinition = NEON_CIRCUIT_TRACK,
    totalLaps: number = TOTAL_RACE_LAPS,
    boostConfig: BoostConfig = DEFAULT_BOOST_CONFIG,
  ) {
    this.track = track;
    this.totalLaps = totalLaps;
    this.checkpoints = new CheckpointSystem(track);
    this.boost = new BoostSystem(track, boostConfig);
  }

  /**
   * Resets session back to 'ready' at the starting grid.
   */
  resetToReady(): void {
    const { x, y } = this.track.startSpawn;
    this.phase = 'ready';
    this.pausedFromPhase = null;
    this.countdownRemaining = COUNTDOWN_SECONDS;
    this.lastEmittedCountdownNum = null;
    this.goBannerTimer = 0;
    this.currentLap = 1;
    this.currentLapTime = 0;
    this.rawTotalTime = 0;
    this.penaltyTime = 0;
    this.finalTime = 0;
    this.lapTimes = [];
    this.bestLapTime = null;
    this.respawnCount = 0;
    this.transientBanner = null;
    this.transientBannerTimer = 0;
    this.checkpoints.reset(x, y);
    this.boost.reset(x, y);
  }

  /**
   * Resets and immediately starts the 3-2-1 countdown.
   */
  startCountdown(): void {
    this.resetToReady();
    this.phase = 'countdown';
    this.countdownRemaining = COUNTDOWN_SECONDS;
    this.lastEmittedCountdownNum = null;
  }

  pause(): boolean {
    if (this.phase === 'countdown' || this.phase === 'racing') {
      this.pausedFromPhase = this.phase;
      this.phase = 'paused';
      return true;
    }
    return false;
  }

  resume(): boolean {
    if (this.phase === 'paused' && this.pausedFromPhase) {
      this.phase = this.pausedFromPhase;
      this.pausedFromPhase = null;
      return true;
    }
    return false;
  }

  togglePause(): boolean {
    if (this.phase === 'paused') {
      return this.resume();
    }
    return this.pause();
  }

  requestBoost(): void {
    if (this.phase === 'racing') {
      this.boost.requestActivate();
    }
  }

  /**
   * Respawns at the last valid checkpoint (or grid start if none yet),
   * adds +5s penalty, clears active/stored boost, and rebases pose tracking.
   */
  respawnAtLastCheckpoint(): { x: number; y: number; heading: number } | null {
    const activeRaceOrPausedRace =
      this.phase === 'racing' ||
      (this.phase === 'paused' && this.pausedFromPhase === 'racing');

    if (!activeRaceOrPausedRace) {
      return null;
    }

    const pose = this.checkpoints.getRespawnPose();
    this.checkpoints.rebasePose(pose.x, pose.y);
    this.boost.onRespawn(pose.x, pose.y);
    this.penaltyTime += RESPAWN_PENALTY_SECONDS;
    this.finalTime = this.rawTotalTime + this.penaltyTime;
    this.respawnCount++;

    this.setTransientBanner(
      `Trassaga qaytarildi (+${RESPAWN_PENALTY_SECONDS.toFixed(0)}s jarima)`,
      'warn',
      2.4,
    );

    if (this.phase === 'paused') {
      this.resume();
    }

    return pose;
  }

  setTransientBanner(
    text: string,
    tone: RaceBanner['tone'] = 'info',
    durationSeconds = 2.0,
  ): void {
    this.transientBanner = { text, tone };
    this.transientBannerTimer = durationSeconds;
  }

  getPhase(): RacePhase {
    return this.phase;
  }

  getSnapshot(): RaceSessionSnapshot {
    const cpSnap = this.checkpoints.getSnapshot();
    const boostSnap = this.boost.getSnapshot();

    let countdownNumber: 3 | 2 | 1 | 0 | null = null;
    if (this.phase === 'countdown' || (this.phase === 'paused' && this.pausedFromPhase === 'countdown')) {
      const ceil = Math.ceil(this.countdownRemaining);
      countdownNumber = (Math.max(1, Math.min(3, ceil)) as 3 | 2 | 1);
    } else if (this.phase === 'racing' && this.goBannerTimer > 0) {
      countdownNumber = 0;
    }

    let banner: RaceBanner | null = null;
    if (cpSnap.wrongWay && this.phase === 'racing') {
      banner = {
        text: 'TESKARI YO‘NALISH! Orqaga buriling',
        tone: 'warn',
      };
    } else if (cpSnap.missedCheckpointIndex !== null && this.phase === 'racing') {
      banner = {
        text: `Checkpoint #${cpSnap.missedCheckpointIndex} o‘tkazib yuborildi — R bosing yoki orqaga qayting`,
        tone: 'warn',
      };
    } else if (this.transientBanner && this.transientBannerTimer > 0) {
      banner = this.transientBanner;
    }

    return {
      phase: this.phase,
      pausedFromPhase: this.pausedFromPhase,
      currentLap: this.currentLap,
      totalLaps: this.totalLaps,
      countdownRemaining: this.countdownRemaining,
      countdownNumber,
      currentLapTime: this.currentLapTime,
      rawTotalTime: this.rawTotalTime,
      penaltyTime: this.penaltyTime,
      finalTime:
        this.phase === 'finished'
          ? this.finalTime
          : this.rawTotalTime + this.penaltyTime,
      lapTimes: [...this.lapTimes],
      bestLapTime: this.bestLapTime,
      respawnCount: this.respawnCount,
      boost: boostSnap,
      checkpoint: cpSnap,
      banner,
    };
  }

  /**
   * Advances the race session by one fixed simulation step (dt = 1/120s).
   */
  step(input: RaceStepInput): RaceStepResult {
    const {
      x,
      y,
      heading,
      vx,
      vy,
      forwardSpeed,
      forwardInput,
      brakeInput,
      handbrakeInput,
      dt,
    } = input;

    const result: RaceStepResult = {
      phase: this.phase,
      lockDrive: false,
      postFinishBrake: false,
      boostAccel: 0,
      boostMaxSpeed: DEFAULT_BOOST_CONFIG.maxBoostSpeed,
      countdownTick: null,
      checkpointsPassed: [],
      lapCompleted: null,
      raceFinished: false,
      boostPickedUp: null,
      boostActivated: false,
    };

    if (this.phase === 'ready') {
      this.checkpoints.rebasePose(x, y);
      this.boost.rebasePose(x, y);
      result.lockDrive = true;
      return result;
    }

    if (this.phase === 'paused') {
      result.lockDrive = true;
      return result;
    }

    if (this.phase === 'finished') {
      this.checkpoints.rebasePose(x, y);
      this.boost.rebasePose(x, y);
      result.lockDrive = true;
      result.postFinishBrake = true;
      return result;
    }

    if (this.transientBannerTimer > 0) {
      this.transientBannerTimer = Math.max(0, this.transientBannerTimer - dt);
      if (this.transientBannerTimer <= 0) {
        this.transientBanner = null;
      }
    }

    if (this.phase === 'countdown') {
      this.checkpoints.rebasePose(x, y);
      this.boost.rebasePose(x, y);
      result.lockDrive = true;

      const currentNum = Math.max(1, Math.min(3, Math.ceil(this.countdownRemaining))) as 3 | 2 | 1;
      if (this.lastEmittedCountdownNum !== currentNum) {
        this.lastEmittedCountdownNum = currentNum;
        result.countdownTick = currentNum;
      }

      this.countdownRemaining = Math.max(0, this.countdownRemaining - dt);
      if (this.countdownRemaining <= 1e-6) {
        this.countdownRemaining = 0;
        this.phase = 'racing';
        this.goBannerTimer = 1.1;
        result.phase = 'racing';
        result.lockDrive = false;
        result.countdownTick = 0;
      }
      return result;
    }

    // Active 'racing' phase
    if (this.goBannerTimer > 0) {
      this.goBannerTimer = Math.max(0, this.goBannerTimer - dt);
    }

    this.currentLapTime += dt;
    this.rawTotalTime += dt;
    this.finalTime = this.rawTotalTime + this.penaltyTime;

    const cpEvent = this.checkpoints.step(x, y, heading, vx, vy, dt);
    result.checkpointsPassed = cpEvent.checkpointsPassed;

    if (cpEvent.checkpointsPassed.length > 0) {
      const lastCp = cpEvent.checkpointsPassed[cpEvent.checkpointsPassed.length - 1];
      this.setTransientBanner(
        `Checkpoint ${lastCp}/${this.track.checkpoints.length}`,
        'info',
        1.2,
      );
    }

    const boostEvent = this.boost.step({
      x,
      y,
      forwardSpeed,
      forwardInput,
      brakeInput,
      handbrakeInput,
      canActivate: true,
      dt,
    });

    result.boostAccel = boostEvent.currentBoostAccel;
    result.boostMaxSpeed = boostEvent.maxBoostSpeed;
    result.boostPickedUp = boostEvent.pickedUpPadId;
    result.boostActivated = boostEvent.activated;

    if (boostEvent.pickedUpPadId !== null) {
      this.setTransientBanner('BOOST OLINDI! [E] bosing', 'accent', 1.8);
    }
    if (boostEvent.activated) {
      this.setTransientBanner('NEON BOOST FAOL!', 'accent', 1.5);
    }

    if (cpEvent.lapCompleted) {
      const completedLapIndex = this.currentLap;
      const finishedLapTime = this.currentLapTime;
      this.lapTimes.push(finishedLapTime);
      if (this.bestLapTime === null || finishedLapTime < this.bestLapTime) {
        this.bestLapTime = finishedLapTime;
      }
      result.lapCompleted = completedLapIndex;

      if (this.currentLap >= this.totalLaps) {
        // Race finished! Freeze all timers once and stop active boost/driving
        this.phase = 'finished';
        this.finalTime = this.rawTotalTime + this.penaltyTime;
        this.boost.onRespawn(x, y);
        result.phase = 'finished';
        result.raceFinished = true;
        result.lockDrive = true;
        result.postFinishBrake = true;
        result.boostAccel = 0;
        this.setTransientBanner('MARRA! Poyga yakunlandi', 'success', 4.0);
      } else {
        this.currentLap++;
        this.currentLapTime = 0;
        this.boost.onNewLap();
        this.setTransientBanner(
          `Aylana ${this.currentLap}/${this.totalLaps} — Boost yangilandi!`,
          'success',
          2.2,
        );
      }
    }

    return result;
  }
}
