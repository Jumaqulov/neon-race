import * as THREE from 'three';
import { clamp, type CarPhysics } from '../physics/carPhysics.ts';
import { canvasTex } from '../rendering/batching.ts';
import type { MuscleCarModel } from '../vehicle/muscleCar.ts';

interface SkidPoint {
  x: number;
  z: number;
  px: number;
  pz: number;
  a: number;
}

// ---- skid marks: ring buffer of quads, one strip per wheel
export class SkidMarks {
  public readonly max: number;
  public i = 0;
  public used = 0;
  public last: Array<SkidPoint | null> = [null, null, null, null];
  public dirty = false;
  public readonly pos: Float32Array;
  public readonly alpha: Float32Array;
  public readonly mesh: THREE.Mesh;

  constructor(scene: THREE.Scene, max = 5000) {
    this.max = max;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 12);
    this.alpha = new Float32Array(max * 4);
    const idx = new Uint32Array(max * 6);
    for (let s = 0; s < max; s++) {
      idx.set([s * 4, s * 4 + 1, s * 4 + 2, s * 4 + 2, s * 4 + 1, s * 4 + 3], s * 6);
    }
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.setDrawRange(0, 0);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: true,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog]),
      vertexShader: `attribute float alpha; varying float vA;
        #include <fog_pars_vertex>
        void main(){ vA = alpha; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
        }`,
      fragmentShader: `varying float vA;
        #include <fog_pars_fragment>
        void main(){ gl_FragColor = vec4(0.04, 0.04, 0.045, vA);
        #include <fog_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);
  }

  add(w: number, x: number, z: number, hx: number, hz: number, k: number): void {
    if (k < 0.12) {
      this.last[w] = null;
      return;
    }
    const px = -hz * 0.13;
    const pz = hx * 0.13;
    const a = Math.min(0.75, k * 0.75);
    const L = this.last[w];
    if (!L) {
      this.last[w] = { x, z, px, pz, a };
      return;
    }
    if ((x - L.x) ** 2 + (z - L.z) ** 2 < 0.09) return;
    const o = this.i * 12;
    const y = 0.015;
    this.pos.set([L.x - L.px, y, L.z - L.pz, L.x + L.px, y, L.z + L.pz, x - px, y, z - pz, x + px, y, z + pz], o);
    this.alpha.set([L.a, L.a, a, a], this.i * 4);
    this.i = (this.i + 1) % this.max;
    this.used = Math.min(this.max, this.used + 1);
    this.mesh.geometry.setDrawRange(0, this.used * 6);
    this.dirty = true;
    this.last[w] = { x, z, px, pz, a };
  }

  breakAll(): void {
    this.last = [null, null, null, null];
  }

  clear(): void {
    this.alpha.fill(0);
    this.used = 0;
    this.i = 0;
    this.mesh.geometry.setDrawRange(0, 0);
    this.dirty = true;
    this.breakAll();
  }

  flush(): void {
    if (!this.dirty) return;
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.alpha.needsUpdate = true;
    this.dirty = false;
  }
}

// ---- tyre smoke: soft point sprites
export class Smoke {
  public readonly max: number;
  public i = 0;
  public readonly p: Float32Array;
  public readonly v: Float32Array;
  public readonly size: Float32Array;
  public readonly alpha: Float32Array;
  public readonly life: Float32Array;
  public readonly span: Float32Array;
  public readonly s0: Float32Array;
  public readonly a0: Float32Array;
  public readonly mat: THREE.ShaderMaterial;
  public readonly points: THREE.Points;

  constructor(scene: THREE.Scene, max = 600) {
    this.max = max;
    this.p = new Float32Array(max * 3);
    this.v = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.life = new Float32Array(max).fill(1);
    this.span = new Float32Array(max).fill(1);
    this.s0 = new Float32Array(max);
    this.a0 = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.p, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    const tex = canvasTex(64, 64, (c) => {
      const gr = c.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(255,255,255,1)');
      gr.addColorStop(0.45, 'rgba(255,255,255,.45)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = gr;
      c.fillRect(0, 0, 64, 64);
    });
    tex.encoding = THREE.LinearEncoding;
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        { map: { value: null }, scale: { value: 500 }, color: { value: new THREE.Color(0xdddddd) } },
      ]),
      vertexShader: `attribute float size; attribute float alpha; uniform float scale; varying float vA;
        #include <fog_pars_vertex>
        void main(){ vA = alpha; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * scale / max(0.5, -mvPosition.z); gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `uniform sampler2D map; uniform vec3 color; varying float vA;
        #include <fog_pars_fragment>
        void main(){ float a = texture2D(map, gl_PointCoord).a * vA; if (a < 0.004) discard; gl_FragColor = vec4(color, a);
          #include <fog_fragment>
        }`,
    });
    this.mat.uniforms.map.value = tex;
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
    scene.add(this.points);
  }

  spawn(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    size: number,
    alpha: number,
    span: number,
  ): void {
    const i = this.i;
    this.i = (i + 1) % this.max;
    this.p.set([x, y, z], i * 3);
    this.v.set([vx, vy, vz], i * 3);
    this.life[i] = 0;
    this.span[i] = span;
    this.s0[i] = size;
    this.a0[i] = alpha;
  }

  update(dt: number): void {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] >= this.span[i]) {
        this.alpha[i] = 0;
        continue;
      }
      this.life[i] += dt;
      const t = this.life[i] / this.span[i];
      const d = Math.max(0, 1 - 1.6 * dt);
      this.v[i * 3] *= d;
      this.v[i * 3 + 2] *= d;
      this.v[i * 3 + 1] = this.v[i * 3 + 1] * d + 0.5 * dt;
      this.p[i * 3] += this.v[i * 3] * dt;
      this.p[i * 3 + 1] += this.v[i * 3 + 1] * dt;
      this.p[i * 3 + 2] += this.v[i * 3 + 2] * dt;
      this.size[i] = this.s0[i] * (1 + t * 3.2);
      this.alpha[i] = this.a0[i] * Math.min(1, t * 10) * (1 - t) * (1 - t);
    }
    const a = this.points.geometry.attributes;
    a.position.needsUpdate = a.size.needsUpdate = a.alpha.needsUpdate = true;
  }
}

