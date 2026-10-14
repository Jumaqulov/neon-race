import test from 'node:test';
import assert from 'node:assert/strict';
import { CarPhysics } from '../src/game/physics/carPhysics.ts';
import { ColliderGrid, collide, type CircleCollider } from '../src/game/physics/collisions.ts';
import { impactDisplacement, makeCrushHit } from '../src/game/damage/deformation.ts';
import type { GameInput, ImpactEvent } from '../src/shared/types.ts';

let phys = new CarPhysics();
let colliderGrid = new ColliderGrid([]);
const setCar = (p: CarPhysics): void => {
  phys = p;
};
const setColliders = (cs: CircleCollider[]): void => {
  colliderGrid = new ColliderGrid(cs);
};
const runCollide = (): number => collide(phys, colliderGrid);

function sim(p: CarPhysics, seconds: number, input: GameInput = {}, dt = 1 / 240): CarPhysics {
  for (let i = 0; i < Math.round(seconds / dt); i++) p.step(input, dt);
  return p;
}

function energy(p: CarPhysics): number {
  return 0.5 * p.p.mass * (p.u * p.u + p.v * p.v) + 0.5 * p.p.inertia * p.r * p.r;
}

function finite(p: CarPhysics): boolean {
  return [p.x, p.y, p.u, p.v, p.r, p.heading, p.rpm, ...Object.values(p.suspension)].every(Number.isFinite);
}

test('Idle stays stationary for 60 seconds', () => {
  const p = sim(new CarPhysics(), 60);
  assert(p.speed < 0.001);
  assert(finite(p));
});

test('Full throttle accelerates straight without lateral drift', () => {
  const p = sim(new CarPhysics(), 10, { throttle: 1 });
  assert(p.speed > 25 && p.speed < 65);
  assert(Math.abs(p.y) < 0.01);
  assert(p.gear >= 2);
  assert(finite(p));
});

test('100 km/h braking is stable and stops before reverse engages', () => {
  const p = new CarPhysics();
  p.u = 100 / 3.6;
  p.gear = 3;
  let t = 0;
  while (p.speed > 0.15 && t < 15) {
    p.step({ brake: 1 }, 1 / 240);
    t += 1 / 240;
  }
  assert(p.speed < 0.15);
  assert(p.x > 25 && p.x < 90);
  assert(p.gear > 0);
});

test('Reverse requires a deliberate standstill hold', () => {
  const p = new CarPhysics();
  sim(p, 0.20, { brake: 1 });
  assert.equal(p.gear, 1);
  sim(p, 2, { brake: 1 });
  assert.equal(p.gear, -1);
  assert(p.u < -0.5);
});

test('A backwards bounce cannot auto-select reverse', () => {
  const p = new CarPhysics();
  p.u = -5;
  sim(p, 0.2, { brake: 1 });
  assert.equal(p.gear, 1);
});

test('Steering produces mirrored left/right turns', () => {
  const a = new CarPhysics();
  const b = new CarPhysics();
  a.u = b.u = 15;
  a.gear = b.gear = 2;
  sim(a, 3, { throttle: 0.3, steer: 0.5 });
  sim(b, 3, { throttle: 0.3, steer: -0.5 });
  assert(a.heading > 0.05);
  assert(b.heading < -0.05);
  assert(Math.abs(a.x - b.x) < 0.02);
  assert(Math.abs(a.y + b.y) < 0.02);
});

test('Ackermann gives the inside front wheel a larger steering angle', () => {
  const p = sim(new CarPhysics(), 1, { throttle: 0.3, steer: 0.75 });
  assert(p.wheels[0].steer > p.wheels[1].steer);
});

test('Wheel normal loads conserve the full vehicle weight', () => {
  const p = sim(new CarPhysics(), 3, { throttle: 1, steer: 0.5 });
  assert(Math.abs(p.wheels.reduce((n, w) => n + w.load, 0) - p.p.mass * 9.81) < 1e-6);
  assert(p.wheels.every((w) => w.load > 0));
});

test('TCS limits power-induced wheelspin', () => {
  const a = sim(new CarPhysics({ tcs: true }), 1, { throttle: 1 });
  const b = sim(new CarPhysics({ tcs: false }), 1, { throttle: 1 });
  assert(a.wheelspin <= b.wheelspin);
});

test('Chassis damage affects engine power, steering and collision footprint', () => {
  const a = new CarPhysics();
  const b = new CarPhysics();
  b.setDamage({ front: 0.95, rear: 0 }, [
    { damage: { toe: 0.08, camber: 0.08, inset: 0.08 } },
    { damage: { toe: 0, camber: 0, inset: 0 } },
  ]);
  sim(a, 8, { throttle: 1 });
  sim(b, 8, { throttle: 1 });
  assert(b.engineHealth < 0.4);
  assert(b.steeringHealth < 0.7);
  assert(b.speed < a.speed * 0.9);
  assert(b.bounds.front < a.bounds.front);
});

test('Direct wall impact dissipates energy, with a small rebound', () => {
  const p = new CarPhysics();
  p.u = 80 / 3.6;
  const before = energy(p);
  let hit: ImpactEvent | undefined;
  p.onImpact = (e) => {
    hit = e;
  };
  p.contact(2.44, 0, -1, 0, 0.02, 0.10, 0.3, 'concrete');
  assert(energy(p) < before * 0.025);
  assert(p.u < 0 && p.u > -2);
  assert(Math.abs(p.r) < 1e-8);
  assert(hit && hit.energy > 200000);
});

