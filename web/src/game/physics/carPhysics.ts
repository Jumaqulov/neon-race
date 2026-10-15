// ---------------------------------------------------------------
// CarPhysics V3 — four contact patches, rear-wheel drive; no Three.js dependency.
// 2D top-down world: X = three.x, Y = -three.z.
// heading 0 faces +X, positive heading/yaw-rate = turning left (CCW).
// Body frame: u = forward speed, v = sideways speed (+ = left), r = yaw rate.
// ---------------------------------------------------------------
import type { DamageZones, GameInput, ImpactEvent, SurfaceType, WheelDamageOffset } from '../../shared/types.ts';

export const clamp = (x: number, a: number, b: number): number => (x < a ? a : x > b ? b : x);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smooth = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

export interface CarPhysicsParams {
  mass: number;
  inertia: number;
  a: number;
  b: number;
  L: number;
  track: number;
  cgHeight: number;
  wheelRadius: number;
  halfLength: number;
  halfWidth: number;
  muF: number;
  muR: number;
  tyreB: number;
  tyreC: number;
  torque: Array<[number, number]>;
  idle: number;
  redline: number;
  gears: number[];
  reverse: number;
  final: number;
  eff: number;
  upRpm: number;
  downRpm: number;
  shiftTime: number;
  brake: number;
  brakeBias: number;
  handbrakeMu: number;
  drag: number;
  maxSteer: number;
  steerRate: number;
  steerReturn: number;
  tcs: boolean;
  grip: number;
}

export interface PhysicsWheelState {
  front: boolean;
  left: boolean;
  x: number;
  y: number;
  spin: number;
  omega: number;
  steer: number;
  load: number;
  slip: number;
  alpha: number;
  fx: number;
  fy: number;
  toe: number;
  damage: number;
  road: number;
}

export interface CarBounds {
  front: number;
  rear: number;
  left: number;
  right: number;
}

export interface SuspensionState {
  heave: number;
  heaveV: number;
  roll: number;
  rollV: number;
  pitch: number;
  pitchV: number;
}

export interface WheelDamageCarrier {
  damage?: WheelDamageOffset | null;
}

// Four contact patches, load transfer and a spring/damper sprung body.
// SI units; planar chassis motion. This is a game model, not a vehicle-safety solver.
export class CarPhysics {
  public p: CarPhysicsParams;
  public wheels: PhysicsWheelState[];
  public x = 0;
  public y = 0;
  public heading = 0;
  public u = 0;
  public v = 0;
  public r = 0;
  public steer = 0;
  public steerIn = 0;
  public gear = 1;
  public rpm = 850;
  public shiftT = 0;
  public ax = 0;
  public ay = 0;
  public axS = 0;
  public ayS = 0;
  public thr = 0;
  public brk = 0;
  public hb = false;
  public spinF = 0;
  public spinR = 0;
  public slipF = 0;
  public slipR = 0;
  public wheelspin = 0;
  public limiter = false;
  public tcsActive = false;
  public absActive = false;
  public beta = 0;
  public braking = false;
  public reverseHold = 0;
  public time = 0;
  public engineHealth = 1;
  public steeringHealth = 1;
  public engineFactor = 1;
  public alignment = 0;
  public impactPulse = 0;
  public bounds: CarBounds = { front: 2.44, rear: 2.44, left: 0.97, right: 0.97 };
  public suspension: SuspensionState = { heave: 0, heaveV: 0, roll: 0, rollV: 0, pitch: 0, pitchV: 0 };
  public onImpact?: (event: ImpactEvent) => void;

