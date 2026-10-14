// ---------------------------------------------------------------
// createMuscleCar(color) -> { group, body, wheels, setPaint, setLights }
// Original low-poly muscle car built from primitives. Car faces +X, left side is -Z.
// group = root on the ground (follows physics), body = sprung mass (rolls / pitches).
// ---------------------------------------------------------------
import * as THREE from 'three';
import type { TurnSignalMode, WheelDamageOffset } from '../../shared/types.ts';
import { clamp, lerp } from '../physics/carPhysics.ts';
import { detailTexture, isMeshObject, lin, mergeRigidMeshes, roundedDetailBox } from '../rendering/batching.ts';

export type FixtureKind = 'head' | 'tail' | 'markerFront' | 'markerRear' | 'indicator';

export interface CarFixture {
  kind: FixtureKind;
  side: 'left' | 'right';
  material: THREE.MeshStandardMaterial;
  health: number;
  broken?: boolean;
  home: THREE.Vector3;
  root?: THREE.Group;
  mesh: THREE.Mesh;
  bezel?: THREE.Mesh;
  intactParts?: THREE.Object3D[];
  brokenParts?: THREE.Mesh | null;
  crackLines?: THREE.LineSegments | null;
  halo?: THREE.MeshStandardMaterial;
  cover?: THREE.MeshPhysicalMaterial;
  spill?: THREE.PointLight;
  sprite?: THREE.SpriteMaterial;
}

export interface CarWheelNode {
  root: THREE.Group;
  spin: THREE.Group;
  front: boolean;
  left: boolean;
  home: THREE.Vector3;
  damage: WheelDamageOffset;
}

export interface GlassCrackOverlay {
  front: boolean;
  object: THREE.LineSegments;
}

export interface CarDetails {
  attachments: THREE.Object3D[];
  cracks: GlassCrackOverlay[];
}

export interface CarLightParams {
  head?: boolean;
  brake?: number;
  reverse?: boolean;
  night?: boolean;
  markers?: boolean;
  turn?: TurnSignalMode;
  hazards?: boolean;
  time?: number;
}

export interface MuscleCarModel {
  group: THREE.Group;
  body: THREE.Group;
  shell: THREE.Group;
  wheels: CarWheelNode[];
  setPaint: (hex: number) => void;
  setLights: (params: CarLightParams) => void;
  fixtures: CarFixture[];
  details: CarDetails;
  beams: THREE.SpotLight[];
  exhaustOutlets: THREE.Object3D[];
  materials: {
    paint: THREE.MeshPhysicalMaterial;
    stripe: THREE.MeshPhysicalMaterial;
    glass: THREE.MeshPhysicalMaterial;
  };
}

export function setFixtureFracture(f: CarFixture): void {
  if (f.kind !== 'head') return;
  if (f.intactParts) f.intactParts.forEach((o) => (o.visible = !f.broken));
  if (f.crackLines) f.crackLines.visible = !f.broken && f.health < 0.78;
  if (f.brokenParts) f.brokenParts.visible = !!f.broken;
  if (f.cover) f.cover.opacity = f.health < 0.78 ? 0.38 : 0.27;
  if (f.broken) {
    f.material.emissiveIntensity = 0;
    if (f.halo) f.halo.emissiveIntensity = 0;
  }
}

interface DecorateContext {
  shell: THREE.Group;
  add: (
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
    rx?: number,
    ry?: number,
    rz?: number,
    parent?: THREE.Object3D,
  ) => THREE.Mesh;
  paint: THREE.MeshPhysicalMaterial;
  stripe: THREE.MeshPhysicalMaterial;
  black: THREE.MeshStandardMaterial;
  satin: THREE.MeshStandardMaterial;
  chrome: THREE.MeshStandardMaterial;
  glass: THREE.MeshPhysicalMaterial;
  wheels: CarWheelNode[];
  fixtures: CarFixture[];
  beams: THREE.SpotLight[];
}