export interface ExhaustProfileData {
  rate: number;
  jet: number;
  size: number;
  opacity: number;
  span: number;
  growth: number;
  shade: number;
}

// Pure calibration function: RPM changes the exhaust velocity slightly, but
// throttle is the primary input for smoke quantity, opacity and expansion.
export function exhaustProfile(load: number, rpm = 850): ExhaustProfileData {
  const t = clamp(Number.isFinite(load) ? load : 0, 0, 1);
  const r = clamp(((Number.isFinite(rpm) ? rpm : 850) - 850) / 5950, 0, 1);
  return {
    rate: 3 + 55 * Math.pow(t, 0.85),
    jet: 0.38 + 2.8 * t + 0.25 * r,
    size: 0.070 + 0.078 * t,
    opacity: 0.060 + 0.29 * t,
    span: 0.65 + 0.72 * t,
    growth: 2.5 + 1.6 * t,
    shade: 1 - 0.19 * t,
  };
}

export interface ExhaustSnapshot {
  load: number;
  ratePerTailpipe: number;
  active: number;
  capacity: number;
  emitted: number;
}

export class ExhaustSmoke extends Smoke {
  public load = 0;
  public time = 0;
  public emitted = 0;
  public rate = 3;
  public accum: [number, number] = [0, 0];
  public previous: [THREE.Vector3 | null, THREE.Vector3 | null] = [null, null];
  public readonly growth: Float32Array;
  public readonly shade: Float32Array;
  public readonly seed: Float32Array;