  constructor(opts: Partial<CarPhysicsParams> = {}) {
    const defaults: CarPhysicsParams = {
      mass: 1450,
      inertia: 2920,
      a: 1.42,
      b: 1.42,
      L: 2.84,
      track: 1.60,
      cgHeight: 0.49,
      wheelRadius: 0.37,
      halfLength: 2.44,
      halfWidth: 0.97,
      muF: 1.06,
      muR: 1.10,
      tyreB: 10.5,
      tyreC: 1.42,
      torque: [
        [800, 290],
        [1500, 370],
        [2500, 455],
        [3500, 510],
        [4500, 525],
        [5500, 505],
        [6500, 445],
        [7200, 380],
      ],
      idle: 850,
      redline: 6800,
      gears: [2.95, 1.95, 1.42, 1.10, 0.87],
      reverse: 3.1,
      final: 3.7,
      eff: 0.85,
      upRpm: 6300,
      downRpm: 2450,
      shiftTime: 0.23,
      brake: 16100,
      brakeBias: 0.63,
      handbrakeMu: 0.72,
      drag: 0.48,
      maxSteer: 0.60,
      steerRate: 2.8,
      steerReturn: 4.7,
      tcs: true,
      grip: 1,
    };
    this.p = Object.assign(defaults, opts);
    this.p.L = this.p.a + this.p.b;
    this.wheels = [
      { front: true, left: true },
      { front: true, left: false },
      { front: false, left: true },
      { front: false, left: false },
    ].map((w) => ({
      ...w,
      x: w.front ? this.p.a : -this.p.b,
      y: (w.left ? 1 : -1) * (this.p.track / 2),
      spin: 0,
      omega: 0,
      steer: 0,
      load: 0,
      slip: 0,
      alpha: 0,
      fx: 0,
      fy: 0,
      toe: 0,
      damage: 0,
      road: 0,
    }));
    this.reset(0, 0, 0);
  }

  reset(x = 0, y = 0, heading = 0): void {
    Object.assign(this, {
      x,
      y,
      heading,
      u: 0,
      v: 0,
      r: 0,
      steer: 0,
      steerIn: 0,
      gear: 1,
      rpm: this.p.idle,
      shiftT: 0,
      ax: 0,
      ay: 0,
      axS: 0,
      ayS: 0,
      thr: 0,
      brk: 0,
      hb: false,
      spinF: 0,
      spinR: 0,
      slipF: 0,
      slipR: 0,
      wheelspin: 0,
      limiter: false,
      tcsActive: false,
      absActive: false,
      beta: 0,
      braking: false,
      reverseHold: 0,
      time: 0,
      engineHealth: 1,
      steeringHealth: 1,
      engineFactor: 1,
      alignment: 0,
      impactPulse: 0,
    });
    this.bounds = {
      front: this.p.halfLength,
      rear: this.p.halfLength,
      left: this.p.halfWidth,
      right: this.p.halfWidth,
    };
    this.suspension = { heave: 0, heaveV: 0, roll: 0, rollV: 0, pitch: 0, pitchV: 0 };
    this.wheels.forEach((w) =>
      Object.assign(w, {
        spin: 0,
        omega: 0,
        load: (this.p.mass * 9.81) / 4,
        slip: 0,
        alpha: 0,
        fx: 0,
        fy: 0,
        toe: 0,
        damage: 0,
        road: 0,
        steer: 0,
      }),
    );
  }

  get speed(): number {
    return Math.hypot(this.u, this.v);
  }

  torqueAt(rpm: number): number {
    const t = this.p.torque;
    if (rpm <= t[0][0]) return t[0][1];
    for (let i = 1; i < t.length; i++) {
      if (rpm <= t[i][0]) {
        return lerp(t[i - 1][1], t[i][1], (rpm - t[i - 1][0]) / (t[i][0] - t[i - 1][0]));
      }
    }
    return t[t.length - 1][1];
  }

  tyre(alpha: number): number {
    return Math.sin(this.p.tyreC * Math.atan(this.p.tyreB * alpha));
  }

  worldVel(out?: [number, number]): [number, number] {
    const c = Math.cos(this.heading);
    const s = Math.sin(this.heading);
    const res: [number, number] = out || [0, 0];
    res[0] = this.u * c - this.v * s;
    res[1] = this.u * s + this.v * c;
    return res;
  }

  setWorldVel(vx: number, vy: number): void {
    const c = Math.cos(this.heading);
    const s = Math.sin(this.heading);
    this.u = vx * c + vy * s;
    this.v = -vx * s + vy * c;
  }

  corners(): Array<[number, number]> {
    const c = Math.cos(this.heading);
    const s = Math.sin(this.heading);
    const b = this.bounds;
    return (
      [
        [b.front, b.left],
        [b.front, -b.right],
        [-b.rear, b.left],
        [-b.rear, -b.right],
      ] as Array<[number, number]>
    ).map(([x, y]) => [this.x + x * c - y * s, this.y + x * s + y * c]);
  }

