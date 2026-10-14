import * as THREE from 'three';
import { ARENA, type DamageZoneName, type DamageZones, type ImpactEvent } from '../../shared/types.ts';
import { clamp } from '../physics/carPhysics.ts';
import { isMeshObject } from '../rendering/batching.ts';
import type { CarFixture, MuscleCarModel } from '../vehicle/muscleCar.ts';

interface CrashParticleItem {
  life: number;
  span: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  spark: boolean;
}

export class CrashParticles {
  public readonly max: number;
  public next = 0;
  public activeLast = false;
  public readonly items: CrashParticleItem[];
  public readonly positions: Float32Array;
  public readonly colors: Float32Array;
  public readonly lines: THREE.LineSegments;

  constructor(scene: THREE.Scene, max = 180) {
    this.max = max;
    this.items = Array.from({ length: max }, () => ({
      life: 0,
      span: 1,
      x: 0,
      y: 0,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      spark: false,
    }));
    this.positions = new Float32Array(max * 6);
    this.colors = new Float32Array(max * 6);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    this.lines = new THREE.LineSegments(
      g,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false }),
    );
    this.lines.frustumCulled = false;
    scene.add(this.lines);
  }

  spawn(hit: ImpactEvent): void {
    const count = Math.min(62, Math.floor(8 + Math.sqrt(hit.energy) * 0.075));
    for (let i = 0; i < count; i++) {
      const p = this.items[this.next];
      this.next = (this.next + 1) % this.max;
      Object.assign(p, {
        life: 0.26 + Math.random() * 0.62,
        x: hit.px,
        y: 0.48 + Math.random() * 0.30,
        z: -hit.py,
        vx: hit.nx * (1 + Math.random() * 3) + (Math.random() - 0.5) * 5,
        vz: -hit.ny * (1 + Math.random() * 3) + (Math.random() - 0.5) * 5,
        vy: 1 + Math.random() * 4,
        spark: hit.surface !== 'tyres' && i % 3 !== 0,
      });
      p.span = p.life;
    }
  }

  update(dt: number): void {
    const active = this.items.some((p) => p.life > 0);
    if (!active && !this.activeLast) return;
    this.activeLast = active;
    for (let i = 0; i < this.max; i++) {
      const p = this.items[i];
      const o = i * 6;
      if (p.life <= 0) {
        this.colors.fill(0, o, o + 6);
        this.positions.fill(0, o, o + 6);
        continue;
      }
      p.life -= dt;
      p.vy -= 9.81 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.y < 0.025) {
        p.y = 0.025;
        p.vy = Math.abs(p.vy) * 0.22;
        p.vx *= 0.65;
        p.vz *= 0.65;
      }
      this.positions.set([p.x, p.y, p.z, p.x - p.vx * 0.017, p.y - p.vy * 0.017, p.z - p.vz * 0.017], o);
      const a = clamp(p.life / p.span, 0, 1);
      const color: [number, number, number] = p.spark ? [a, 0.53 * a, 0.11 * a] : [0.37 * a, 0.39 * a, 0.42 * a];
      this.colors.set(color, o);
      this.colors.set([color[0] * 0.25, color[1] * 0.25, color[2] * 0.25], o + 3);
    }
    this.lines.geometry.attributes.position.needsUpdate = true;
    this.lines.geometry.attributes.color.needsUpdate = true;
  }

  clear(): void {
    this.items.forEach((p) => (p.life = 0));
    this.colors.fill(0);
    this.positions.fill(0);
    this.lines.geometry.attributes.position.needsUpdate = true;
    this.lines.geometry.attributes.color.needsUpdate = true;
  }
}

interface LensDebrisItem {
  life: number;
  span: number;
  p: THREE.Vector3;
  v: THREE.Vector3;
  spin: THREE.Vector3;
  angle: THREE.Vector3;
  scale: number;
}

// Pooled triangular lens fragments. They bounce and fade through shrinkage;
// a failed lamp never comes back on until Repair is used.
export class LensDebris {
  public readonly max: number;
  public next = 0;
  public wasActive = false;
  public readonly items: LensDebrisItem[];
  public readonly mesh: THREE.InstancedMesh;
  public readonly dummy = new THREE.Object3D();

