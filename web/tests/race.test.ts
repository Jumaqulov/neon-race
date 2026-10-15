import assert from 'node:assert/strict';
import test from 'node:test';
import { GameEngine } from '../src/game/GameEngine.ts';
import { CarPhysics } from '../src/game/physics/carPhysics.ts';
import { BoostSystem } from '../src/game/race/boostSystem.ts';
import { CheckpointSystem } from '../src/game/race/checkpointSystem.ts';
import {
  COUNTDOWN_SECONDS,
  RESPAWN_PENALTY_SECONDS,
  RaceSession,
} from '../src/game/race/raceSession.ts';
import {
  NEON_CIRCUIT_TRACK,
  sampleTrackAtS,
  type TrackGate,
} from '../src/game/race/trackDefinition.ts';

const FIXED_DT = 1 / 120;

function crossGateCenterForward(
  session: RaceSession,
  gate: TrackGate,
  dt = FIXED_DT,
) {
  // Position 1.2m behind gate, then step to 1.2m ahead of gate along gate forward normal
  const beforeX = gate.x - gate.nx * 1.2;
  const beforeY = gate.y - gate.ny * 1.2;
  const afterX = gate.x + gate.nx * 1.2;
  const afterY = gate.y + gate.ny * 1.2;
  const heading = Math.atan2(gate.ny, gate.nx);

  session.checkpoints.rebasePose(beforeX, beforeY);
  session.boost.rebasePose(beforeX, beforeY);

  return session.step({
    x: afterX,
    y: afterY,
    heading,
    vx: gate.nx * 25,
    vy: gate.ny * 25,
    forwardSpeed: 25,
    forwardInput: true,
    brakeInput: false,
    handbrakeInput: false,
    dt,
  });
}

test('1. Locks car, race timer, and boost during 3-2-1 countdown and unlocks on GO', () => {
  const engine = new GameEngine({ headless: true, initialMode: 'neon_circuit' });
  engine.init(null);
  engine.startRaceCountdown();

  const initialX = engine.phys.x;
  const initialY = engine.phys.y;
  assert.equal(engine.raceSession.getPhase(), 'countdown');

  // Attempt throttle and boost during countdown (first 2.5 seconds = 300 steps)
  engine.activateBoost();
  for (let i = 0; i < 300; i++) {
    engine.advanceSimulation({ throttle: 1, steer: 0.2 }, FIXED_DT);
  }

  const midSnap = engine.raceSession.getSnapshot();
  assert.equal(midSnap.phase, 'countdown');
  assert.equal(midSnap.rawTotalTime, 0);
  assert.equal(midSnap.currentLapTime, 0);
  assert.equal(midSnap.boost.status, 'empty');
  assert.equal(engine.phys.x, initialX);
  assert.equal(engine.phys.y, initialY);
  assert.equal(engine.phys.speed, 0);

  // Complete remaining 0.5s (60 steps) to reach GO
  for (let i = 0; i < 61; i++) {
    engine.advanceSimulation({ throttle: 1 }, FIXED_DT);
  }

  const goSnap = engine.raceSession.getSnapshot();
  assert.equal(goSnap.phase, 'racing');
  assert.equal(goSnap.countdownNumber, 0);

  // Now driving advances car and timer
  for (let i = 0; i < 60; i++) {
    engine.advanceSimulation({ throttle: 1 }, FIXED_DT);
  }
  assert(engine.phys.speed > 1.0, 'Car should accelerate after countdown finishes');
  assert(engine.raceSession.getSnapshot().rawTotalTime > 0.4);
  engine.dispose();
});

