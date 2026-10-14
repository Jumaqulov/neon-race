import * as THREE from 'three';
import { clamp } from '../physics/carPhysics.ts';

export const lin = (hex: number): THREE.Color => new THREE.Color(hex).convertSRGBToLinear();

export const SUN_DIR = new THREE.Vector3(0.52, 0.62, 0.38).normalize();

export interface SkyThemeConfig {
  top: number;
  horizon: number;
  bottom: number;
  fog: number;
  hemi: number;
  sun: number;
  sunColor: number;
  glow: number;
  smoke: number;
  poles: number;
  exposure: number;
}

export const THEMES: Record<'day' | 'night', SkyThemeConfig> = {
  day: {
    top: 0x5989ae,
    horizon: 0xe2ddd2,
    bottom: 0x414447,
    fog: 0xcad1d0,
    hemi: 0.78,
    sun: 1.85,
    sunColor: 0xffe6c4,
    glow: 1.0,
    smoke: 0xdedede,
    poles: 0.0,
    exposure: 1.0,
  },
  night: {
    top: 0x02040a,
    horizon: 0x131a28,
    bottom: 0x040506,
    fog: 0x0f1520,
    hemi: 0.18,
    sun: 0.19,
    sunColor: 0x9fb4ff,
    glow: 0.0,
    smoke: 0x5c6068,
    poles: 2.5,
    exposure: 1.1,
  },
};

export function isMeshObject(obj: THREE.Object3D): obj is THREE.Mesh {
  return Boolean((obj as THREE.Mesh).isMesh);
}

export function isLineSegmentsObject(obj: THREE.Object3D): obj is THREE.LineSegments {
  return Boolean((obj as THREE.LineSegments).isLineSegments);
}

export function isInstancedMeshObject(obj: THREE.Object3D): obj is THREE.InstancedMesh {
  return Boolean((obj as THREE.InstancedMesh).isInstancedMesh);
}

export function makeSkyMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color() },
      horizon: { value: new THREE.Color() },
      bottom: { value: new THREE.Color() },
      sunDir: { value: SUN_DIR.clone() },
      glow: { value: 1 },
      cloudDetail: { value: 1 },
    },
    vertexShader: `varying vec3 vDir;
      void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 top, horizon, bottom, sunDir; uniform float glow;uniform float cloudDetail; varying vec3 vDir;
      float hash21(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float skyNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash21(i),hash21(i+vec2(1,0)),f.x),mix(hash21(i+vec2(0,1)),hash21(i+vec2(1,1)),f.x),f.y);}
      float skyFbm(vec2 p){float f=0.0;f+=.5*skyNoise(p);p=p*2.07+7.3;f+=.25*skyNoise(p);p=p*2.1+3.1;f+=.125*skyNoise(p);p=p*2.02+5.3;f+=.0625*skyNoise(p);return f;}
      void main(){
        vec3 d = normalize(vDir); float h = d.y;
        vec3 col = h > 0.0 ? mix(horizon, top, pow(h, 0.5)) : mix(horizon, bottom, pow(-h, 0.4));
        if(h>0.0&&cloudDetail>.5){vec2 p=d.xz/max(.12,d.y)*2.7;float cloud=smoothstep(.48,.74,skyFbm(p));
          float veil=cloud*smoothstep(.025,.22,h)*.48*glow;col=mix(col,vec3(.94,.91,.85),veil);}
        float s = max(dot(d, sunDir), 0.0);
        col += glow * (vec3(1.0, 0.92, 0.75) * pow(s, 900.0) * 6.0 + vec3(1.0, 0.85, 0.6) * pow(s, 12.0) * 0.25);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <encodings_fragment>
      }`,
  });
}

export function applySkyTheme(mat: THREE.ShaderMaterial, t: SkyThemeConfig): void {
  (mat.uniforms.top.value as THREE.Color).copy(lin(t.top));
  (mat.uniforms.horizon.value as THREE.Color).copy(lin(t.horizon));
  (mat.uniforms.bottom.value as THREE.Color).copy(lin(t.bottom));
  mat.uniforms.glow.value = t.glow;
}