function decorateMuscleCar(ctx: DecorateContext): CarDetails {
  const { shell, add, black, satin, chrome, glass, wheels, fixtures, beams } = ctx;
  const linear = (hex: number): THREE.Color => new THREE.Color(hex).convertSRGBToLinear();
  const attachments: THREE.Object3D[] = [];
  const mesh = (
    g: THREE.BufferGeometry,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
    rx = 0,
    ry = 0,
    rz = 0,
    parent: THREE.Object3D = shell,
  ): THREE.Mesh => add(g, mat, x, y, z, rx, ry, rz, parent);
  const box = (
    w: number,
    h: number,
    d: number,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
    r = 0.012,
  ): THREE.Mesh => mesh(roundedDetailBox(w, h, d, r), mat, x, y, z);
  const tube = (points: Array<[number, number, number]>, r: number, mat: THREE.Material): THREE.Mesh =>
    mesh(
      new THREE.TubeGeometry(
        new THREE.CatmullRomCurve3(
          points.map((p) => new THREE.Vector3(...p)),
          false,
          'centripetal',
        ),
        Math.max(12, points.length * 5),
        r,
        5,
        false,
      ),
      mat,
      0,
      0,
      0,
    );
  const decal = (
    text: string,
    w: number,
    h: number,
    x: number,
    y: number,
    z: number,
    ry = 0,
    bg: string | null = null,
  ): THREE.Mesh => {
    const map = detailTexture(512, 128, (g, W, H) => {
      if (bg) {
        g.fillStyle = bg;
        g.fillRect(0, 0, W, H);
      }
      g.fillStyle = '#d9dcd8';
      g.font = 'italic 800 82px Arial';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(text, W / 2, H / 2 + 5);
    });
    return mesh(
      new THREE.PlaneGeometry(w, h, 6, 2),
      new THREE.MeshStandardMaterial({
        map,
        transparent: !bg,
        alphaTest: 0.15,
        metalness: 0.3,
        roughness: 0.38,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      }),
      x,
      y,
      z,
      0,
      ry,
    );
  };

  // Separate panel gaps and brightwork; nothing cuts right through the body.
  for (const side of [-1, 1]) {
    const z = side * 0.936;
    tube(
      [
        [0.59, 0.965, z],
        [0.60, 0.70, z],
        [0.53, 0.435, z],
        [-0.62, 0.435, z],
        [-0.73, 0.55, z],
        [-0.73, 0.96, z],
      ],
      0.0045,
      black,
    );
    tube(
      [
        [-2.13, 0.944, z],
        [-1.6, 0.982, z],
        [-0.7, 0.983, z],
        [0.64, 0.983, z],
        [1.75, 0.905, z],
        [2.11, 0.873, z],
      ],
      0.006,
      chrome,
    );
    tube(
      [
        [0.67, 1.035, side * 0.773],
        [-0.20, 1.49, side * 0.773],
        [-1.13, 1.49, side * 0.765],
        [-1.91, 1.04, side * 0.727],
      ],
      0.009,
      black,
    );
    tube(
      [
        [0.62, 1.049, side * 0.779],
        [-0.20, 1.482, side * 0.779],
        [-1.13, 1.482, side * 0.771],
        [-1.85, 1.062, side * 0.743],
      ],
      0.004,
      chrome,
    );
    box(0.008, 0.063, 0.094, glass, 0.432, 1.101, side * 0.981, 0.003);
    box(0.084, 0.018, 0.016, black, -0.55, 0.89, side * 0.949, 0.006);
    box(0.125, 0.024, 0.032, chrome, -0.54, 0.909, side * 0.962, 0.008);
    decal('427', 0.18, 0.046, 0.95, 0.913, side * 0.943, side > 0 ? 0 : Math.PI);
    for (let i = 0; i < 3; i++) {
      const v = box(0.023, 0.11, 0.013, satin, 0.83 + i * 0.07, 0.788, side * 0.938, 0.003);
      v.rotation.z = -0.18;
    }
    box(1.62, 0.04, 0.035, satin, 0, 0.397, side * 0.932, 0.009);
    tube(
      [
        [0.76, 1.06, side * 0.67],
        [1.1, 1.035, side * 0.69],
        [1.75, 0.988, side * 0.69],
        [2.08, 0.964, side * 0.66],
      ],
      0.004,
      black,
    );
    tube(
      [
        [-1.99, 1.04, side * 0.64],
        [-2.17, 1.026, side * 0.65],
      ],
      0.004,
      black,
    );
    tube(
      [
        [0.65, 1.082, side * 0.48],
        [0.42, 1.205, side * 0.27],
        [0.30, 1.264, side * 0.07],
      ],
      0.006,
      satin,
    );
    tube(
      [
        [0.27, 1.278, side * 0.03],
        [0.45, 1.188, side * 0.36],
      ],
      0.009,
      black,
    );
  }

  const grilleMap = detailTexture(512, 128, (g, w, h) => {
    g.fillStyle = '#080a0c';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#3a3c3e';
    g.lineWidth = 2;
    for (let row = 0; row < 9; row++) {
      for (let col = 0; col < 29; col++) {
        const x = col * 19 + (row % 2) * 9.5;
        const y = row * 15;
        g.beginPath();
        for (let a = 0; a < 6; a++) {
          const ang = (a * Math.PI) / 3;
          const px = x + 8 * Math.cos(ang);
          const py = y + 8 * Math.sin(ang);
          if (a) g.lineTo(px, py);
          else g.moveTo(px, py);
        }
        g.closePath();
        g.stroke();
      }
    }
  });
  mesh(
    new THREE.PlaneGeometry(1.48, 0.252, 16, 4),
    new THREE.MeshStandardMaterial({ map: grilleMap, metalness: 0.42, roughness: 0.5 }),
    2.374,
    0.67,
    0,
    0,
    Math.PI / 2,
  );
  box(0.015, 0.014, 1.53, chrome, 2.375, 0.807, 0, 0.006);
  box(0.015, 0.01, 1.50, satin, 2.376, 0.535, 0, 0.004);
  decal('427', 0.15, 0.043, 2.391, 0.682, 0, Math.PI / 2, '#14171a');

  for (const f of fixtures.filter((item) => item.kind === 'head')) {
    const root = f.root!;
    // A dark reflector remains exposed when the glass and bulb fail.
    mesh(new THREE.CircleGeometry(0.083, 48), black, 0.007, 0, 0, 0, Math.PI / 2, 0, root);
    mesh(new THREE.TorusGeometry(0.052, 0.006, 8, 36), satin, 0.010, 0, 0, 0, Math.PI / 2, 0, root);
    const socket = mesh(new THREE.SphereGeometry(0.025, 14, 10), satin, 0.011, 0, 0, 0, 0, 0, root);
    socket.scale.x = 0.28;
    const halo = new THREE.MeshStandardMaterial({
      color: linear(0xffeed6),
      emissive: linear(0xffe1ad),
      emissiveIntensity: 0.15,
      roughness: 0.24,
    });
    const haloMesh = mesh(new THREE.TorusGeometry(0.078, 0.004, 8, 48), halo, 0.019, 0, 0, 0, Math.PI / 2, 0, root);
    f.halo = halo;
    const cover = new THREE.MeshPhysicalMaterial({
      color: linear(0xd9e1e3),
      metalness: 0.12,
      roughness: 0.055,
      transparent: true,
      opacity: 0.27,
      clearcoat: 1,
      depthWrite: false,
    });
    const lens = mesh(new THREE.SphereGeometry(0.082, 32, 20), cover, 0.025, 0, 0, 0, 0, 0, root);
    lens.scale.x = 0.13;
    f.cover = cover;
    f.intactParts!.push(haloMesh, lens);
    const crackPoints: number[] = [];
    const fragmentPoints: number[] = [];
    for (let i = 0; i < 13; i++) {
      const a = (i * Math.PI * 2) / 13;
      const b = a + 0.31;
      const r = 0.073 + (i % 3) * 0.003;
      const inner = 0.059 + (i % 4) * 0.004;
      crackPoints.push(
        0.037,
        Math.sin(a) * 0.006,
        Math.cos(a) * 0.006,
        0.037,
        Math.sin(a + 0.08) * 0.04,
        Math.cos(a + 0.08) * 0.04,
      );
      crackPoints.push(
        0.037,
        Math.sin(a + 0.08) * 0.04,
        Math.cos(a + 0.08) * 0.04,
        0.037,
        Math.sin(a - 0.03) * r,
        Math.cos(a - 0.03) * r,
      );
      fragmentPoints.push(
        0.029,
        Math.sin(a) * 0.084,
        Math.cos(a) * 0.084,
        0.033,
        Math.sin(a + 0.11) * inner,
        Math.cos(a + 0.11) * inner,
        0.024,
        Math.sin(b) * 0.082,
        Math.cos(b) * 0.082,
      );
    }
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.Float32BufferAttribute(crackPoints, 3));
    f.crackLines = new THREE.LineSegments(
      cg,
      new THREE.LineBasicMaterial({ color: 0xd9edf1, transparent: true, opacity: 0.85, depthWrite: false }),
    );
    f.crackLines.visible = false;
    root.add(f.crackLines);
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.Float32BufferAttribute(fragmentPoints, 3));
    fg.computeVertexNormals();
    f.brokenParts = mesh(
      fg,
      new THREE.MeshStandardMaterial({
        color: linear(0xb6c6cb),
        metalness: 0.45,
        roughness: 0.20,
        side: THREE.DoubleSide,
      }),
      0,
      0,
      0,
      0,
      0,
      0,
      root,
    );
    f.brokenParts.visible = false;
    // The whole unit is anchored to the damage field exactly once.
    root.traverse((o) => {
      o.userData.noDamage = true;
      o.userData.noShadow = true;
      o.castShadow = false;
      o.receiveShadow = false;
    });
    root.userData.lampAssembly = true;
    attachments.push(root);
  }

  // Each side lamp has its own circuit, lens, glow, light and damage state.
  const ribs = detailTexture(128, 64, (g, w, h) => {
    g.fillStyle = '#fff';
    g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 7) {
      g.fillStyle = 'rgba(0,0,0,.23)';
      g.fillRect(x, 0, 2, h);
      g.fillStyle = 'rgba(255,255,255,.8)';
      g.fillRect(x + 2, 0, 1, h);
    }
    g.strokeStyle = 'rgba(0,0,0,.18)';
    g.lineWidth = 4;
    g.strokeRect(2, 2, w - 4, h - 4);
  });
  const glow = detailTexture(64, 64, (g) => {
    const gr = g.createRadialGradient(32, 32, 1, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,.7)');
    gr.addColorStop(0.25, 'rgba(255,255,255,.2)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
  });
  for (const side of [-1, 1]) {
    for (const front of [true, false]) {
      const x = front ? 1.98 : -2.075;
      const y = front ? 0.665 : 0.70;
      const z = side * 0.949;
      const hue = front ? 0xff8a0a : 0xff2514;
      box(0.204, 0.091, 0.03, black, x, y, z - 0.006 * side, 0.016);
      box(0.18, 0.072, 0.033, chrome, x, y, z + 0.005 * side, 0.015);
      const mat = new THREE.MeshStandardMaterial({
        map: ribs,
        color: linear(front ? 0xdb6810 : 0xb5120c),
        emissive: linear(hue),
        emissiveMap: ribs,
        emissiveIntensity: 0.25,
        roughness: 0.25,
        metalness: 0.08,
      });
      const lens = box(0.156, 0.049, 0.037, mat, x, y, z + 0.01 * side, 0.008);
      const spriteMat = new THREE.SpriteMaterial({
        map: glow,
        color: hue,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const sprite = new THREE.Sprite(spriteMat);
      sprite.position.set(x, y, z + 0.037 * side);
      sprite.scale.set(0.31, 0.20, 1);
      shell.add(sprite);
      const spill = new THREE.PointLight(hue, 0, 2.1, 2);
      spill.position.set(x, y - 0.05, z + 0.08 * side);
      shell.add(spill);
      attachments.push(spill, sprite);
      fixtures.push({
        kind: front ? 'markerFront' : 'markerRear',
        side: side < 0 ? 'left' : 'right',
        material: mat,
        health: 1,
        home: new THREE.Vector3(x, y, z),
        mesh: lens,
        spill,
        sprite: spriteMat,
      });
    }
  }
  for (const side of [-1, 1]) {
    const mat = new THREE.MeshStandardMaterial({
      map: ribs,
      color: linear(0xc26012),
      emissive: linear(0xff8800),
      emissiveMap: ribs,
      emissiveIntensity: 0.1,
      roughness: 0.25,
    });
    const lens = box(0.035, 0.045, 0.135, mat, 2.426, 0.435, side * 0.79, 0.01);
    fixtures.push({
      kind: 'indicator',
      side: side < 0 ? 'left' : 'right',
      material: mat,
      health: 1,
      home: new THREE.Vector3(2.426, 0.435, side * 0.79),
      mesh: lens,
    });
    for (let i = 0; i < 5; i++) {
      box(0.01, 0.113, 0.009, satin, -2.396, 0.79, side * 0.47 + (i - 2) * 0.11, 0.002);
    }
    mesh(new THREE.TorusGeometry(0.055, 0.009, 8, 32), chrome, -2.487, 0.31, side * 0.55, 0, Math.PI / 2);
  }

  // Tyre lettering and rim hardware, with brake perforations in one draw call.
  const wallMap = detailTexture(512, 512, (g, w, h) => {
    g.translate(w / 2, h / 2);
    g.fillStyle = '#252526';
    g.beginPath();
    g.arc(0, 0, 250, 0, Math.PI * 2);
    g.arc(0, 0, 181, 0, Math.PI * 2, true);
    g.fill();
    g.strokeStyle = '#414141';
    g.lineWidth = 2;
    for (const r of [193, 241]) {
      g.beginPath();
      g.arc(0, 0, r, 0, Math.PI * 2);
      g.stroke();
    }
    const arcText = (text: string, start: number, r: number, size: number) => {
      g.font = `700 ${size}px Arial`;
      g.fillStyle = '#d7d3c6';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      [...text].forEach((c, i) => {
        g.save();
        g.rotate(start + (i - (text.length - 1) / 2) * 0.088);
        g.translate(0, -r);
        g.fillText(c, 0, 0);
        g.restore();
      });
    };
    arcText('PROVING GROUND', 0, 216, 19);
    arcText('RADIAL G/T', Math.PI, 217, 17);
    for (let i = 0; i < 80; i++) {
      const a = (i * Math.PI) / 40;
      g.strokeStyle = '#303032';
      g.beginPath();
      g.moveTo(Math.cos(a) * 245, Math.sin(a) * 245);
      g.lineTo(Math.cos(a + 0.015) * 251, Math.sin(a + 0.015) * 251);
      g.stroke();
    }
  });
  const wallMat = new THREE.MeshStandardMaterial({ map: wallMap, transparent: true, alphaTest: 0.18, roughness: 0.9 });
  const hardware = new THREE.MeshStandardMaterial({ color: linear(0xb5b8ba), metalness: 0.95, roughness: 0.22 });
  const hubMap = detailTexture(128, 128, (g) => {
    g.fillStyle = '#111317';
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#d2d5d8';
    g.font = 'bold 42px Arial';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('427', 64, 65);
  });
  const hubMat = new THREE.MeshStandardMaterial({ map: hubMap, metalness: 0.4, roughness: 0.3 });
  for (const w of wheels) {
    mesh(new THREE.PlaneGeometry(0.738, 0.738), wallMat, 0, 0, 0.146, 0, 0, 0, w.spin);
    mesh(new THREE.CircleGeometry(0.048, 32), hubMat, 0, 0, 0.129, 0, 0, 0, w.spin);
    for (let i = 0; i < 5; i++) {
      const a = (i * Math.PI * 2) / 5;
      mesh(
        new THREE.CylinderGeometry(0.012, 0.012, 0.022, 6),
        hardware,
        Math.cos(a) * 0.072,
        Math.sin(a) * 0.072,
        0.118,
        Math.PI / 2,
        0,
        0,
        w.spin,
      );
    }
    const holes = new THREE.InstancedMesh(new THREE.CircleGeometry(0.006, 6), black, 24);
    const d = new THREE.Object3D();
    for (let i = 0; i < 24; i++) {
      const a = (i * Math.PI) / 12;
      const r = i % 2 ? 0.156 : 0.177;
      d.position.set(Math.cos(a) * r, Math.sin(a) * r, -0.016);
      d.updateMatrix();
      holes.setMatrixAt(i, d.matrix);
    }
    w.spin.add(holes);
    w.home = w.root.position.clone();
    w.damage = { toe: 0, camber: 0, inset: 0 };
  }

  // Fracture overlays are initially hidden, and follow the same damage field.
  const cracks: GlassCrackOverlay[] = [];
  for (const front of [true, false]) {
    const pts: number[] = [];
    const map = (u: number, v: number): [number, number, number] =>
      front
        ? [lerp(0.71, -0.18, v) + 0.012, lerp(1.035, 1.481, v), u * 0.69]
        : [lerp(-1.98, -1.15, v) - 0.012, lerp(1.035, 1.481, v), u * 0.66];
    for (let arm = 0; arm < 11; arm++) {
      const a = (arm * Math.PI * 2) / 11;
      let u = 0.13;
      let v = 0.37;
      for (let j = 1; j <= 5; j++) {
        const U = clamp(0.13 + Math.cos(a) * j * 0.12 + Math.sin(j * 2.3 + arm) * 0.015, -0.95, 0.95);
        const V = clamp(0.37 + Math.sin(a) * j * 0.065 + Math.cos(j + arm) * 0.012, 0.03, 0.96);
        pts.push(...map(u, v), ...map(U, V));
        u = U;
        v = V;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const lines = new THREE.LineSegments(
      g,
      new THREE.LineBasicMaterial({ color: 0xbfd2db, transparent: true, opacity: 0.58, depthWrite: false }),
    );
    lines.visible = false;
    lines.userData.glassCrack = true;
    shell.add(lines);
    cracks.push({ front, object: lines });
  }
  beams.forEach((b) => attachments.push(b));
  return { attachments, cracks };
}

export function createMuscleCar(color = 0xc8102e): MuscleCarModel {
  const car = new THREE.Group();
  const fixtures: CarFixture[] = [];
  const exhaustOutlets: THREE.Object3D[] = [];
  const body = new THREE.Group(); // pivot at roll-centre height
  body.position.y = 0.45;
  const shell = new THREE.Group();
  shell.position.y = -0.45;
  body.add(shell);
  car.add(body);

  // r128 + sRGB output treats hex colours as linear; convert so paint looks like the hex you pick
  const paint = new THREE.MeshPhysicalMaterial({
    color: lin(color),
    metalness: 0.32,
    roughness: 0.29,
    clearcoat: 1,
    clearcoatRoughness: 0.04,
    envMapIntensity: 1.15,
  });
  const stripe = new THREE.MeshPhysicalMaterial({
    color: lin(0xf4f4f0),
    metalness: 0.2,
    roughness: 0.35,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
  });
  const glass = new THREE.MeshPhysicalMaterial({
    color: lin(0x172630),
    metalness: 0.48,
    roughness: 0.085,
    clearcoat: 1,
    envMapIntensity: 1.15,
  });
  const black = new THREE.MeshStandardMaterial({ color: lin(0x0b0b0c), roughness: 0.75 });
  const satin = new THREE.MeshStandardMaterial({ color: lin(0x18191b), metalness: 0.4, roughness: 0.45 });
  const chrome = new THREE.MeshStandardMaterial({ color: lin(0xd9dadc), metalness: 1, roughness: 0.14 });
  const headL = new THREE.MeshStandardMaterial({
    color: lin(0xfff6e0),
    emissive: lin(0xfff0c8),
    emissiveIntensity: 0.25,
    roughness: 0.2,
  });
  const brakeL = new THREE.MeshStandardMaterial({
    color: lin(0x400000),
    emissive: lin(0xff1800),
    emissiveIntensity: 0.3,
    roughness: 0.3,
  });
  const revL = new THREE.MeshStandardMaterial({
    color: lin(0xbbbbbb),
    emissive: lin(0xffffff),
    emissiveIntensity: 0,
    roughness: 0.3,
  });

  const add = (
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
    rx = 0,
    ry = 0,
    rz = 0,
    parent: THREE.Object3D = shell,
  ): THREE.Mesh => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  const extrude = (pts: Array<[number, number]>, depth: number, mat: THREE.Material, bevel = 0.05): THREE.Mesh => {
    const s = new THREE.Shape();
    s.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, {
      depth,
      bevelEnabled: true,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelSegments: 4,
      curveSegments: 10,
    });
    g.translate(0, 0, -depth / 2);
    return add(g, mat, 0, 0, 0);
  };
  // Box laid along a 2D segment in the side (XY) plane
  const along = (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    thick: number,
    width: number,
    mat: THREE.Material,
    z = 0,
  ): THREE.Mesh => {
    const len = Math.hypot(x2 - x1, y2 - y1);
    return add(
      new THREE.BoxGeometry(len, thick, width),
      mat,
      (x1 + x2) / 2,
      (y1 + y2) / 2,
      z,
      0,
      0,
      Math.atan2(y2 - y1, x2 - x1),
    );
  };

  // Metallic paint: a very fine, low-amplitude clear-coat microtexture.
  const finishMap = detailTexture(256, 256, (g, w, h) => {
    const image = g.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      const a = i * 4;
      const v = 238 + Math.floor(((((Math.sin(i * 12.9898) * 43758.5453) % 1) + 1) * 5));
      image.data[a] = image.data[a + 1] = image.data[a + 2] = v;
      image.data[a + 3] = 255;
    }
    g.putImageData(image, 0, 0);
  });
  finishMap.encoding = THREE.LinearEncoding;
  finishMap.wrapS = finishMap.wrapT = THREE.RepeatWrapping;
  finishMap.repeat.set(6, 6);
  paint.roughnessMap = finishMap;
  paint.roughness = 0.27;
  paint.metalness = 0.34;
  paint.clearcoatRoughness = 0.075;
  chrome.side = THREE.FrontSide;

  // ---- Lower body: long hood, short deck, real wheel arches
  const WR = 0.37;
  const WX = 1.42;
  const ARCH = 0.47;
  const BOT = 0.32;
  const arch = (cx: number): Array<[number, number]> => {
    const pts: Array<[number, number]> = [];
    const d = Math.asin((WR - BOT) / ARCH);
    for (let i = 0; i <= 28; i++) {
      const t = Math.PI + d - ((Math.PI + 2 * d) * i) / 28;
      pts.push([cx + ARCH * Math.cos(t), WR + ARCH * Math.sin(t)]);
    }
    return pts;
  };
  extrude(
    [
      [-2.25, BOT],
      ...arch(-WX),
      ...arch(WX),
      [2.2, BOT],
      [2.32, 0.5],
      [2.3, 0.78],
      [2.12, 0.9],
      [0.75, 1.0],
      [-1.55, 1.0],
      [-2.2, 0.97],
      [-2.32, 0.78],
      [-2.3, 0.45],
    ],
    1.76,
    paint,
  );
  // dark arch liners
  const linerGeo = new THREE.CylinderGeometry(ARCH - 0.04, ARCH - 0.04, 1.8, 18, 1, true, Math.PI / 2, Math.PI);
  linerGeo.rotateX(Math.PI / 2);
  const linerMat = new THREE.MeshStandardMaterial({ color: lin(0x070707), roughness: 1, side: THREE.DoubleSide });
  for (const x of [-WX, WX]) add(linerGeo, linerMat, x, WR, 0);

  // ---- Greenhouse: glass cabin with painted pillars and roof
  extrude(
    [
      [0.72, 1.0],
      [-0.18, 1.47],
      [-1.15, 1.47],
      [-1.98, 1.0],
    ],
    1.44,
    glass,
    0.03,
  );
  add(roundedDetailBox(1.02, 0.05, 1.52, 0.02), paint, -0.665, 1.49, 0);
  for (const z of [-0.74, 0.74]) {
    along(0.72, 1.02, -0.18, 1.48, 0.07, 0.07, paint, z); // A-pillars
    along(-1.15, 1.48, -1.98, 1.02, 0.07, 0.16, paint, z * 0.96); // fastback sail panels
    add(new THREE.BoxGeometry(0.08, 0.46, 0.05), paint, -0.62, 1.24, z); // B-pillars
  }

  // ---- Twin racing stripes (hood, roof, deck)
  const addStripe = (x1: number, y1: number, x2: number, y2: number) => {
    for (const z of [-0.17, 0.17]) along(x1, y1, x2, y2, 0.012, 0.17, stripe, z);
  };
  addStripe(2.13, 0.957, 0.76, 1.057);
  addStripe(-0.16, 1.522, -1.16, 1.522);
  addStripe(-1.56, 1.057, -2.2, 1.027);

  // ---- Hood scoop (two-tier) and rear wing
  const hoodAng = Math.atan2(0.1, -1.37);
  add(new THREE.BoxGeometry(0.62, 0.07, 0.56), satin, 1.27, 1.02, 0, 0, 0, hoodAng + Math.PI);
  add(new THREE.BoxGeometry(0.42, 0.1, 0.46), satin, 1.22, 1.07, 0, 0, 0, hoodAng + Math.PI);
  add(new THREE.BoxGeometry(0.03, 0.07, 0.4), black, 1.44, 1.08, 0);
  add(new THREE.BoxGeometry(0.3, 0.035, 1.74), satin, -2.12, 1.15, 0, 0, 0, 0.06);
  for (const z of [-0.66, 0.66]) add(new THREE.BoxGeometry(0.1, 0.13, 0.04), satin, -2.08, 1.07, z);

  // ---- Front: recessed grille, quad headlights with chrome bezels, bumper
  add(new THREE.BoxGeometry(0.05, 0.27, 1.5), black, 2.345, 0.67, 0);

  const lensGeo = new THREE.CircleGeometry(0.085, 48);
  const bezelGeo = new THREE.TorusGeometry(0.09, 0.014, 10, 48);
  for (const z of [-0.62, -0.42, 0.42, 0.62]) {
    const root = new THREE.Group();
    root.position.set(2.378, 0.68, z);
    shell.add(root);
    const mat = headL.clone();
    const lens = add(lensGeo, mat, 0.015, 0, 0, 0, Math.PI / 2, 0, root);
    const bezel = add(bezelGeo, chrome, 0.009, 0, 0, 0, Math.PI / 2, 0, root);
    fixtures.push({
      kind: 'head',
      side: z < 0 ? 'left' : 'right',
      material: mat,
      health: 1,
      broken: false,
      home: new THREE.Vector3(2.378, 0.68, z),
      root,
      mesh: lens,
      bezel,
      intactParts: [lens],
      brokenParts: null,
      crackLines: null,
    });
  }

  const frontBumper = add(roundedDetailBox(0.13, 0.11, 1.98, 0.04), chrome, 2.36, 0.43, 0);
  frontBumper.userData.breakaway = 'front';
  add(new THREE.BoxGeometry(0.06, 0.05, 1.5), black, 2.3, 0.33, 0); // lower valance

  // ---- Rear: split tail lights, reverse lamps, plate, bumper, twin exhausts
  for (const z of [-0.47, 0.47]) {
    const mat = brakeL.clone();
    const lens = add(roundedDetailBox(0.04, 0.12, 0.66, 0.015), mat, -2.37, 0.79, z);
    fixtures.push({
      kind: 'tail',
      side: z < 0 ? 'left' : 'right',
      material: mat,
      health: 1,
      home: new THREE.Vector3(-2.37, 0.79, z),
      mesh: lens,
    });
  }
  for (const z of [-0.09, 0.09]) add(new THREE.BoxGeometry(0.04, 0.1, 0.1), revL, -2.37, 0.79, z);
  add(new THREE.BoxGeometry(0.05, 0.16, 1.62), black, -2.355, 0.79, 0);
  const rearBumper = add(roundedDetailBox(0.13, 0.11, 1.98, 0.04), chrome, -2.37, 0.45, 0);
  rearBumper.userData.breakaway = 'rear';
  const plate = document.createElement('canvas');
  plate.width = 256;
  plate.height = 64;
  const pg = plate.getContext('2d')!;
  pg.fillStyle = '#f2efe4';
  pg.fillRect(0, 0, 256, 64);
  pg.strokeStyle = '#223';
  pg.lineWidth = 5;
  pg.strokeRect(3, 3, 250, 58);
  pg.fillStyle = '#1b2440';
  pg.font = 'bold 42px sans-serif';
  pg.textAlign = 'center';
  pg.textBaseline = 'middle';
  pg.fillText('V8 • 427', 128, 35);
  const plateTex = new THREE.CanvasTexture(plate);
  plateTex.encoding = THREE.sRGBEncoding;
  add(
    new THREE.PlaneGeometry(0.5, 0.125),
    new THREE.MeshStandardMaterial({ map: plateTex, roughness: 0.5 }),
    -2.383,
    0.6,
    0,
    0,
    -Math.PI / 2,
    0,
  );
  const exGeo = new THREE.CylinderGeometry(0.058, 0.058, 0.26, 16, 1, true);
  const exInner = new THREE.CircleGeometry(0.05, 16);
  for (const z of [-0.55, 0.55]) {
    const exhaustMetal = chrome.clone();
    exhaustMetal.side = THREE.DoubleSide;
    add(exGeo, exhaustMetal, -2.36, 0.31, z, 0, 0, Math.PI / 2);
    add(exInner, black, -2.45, 0.31, z, 0, -Math.PI / 2, 0);
    const outlet = new THREE.Object3D();
    outlet.position.set(-2.515, 0.31, z);
    shell.add(outlet);
    exhaustOutlets.push(outlet);
  }

  // ---- Sides: mirrors, rocker trim
  for (const z of [-1, 1]) {
    add(roundedDetailBox(0.16, 0.09, 0.12, 0.025), paint, 0.52, 1.1, z * 0.98);
    add(new THREE.BoxGeometry(0.05, 0.05, 0.1), satin, 0.52, 1.04, z * 0.92);
  }

  add(new THREE.BoxGeometry(1.86, 0.035, 1.87), chrome, 0, 0.37, 0);

  // ---- Wheels: lathe tyre with tread, raised white letters, 5-spoke rim, disc + caliper
  const tread = document.createElement('canvas');
  tread.width = 512;
  tread.height = 64;
  const tg = tread.getContext('2d')!;
  tg.fillStyle = '#262626';
  tg.fillRect(0, 0, 512, 64);
  tg.fillStyle = '#121212';
  for (let i = 0; i < 64; i++) tg.fillRect(i * 8, 19, 3, 26);
  tg.fillRect(0, 30, 512, 3);
  tg.strokeStyle = '#090a0a';
  tg.lineWidth = 2;
  for (let x = 0; x < 512; x += 12) {
    tg.beginPath();
    tg.moveTo(x, 7);
    tg.lineTo(x + 7, 29);
    tg.lineTo(x, 55);
    tg.stroke();
  }
  const treadTex = new THREE.CanvasTexture(tread);
  const tyreMat = new THREE.MeshStandardMaterial({ map: treadTex, roughness: 0.92 });
  const prof = (
    [
      [0.25, -0.14],
      [0.31, -0.143],
      [0.35, -0.136],
      [0.366, -0.11],
      [0.37, -0.06],
      [0.37, 0.06],
      [0.366, 0.11],
      [0.35, 0.136],
      [0.31, 0.143],
      [0.25, 0.14],
    ] as Array<[number, number]>
  ).map(([r, y]) => new THREE.Vector2(r, y));
  const tyreGeo = new THREE.LatheGeometry(prof, 64);
  tyreGeo.rotateX(Math.PI / 2);
  const barrelGeo = new THREE.CylinderGeometry(0.252, 0.252, 0.24, 24, 1, true);
  barrelGeo.rotateX(Math.PI / 2);
  const barrelMat = new THREE.MeshStandardMaterial({
    color: lin(0x2a2b2e),
    metalness: 0.6,
    roughness: 0.5,
    side: THREE.DoubleSide,
  });
  const lipGeo = new THREE.TorusGeometry(0.252, 0.016, 10, 64);
  const spokeGeo = roundedDetailBox(0.2, 0.052, 0.035, 0.014);
  const capGeo = new THREE.CylinderGeometry(0.055, 0.065, 0.05, 16);
  capGeo.rotateX(Math.PI / 2);
  const discGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.024, 24);
  discGeo.rotateX(Math.PI / 2);
  const discMat = new THREE.MeshStandardMaterial({ color: lin(0x8a8a8a), metalness: 0.8, roughness: 0.35 });
  const caliperMat = new THREE.MeshStandardMaterial({ color: lin(0xd11a1a), roughness: 0.45, metalness: 0.2 });
  const caliperGeo = new THREE.BoxGeometry(0.1, 0.17, 0.07);

  const wheels: CarWheelNode[] = [];
  for (const [x, front] of [
    [WX, true],
    [-WX, false],
  ] as Array<[number, boolean]>) {
    for (const z of [-0.8, 0.8]) {
      const root = new THREE.Group();
      root.position.set(x, WR, z);
      const side = new THREE.Group();
      side.scale.z = z < 0 ? -1 : 1; // outer face points away from car
      const spin = new THREE.Group();
      root.add(side);
      side.add(spin);
      add(tyreGeo, tyreMat, 0, 0, 0, 0, 0, 0, spin);
      add(barrelGeo, barrelMat, 0, 0, 0, 0, 0, 0, spin);
      add(lipGeo, chrome, 0, 0, 0.11, 0, 0, 0, spin);
      for (let i = 0; i < 5; i++) {
        const a = (i * Math.PI * 2) / 5;
        add(spokeGeo, chrome, Math.cos(a) * 0.14, Math.sin(a) * 0.14, 0.085, 0, 0, a, spin);
      }
      add(capGeo, chrome, 0, 0, 0.1, 0, 0, 0, spin);
      add(discGeo, discMat, 0, 0, -0.03, 0, 0, 0, spin);
      add(caliperGeo, caliperMat, -0.17, 0.05, 0.0, 0, 0, 0.3, side);
      car.add(root);
      wheels.push({
        root,
        spin,
        front,
        left: z < 0,
        home: root.position.clone(),
        damage: { toe: 0, camber: 0, inset: 0 },
      });
    }
  }

  // ---- Headlight beams (off by default)
  const beams: THREE.SpotLight[] = [];
  for (const z of [-0.52, 0.52]) {
    const s = new THREE.SpotLight(0xfff1d6, 0, 70, 0.42, 0.55, 1.4);
    s.position.set(2.35, 0.68, z);
    s.target.position.set(14, -0.6, z * 1.6);
    s.userData.fixtureSide = z < 0 ? 'left' : 'right';
    shell.add(s, s.target);
    beams.push(s);
  }

  function setPaint(hex: number): void {
    paint.color.copy(lin(hex));
    const c = new THREE.Color(hex);
    const hsl = { h: 0, s: 0, l: 0 };
    c.getHSL(hsl);
    stripe.color.copy(lin(hsl.l > 0.55 ? 0x141414 : 0xf4f4f0)); // dark stripes on light paint
  }

  const headBySide: Record<'left' | 'right', CarFixture[]> = {
    left: fixtures.filter((f) => f.kind === 'head' && f.side === 'left'),
    right: fixtures.filter((f) => f.kind === 'head' && f.side === 'right'),
  };

  function setLights({
    head = false,
    brake = 0,
    reverse = false,
    night = false,
    markers = true,
    turn = 'off',
    hazards = false,
    time = 0,
  }: CarLightParams): void {
    const blink = time % 0.8 < 0.4;
    const running = markers || head;
    revL.emissiveIntensity = reverse ? 2.8 : 0;
    for (const f of fixtures) {
      const alive = f.broken || f.health < 0.15 ? 0 : f.health;
      const signal = hazards || turn === f.side;
      let intensity = 0;
      if (f.kind === 'head') intensity = head ? 2.6 : 0.08;
      if (f.kind === 'tail') intensity = signal ? (blink ? 3.8 : 0.08) : brake > 0 ? 3.5 : running ? 1.2 : 0.08;
      if (f.kind === 'markerFront') intensity = signal ? (blink ? 3.5 : 0.04) : running ? (night ? 1.7 : 0.85) : 0;
      if (f.kind === 'markerRear') intensity = running ? (night ? 1.5 : 0.75) : 0;
      if (f.kind === 'indicator') intensity = signal ? (blink ? 3.4 : 0.04) : running ? 0.22 : 0.04;
      f.material.emissiveIntensity = intensity * alive;
      if (f.halo) f.halo.emissiveIntensity = (head ? 3.1 : 0.12) * alive;
      if (f.spill) f.spill.intensity = intensity * (night ? 0.28 : 0.07) * alive;
      if (f.sprite) f.sprite.opacity = Math.min(0.78, intensity * (night ? 0.42 : 0.13)) * alive;
    }
    beams.forEach((b) => {
      const side: 'left' | 'right' = b.userData.fixtureSide || (b.position.z < 0 ? 'left' : 'right');
      const lamps = headBySide[side];
      const health =
        lamps.reduce((n, f) => n + (f.broken || f.health < 0.15 ? 0 : f.health), 0) / Math.max(1, lamps.length);
      b.intensity = head ? 2.7 * health : 0;
    });
  }

  const details = decorateMuscleCar({ shell, add, paint, stripe, black, satin, chrome, glass, wheels, fixtures, beams });
  details.attachments.push(...exhaustOutlets);

  // Do not let transparent lettering, light flares, fracture overlays or tiny
  // chrome details stamp opaque/aliased shapes into the ground shadow map.
  car.traverse((obj) => {
    if (!isMeshObject(obj)) return;
    const mat = obj.material;
    const geo = obj.geometry;
    const isTransparent = Array.isArray(mat) ? mat.some((m) => m.transparent) : mat && mat.transparent;
    if (obj.userData.noShadow || isTransparent) {
      obj.castShadow = false;
      obj.receiveShadow = false;
      return;
    }
    geo.computeBoundingBox();
    const b = geo.boundingBox;
    if (b && (b.max.x - b.min.x) * (b.max.y - b.min.y) * (b.max.z - b.min.z) < 0.00003) {
      obj.castShadow = false;
    }
  });

  setPaint(color);
  return {
    group: car,
    body,
    shell,
    wheels,
    setPaint,
    setLights,
    fixtures,
    details,
    beams,
    exhaustOutlets,
    materials: { paint, stripe, glass },
  };
}

export function optimizeCarMeshes(car: MuscleCarModel): number {
  for (const f of car.fixtures) {
    if (f.mesh) f.mesh.userData.noBatch = true;
  }
  let saved = mergeRigidMeshes(car.shell);
  for (const w of car.wheels) saved += mergeRigidMeshes(w.spin);
  // Lenses and emissive sprites already express these tiny lamps. Four extra
  // point lights otherwise make every PBR material unnecessarily expensive.
  for (const f of car.fixtures) {
    if (f.spill) f.spill.visible = false;
  }
  return saved;
}