test('2. Initial crossing of Start/Finish line right after start does not count as a lap', () => {
  const session = new RaceSession(NEON_CIRCUIT_TRACK);
  session.startCountdown();
  // Advance through 3.0s countdown
  for (let i = 0; i < 360; i++) {
    session.step({
      x: NEON_CIRCUIT_TRACK.startSpawn.x,
      y: NEON_CIRCUIT_TRACK.startSpawn.y,
      heading: NEON_CIRCUIT_TRACK.startSpawn.heading,
      vx: 0,
      vy: 0,
      forwardSpeed: 0,
      forwardInput: false,
      brakeInput: false,
      handbrakeInput: false,
      dt: FIXED_DT,
    });
  }
  assert.equal(session.getPhase(), 'racing');

  // Cross the Start/Finish gate immediately at start of Lap 1
  const res = crossGateCenterForward(session, NEON_CIRCUIT_TRACK.startFinishGate);
  assert.equal(res.lapCompleted, null);
  assert.equal(session.getSnapshot().currentLap, 1);
  assert.equal(session.getSnapshot().lapTimes.length, 0);
});

test('3. Accepts checkpoints only in sequential order and within the track corridor', () => {
  const session = new RaceSession(NEON_CIRCUIT_TRACK);
  session.startCountdown();
  for (let i = 0; i < 360; i++) {
    session.step({
      x: NEON_CIRCUIT_TRACK.startSpawn.x,
      y: NEON_CIRCUIT_TRACK.startSpawn.y,
      heading: 0,
      vx: 0,
      vy: 0,
      forwardSpeed: 0,
      forwardInput: false,
      brakeInput: false,
      handbrakeInput: false,
      dt: FIXED_DT,
    });
  }

  const cp1 = NEON_CIRCUIT_TRACK.checkpoints[0];
  const cp2 = NEON_CIRCUIT_TRACK.checkpoints[1];

  // Attempting to cross CP1 outside its finite width / corridor gives no progress
  const outX0 = cp1.x - cp1.nx * 1.5;
  const outY0 = cp1.y - cp1.ny * 1.5 + 25; // 25m laterally outside corridor
  const outX1 = cp1.x + cp1.nx * 1.5;
  const outY1 = cp1.y + cp1.ny * 1.5 + 25;
  session.checkpoints.rebasePose(outX0, outY0);
  session.step({
    x: outX1,
    y: outY1,
    heading: 0,
    vx: 20,
    vy: 0,
    forwardSpeed: 20,
    forwardInput: true,
    brakeInput: false,
    handbrakeInput: false,
    dt: FIXED_DT,
  });
  assert.equal(session.getSnapshot().checkpoint.nextCheckpointIndex, 0);

  // Valid crossing of CP1 and CP2 in order
  const r1 = crossGateCenterForward(session, cp1);
  assert.deepEqual(r1.checkpointsPassed, [1]);
  assert.equal(session.getSnapshot().checkpoint.nextCheckpointIndex, 1);

  const r2 = crossGateCenterForward(session, cp2);
  assert.deepEqual(r2.checkpointsPassed, [2]);
  assert.equal(session.getSnapshot().checkpoint.nextCheckpointIndex, 2);
});

test('4. Processes two consecutive gates crossed in a single step in ascending t order', () => {
  const baseGateA: TrackGate = {
    index: 1,
    s: 10,
    x: 10,
    y: -80,
    nx: 1,
    ny: 0,
    ax: 10,
    ay: -72,
    bx: 10,
    by: -88,
    halfWidth: 8,
    respawn: { x: 10, y: -80, heading: 0 },
  };
  const baseGateB: TrackGate = {
    index: 2,
    s: 12,
    x: 12,
    y: -80,
    nx: 1,
    ny: 0,
    ax: 12,
    ay: -72,
    bx: 12,
    by: -88,
    halfWidth: 8,
    respawn: { x: 12, y: -80, heading: 0 },
  };

  const customTrack = {
    ...NEON_CIRCUIT_TRACK,
    checkpoints: [baseGateA, baseGateB],
  };

  const cpSys = new CheckpointSystem(customTrack);
  cpSys.rebasePose(9, -80);
  const ev = cpSys.step(13, -80, 0, 30, 0, FIXED_DT);
  assert.deepEqual(ev.checkpointsPassed, [1, 2]);
  assert.equal(cpSys.getSnapshot().allCheckpointsPassedForLap, true);
});