  constructor(scene: THREE.Scene, max = 280) {
    super(scene, max);
    this.growth = new Float32Array(max);
    this.shade = new Float32Array(max).fill(1);
    this.seed = new Float32Array(max);
    const geo = this.points.geometry;
    geo.setAttribute('shade', new THREE.BufferAttribute(this.shade, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('seed', new THREE.BufferAttribute(this.seed, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat.vertexShader = `attribute float size; attribute float alpha; attribute float shade; attribute float seed;
      uniform float scale; varying float vA; varying float vShade; varying float vSeed;
      #include <fog_pars_vertex>
      void main(){vA=alpha;vShade=shade;vSeed=seed;vec4 mvPosition=modelViewMatrix*vec4(position,1.0);
        gl_PointSize=clamp(size*scale/max(.5,-mvPosition.z),1.0,190.0);gl_Position=projectionMatrix*mvPosition;
        #include <fog_vertex>
      }`;
    this.mat.fragmentShader = `uniform vec3 color; varying float vA; varying float vShade; varying float vSeed;
      #include <fog_pars_fragment>
      void main(){vec2 p=gl_PointCoord*2.0-1.0;float radius=dot(p,p);if(radius>1.0)discard;
        float wisps=.80+.12*sin(p.x*9.0+p.y*4.0+vSeed)+.08*cos(p.y*12.0-p.x*7.0+vSeed*1.7);
        float a=pow(max(0.0,1.0-radius),2.2)*wisps*vA;if(a<.003)discard;
        gl_FragColor=vec4(color*vShade,a);
        #include <tonemapping_fragment>
        #include <encodings_fragment>
        #include <fog_fragment>
      }`;
    this.mat.depthTest = true;
    this.mat.depthWrite = false;
    this.mat.blending = THREE.NormalBlending;
    this.points.castShadow = false;
    this.points.receiveShadow = false;
    this.points.renderOrder = 3;
    this.setNight(false);
  }

  setNight(night: boolean): void {
    (this.mat.uniforms.color.value as THREE.Color).setHex(night ? 0x909ba7 : 0xc4c9cd).convertSRGBToLinear();
  }

  emit(dt: number, car: MuscleCarModel, phys: CarPhysics, running: boolean): void {
    dt = clamp(dt, 0, 0.1);
    this.time += dt;
    const throttle = running && Number.isFinite(phys.thr) ? clamp(phys.thr, 0, 1) : 0;
    this.load += (throttle - this.load) * (1 - Math.exp(-dt * (throttle > this.load ? 10 : 4.5)));
    const profile = exhaustProfile(this.load, phys.rpm);
    this.rate = running ? profile.rate : 0;
    const velocity = phys.worldVel();
    const direction = new THREE.Vector3(-1, 0, 0).transformDirection(car.shell.matrixWorld);
    for (let side = 0; side < car.exhaustOutlets.length; side++) {
      const current = car.exhaustOutlets[side].getWorldPosition(new THREE.Vector3());
      let previous = this.previous[side];
      if (!previous || previous.distanceTo(current) > 12) previous = current.clone();
      this.previous[side] = current.clone();
      if (!running) {
        this.accum[side] = 0;
        continue;
      }
      const total = this.accum[side] + profile.rate * dt;
      const count = Math.min(12, Math.floor(total));
      this.accum[side] = total - Math.floor(total);
      for (let j = 0; j < count; j++) {
        const origin = previous.clone().lerp(current, (j + 1) / (count + 1));
        const pulse = 1 + 0.045 * Math.sin((this.time * phys.rpm) / 15 + side * Math.PI);
        const index = this.i;
        super.spawn(
          origin.x,
          origin.y,
          origin.z,
          velocity[0] * 0.70 + direction.x * profile.jet + (Math.random() - 0.5) * 0.15,
          0.09 + direction.y * profile.jet + Math.random() * 0.12,
          -velocity[1] * 0.70 + direction.z * profile.jet + (Math.random() - 0.5) * 0.15,
          profile.size * pulse,
          profile.opacity,
          profile.span * (0.85 + Math.random() * 0.30),
        );
        this.growth[index] = profile.growth;
        this.shade[index] = profile.shade;
        this.seed[index] = Math.random() * 30;
        this.emitted++;
      }
    }
    this.points.geometry.attributes.shade.needsUpdate = true;
    this.points.geometry.attributes.seed.needsUpdate = true;
  }

  override update(dt: number): void {
    dt = clamp(dt, 0, 0.1);
    const damping = Math.exp(-dt * 1.45);
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] >= this.span[i]) {
        this.alpha[i] = 0;
        continue;
      }
      this.life[i] += dt;
      const t = clamp(this.life[i] / this.span[i], 0, 1);
      const o = i * 3;
      this.v[o] *= damping;
      this.v[o + 2] *= damping;
      this.v[o + 1] = this.v[o + 1] * damping + 0.48 * dt;
      this.p[o] += this.v[o] * dt;
      this.p[o + 1] = Math.max(0.14, this.p[o + 1] + this.v[o + 1] * dt);
      this.p[o + 2] += this.v[o + 2] * dt;
      this.size[i] = this.s0[i] * (1 + t * this.growth[i]);
      this.alpha[i] = this.a0[i] * Math.min(1, t * 12) * (1 - t) * (1 - t);
    }
    const a = this.points.geometry.attributes;
    a.position.needsUpdate = a.size.needsUpdate = a.alpha.needsUpdate = true;
  }

  clear(): void {
    this.life.set(this.span);
    this.alpha.fill(0);
    this.load = 0;
    this.accum = [0, 0];
    this.previous = [null, null];
    this.points.geometry.attributes.alpha.needsUpdate = true;
  }

  snapshot(): ExhaustSnapshot {
    let active = 0;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] < this.span[i]) active++;
    }
    return {
      load: this.load,
      ratePerTailpipe: this.rate,
      active,
      capacity: this.max,
      emitted: this.emitted,
    };
  }
}
