import * as THREE from 'three';
import type { CrushHit, DamageZoneName, DamageZones, ImpactEvent, LastImpactSummary } from '../../shared/types.ts';
import { clamp, lerp, smooth } from '../physics/carPhysics.ts';
import { isInstancedMeshObject, isLineSegmentsObject, isMeshObject } from '../rendering/batching.ts';
import { type CarFixture, type MuscleCarModel, setFixtureFracture } from '../vehicle/muscleCar.ts';
import { impactDisplacement, impactWeight, makeCrushHit } from './deformation.ts';

type VertexTuple = [number, number, number, number, number, number, number, number];

export function tessellateDamageGeometry(source: THREE.BufferGeometry, edge = 0.19): THREE.BufferGeometry {
  // Split long triangle edges and weld matching position/normal/UV vertices.
  const src = source.index ? source.toNonIndexed() : source.clone();
  const p = src.attributes.position as THREE.BufferAttribute | undefined;
  const n = src.attributes.normal as THREE.BufferAttribute | undefined;
  const uv = src.attributes.uv as THREE.BufferAttribute | undefined;
  if (!p || !n) return src;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const lookup = new Map<string, number>();

  const read = (i: number): VertexTuple => [
    p.getX(i),
    p.getY(i),
    p.getZ(i),
    n.getX(i),
    n.getY(i),
    n.getZ(i),
    uv ? uv.getX(i) : 0,
    uv ? uv.getY(i) : 0,
  ];
  const mid = (a: VertexTuple, b: VertexTuple): VertexTuple => {
    const v = a.map((x, i) => (x + b[i]) * 0.5) as VertexTuple;
    const l = Math.hypot(v[3], v[4], v[5]) || 1;
    v[3] /= l;
    v[4] /= l;
    v[5] /= l;
    return v;
  };
  const dist = (a: VertexTuple, b: VertexTuple): number =>
    (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  const emit = (v: VertexTuple): void => {
    const key = v.map((x, i) => Math.round(x * (i < 3 ? 1e5 : i < 6 ? 1e3 : 1e5))).join(',');
    let idx = lookup.get(key);
    if (idx === undefined) {
      idx = positions.length / 3;
      lookup.set(key, idx);
      positions.push(v[0], v[1], v[2]);
      normals.push(v[3], v[4], v[5]);
      uvs.push(v[6], v[7]);
    }
    indices.push(idx);
  };
  const split = (a: VertexTuple, b: VertexTuple, c: VertexTuple, depth: number): void => {
    const ab = dist(a, b);
    const bc = dist(b, c);
    const ca = dist(c, a);
    if (Math.max(ab, bc, ca) <= edge * edge || depth >= 11) {
      emit(a);
      emit(b);
      emit(c);
      return;
    }
    if (ab >= bc && ab >= ca) {
      const m = mid(a, b);
      split(a, m, c, depth + 1);
      split(m, b, c, depth + 1);
    } else if (bc >= ca) {
      const m = mid(b, c);
      split(a, b, m, depth + 1);
      split(a, m, c, depth + 1);
    } else {
      const m = mid(c, a);
      split(a, b, m, depth + 1);
      split(m, b, c, depth + 1);
    }
  };

  for (let i = 0; i < p.count; i += 3) split(read(i), read(i + 1), read(i + 2), 0);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  src.dispose();
  return g;
}

export interface DamageMeshEntry {
  obj: THREE.Mesh | THREE.LineSegments;
  g: THREE.BufferGeometry;
  rest: Float32Array;
  model: Float32Array;
  targetModel: Float32Array;
  target: Float32Array;
  normal: Float32Array | null;
  inverse: THREE.Matrix4;
  compliance: number;
  isLine: boolean;
  colors: Float32Array | null;
  dirty: boolean;
}

export interface DamageAnchorEntry {
  obj: THREE.Object3D;
  home: THREE.Vector3;
  model: THREE.Vector3;
  target: THREE.Vector3;
  local: THREE.Vector3;
  inverse: THREE.Matrix4;
  rotation: THREE.Quaternion;
  targetRotation: THREE.Quaternion;
  tilt: number;
}

export interface DamageBreakEvent {
  fixture: CarFixture;
  event: ImpactEvent;
}

export interface DamageSnapshot {
  contacts: number;
  vertices: number;
  displaced: number;
  maxDisplacement: number;
  finite: boolean;
  zones: DamageZones;
  fixtures: Array<{
    kind: string;
    side: 'left' | 'right';
    health: number;
    broken: boolean;
    lensVisible: boolean;
    intensity: number;
  }>;
  lastImpact: LastImpactSummary | null;
}

export class VehicleDamage {
  public readonly car: MuscleCarModel;
  public readonly entries: DamageMeshEntry[] = [];
  public readonly anchors: DamageAnchorEntry[] = [];
  public readonly pending: ImpactEvent[] = [];
  public time = 0;
  public lastImpact: LastImpactSummary | null = null;
  public contacts = 0;
  public totalEnergy = 0;
  public readonly history: CrushHit[] = [];
  public normalClock = 0;
  public zones: DamageZones = { front: 0, rear: 0, left: 0, right: 0 };
  public readonly cooldowns = new Map<string, number>();
  public readonly breaks: DamageBreakEvent[] = [];
  public readonly vertexCount: number;

  constructor(car: MuscleCarModel) {
    this.car = car;
    car.group.updateMatrixWorld(true);
    const invShell = new THREE.Matrix4().copy(car.shell.matrixWorld).invert();
    const point = new THREE.Vector3();

    car.shell.traverse((obj) => {
      if ((!isMeshObject(obj) && !isLineSegmentsObject(obj)) || isInstancedMeshObject(obj) || obj.userData.noDamage) {
        return;
      }
      const isLine = isLineSegmentsObject(obj);
      const g = isLine
        ? obj.geometry.clone()
        : tessellateDamageGeometry(
            obj.geometry,
            obj.material === car.materials.paint || obj.material === car.materials.stripe ? 0.17 : 0.26,
          );
      obj.geometry = g;
      g.computeBoundingSphere();
      if (g.boundingSphere) g.boundingSphere.radius += 1.5;
      obj.frustumCulled = true;
      const matrix = new THREE.Matrix4().multiplyMatrices(invShell, obj.matrixWorld);
      const inverse = matrix.clone().invert();
      const pos = g.attributes.position as THREE.BufferAttribute;
      const rest = new Float32Array(pos.array as ArrayLike<number>);
      const model = new Float32Array(pos.array.length);
      for (let i = 0; i < pos.count; i++) {
        point.fromBufferAttribute(pos, i).applyMatrix4(matrix);
        point.toArray(model, i * 3);
      }
      const material = obj.material;
      const compliance = 1;
      const wear = material === car.materials.paint || material === car.materials.stripe;
      let colors: Float32Array | null = null;
      if (wear && !Array.isArray(material)) {
        colors = new Float32Array(pos.count * 3).fill(1);
        g.setAttribute('color', new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage));
        material.vertexColors = true;
        material.needsUpdate = true;
      }
      this.entries.push({
        obj,
        g,
        rest,
        model,
        targetModel: new Float32Array(model),
        target: new Float32Array(rest),
        normal: g.attributes.normal ? new Float32Array(g.attributes.normal.array as ArrayLike<number>) : null,
        inverse,
        compliance,
        isLine,
        colors,
        dirty: false,
      });
    });

    for (const obj of car.details.attachments) {
      const parent = obj.parent || car.shell;
      const matrix = new THREE.Matrix4().multiplyMatrices(invShell, parent.matrixWorld);
      const inverse = matrix.clone().invert();
      const home = obj.position.clone().applyMatrix4(matrix);
      this.anchors.push({
        obj,
        home,
        model: home.clone(),
        target: obj.position.clone(),
        local: obj.position.clone(),
        inverse,
        rotation: obj.quaternion.clone(),
        targetRotation: obj.quaternion.clone(),
        tilt: 0,
      });
    }

    this.vertexCount = this.entries.reduce((sum, e) => sum + e.rest.length / 3, 0);
  }

  enqueue(event: ImpactEvent): void {
    if (
      !event ||
      ![
        event.energy,
        event.normalSpeed,
        event.impulse,
        event.localX,
        event.localZ,
        event.localNX,
        event.localNZ,
      ].every(Number.isFinite) ||
      event.energy <= 1200 ||
      event.normalSpeed < 1.8 ||
      event.impulse < 900 ||
      Math.hypot(event.localNX, event.localNZ) < 0.9
    ) {
      return;
    }
    this.pending.push(event);
    if (this.pending.length > 80) this.pending.shift();
  }

  process(): ImpactEvent[] {
    if (!this.pending.length) return [];
    // One physical impact per surface/sector, not one dent per solver corner.
    // Substep jitter in a resting contact cannot repeatedly crush the nose.
    const batches = new Map<string, ImpactEvent>();
    for (const e of this.pending) {
      const zone: DamageZoneName =
        Math.abs(e.localNX) > 0.65 ? (e.localX > 0 ? 'front' : 'rear') : e.localZ < 0 ? 'left' : 'right';
      const key = e.surface + ':' + zone;
      const existing = batches.get(key);
      if (!existing || existing.energy < e.energy) batches.set(key, e);
    }
    this.pending.length = 0;
    const applied: ImpactEvent[] = [];
    for (const [key, e] of batches) {
      if (this.time - (this.cooldowns.get(key) ?? -100) < 0.18) continue;
      this.cooldowns.set(key, this.time);
      this.apply(e);
      applied.push(e);
    }
    return applied;
  }

  apply(event: ImpactEvent): void {
    const requested = makeCrushHit(event);
    const energy = requested.energy;
    const frontal = Math.abs(requested.nx) > 0.65;
    if (requested.depth <= 0) return;
    // Repeated impacts at the same mount consume a finite crush stroke.
    const prior = this.history.find(
      (h) =>
        h.surface === requested.surface &&
        h.nx * requested.nx + h.nz * requested.nz > 0.985 &&
        Math.hypot(h.x - requested.x, h.z - requested.z) < 0.55,
    );
    let hit = requested;
    let accumulatedDepth = requested.depth;
    if (prior) {
      const stroke = Math.min(requested.depth, Math.max(0, (frontal ? 1.30 : 0.62) - prior.depth));
      hit = { ...prior, depth: stroke, energy };
      prior.depth += stroke;
      accumulatedDepth = prior.depth;
    } else {
      this.history.push({ ...requested });
      if (this.history.length > 64) this.history.shift();
    }

    const v = new THREE.Vector3();
    const disp: [number, number, number] = [0, 0, 0];
    for (const e of this.entries) {
      if (e.obj.userData.detached) continue;
      const m = e.model;
      const t = e.targetModel;
      let changed = false;
      for (let i = 0; i < m.length; i += 3) {
        const d = impactDisplacement(m[i], m[i + 1], m[i + 2], hit, e.compliance, disp);
        if (Math.abs(d[0]) + Math.abs(d[1]) + Math.abs(d[2]) < 0.00001) continue;
        let dx = t[i] + d[0] - m[i];
        let dy = t[i + 1] + d[1] - m[i + 1];
        let dz = t[i + 2] + d[2] - m[i + 2];
        const endZone = smooth(0.52, 1.36, Math.abs(m[i]));
        const limit = frontal ? lerp(0.33, m[i] > 0 ? 1.42 : 1.25, endZone) : lerp(0.48, 0.74, endZone);
        const length = Math.hypot(dx, dy, dz);
        const scale = length > limit ? limit / length : 1;
        dx *= scale;
        dy *= scale;
        dz *= scale;
        t[i] = m[i] + dx;
        t[i + 1] = Math.max(0.15, m[i + 1] + dy);
        t[i + 2] = m[i + 2] + dz;
        v.set(t[i], t[i + 1], t[i + 2]).applyMatrix4(e.inverse).toArray(e.target, i);
        if (e.colors) {
          const wear = clamp(Math.hypot(dx, dy, dz) / 0.75, 0, 1);
          const crease = 0.5 + 0.5 * Math.sin(m[i] * 37 + m[i + 2] * 23);
          e.colors[i] = 1 - wear * (0.27 + 0.12 * crease);
          e.colors[i + 1] = 1 - wear * (0.26 + 0.12 * crease);
          e.colors[i + 2] = 1 - wear * (0.23 + 0.10 * crease);
        }
        changed = true;
      }
      if (changed) {
        e.dirty = true;
        if (e.colors && e.g.attributes.color) {
          e.g.attributes.color.needsUpdate = true;
        }
      }
    }

    for (const a of this.anchors) {
      const d = impactDisplacement(a.home.x, a.home.y, a.home.z, hit);
      a.model.add(new THREE.Vector3(...d));
      const limit = lerp(0.33, a.home.x > 0 ? 1.42 : 1.25, smooth(0.52, 1.36, Math.abs(a.home.x)));
      const offset = a.model.clone().sub(a.home);
      if (offset.length() > limit) a.model.copy(a.home).add(offset.setLength(limit));
      a.model.y = Math.max(0.15, a.model.y);
      a.target.copy(a.model).applyMatrix4(a.inverse);
      if (a.obj.userData.lampAssembly) {
        const strength = impactWeight(a.home.x, a.home.y, a.home.z, hit) * hit.depth;
        a.tilt = clamp(a.tilt + strength * 0.30, 0, 0.48);
        const tilt = new THREE.Quaternion().setFromEuler(
          new THREE.Euler(0, Math.sign(a.home.z) * a.tilt * 0.60, -a.tilt),
        );
        a.targetRotation.copy(a.rotation).multiply(tilt);
      }
    }

    for (const f of this.car.fixtures) {
      const push = impactDisplacement(f.home.x, f.home.y, f.home.z, hit);
      const strain = Math.hypot(...push);
      f.health = clamp(f.health - strain * (f.kind === 'head' ? 1.85 : 1.50), 0, 1);
      if (f.kind === 'head' && !f.broken && (f.health < 0.28 || strain > 0.42)) {
        f.broken = true;
        f.health = 0;
        this.breaks.push({ fixture: f, event });
      }
      setFixtureFracture(f);
    }

    const zone: DamageZoneName = frontal
      ? event.localX > 0
        ? 'front'
        : 'rear'
      : event.localZ < 0
        ? 'left'
        : 'right';
    this.zones[zone] = clamp(this.zones[zone] + hit.depth * 0.76, 0, 1);
    const severity: 'Light' | 'Moderate' | 'Heavy' =
      accumulatedDepth < 0.16 ? 'Light' : accumulatedDepth < 0.50 ? 'Moderate' : 'Heavy';
    this.lastImpact = {
      zone,
      severity,
      energy,
      normalSpeed: event.normalSpeed,
      depth: accumulatedDepth,
      newCrush: hit.depth,
    };
    this.contacts++;
    this.totalEnergy += energy;

    for (const crack of this.car.details.cracks) {
      if (accumulatedDepth > 0.57 && ((crack.front && zone === 'front') || (!crack.front && zone === 'rear'))) {
        crack.object.visible = true;
      }
    }

    for (const w of this.car.wheels) {
      const weight = impactWeight(w.home.x, 0.52, w.home.z, hit);
      if (accumulatedDepth > 0.35 && weight > 0.16) {
        w.damage.toe = clamp(w.damage.toe + hit.depth * weight * 0.10 * Math.sign(w.home.z), -0.11, 0.11);
        w.damage.camber = clamp(w.damage.camber + hit.depth * weight * 0.10 * Math.sign(w.home.z), -0.12, 0.12);
        w.damage.inset = clamp(w.damage.inset + hit.depth * weight * 0.11, 0, 0.10);
      }
    }
  }

  takeBreaks(): DamageBreakEvent[] {
    const events = this.breaks.slice();
    this.breaks.length = 0;
    return events;
  }

  update(dt: number): void {
    this.time += dt;
    this.normalClock += dt;
    const normalDue = this.normalClock >= 1 / 30;
    if (normalDue) this.normalClock = 0;
    const t = 1 - Math.exp(-Math.min(dt, 0.05) * 58);

    for (const e of this.entries) {
      if (!e.dirty || e.obj.userData.detached) continue;
      const p = e.g.attributes.position.array as Float32Array;
      let delta = 0;
      for (let i = 0; i < p.length; i++) {
        const d = e.target[i] - p[i];
        p[i] += d * t;
        delta = Math.max(delta, Math.abs(d));
      }
      if (delta < 0.00035) {
        p.set(e.target);
        e.dirty = false;
      }
      e.g.attributes.position.needsUpdate = true;
      if (!e.isLine && (normalDue || !e.dirty)) e.g.computeVertexNormals();
      if (!e.dirty) e.g.computeBoundingSphere();
    }

    for (const a of this.anchors) {
      a.obj.position.lerp(a.target, t);
      a.obj.quaternion.slerp(a.targetRotation, t);
    }
    if (this.cooldowns.size > 100) this.cooldowns.clear();
  }

  repair(): void {
    for (const e of this.entries) {
      (e.g.attributes.position.array as Float32Array).set(e.rest);
      e.g.attributes.position.needsUpdate = true;
      if (e.normal && e.g.attributes.normal) {
        (e.g.attributes.normal.array as Float32Array).set(e.normal);
        e.g.attributes.normal.needsUpdate = true;
      }
      e.target.set(e.rest);
      e.targetModel.set(e.model);
      e.dirty = false;
      e.g.computeBoundingSphere();
      if (e.colors && e.g.attributes.color) {
        e.colors.fill(1);
        e.g.attributes.color.needsUpdate = true;
      }
    }
    for (const a of this.anchors) {
      a.model.copy(a.home);
      a.target.copy(a.local);
      a.obj.position.copy(a.local);
      a.obj.quaternion.copy(a.rotation);
      a.targetRotation.copy(a.rotation);
      a.tilt = 0;
    }
    this.car.fixtures.forEach((f) => {
      f.health = 1;
      f.broken = false;
      setFixtureFracture(f);
    });
    this.breaks.length = 0;
    this.car.details.cracks.forEach((c) => (c.object.visible = false));
    this.car.wheels.forEach((w) => {
      w.damage = { toe: 0, camber: 0, inset: 0 };
      w.root.position.copy(w.home);
      w.root.rotation.set(0, 0, 0);
    });
    this.zones = { front: 0, rear: 0, left: 0, right: 0 };
    this.pending.length = 0;
    this.history.length = 0;
    this.cooldowns.clear();
    this.contacts = 0;
    this.totalEnergy = 0;
    this.lastImpact = null;
  }

  snapshot(): DamageSnapshot {
    let displaced = 0;
    let maxDisplacement = 0;
    let finite = true;
    for (const e of this.entries) {
      for (let i = 0; i < e.model.length; i += 3) {
        const d = Math.hypot(
          e.targetModel[i] - e.model[i],
          e.targetModel[i + 1] - e.model[i + 1],
          e.targetModel[i + 2] - e.model[i + 2],
        );
        if (d > 1e-5) displaced++;
        maxDisplacement = Math.max(maxDisplacement, d);
        if (!Number.isFinite(d)) finite = false;
      }
    }
    return {
      contacts: this.contacts,
      vertices: this.vertexCount,
      displaced,
      maxDisplacement,
      finite,
      zones: { ...this.zones },
      fixtures: this.car.fixtures.map((f) => ({
        kind: f.kind,
        side: f.side,
        health: f.health,
        broken: !!f.broken,
        lensVisible: f.mesh ? f.mesh.visible : !f.broken,
        intensity: f.material.emissiveIntensity,
      })),
      lastImpact: this.lastImpact,
    };
  }
}