test('5. Rejects skipped checkpoints, reverse crossings, and gate oscillation without closing a lap', () => {
  const session = new RaceSession(NEON_CIRCUIT_TRACK);
  session.startCountdown();
  for (let i = 0; i < 360; i++) {
    session.step({
      x: NEON_CIRCUIT_TRACK.startSpawn.x,
      y: NEON_CIRCUIT_TRACK.startSpawn.y,
      heading: 0,
      vx: 0,
      vy: 0,
      forwardSpeed: 0,
      forwardInput: false,
      brakeInput: false,
      handbrakeInput: false,
      dt: FIXED_DT,
    });
  }

  const cp1 = NEON_CIRCUIT_TRACK.checkpoints[0];
  const cp2 = NEON_CIRCUIT_TRACK.checkpoints[1];

  // Cross CP1 in reverse direction -> no progress
  session.checkpoints.rebasePose(cp1.x + cp1.nx * 1.5, cp1.y + cp1.ny * 1.5);
  session.step({
    x: cp1.x - cp1.nx * 1.5,
    y: cp1.y - cp1.ny * 1.5,
    heading: Math.PI,
    vx: -20,
    vy: 0,
    forwardSpeed: -20,
    forwardInput: false,
    brakeInput: true,
    handbrakeInput: false,
    dt: FIXED_DT,
  });
  assert.equal(session.getSnapshot().checkpoint.nextCheckpointIndex, 0);

  // Skip CP1 and cross CP2 -> sets missedCheckpointIndex = 1 and does not advance
  crossGateCenterForward(session, cp2);
  assert.equal(session.getSnapshot().checkpoint.nextCheckpointIndex, 0);
  assert.equal(session.getSnapshot().checkpoint.missedCheckpointIndex, 1);

  // Cross Start/Finish without completing checkpoints -> does not complete lap
  const finishRes = crossGateCenterForward(session, NEON_CIRCUIT_TRACK.startFinishGate);
  assert.equal(finishRes.lapCompleted, null);
  assert.equal(session.getSnapshot().currentLap, 1);

  // Oscillating back and forth on CP1 only counts once
  crossGateCenterForward(session, cp1);
  assert.equal(session.getSnapshot().checkpoint.nextCheckpointIndex, 1);
  assert.equal(session.getSnapshot().checkpoint.missedCheckpointIndex, null);
  crossGateCenterForward(session, cp1);
  assert.equal(session.getSnapshot().checkpoint.nextCheckpointIndex, 1);
});