  setDamage(zones: Partial<DamageZones>, wheels?: WheelDamageCarrier[]): void {
    const f = clamp(zones.front || 0, 0, 1);
    const r = clamp(zones.rear || 0, 0, 1);
    this.engineHealth = clamp(1 - smooth(0.25, 1, f) * 0.76, 0.24, 1);
    this.engineFactor = this.engineHealth;
    let worst = 0;
    let alignment = 0;
    this.wheels.forEach((w, i) => {
      const d = wheels && wheels[i] ? wheels[i].damage : null;
      w.toe = d ? d.toe : 0;
      w.damage = d ? clamp(Math.abs(d.camber) * 3 + d.inset * 4 + Math.abs(d.toe) * 2, 0, 0.75) : 0;
      if (w.front) {
        worst = Math.max(worst, w.damage);
        alignment += w.toe * 0.5;
      }
    });
    this.steeringHealth = 1 - worst;
    this.alignment = alignment;
    // The crushable nose/tail recede, while the wheelbase and occupant cell stay rigid.
    this.bounds.front = Math.max(1.77, this.p.halfLength - f * 0.58);
    this.bounds.rear = Math.max(1.82, this.p.halfLength - r * 0.48);
  }

  step(input: GameInput = {}, dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    dt = Math.min(dt, 1 / 60);
    const p = this.p;
    const m = p.mass;
    const g = 9.81;
    const spd = this.speed;
    const throttle = clamp(Number(input.throttle) || 0, 0, 1);
    const brake = clamp(Number(input.brake) || 0, 0, 1);
    const hb = !!input.handbrake;
    this.time += dt;
    this.impactPulse *= Math.exp(-dt * 9);
    // Require a deliberate standstill hold. A spin or a rearward bounce cannot select reverse.
    const opposite = this.gear > 0 ? brake > 0.15 && throttle < 0.05 : throttle > 0.15 && brake < 0.05;
    if (opposite && spd < 0.6) {
      this.reverseHold += dt;
      if (this.reverseHold > 0.30) {
        this.gear = this.gear > 0 ? -1 : 1;
        this.reverseHold = 0;
      }
    } else {
      this.reverseHold = 0;
    }
    const fwd = this.gear > 0;
    const dir = fwd ? 1 : -1;
    const thr = fwd ? throttle : brake;
    const brk = fwd ? brake : throttle;
    const sIn = clamp(Number(input.steer) || 0, -1, 1);
    const returning = Math.abs(sIn) < Math.abs(this.steerIn) || sIn * this.steerIn < 0;
    const steerRate =
      (returning ? p.steerReturn : p.steerRate) *
      (input.analog ? 2.5 : 1) *
      lerp(1, 0.7, smooth(12, 42, spd));
    this.steerIn += clamp(sIn - this.steerIn, -steerRate * dt, steerRate * dt);
    const range = lerp(p.maxSteer, 0.145, smooth(3, 34, spd));
    const caster = this.u > 2 ? Math.atan2(this.v, this.u) * 0.52 * smooth(3, 10, spd) : 0;
    const target = clamp(this.steerIn * range + caster, -p.maxSteer, p.maxSteer);
    this.steer += clamp(target - this.steer, -3.7 * dt, 3.7 * dt);
    this.shiftT = Math.max(0, this.shiftT - dt);
    let ratio = (fwd ? p.gears[this.gear - 1] : p.reverse) * p.final;
    let wheelRpm = ((Math.abs(this.u) / p.wheelRadius) * 60) / (2 * Math.PI) * ratio;
    if (fwd && this.shiftT === 0 && !hb && Math.abs(this.beta) < 0.26) {
      if (wheelRpm > p.upRpm && this.gear < p.gears.length) {
        this.gear++;
        this.shiftT = p.shiftTime;
      } else if (
        this.gear > 1 &&
        wheelRpm < (thr > 0.85 ? 3100 : p.downRpm) &&
        (wheelRpm * p.gears[this.gear - 2]) / p.gears[this.gear - 1] < p.upRpm - 550
      ) {
        this.gear--;
        this.shiftT = p.shiftTime * 0.75;
      }
      ratio = p.gears[this.gear - 1] * p.final;
      wheelRpm = ((Math.abs(this.u) / p.wheelRadius) * 60) / (2 * Math.PI) * ratio;
    }
    const launchRpm = p.idle + thr * 2300;
    const torqueRpm = Math.max(p.idle, wheelRpm, Math.abs(this.gear) === 1 ? launchRpm : 0);
    this.limiter = wheelRpm > p.redline || (!fwd && Math.abs(this.u) > 15);
    let drive = ((dir * this.torqueAt(torqueRpm) * thr * ratio * p.eff) / p.wheelRadius) * this.engineFactor;
    if (this.limiter || this.shiftT > 0 || hb) drive = 0;
    const Fzf = clamp((m * (g * p.b - this.axS * p.cgHeight)) / p.L, m * g * 0.13, m * g * 0.87);
    const Fzr = m * g - Fzf;
    const transfer = (m * this.ayS * p.cgHeight) / p.track;
    let Fx = 0;
    let Fy = 0;
    let Mz = 0;
    let maxSpin = 0;
    this.tcsActive = false;
    this.absActive = false;
    const oldH = this.heading;
    const c = Math.cos(oldH);
    const s = Math.sin(oldH);
    const oldU = this.u;
    const oldV = this.v;
    const oldR = this.r;
    const oldVX = oldU * c - oldV * s;
    const oldVY = oldU * s + oldV * c;
    for (const w of this.wheels) {
      const axleLoad = w.front ? Fzf : Fzr;
      const lat = transfer * (w.front ? p.b / p.L : p.a / p.L);
      w.load = clamp(axleLoad * 0.5 + (w.left ? -lat : lat), axleLoad * 0.08, axleLoad * 0.92);
      // Ackermann: the inside front wheel follows a tighter turn radius.
      let delta = 0;
      if (w.front && Math.abs(this.steer) > 0.0001) {
        const R = p.L / Math.tan(this.steer);
        delta = Math.atan(p.L / (R - w.y));
      }
      delta += w.toe;
      w.steer = delta;
      const cd = Math.cos(delta);
      const sd = Math.sin(delta);
      const vfx = oldU - oldR * w.y;
      const vfy = oldV + oldR * w.x;
      const wx = vfx * cd + vfy * sd;
      const wy = -vfx * sd + vfy * cd;
      const alpha = Math.atan2(wy, Math.max(Math.abs(wx), 1.25));
      w.alpha += (alpha - w.alpha) * (1 - Math.exp((-Math.max(Math.abs(wx), 4) * dt) / 0.32));
      // Tyre load sensitivity: doubling normal load gives slightly less than double grip.
      const sensitivity = clamp(1 - 0.085 * (w.load / ((m * g) / 4) - 1), 0.84, 1.12);
      const grip = Math.max(1, (w.front ? p.muF : p.muR) * p.grip * w.load * sensitivity * (1 - w.damage * 0.37));
      let fy = -grip * this.tyre(w.alpha);
      let fx = 0;
      let spin = 0;
      const brakeDemand = brk * p.brake * (w.front ? p.brakeBias : 1 - p.brakeBias) * 0.5;
      if (!w.front && hb) {
        const v = Math.hypot(wx, wy);
        const k = (p.handbrakeMu * grip) / Math.max(v, 0.9);
        fx = -wx * k;
        fy = -wy * k;
      } else {
        let wheelDrive = w.front ? 0 : drive * 0.5;
        if (!w.front && p.tcs) {
          const available = Math.sqrt(Math.max(0, grip * grip - fy * fy));
          const cap = Math.max(grip * 0.18, available * 0.98);
          if (Math.abs(wheelDrive) > cap) {
            wheelDrive = Math.sign(wheelDrive) * cap;
            this.tcsActive = thr > 0.12;
          }
        }
        let braking = -brakeDemand * Math.tanh(wx * 2.5);
        if (Math.abs(braking) > grip * 0.93) {
          braking = Math.sign(braking) * grip * 0.93;
          this.absActive = brk > 0.15;
        }
        const engineBrake =
          !w.front && thr < 0.04 && this.shiftT <= 0
            ? -Math.tanh(wx * 0.8) * (110 + 27 * ratio) * this.engineFactor
            : 0;
        const request = wheelDrive + braking + engineBrake;
        fx = clamp(request, -grip * 0.98, grip * 0.98);
        if (!w.front && thr > 0.1 && Math.abs(wheelDrive) > grip) {
          spin = clamp((Math.abs(wheelDrive) - grip) / grip, 0, 1);
          fx *= 0.87;
        }
        fy *= Math.sqrt(Math.max(0, 1 - (fx / grip) ** 2));
        if (spin > 0) fy *= 1 - spin * 0.48;
      }
      fx -= (43 + 125 * w.damage) * Math.tanh(wx * 2.5) + 1.4 * wx;
      const fxBody = fx * cd - fy * sd;
      const fyBody = fx * sd + fy * cd;
      Fx += fxBody;
      Fy += fyBody;
      Mz += w.x * fyBody - w.y * fxBody;
      w.fx = fx;
      w.fy = fy;
      maxSpin = Math.max(maxSpin, spin);
      w.slip = Math.max(
        smooth(0.13, 0.32, Math.abs(w.alpha)) * smooth(2, 6, spd),
        spin,
        hb && !w.front ? smooth(1.5, 5, spd) : 0,
      );
      const desiredOmega = hb && !w.front ? 0 : wx / p.wheelRadius + (!w.front ? spin * dir * 43 : 0);
      w.omega += (desiredOmega - w.omega) * (1 - Math.exp(-dt * 25));
      w.spin += w.omega * dt;
      const gx = this.x + w.x * c - w.y * s;
      const gy = this.y + w.x * s + w.y * c;
      w.road = 0.0018 * Math.sin(gx * 1.35 + gy * 0.5) + 0.0012 * Math.sin(gx * 3.7 - gy * 2.2);
    }
    Fx -= p.drag * oldU * spd;
    Fy -= p.drag * oldV * spd;
    const boostAccel = input.boostAccel ?? 0;
    if (boostAccel > 0 && !hb && brk < 0.05 && (fwd || oldU > 0.25)) {
      const maxBoostSpeed = input.boostMaxSpeed ?? 60.0;
      if (oldU < maxBoostSpeed) {
        const taper = clamp((maxBoostSpeed - oldU) / 6.0, 0, 1);
        Fx += m * boostAccel * taper;
      }
    }
    // Damping only represents small drivetrain/bearing losses, not an artificial yaw lock.
    Mz -= oldR * 95;
    this.ax = Fx / m;
    this.ay = Fy / m;
    let vx = oldVX + (this.ax * c - this.ay * s) * dt;
    let vy = oldVY + (this.ax * s + this.ay * c) * dt;
    this.r = oldR + (Mz / p.inertia) * dt;
    this.heading = oldH + (oldR + this.r) * 0.5 * dt;
    this.setWorldVel(vx, vy);
    // A low-speed constraint removes singular slip angles without frame-dependent snapping.
    const blend = (1 - smooth(0.4, 3.2, Math.hypot(this.u, this.v))) * (1 - Math.exp(-dt * 25));
    if (blend > 0) {
      const yaw = (this.u * Math.tan(this.steer)) / p.L;
      this.r = lerp(this.r, yaw, blend);
      this.v = lerp(this.v, yaw * p.b, blend);
    }
    if (thr < 0.015 && boostAccel <= 0 && Math.abs(this.u) < 0.045 && Math.abs(this.v) < 0.045) {
      this.u = this.v = this.r = 0;
    }
    const nc = Math.cos(this.heading);
    const ns = Math.sin(this.heading);
    vx = this.u * nc - this.v * ns;
    vy = this.u * ns + this.v * nc;
    this.x += (oldVX + vx) * 0.5 * dt;
    this.y += (oldVY + vy) * 0.5 * dt;
    const filter = 1 - Math.exp(-dt * 9);
    this.axS += (this.ax - this.axS) * filter;
    this.ayS += (this.ay - this.ayS) * filter;
    this.thr = thr;
    this.brk = brk;
    this.hb = hb;
    this.braking = brk > 0.05 && spd > 0.2;
    this.wheelspin = maxSpin;
    this.spinF = (this.wheels[0].spin + this.wheels[1].spin) / 2;
    this.spinR = (this.wheels[2].spin + this.wheels[3].spin) / 2;
    this.slipF = Math.max(this.wheels[0].slip, this.wheels[1].slip);
    this.slipR = Math.max(this.wheels[2].slip, this.wheels[3].slip);
    this.beta = this.speed > 1.5 ? Math.atan2(this.v, Math.abs(this.u)) : 0;
    let rpmT =
      Math.max(p.idle, wheelRpm, Math.abs(this.gear) === 1 && thr > 0 ? launchRpm : 0) + maxSpin * 1700;
    if (hb) rpmT = p.idle + thr * 4700;
    if (this.shiftT > 0) rpmT = Math.max(p.idle, rpmT - 600);
    rpmT = Math.min(rpmT, p.redline + (this.limiter ? -100 + 90 * Math.sin(this.time * 90) : 100));
    this.rpm += (rpmT - this.rpm) * (1 - Math.exp(-dt * 13));
    this.stepSuspension(dt);
  }