export function detailTexture(
  w: number,
  h: number,
  draw: (g: CanvasRenderingContext2D, w: number, h: number) => void,
): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (ctx) draw(ctx, w, h);
  const t = new THREE.CanvasTexture(c);
  t.encoding = THREE.sRGBEncoding;
  t.anisotropy = 4;
  return t;
}

export function canvasTex(
  w: number,
  h: number,
  draw: (g: CanvasRenderingContext2D, w: number, h: number) => void,
  repeat = 1,
): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (ctx) draw(ctx, w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.encoding = THREE.sRGBEncoding;
  return t;
}

export function noiseFill(
  g: CanvasRenderingContext2D,
  w: number,
  h: number,
  base: string,
  amp: number,
  specks: number,
): void {
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * amp;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  for (let i = 0; i < specks; i++) {
    g.fillStyle = Math.random() < 0.5 ? 'rgba(15,15,18,.45)' : 'rgba(150,150,155,.35)';
    g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 1.5, 1 + Math.random() * 1.5);
  }
}

export function roundedDetailBox(w: number, h: number, d: number, radius = 0.02): THREE.BufferGeometry {
  const r = Math.min(radius, w / 2, h / 2, d / 2);
  const g = new THREE.BoxGeometry(
    w,
    h,
    d,
    Math.max(2, Math.min(24, Math.ceil(w / 0.16))),
    Math.max(2, Math.min(24, Math.ceil(h / 0.16))),
    Math.max(2, Math.min(24, Math.ceil(d / 0.16))),
  );
  const p = g.attributes.position as THREE.BufferAttribute;
  const n = g.attributes.normal as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  const q = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    q.set(clamp(v.x, -w / 2 + r, w / 2 - r), clamp(v.y, -h / 2 + r, h / 2 - r), clamp(v.z, -d / 2 + r, d / 2 - r));
    v.sub(q).normalize();
    n.setXYZ(i, v.x, v.y, v.z);
    v.multiplyScalar(r).add(q);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  return g;
}

export function mergeRigidMeshes(parent: THREE.Object3D): number {
  const buckets = new Map<string, THREE.Mesh[]>();
  for (const o of [...parent.children]) {
    if (
      !isMeshObject(o) ||
      isInstancedMeshObject(o) ||
      o.userData.noBatch ||
      o.userData.noDamage ||
      o.userData.breakaway ||
      o.children.length ||
      Array.isArray(o.material) ||
      o.material.transparent
    ) {
      continue;
    }
    const key = o.material.uuid + ':' + o.castShadow + ':' + o.receiveShadow;
    let list = buckets.get(key);
    if (!list) {
      list = [];
      buckets.set(key, list);
    }
    list.push(o);
  }
  let saved = 0;
  for (const nodes of buckets.values()) {
    if (nodes.length < 2) continue;
    const chunks: THREE.BufferGeometry[] = [];
    let count = 0;
    for (const o of nodes) {
      o.updateMatrix();
      const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      if (!g.attributes.normal) g.computeVertexNormals();
      g.applyMatrix4(o.matrix);
      chunks.push(g);
      count += g.attributes.position.count;
    }
    const position = new Float32Array(count * 3);
    const normal = new Float32Array(count * 3);
    const uv = new Float32Array(count * 2);
    let offset = 0;
    for (const g of chunks) {
      const n = g.attributes.position.count;
      position.set(g.attributes.position.array as ArrayLike<number>, offset * 3);
      normal.set(g.attributes.normal.array as ArrayLike<number>, offset * 3);
      if (g.attributes.uv) uv.set(g.attributes.uv.array as ArrayLike<number>, offset * 2);
      offset += n;
      g.dispose();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.computeBoundingSphere();
    const merged = new THREE.Mesh(geo, nodes[0].material);
    merged.castShadow = nodes[0].castShadow;
    merged.receiveShadow = nodes[0].receiveShadow;
    merged.name = 'batched-' + nodes.length + '-parts';
    parent.add(merged);
    for (const o of nodes) parent.remove(o);
    saved += nodes.length - 1;
  }
  return saved;
}