test('6. Completes Laps 1, 2, and 3 in order, transitions to finished after Lap 3, and freezes timers (never 4/3)', () => {
  const session = new RaceSession(NEON_CIRCUIT_TRACK);
  session.startCountdown();
  for (let i = 0; i < 360; i++) {
    session.step({
      x: NEON_CIRCUIT_TRACK.startSpawn.x,
      y: NEON_CIRCUIT_TRACK.startSpawn.y,
      heading: 0,
      vx: 0,
      vy: 0,
      forwardSpeed: 0,
      forwardInput: false,
      brakeInput: false,
      handbrakeInput: false,
      dt: FIXED_DT,
    });
  }

  for (let lap = 1; lap <= 3; lap++) {
    assert.equal(session.getSnapshot().currentLap, lap);
    // Advance some extra steps on each lap so lap times differ
    for (let s = 0; s < lap * 20; s++) {
      session.step({
        x: NEON_CIRCUIT_TRACK.startSpawn.x,
        y: NEON_CIRCUIT_TRACK.startSpawn.y,
        heading: 0,
        vx: 20,
        vy: 0,
        forwardSpeed: 20,
        forwardInput: true,
        brakeInput: false,
        handbrakeInput: false,
        dt: FIXED_DT,
      });
    }
    for (const cp of NEON_CIRCUIT_TRACK.checkpoints) {
      crossGateCenterForward(session, cp);
    }
    const finishStep = crossGateCenterForward(session, NEON_CIRCUIT_TRACK.startFinishGate);
    assert.equal(finishStep.lapCompleted, lap);
    if (lap < 3) {
      assert.equal(session.getPhase(), 'racing');
      assert.equal(session.getSnapshot().currentLap, lap + 1);
    } else {
      assert.equal(session.getPhase(), 'finished');
      assert.equal(finishStep.raceFinished, true);
    }
  }

  const finishedSnap = session.getSnapshot();
  assert.equal(finishedSnap.currentLap, 3);
  assert.equal(finishedSnap.lapTimes.length, 3);
  assert(finishedSnap.bestLapTime !== null && finishedSnap.bestLapTime > 0);
  const frozenFinal = finishedSnap.finalTime;
  const frozenRaw = finishedSnap.rawTotalTime;

  // Stepping further after finish must NOT change frozen times or increment lap to 4/3
  for (let i = 0; i < 120; i++) {
    crossGateCenterForward(session, NEON_CIRCUIT_TRACK.startFinishGate);
  }
  const afterSnap = session.getSnapshot();
  assert.equal(afterSnap.currentLap, 3);
  assert.equal(afterSnap.finalTime, frozenFinal);
  assert.equal(afterSnap.rawTotalTime, frozenRaw);
  assert.equal(afterSnap.lapTimes.length, 3);
});

test('7. Collects boost pickup once per lap, does not consume another pickup when full/active, and restores on new lap', () => {
  const boostSys = new BoostSystem(NEON_CIRCUIT_TRACK);
  const pad0 = NEON_CIRCUIT_TRACK.boostPads[0];
  const pad1 = NEON_CIRCUIT_TRACK.boostPads[1];

  // Collect pad 0
  boostSys.rebasePose(pad0.x - 1, pad0.y);
  const step0 = boostSys.step({
    x: pad0.x + 1,
    y: pad0.y,
    forwardSpeed: 20,
    forwardInput: true,
    brakeInput: false,
    handbrakeInput: false,
    canActivate: true,
    dt: FIXED_DT,
  });
  assert.equal(step0.pickedUpPadId, pad0.id);
  assert.equal(boostSys.getSnapshot().status, 'ready');
  assert.equal(boostSys.isPadAvailable(pad0.id), false);

  // Driving over pad 1 while slot is already 'ready' must NOT consume pad 1
  boostSys.rebasePose(pad1.x - 1, pad1.y);
  const step1 = boostSys.step({
    x: pad1.x + 1,
    y: pad1.y,
    forwardSpeed: 20,
    forwardInput: true,
    brakeInput: false,
    handbrakeInput: false,
    canActivate: true,
    dt: FIXED_DT,
  });
  assert.equal(step1.pickedUpPadId, null);
  assert.equal(boostSys.isPadAvailable(pad1.id), true);

  // Activate boost and drive over pad 1 while 'active' -> still must NOT consume pad 1
  boostSys.requestActivate();
  boostSys.rebasePose(pad1.x - 1, pad1.y);
  const stepActive = boostSys.step({
    x: pad1.x + 1,
    y: pad1.y,
    forwardSpeed: 25,
    forwardInput: true,
    brakeInput: false,
    handbrakeInput: false,
    canActivate: true,
    dt: FIXED_DT,
  });
  assert.equal(stepActive.activated, true);
  assert.equal(stepActive.pickedUpPadId, null);
  assert.equal(boostSys.isPadAvailable(pad1.id), true);

  // New lap restores pad 0
  boostSys.onNewLap();
  assert.equal(boostSys.isPadAvailable(pad0.id), true);
});