  stepSuspension(dt: number): void {
    const q = this.suspension;
    const m = this.p.mass * 0.88;
    const k = 32500;
    const d = 2850;
    let fy = 0;
    let rollM = this.p.mass * this.ayS * 0.31;
    let pitchM = this.p.mass * this.axS * 0.32;
    for (const w of this.wheels) {
      const h = q.heave + q.roll * w.y + q.pitch * w.x;
      const vel = q.heaveV + q.rollV * w.y + q.pitchV * w.x;
      const force = k * (w.road - h) - d * vel;
      fy += force;
      rollM += w.y * force;
      pitchM += w.x * force;
    }
    // Anti-roll stiffness with finite travel and bump stops.
    rollM -= q.roll * 16000;
    pitchM -= q.pitch * 17000;
    q.heaveV += (fy / m) * dt;
    q.rollV += (rollM / 690) * dt;
    q.pitchV += (pitchM / 2450) * dt;
    q.heave = clamp(q.heave + q.heaveV * dt, -0.10, 0.10);
    q.roll = clamp(q.roll + q.rollV * dt, -0.15, 0.15);
    q.pitch = clamp(q.pitch + q.pitchV * dt, -0.13, 0.13);
  }

  contact(
    px: number,
    py: number,
    nx: number,
    ny: number,
    depth: number,
    e = 0.1,
    mu = 0.32,
    surface: SurfaceType = 'concrete',
  ): number {
    if (![px, py, nx, ny, depth].every(Number.isFinite)) return 0;
    const nlen = Math.hypot(nx, ny);
    if (nlen < 0.5) return 0;
    nx /= nlen;
    ny /= nlen;
    const p = this.p;
    const m = p.mass;
    const I = p.inertia;
    const c = Math.cos(this.heading);
    const s = Math.sin(this.heading);
    const rx = px - this.x;
    const ry = py - this.y;
    const localX = rx * c + ry * s;
    const localZ = rx * s - ry * c;
    const localNX = nx * c + ny * s;
    const localNZ = nx * s - ny * c;
    const velocity = this.worldVel();
    const beforeVX = velocity[0];
    const beforeVY = velocity[1];
    const beforeR = this.r;
    this.x += nx * Math.max(0, depth - 0.00005);
    this.y += ny * Math.max(0, depth - 0.00005);
    const vn = (beforeVX - beforeR * ry) * nx + (beforeVY + beforeR * rx) * ny;
    if (vn >= 0) return 0;
    // High-energy crush is deliberately inelastic. No pinball-like rebound.
    const restitution = surface === 'tyres' ? Math.min(e, 0.24) : Math.min(e, 0.025 + 0.09 * Math.exp(vn / 5));
    const rn = rx * ny - ry * nx;
    const den = 1 / m + (rn * rn) / I;
    const j = (-(1 + restitution) * vn) / den;
    let vx = beforeVX + (j * nx) / m;
    let vy = beforeVY + (j * ny) / m;
    let r = beforeR + (rn * j) / I;
    const tx = -ny;
    const ty = nx;
    const rt = rx * ty - ry * tx;
    const vt = (vx - r * ry) * tx + (vy + r * rx) * ty;
    const jt = clamp(-vt / (1 / m + (rt * rt) / I), -mu * j, mu * j);
    vx += (jt * tx) / m;
    vy += (jt * ty) / m;
    r += (rt * jt) / I;
    const beforeE = 0.5 * m * (beforeVX * beforeVX + beforeVY * beforeVY) + 0.5 * I * beforeR * beforeR;
    let afterE = 0.5 * m * (vx * vx + vy * vy) + 0.5 * I * r * r;
    if (afterE > beforeE && afterE > 0) {
      const k = Math.sqrt(beforeE / afterE);
      vx *= k;
      vy *= k;
      r *= k;
      afterE = beforeE;
    }
    this.r = r;
    this.setWorldVel(vx, vy);
    const deltaV = Math.hypot(vx - beforeVX, vy - beforeVY);
    this.impactPulse = Math.max(this.impactPulse, clamp(deltaV / 18, 0, 1));
    this.suspension.pitchV = clamp(this.suspension.pitchV - localNX * deltaV * 0.020, -0.65, 0.65);
    this.suspension.rollV = clamp(this.suspension.rollV + localNZ * deltaV * 0.014, -0.65, 0.65);
    if (typeof this.onImpact === 'function') {
      this.onImpact({
        px,
        py,
        nx,
        ny,
        localX,
        localZ,
        localNX,
        localNZ,
        impulse: j,
        normalSpeed: -vn,
        energy: Math.max(0, beforeE - afterE),
        surface,
        height: 0.63,
        deltaV,
        beforeVX,
        beforeVY,
        beforeR,
        postVX: vx,
        postVY: vy,
      });
    }
    return j;
  }
}