test('Oblique collision does not create kinetic energy', () => {
  for (let i = 0; i < 1000; i++) {
    const p = new CarPhysics();
    p.u = 4 + (i % 61);
    p.v = Math.sin(i) * 11;
    p.r = Math.cos(i) * 2;
    p.heading = Math.sin(i * 0.17) * 3;
    const before = energy(p);
    const c = Math.cos(p.heading);
    const s = Math.sin(p.heading);
    const ry = Math.sin(i * 0.37) * 0.94;
    const px = 2.44 * c - ry * s;
    const py = 2.44 * s + ry * c;
    p.contact(px, py, -c, -s, 0.025, 0.13, 0.35, 'concrete');
    const ratio = energy(p) / before;
    assert(ratio <= 1 + 1e-10);
    assert(finite(p));
  }
});

test('High-speed pole cannot be skipped with adaptive microsteps', () => {
  const p = new CarPhysics();
  p.reset(0, 0, 0);
  p.u = 75;
  p.gear = 5;
  setCar(p);
  setColliders([{ x: 8, y: 0, r: 0.25, surface: 'pole' }]);
  let hit = 0;
  p.onImpact = (e) => {
    hit = Math.max(hit, e.impulse);
  };
  for (let i = 0; i < 240; i++) {
    const h = 1 / 120;
    const n = Math.min(8, Math.max(1, Math.ceil(((p.speed + Math.abs(p.r) * 2.8) * h) / 0.14)));
    for (let k = 0; k < n; k++) {
      p.step({}, h / n);
      runCollide();
    }
  }
  assert(hit > 20000);
  assert(p.x < 10);
  assert(finite(p));
});

test('Repeated barrier contact stays finite and inside the arena', () => {
  const p = new CarPhysics();
  p.reset(193, 0, 0);
  p.u = 40;
  setCar(p);
  setColliders([]);
  for (let i = 0; i < 2400; i++) {
    p.step({ throttle: 1, steer: i > 1000 ? 0.15 : 0 }, 1 / 240);
    runCollide();
    assert(finite(p));
  }
  assert(Math.abs(p.x) < 200);
});

test('Crush increases with impact energy and remains bounded', () => {
  let last = 0;
  for (const speed of [5, 10, 20, 30, 50]) {
    const h = makeCrushHit({
      energy: 0.5 * 1450 * speed * speed,
      localNX: -1,
      localNZ: 0,
      localX: 2.44,
      localZ: 0,
      height: 0.63,
      surface: 'concrete',
    });
    assert(h.depth >= last);
    assert(h.depth <= 1.3);
    last = h.depth;
    for (let x = -2.4; x < 2.5; x += 0.1) {
      const d = impactDisplacement(x, 0.8, 0.2, h);
      assert(d.every(Number.isFinite));
      assert(Math.hypot(...d) < 1.8);
    }
  }
});

test('Padded tyre barrier deforms less than concrete', () => {
  const e = { energy: 180000, localNX: -1, localNZ: 0, localX: 2.44, localZ: 0, height: 0.63 };
  assert(makeCrushHit({ ...e, surface: 'tyres' }).depth < makeCrushHit({ ...e, surface: 'concrete' }).depth);
});

test('Invalid dt cannot contaminate physics state', () => {
  const p = new CarPhysics();
  for (const dt of [NaN, Infinity, -0.1, 0]) p.step({ throttle: 1 }, dt);
  assert(p.speed === 0);
  assert(finite(p));
});

test('120 vs 240 Hz integration remains close', () => {
  const a = sim(new CarPhysics(), 8, { throttle: 1 }, 1 / 120);
  const b = sim(new CarPhysics(), 8, { throttle: 1 }, 1 / 240);
  assert(Math.abs(a.speed - b.speed) / b.speed < 0.025);
  assert(Math.abs(a.x - b.x) < 1.5);
});

test('30/60/144 FPS use the same fixed simulation duration', () => {
  const result: number[] = [];
  for (const fps of [30, 60, 144]) {
    const p = new CarPhysics();
    let acc = 0;
    for (let i = 0; i < fps * 6; i++) {
      acc += 1 / fps;
      while (acc >= 1 / 120 - 1e-12) {
        p.step({ throttle: 0.7 }, 1 / 120);
        acc -= 1 / 120;
      }
    }
    result.push(p.x);
  }
  assert(Math.max(...result) - Math.min(...result) < 1e-8);
});

test('Long mixed-input stress run remains finite', () => {
  const p = new CarPhysics({ tcs: false });
  setCar(p);
  setColliders([{ x: 70, y: 25, r: 0.6, surface: 'tyres' }]);
  for (let i = 0; i < 100000; i++) {
    p.step(
      {
        throttle: i % 1900 < 1450 ? 1 : 0,
        brake: i % 4000 > 3100 ? 1 : 0,
        steer: Math.sin(i * 0.004),
        handbrake: i % 3600 > 3100,
      },
      1 / 240,
    );
    runCollide();
    if (!finite(p)) throw new Error('Nonfinite at ' + i);
  }
});