test('8. Boost lasts 2.0s of simulation time and yields measurably higher speed and distance than normal throttle', () => {
  const carNormal = new CarPhysics();
  const carBoosted = new CarPhysics();
  carNormal.reset(0, 0, 0);
  carBoosted.reset(0, 0, 0);

  const boostSys = new BoostSystem(NEON_CIRCUIT_TRACK);
  const pad0 = NEON_CIRCUIT_TRACK.boostPads[0];
  boostSys.rebasePose(pad0.x - 1, pad0.y);
  boostSys.step({
    x: pad0.x + 1,
    y: pad0.y,
    forwardSpeed: 10,
    forwardInput: true,
    brakeInput: false,
    handbrakeInput: false,
    canActivate: true,
    dt: FIXED_DT,
  });
  boostSys.requestActivate();

  // Step 240 steps = 2.0s
  for (let i = 0; i < 240; i++) {
    const bRes = boostSys.step({
      x: carBoosted.x,
      y: carBoosted.y,
      forwardSpeed: carBoosted.u,
      forwardInput: true,
      brakeInput: false,
      handbrakeInput: false,
      canActivate: true,
      dt: FIXED_DT,
    });
    carNormal.step({ throttle: 1, brake: 0, steer: 0, handbrake: false }, FIXED_DT);
    carBoosted.step(
      {
        throttle: 1,
        brake: 0,
        steer: 0,
        handbrake: false,
        boostAccel: bRes.currentBoostAccel,
        boostMaxSpeed: bRes.maxBoostSpeed,
      },
      FIXED_DT,
    );
  }

  assert.equal(boostSys.getSnapshot().status, 'empty');
  assert.equal(boostSys.getSnapshot().remainingTime, 0);
  assert(
    carBoosted.speed > carNormal.speed + 8.0,
    `Expected boosted speed (${carBoosted.speed.toFixed(2)}) > normal speed (${carNormal.speed.toFixed(2)}) + 8 m/s`,
  );
  assert(
    carBoosted.x > carNormal.x + 10.0,
    `Expected boosted distance (${carBoosted.x.toFixed(2)}) > normal distance (${carNormal.x.toFixed(2)}) + 10 m`,
  );
});

test('9. Does not apply forward boost acceleration when brake or handbrake is pressed', () => {
  const boostSys = new BoostSystem(NEON_CIRCUIT_TRACK);
  const pad0 = NEON_CIRCUIT_TRACK.boostPads[0];
  boostSys.rebasePose(pad0.x - 1, pad0.y);
  boostSys.step({
    x: pad0.x + 1,
    y: pad0.y,
    forwardSpeed: 20,
    forwardInput: true,
    brakeInput: false,
    handbrakeInput: false,
    canActivate: true,
    dt: FIXED_DT,
  });

  // Cannot activate while braking
  boostSys.requestActivate();
  const blockedRes = boostSys.step({
    x: pad0.x + 2,
    y: pad0.y,
    forwardSpeed: 20,
    forwardInput: true,
    brakeInput: true,
    handbrakeInput: false,
    canActivate: true,
    dt: FIXED_DT,
  });
  assert.equal(blockedRes.activated, false);
  assert.equal(blockedRes.currentBoostAccel, 0);
  assert.equal(boostSys.getSnapshot().status, 'ready');

  // Activate cleanly without brake
  boostSys.requestActivate();
  const activeRes = boostSys.step({
    x: pad0.x + 3,
    y: pad0.y,
    forwardSpeed: 20,
    forwardInput: true,
    brakeInput: false,
    handbrakeInput: false,
    canActivate: true,
    dt: FIXED_DT,
  });
  assert.equal(activeRes.activated, true);
  assert(activeRes.currentBoostAccel > 0);

  // Pressing handbrake during active boost zeroes out currentBoostAccel
  const hbRes = boostSys.step({
    x: pad0.x + 4,
    y: pad0.y,
    forwardSpeed: 20,
    forwardInput: true,
    brakeInput: false,
    handbrakeInput: true,
    canActivate: true,
    dt: FIXED_DT,
  });
  assert.equal(hbRes.currentBoostAccel, 0);
});