  constructor(scene: THREE.Scene, max = 128) {
    this.max = max;
    this.items = Array.from({ length: max }, () => ({
      life: 0,
      span: 1,
      p: new THREE.Vector3(),
      v: new THREE.Vector3(),
      spin: new THREE.Vector3(),
      angle: new THREE.Vector3(),
      scale: 0,
    }));
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.24, 0, 0.5, -0.15, 0.04, -0.16, 0.60, -0.04], 3));
    g.computeVertexNormals();
    this.mesh = new THREE.InstancedMesh(
      g,
      new THREE.MeshStandardMaterial({ color: 0xb2c6cc, metalness: 0.35, roughness: 0.21, side: THREE.DoubleSide }),
      max,
    );
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    scene.add(this.mesh);
    this.clear();
  }

  burst(f: CarFixture, event: ImpactEvent, _car: MuscleCarModel, velocity: [number, number]): void {
    const root = f.root || f.mesh;
    const origin = root.getWorldPosition(new THREE.Vector3());
    for (let j = 0; j < 22; j++) {
      const p = this.items[this.next];
      this.next = (this.next + 1) % this.max;
      p.life = p.span = 2.0 + Math.random() * 1.4;
      p.scale = 0.019 + Math.random() * 0.033;
      p.p.copy(origin).add(new THREE.Vector3((Math.random() - 0.5) * 0.07, (Math.random() - 0.5) * 0.12, (Math.random() - 0.5) * 0.12));
      p.v.set(
        velocity[0] * 0.14 + event.nx * (0.5 + Math.random() * 2) + (Math.random() - 0.5) * 3.6,
        0.7 + Math.random() * 2.4,
        -velocity[1] * 0.14 - event.ny * (0.5 + Math.random() * 2) + (Math.random() - 0.5) * 3.6,
      );
      p.spin.set((Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18);
      p.angle.set(0, 0, 0);
    }
  }

  update(dt: number): void {
    if (dt > 0 && !this.items.some((p) => p.life > 0) && !this.wasActive) return;
    this.wasActive = this.items.some((p) => p.life > 0);
    const h = Math.min(dt, 0.05);
    const d = this.dummy;
    for (let i = 0; i < this.max; i++) {
      const p = this.items[i];
      p.life = Math.max(0, p.life - h);
      if (p.life > 0) {
        p.v.y -= 9.81 * h;
        p.p.addScaledVector(p.v, h);
        p.angle.addScaledVector(p.spin, h);
        if (p.p.y < 0.022) {
          p.p.y = 0.022;
          p.v.y = Math.abs(p.v.y) * 0.23;
          p.v.x *= 0.72;
          p.v.z *= 0.72;
          p.spin.multiplyScalar(0.73);
        }
        d.position.copy(p.p);
        d.rotation.set(p.angle.x, p.angle.y, p.angle.z);
        d.scale.setScalar(p.scale * Math.min(1, p.life / 0.45));
      } else {
        d.scale.setScalar(0);
      }
      d.updateMatrix();
      this.mesh.setMatrixAt(i, d.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear(): void {
    this.items.forEach((p) => (p.life = 0));
    this.update(0);
  }

  get active(): number {
    return this.items.reduce((n, p) => n + (p.life > 0 ? 1 : 0), 0);
  }
}

interface BreakawayPartItem {
  obj: THREE.Mesh;
  zone: DamageZoneName;
  parent: THREE.Object3D;
  home: THREE.Vector3;
  rotation: THREE.Quaternion;
  scale: THREE.Vector3;
  velocity: THREE.Vector3;
  spin: THREE.Vector3;
  half: THREE.Vector3;
  active: boolean;
  asleep: boolean;
}

export class BreakawayParts {
  public readonly scene: THREE.Scene;
  public readonly car: MuscleCarModel;
  public readonly parts: BreakawayPartItem[] = [];
  public readonly vector = new THREE.Vector3();
  public readonly axis = new THREE.Vector3();
  public readonly dq = new THREE.Quaternion();

  constructor(scene: THREE.Scene, car: MuscleCarModel) {
    this.scene = scene;
    this.car = car;
    car.shell.traverse((o) => {
      if (!isMeshObject(o) || !o.userData.breakaway) return;
      o.geometry.computeBoundingBox();
      const b = o.geometry.boundingBox!;
      this.parts.push({
        obj: o,
        zone: o.userData.breakaway as DamageZoneName,
        parent: o.parent || car.shell,
        home: o.position.clone(),
        rotation: o.quaternion.clone(),
        scale: o.scale.clone(),
        velocity: new THREE.Vector3(),
        spin: new THREE.Vector3(),
        half: b.getSize(new THREE.Vector3()).multiplyScalar(0.5),
        active: false,
        asleep: false,
      });
    });
  }

  handle(event: ImpactEvent, zones: DamageZones): void {
    for (const p of this.parts) {
      if (p.active || zones[p.zone] < 0.63) continue;
      const hitZone: DamageZoneName =
        Math.abs(event.localNX) > 0.65
          ? event.localX > 0
            ? 'front'
            : 'rear'
          : event.localZ < 0
            ? 'left'
            : 'right';
      if (hitZone !== p.zone || event.energy < 42000) continue;
      p.obj.updateWorldMatrix(true, false);
      this.scene.attach(p.obj);
      p.obj.userData.detached = true;
      p.active = true;
      p.asleep = false;
      p.velocity.set(
        (event.beforeVX || 0) * 0.32 + event.nx * 1.6,
        0.7 + Math.min(1.8, event.normalSpeed * 0.07),
        -(event.beforeVY || 0) * 0.32 - event.ny * 1.6,
      );
      p.spin.set(event.localNZ * 0.8, Math.sign(event.localZ || 1) * 1.8, (p.zone === 'front' ? 1 : -1) * 2.6);
      p.obj.castShadow = true;
    }
  }

  update(dt: number): boolean {
    const steps = Math.max(1, Math.ceil(dt / (1 / 90)));
    const h = dt / steps;
    let moving = false;
    for (const p of this.parts) {
      if (!p.active || p.asleep) continue;
      moving = true;
      for (let n = 0; n < steps; n++) {
        p.velocity.y -= 9.81 * h;
        p.obj.position.addScaledVector(p.velocity, h);
        const speed = p.spin.length();
        if (speed > 0.001) {
          this.axis.copy(p.spin).multiplyScalar(1 / speed);
          this.dq.setFromAxisAngle(this.axis, speed * h);
          p.obj.quaternion.premultiply(this.dq).normalize();
        }
        // OBB support height follows the bumper's actual rotated half extents.
        const q = p.obj.quaternion;
        const x = q.x;
        const y = q.y;
        const z = q.z;
        const w = q.w;
        const support =
          Math.abs(2 * (x * y + z * w)) * p.half.x +
          Math.abs(1 - 2 * (x * x + z * z)) * p.half.y +
          Math.abs(2 * (y * z - x * w)) * p.half.z;
        if (p.obj.position.y < support + 0.012) {
          p.obj.position.y = support + 0.012;
          p.velocity.y = Math.abs(p.velocity.y) > 0.8 ? Math.abs(p.velocity.y) * 0.18 : 0;
          const friction = Math.exp(-h * 7);
          p.velocity.x *= friction;
          p.velocity.z *= friction;
          p.spin.multiplyScalar(Math.exp(-h * 5));
          if (p.velocity.lengthSq() < 0.007 && p.spin.lengthSq() < 0.012) {
            p.velocity.set(0, 0, 0);
            p.spin.set(0, 0, 0);
            p.asleep = true;
          }
        }
        const sx =
          Math.abs(1 - 2 * (y * y + z * z)) * p.half.x +
          Math.abs(2 * (x * y - z * w)) * p.half.y +
          Math.abs(2 * (x * z + y * w)) * p.half.z;
        const sz =
          Math.abs(2 * (x * z - y * w)) * p.half.x +
          Math.abs(2 * (y * z + x * w)) * p.half.y +
          Math.abs(1 - 2 * (x * x + y * y)) * p.half.z;
        for (const a of ['x', 'z'] as const) {
          const limit = ARENA - (a === 'x' ? sx : sz) - 0.015;
          if (Math.abs(p.obj.position[a]) > limit) {
            const sign = Math.sign(p.obj.position[a]);
            p.obj.position[a] = sign * limit;
            if (p.velocity[a] * sign > 0) p.velocity[a] *= -0.18;
          }
        }
      }
    }
    return moving;
  }

  repair(): void {
    for (const p of this.parts) {
      p.parent.add(p.obj);
      p.obj.position.copy(p.home);
      p.obj.quaternion.copy(p.rotation);
      p.obj.scale.copy(p.scale);
      p.obj.userData.detached = false;
      p.active = false;
      p.asleep = false;
      p.velocity.set(0, 0, 0);
      p.spin.set(0, 0, 0);
    }
  }

  get active(): number {
    return this.parts.filter((p) => p.active).length;
  }
}

interface MetalDebrisItem {
  life: number;
  p: THREE.Vector3;
  v: THREE.Vector3;
  a: THREE.Vector3;
  s: THREE.Vector3;
  size: number;
}

// One bounded instance pool: no new meshes or materials are allocated per collision.
export class MetalDebris {
  public readonly max: number;
  public next = 0;
  public readonly items: MetalDebrisItem[];
  public readonly mesh: THREE.InstancedMesh;
  public readonly dummy = new THREE.Object3D();
  public dirty = true;

  constructor(scene: THREE.Scene, max = 64) {
    this.max = max;
    this.items = Array.from({ length: max }, () => ({
      life: 0,
      p: new THREE.Vector3(),
      v: new THREE.Vector3(),
      a: new THREE.Vector3(),
      s: new THREE.Vector3(),
      size: 0,
    }));
    this.mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 0.34, 0.62),
      new THREE.MeshStandardMaterial({ color: 0x4d5257, metalness: 0.65, roughness: 0.5 }),
      max,
    );
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.update(0);
  }

  spawn(hit: ImpactEvent): void {
    if (hit.energy < 7000) return;
    const count = Math.min(14, 4 + Math.floor(hit.energy / 28000));
    for (let i = 0; i < count; i++) {
      const p = this.items[this.next];
      this.next = (this.next + 1) % this.max;
      p.life = 5 + Math.random() * 3;
      p.size = 0.025 + Math.random() * 0.075;
      p.p.set(hit.px, 0.42 + Math.random() * 0.3, -hit.py);
      p.v.set(
        hit.nx * (1 + Math.random() * 2) + (hit.beforeVX || 0) * 0.10 + (Math.random() - 0.5) * 3,
        1 + Math.random() * 3,
        -hit.ny * (1 + Math.random() * 2) - (hit.beforeVY || 0) * 0.10 + (Math.random() - 0.5) * 3,
      );
      p.a.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      p.s.set(Math.random() * 12 - 6, Math.random() * 12 - 6, Math.random() * 12 - 6);
    }
    this.dirty = true;
  }

  update(dt: number): void {
    if (!this.dirty && !this.items.some((p) => p.life > 0)) return;
    for (let i = 0; i < this.max; i++) {
      const p = this.items[i];
      const d = this.dummy;
      p.life = Math.max(0, p.life - dt);
      if (p.life > 0) {
        p.v.y -= 9.81 * dt;
        p.p.addScaledVector(p.v, dt);
        p.a.addScaledVector(p.s, dt);
        if (p.p.y < 0.028) {
          p.p.y = 0.028;
          p.v.y = Math.abs(p.v.y) * 0.18;
          p.v.x *= Math.exp(-dt * 7);
          p.v.z *= Math.exp(-dt * 7);
          p.s.multiplyScalar(Math.exp(-dt * 8));
        }
        d.position.copy(p.p);
        d.rotation.set(p.a.x, p.a.y, p.a.z);
        d.scale.setScalar(p.size * Math.min(1, p.life / 0.6));
      } else {
        d.scale.setScalar(0);
      }
      d.updateMatrix();
      this.mesh.setMatrixAt(i, d.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.dirty = false;
  }

  clear(): void {
    this.items.forEach((p) => (p.life = 0));
    this.dirty = true;
    this.update(0);
  }

  get active(): number {
    return this.items.filter((p) => p.life > 0).length;
  }
}