test('10. Respawn restores car to last valid checkpoint, repairs damage, adds +5s penalty, clears boost, and rebases segment', () => {
  const engine = new GameEngine({ headless: true, initialMode: 'neon_circuit' });
  engine.init(null);
  engine.startRaceCountdown();

  // Finish 3s countdown
  for (let i = 0; i < 361; i++) {
    engine.advanceSimulation({ throttle: 0 }, FIXED_DT);
  }

  // Pass CP1 and collect Boost Pad 0
  const pad0 = NEON_CIRCUIT_TRACK.boostPads[0];
  engine.raceSession.boost.rebasePose(pad0.x - 1, pad0.y);
  engine.phys.reset(pad0.x + 1, pad0.y, pad0.heading);
  engine.advanceSimulation({ throttle: 1 }, FIXED_DT);
  assert.equal(engine.raceSession.getSnapshot().boost.status, 'ready');

  const cp1 = NEON_CIRCUIT_TRACK.checkpoints[0];
  crossGateCenterForward(engine.raceSession, cp1);
  assert.equal(engine.raceSession.getSnapshot().checkpoint.nextCheckpointIndex, 1);

  // Inflict engine/steering damage and move far away near CP3
  engine.phys.engineHealth = 0.5;
  engine.phys.steeringHealth = 0.5;
  const cp3 = NEON_CIRCUIT_TRACK.checkpoints[2];
  engine.phys.reset(cp3.x, cp3.y, cp3.respawn.heading);

  // Respawn via KeyR
  engine.toggleKey('KeyR');

  const snapAfter = engine.getSnapshot();
  assert(snapAfter.race !== null);
  assert.equal(snapAfter.race.penaltyTime, RESPAWN_PENALTY_SECONDS);
  assert.equal(snapAfter.race.respawnCount, 1);
  assert.equal(snapAfter.race.boost.status, 'empty');
  assert.equal(
    snapAfter.race.boost.availablePadIds.includes(pad0.id),
    false,
    'Already-collected pad in current lap stays consumed after respawn',
  );
  assert.equal(engine.phys.engineHealth, 1);
  assert.equal(engine.phys.steeringHealth, 1);
  assert.equal(engine.phys.speed, 0);
  assert(Math.hypot(engine.phys.x - cp1.respawn.x, engine.phys.y - cp1.respawn.y) < 1e-4);

  // Stepping from respawned pose must not falsely trigger CP2
  engine.advanceSimulation({ throttle: 1 }, FIXED_DT);
  assert.equal(engine.raceSession.getSnapshot().checkpoint.nextCheckpointIndex, 1);
  engine.dispose();
});

test('11. Blocks KeyF, KeyV, and KeyY in Race mode while keeping them working in Poligon mode', () => {
  const engine = new GameEngine({ headless: true, initialMode: 'neon_circuit' });
  engine.init(null);
  engine.startRaceCountdown();
  for (let i = 0; i < 361; i++) {
    engine.advanceSimulation({}, FIXED_DT);
  }

  engine.phys.engineHealth = 0.6;
  const xBefore = engine.phys.x;

  // Attempt free repair (KeyF), crash test (KeyV), and slow-motion (KeyY) in Race mode
  engine.toggleKey('KeyF');
  assert.equal(engine.phys.engineHealth, 0.6, 'KeyF must be blocked in Race mode');

  engine.toggleKey('KeyV');
  assert.equal(engine.phys.x, xBefore, 'KeyV crash test must be blocked in Race mode');

  engine.toggleKey('KeyY');
  assert.equal(engine.getSnapshot().slowMotion, false, 'KeyY slowMotion must be blocked in Race mode');

  // Switch to Poligon mode and verify KeyF, KeyV, KeyY work as expected
  engine.setMode('proving_ground');
  engine.start('proving_ground');
  engine.phys.engineHealth = 0.6;

  engine.toggleKey('KeyF');
  assert.equal(engine.phys.engineHealth, 1, 'KeyF repairs car in Poligon mode');

  engine.toggleKey('KeyY');
  assert.equal(engine.getSnapshot().slowMotion, true, 'KeyY toggles slowMotion in Poligon mode');

  engine.toggleKey('KeyV');
  assert(Math.abs(engine.phys.u - 80 / 3.6) < 0.01, 'KeyV launches 80 km/h crash test in Poligon mode');

  // Verify Poligon CarPhysics regression (default boostAccel = 0 is bit-for-bit identical)
  const pA = new CarPhysics();
  const pB = new CarPhysics();
  pA.reset(0, 0, 0);
  pB.reset(0, 0, 0);
  for (let i = 0; i < 120; i++) {
    pA.step({ throttle: 0.8, steer: 0.15 }, FIXED_DT);
    pB.step({ throttle: 0.8, steer: 0.15, boostAccel: 0 }, FIXED_DT);
  }
  assert.equal(pA.x, pB.x);
  assert.equal(pA.y, pB.y);
  assert.equal(pA.u, pB.u);

  engine.dispose();
});

test('12. Fixed-step race and boost timers are identical across 30, 60, and 144 FPS frame delivery', () => {
  const runAtFps = (fps: number) => {
    const session = new RaceSession(NEON_CIRCUIT_TRACK);
    session.startCountdown();

    const frameDt = 1 / fps;
    const totalSeconds = 6.0; // 3.0s countdown + 3.0s racing (with 2.0s boost)
    const frameCount = Math.round(totalSeconds * fps);
    let acc = 0;
    let boostTriggered = false;

    for (let f = 0; f < frameCount; f++) {
      acc += frameDt;
      while (acc >= FIXED_DT - 1e-12) {
        if (session.getPhase() === 'racing' && !boostTriggered) {
          boostTriggered = true;
          const pad0 = NEON_CIRCUIT_TRACK.boostPads[0];
          session.boost.rebasePose(pad0.x - 1, pad0.y);
          session.step({
            x: pad0.x + 1,
            y: pad0.y,
            heading: 0,
            vx: 20,
            vy: 0,
            forwardSpeed: 20,
            forwardInput: true,
            brakeInput: false,
            handbrakeInput: false,
            dt: FIXED_DT,
          });
          session.requestBoost();
        } else {
          const pt = sampleTrackAtS(NEON_CIRCUIT_TRACK.samples, NEON_CIRCUIT_TRACK.totalLength, 5);
          session.step({
            x: pt.x,
            y: pt.y,
            heading: pt.heading,
            vx: 20,
            vy: 0,
            forwardSpeed: 20,
            forwardInput: true,
            brakeInput: false,
            handbrakeInput: false,
            dt: FIXED_DT,
          });
        }
        acc -= FIXED_DT;
      }
    }
    return session.getSnapshot();
  };

  const snap30 = runAtFps(30);
  const snap60 = runAtFps(60);
  const snap144 = runAtFps(144);

  assert(Math.abs(snap30.rawTotalTime - (6.0 - COUNTDOWN_SECONDS)) < 1e-6);
  assert(Math.abs(snap30.rawTotalTime - snap60.rawTotalTime) < 1e-9);
  assert(Math.abs(snap60.rawTotalTime - snap144.rawTotalTime) < 1e-9);
  assert.equal(snap30.boost.boostsUsed, 1);
  assert.equal(snap60.boost.boostsUsed, 1);
  assert.equal(snap144.boost.boostsUsed, 1);
  assert.equal(snap30.boost.status, 'empty');
  assert.equal(snap60.boost.status, 'empty');
  assert.equal(snap144.boost.status, 'empty');
});

test('13. Full 3-lap Neon Circuit race completed via real CarPhysics, collisions, checkpoints, and boost using waypoint steering/throttle controller', () => {
  const engine = new GameEngine({ headless: true, initialMode: 'neon_circuit' });
  engine.init(null);
  engine.startRaceCountdown();

  // Complete 3.0s countdown
  for (let i = 0; i < 361; i++) {
    engine.advanceSimulation({ throttle: 0 }, FIXED_DT);
  }
  assert.equal(engine.raceSession.getPhase(), 'racing');

  const wrapAng = (a: number): number => {
    let r = (a + Math.PI) % (Math.PI * 2);
    if (r < 0) r += Math.PI * 2;
    return r - Math.PI;
  };

  const samples = NEON_CIRCUIT_TRACK.samples;
  const totalLen = NEON_CIRCUIT_TRACK.totalLength;
  const maxSteps = 120 * 140; // max 140s of simulated driving
  let stepCount = 0;

  while (engine.raceSession.getPhase() === 'racing' && stepCount < maxSteps) {
    const x = engine.phys.x;
    const y = engine.phys.y;
    const heading = engine.phys.heading;
    const speedMps = engine.phys.speed;
    const yawRate = engine.phys.r;

    // Find closest sample on track
    let bestIdx = 0;
    let bestDistSq = Infinity;
    for (let i = 0; i < samples.length; i++) {
      const dx = x - samples[i].x;
      const dy = y - samples[i].y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestDistSq) {
        bestDistSq = d2;
        bestIdx = i;
      }
    }
    const curS = samples[bestIdx].s;
    const lookaheadDist = Math.max(13, Math.min(22, speedMps * 0.72));
    const nearPt = sampleTrackAtS(samples, totalLen, curS + lookaheadDist);
    const farPt = sampleTrackAtS(samples, totalLen, curS + 32);

    const targetAngle = Math.atan2(nearPt.y - y, nearPt.x - x);
    const angleErr = wrapAng(targetAngle - heading);
    const curveAngle = Math.abs(wrapAng(farPt.heading - samples[bestIdx].heading));

    // Activate boost on straights when ready
    const raceSnap = engine.raceSession.getSnapshot();
    if (raceSnap.boost.status === 'ready' && curveAngle < 0.14 && Math.abs(angleErr) < 0.12) {
      engine.activateBoost();
    }

    let targetSpeed = 46;
    if (curveAngle > 0.42) {
      targetSpeed = 19.5;
    } else if (curveAngle > 0.22) {
      targetSpeed = 25;
    } else if (curveAngle > 0.10) {
      targetSpeed = 33;
    }

    const steer = Math.max(-1, Math.min(1, angleErr * 2.4 - yawRate * 0.22));
    let throttle = 1;
    let brake = 0;
    if (speedMps > targetSpeed + 2.2) {
      throttle = 0;
      brake = Math.min(0.75, (speedMps - targetSpeed) * 0.18);
    } else if (speedMps > targetSpeed) {
      throttle = 0.25;
    }

    engine.advanceSimulation({ throttle, brake, steer, analog: true }, FIXED_DT);
    stepCount++;
  }

  const finalSnap = engine.getSnapshot();
  assert(finalSnap.race !== null);
  assert.equal(finalSnap.race.phase, 'finished', `Expected race to finish within ${maxSteps} steps (took ${stepCount})`);
  assert.equal(finalSnap.race.currentLap, 3);
  assert.equal(finalSnap.race.lapTimes.length, 3);
  assert(finalSnap.race.bestLapTime !== null && finalSnap.race.bestLapTime > 10);
  assert(finalSnap.race.boost.boostsUsed >= 1, 'Expected at least 1 boost used during 3-lap race');
  engine.dispose();
});
