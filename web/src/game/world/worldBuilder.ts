import * as THREE from 'three';
import { ARENA } from '../../shared/types.ts';
import type { CircleCollider } from '../physics/collisions.ts';
import { canvasTex, lin, noiseFill } from '../rendering/batching.ts';

export interface DynamicCone {
  obj: THREE.Group;
  tiltObj: THREE.Group;
  home: [number, number];
  x: number;
  y: number;
  h: number;
  vx: number;
  vy: number;
  vh: number;
  yaw: number;
  tilt: number;
  tiltV: number;
  active: boolean;
  hit: boolean;
}

export interface WorldSceneData {
  colliders: { circles: CircleCollider[] };
  cones: DynamicCone[];
  coneInstances?: THREE.InstancedMesh[];
  conesDirty?: boolean;
  lampMat: THREE.MeshStandardMaterial;
  winMat: THREE.MeshStandardMaterial;
  asphalt: THREE.Mesh;
}

export function resetCone(c: DynamicCone): void {
  Object.assign(c, {
    x: c.home[0],
    y: c.home[1],
    h: 0,
    vx: 0,
    vy: 0,
    vh: 0,
    yaw: Math.random() * 6,
    tilt: 0,
    tiltV: 0,
    active: false,
    hit: false,
  });
  c.obj.position.set(c.x, 0, -c.y);
  c.obj.rotation.y = c.yaw;
  c.tiltObj.rotation.z = 0;
}

export function updateCones(cones: DynamicCone[], dt: number): void {
  for (const c of cones) {
    if (!c.active) continue;
    c.vh -= 9.81 * dt;
    c.x += c.vx * dt;
    c.y += c.vy * dt;
    c.h += c.vh * dt;
    c.tilt += c.tiltV * dt;
    if (c.h <= 0) {
      c.h = 0;
      if (c.vh < -1.5) {
        c.vh *= -0.32;
        c.tiltV *= 0.6;
      } else {
        c.vh = 0;
      }
      const f = Math.exp(-5 * dt);
      c.vx *= f;
      c.vy *= f;
      c.tiltV *= Math.exp(-6 * dt);
      if (Math.hypot(c.vx, c.vy) < 0.25 && Math.abs(c.vh) < 0.1 && Math.abs(c.tiltV) < 0.6) {
        // settle: lying on its side (or back upright if it barely tipped)
        const t = ((c.tilt % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
        const target =
          t < 0.5 ? 0 : t > Math.PI * 2 - 0.5 ? Math.PI * 2 : t < Math.PI ? 1.2 : Math.PI * 2 - 1.2;
        c.tilt = t + (target - t) * Math.min(1, dt * 10);
        if (Math.abs(target - t) < 0.01) {
          c.tilt = target;
          c.active = false;
        }
      }
    }
    c.obj.position.set(c.x, c.h + 0.27 * Math.abs(Math.sin(c.tilt)), -c.y);
    c.obj.rotation.y = c.yaw;
    c.tiltObj.rotation.z = -c.tilt;
  }
}

export function buildWorld(scene: THREE.Object3D, renderer: THREE.WebGLRenderer): WorldSceneData {
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const colliders: { circles: CircleCollider[] } = { circles: [] };

  // ---- ground: asphalt pad inside the walls, grass outside
  const asphaltTex = canvasTex(
    1024,
    1024,
    (g, w, h) => {
      noiseFill(g, w, h, '#57595b', 24, 14000);
      g.globalAlpha = 0.035;
      for (let i = 0; i < 180; i++) {
        g.fillStyle = i % 2 ? '#202528' : '#9b9c9c';
        g.beginPath();
        g.ellipse(
          Math.random() * w,
          Math.random() * h,
          20 + Math.random() * 80,
          12 + Math.random() * 45,
          Math.random() * 6,
          0,
          Math.PI * 2,
        );
        g.fill();
      }
      g.globalAlpha = 1;
    },
    (ARENA * 2 + 20) / 8,
  );
  asphaltTex.anisotropy = maxAniso;
  const asphaltMat = new THREE.MeshStandardMaterial({
    map: asphaltTex,
    bumpMap: asphaltTex,
    bumpScale: 0.016,
    roughness: 0.96,
    metalness: 0,
  });
  const asphalt = new THREE.Mesh(new THREE.PlaneGeometry(ARENA * 2 + 20, ARENA * 2 + 20), asphaltMat);
  asphalt.rotation.x = -Math.PI / 2;
  asphalt.receiveShadow = true;
  scene.add(asphalt);
  const asphaltHeight = asphaltTex.clone();
  asphaltHeight.encoding = THREE.LinearEncoding;
  asphaltHeight.needsUpdate = true;
  const roadRoughness = canvasTex(256, 256, (g, w, h) => noiseFill(g, w, h, '#e8e8e8', 20, 200), (ARENA * 2 + 20) / 14);
  roadRoughness.encoding = THREE.LinearEncoding;
  asphaltMat.bumpMap = asphaltHeight;
  asphaltMat.bumpScale = 0.011;
  asphaltMat.roughness = 0.92;
  asphaltMat.roughnessMap = roadRoughness;

  const grassTex = canvasTex(256, 256, (g, w, h) => noiseFill(g, w, h, '#53703a', 40, 1500), 400);
  grassTex.anisotropy = maxAniso;
  const grass = new THREE.Mesh(
    new THREE.PlaneGeometry(3000, 3000),
    new THREE.MeshStandardMaterial({ map: grassTex, roughness: 1 }),
  );
  grass.rotation.x = -Math.PI / 2;
  grass.position.y = -0.03;
  grass.receiveShadow = true;
  scene.add(grass);

  // ---- painted markings
  const paintMat = (c: number) =>
    new THREE.MeshStandardMaterial({
      color: lin(c),
      roughness: 0.7,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
  const white = paintMat(0xeeeeee);
  const yellow = paintMat(0xf2c230);
  const flat = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, rot = 0): THREE.Mesh => {
    const m = new THREE.Mesh(geo, mat);
    m.rotation.set(-Math.PI / 2, 0, rot);
    m.position.set(x, 0.01, -y);
    m.receiveShadow = true;
    scene.add(m);
    return m;
  };
  for (const y of [-9, 9]) flat(new THREE.PlaneGeometry(370, 0.22), white, 0, y);
  const dashTex = canvasTex(64, 8, (g) => {
    g.fillStyle = '#f2c230';
    g.fillRect(0, 0, 32, 8);
  });
  dashTex.repeat.set(60, 1);
  flat(
    new THREE.PlaneGeometry(360, 0.18),
    new THREE.MeshStandardMaterial({
      map: dashTex,
      transparent: true,
      alphaTest: 0.5,
      roughness: 0.7,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    }),
    0,
    0,
  );
  const checkTex = canvasTex(64, 512, (g) => {
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 32; j++) {
        g.fillStyle = (i + j) % 2 ? '#111' : '#eee';
        g.fillRect(i * 16, j * 16, 16, 16);
      }
    }
  });
  checkTex.wrapS = checkTex.wrapT = THREE.ClampToEdgeWrapping;
  flat(
    new THREE.PlaneGeometry(1.6, 18),
    new THREE.MeshStandardMaterial({
      map: checkTex,
      roughness: 0.7,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    }),
    -160,
    0,
  );

  // skid-pad and figure-eight rings
  const ring = (x: number, y: number, r: number, mat: THREE.Material, w = 0.3) =>
    flat(new THREE.RingGeometry(r - w / 2, r + w / 2, 160), mat, x, y);
  ring(90, 85, 26, white);
  ring(90, 85, 10, yellow, 0.2);
  ring(-80, -95, 24, white);
  ring(-30, -95, 24, white);
  const rubber = new THREE.MeshStandardMaterial({ color: lin(0x383b3e), roughness: 0.99 });
  for (const radius of [17.0, 18.58, 21.0, 22.58]) ring(90, 85, radius, rubber, 0.14);
  for (const x of [-140, -110, -80, -50]) {
    const number = canvasTex(256, 64, (g, w, h) => {
      g.fillStyle = '#57595b';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#dbdad2';
      g.font = '600 48px sans-serif';
      g.textAlign = 'center';
      g.fillText(String(x + 140) + ' m', w / 2, 49);
    });
    number.wrapS = number.wrapT = THREE.ClampToEdgeWrapping;
    flat(new THREE.PlaneGeometry(3.2, 0.8), new THREE.MeshStandardMaterial({ map: number, roughness: 0.95 }), x, -6.6);
  }

  // ---- perimeter: alternating red / white jersey barriers (instanced)
  const js = new THREE.Shape();
  (
    [
      [-0.3, 0],
      [0.3, 0],
      [0.18, 0.25],
      [0.1, 0.82],
      [-0.1, 0.82],
      [-0.18, 0.25],
    ] as Array<[number, number]>
  ).forEach(([x, y], i) => (i ? js.lineTo(x, y) : js.moveTo(x, y)));
  const jGeo = new THREE.ExtrudeGeometry(js, { depth: 3.9, bevelEnabled: false });
  jGeo.translate(0, 0, -1.95);
  const per = Math.round((ARENA * 2) / 4);
  const barriers = new THREE.InstancedMesh(jGeo, new THREE.MeshStandardMaterial({ roughness: 0.85 }), per * 4);
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  let k = 0;
  for (let s = 0; s < 4; s++) {
    for (let i = 0; i < per; i++) {
      const t = -ARENA + 2 + i * 4;
      const o = ARENA + 0.3;
      const [x, z, ry] = (
        [
          [t, -o, Math.PI / 2],
          [t, o, Math.PI / 2],
          [-o, t, 0],
          [o, t, 0],
        ] as Array<[number, number, number]>
      )[s];
      dummy.position.set(x, 0, z);
      dummy.rotation.set(0, ry, 0);
      dummy.updateMatrix();
      barriers.setMatrixAt(k, dummy.matrix);
      barriers.setColorAt(k++, col.setHex(i % 2 ? 0xe9e9e6 : 0xc62a24).convertSRGBToLinear());
    }
  }
  barriers.castShadow = true;
  barriers.receiveShadow = true;
  scene.add(barriers);

  // ---- tyre stacks (instanced tori), each a circular collider
  const stacks: Array<[number, number]> = [];
  for (let i = 0; i < 7; i++) stacks.push([120, 1.6 + i * 1.25], [148, -1.6 - i * 1.25]);
  for (const [sx, sy] of [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ]) {
    for (let i = 0; i < 9; i++) stacks.push([sx * (ARENA - 22 + i * 2.2), sy * (ARENA - 2.5 - i * 2.2)]);
  }
  const tyreStack = new THREE.InstancedMesh(
    new THREE.TorusGeometry(0.42, 0.17, 8, 18),
    new THREE.MeshStandardMaterial({ color: lin(0x151515), roughness: 0.9 }),
    stacks.length * 3,
  );
  k = 0;
  for (const [x, y] of stacks) {
    for (let j = 0; j < 3; j++) {
      dummy.position.set(x, 0.17 + j * 0.3, -y);
      dummy.rotation.set(Math.PI / 2, 0, j);
      dummy.updateMatrix();
      tyreStack.setMatrixAt(k++, dummy.matrix);
    }
    colliders.circles.push({ x, y, r: 0.6, surface: 'tyres' });
  }
  tyreStack.castShadow = true;
  tyreStack.receiveShadow = true;
  scene.add(tyreStack);

  // ---- light poles along the main straight
  const poleMat = new THREE.MeshStandardMaterial({ color: lin(0x8a8f96), metalness: 0.6, roughness: 0.4 });
  const lampMat = new THREE.MeshStandardMaterial({
    color: lin(0x333333),
    emissive: lin(0xfff2d0),
    emissiveIntensity: 0,
  });
  for (const x of [-140, -60, 20, 100, 170]) {
    for (const y of [-14, 14]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 10, 10), poleMat);
      pole.position.set(x, 5, -y);
      pole.castShadow = true;
      scene.add(pole);
      const head = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.18, 0.5), lampMat);
      head.position.set(x, 9.9, -y + Math.sign(y) * 0.6);
      scene.add(head);
      colliders.circles.push({ x, y, r: 0.25, surface: 'pole' });
    }
  }

  // ---- buildings outside the wall (backdrop)
  const bldMat = new THREE.MeshStandardMaterial({ color: lin(0xb9bcc0), roughness: 0.85 });
  const winMat = new THREE.MeshStandardMaterial({
    color: lin(0x1d2630),
    metalness: 0.6,
    roughness: 0.2,
    emissive: lin(0xffd9a0),
    emissiveIntensity: 0,
  });
  const sign = canvasTex(1024, 128, (g, w, h) => {
    g.fillStyle = '#16181c';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffb21a';
    g.font = '900 78px "Saira Semi Condensed", Impact, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('PROVING GROUND', w / 2, h / 2 + 4);
  });
  sign.wrapS = sign.wrapT = THREE.ClampToEdgeWrapping;
  for (const [x, y, w, d, h] of [
    [-232, 10, 22, 70, 9],
    [40, 238, 90, 24, 12],
    [150, -236, 60, 20, 8],
  ] as Array<[number, number, number, number, number]>) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), bldMat);
    b.position.set(x, h / 2, -y);
    b.castShadow = true;
    b.receiveShadow = true;
    scene.add(b);
    const facing = Math.abs(x) > Math.abs(y) ? [Math.sign(-x), 0] : [0, Math.sign(-y)];
    const win = new THREE.Mesh(
      new THREE.BoxGeometry(facing[0] ? 0.2 : w * 0.85, h * 0.28, facing[0] ? d * 0.85 : 0.2),
      winMat,
    );
    win.position.set(x + facing[0] * (w / 2), h * 0.45, -(y + facing[1] * (d / 2)));
    scene.add(win);
    if (x < 0) {
      const sg = new THREE.Mesh(new THREE.PlaneGeometry(40, 5), new THREE.MeshBasicMaterial({ map: sign }));
      sg.position.set(x + w / 2 + 0.15, h * 0.82, -y);
      sg.rotation.y = Math.PI / 2;
      scene.add(sg);
    }
  }

  // ---- trees and distant hills
  const treeCount = 320;
  const trunks = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.18, 0.28, 2.4, 6),
    new THREE.MeshStandardMaterial({ color: lin(0x5a4030), roughness: 1 }),
    treeCount,
  );
  const crowns = new THREE.InstancedMesh(
    new THREE.ConeGeometry(2.2, 6.5, 7),
    new THREE.MeshStandardMaterial({ color: lin(0x2f5a2e), roughness: 0.95, flatShading: true }),
    treeCount,
  );
  for (let i = 0; i < treeCount; i++) {
    let x: number;
    let y: number;
    do {
      x = (Math.random() - 0.5) * 760;
      y = (Math.random() - 0.5) * 760;
    } while (
      Math.max(Math.abs(x), Math.abs(y)) < ARENA + 14 ||
      (x < -205 && Math.abs(y) < 60) ||
      (y > 215 && Math.abs(x - 40) < 60) ||
      (y < -215 && Math.abs(x - 150) < 45)
    );
    const s = 0.7 + Math.random() * 0.9;
    dummy.position.set(x, 1.2 * s, -y);
    dummy.rotation.set(0, Math.random() * 6, 0);
    dummy.scale.set(s, s, s);
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);
    dummy.position.y = (2.4 + 3) * s;
    dummy.updateMatrix();
    crowns.setMatrixAt(i, dummy.matrix);
  }
  scene.add(trunks, crowns);

  const hillMat = new THREE.MeshStandardMaterial({ color: lin(0x4d6170), roughness: 1, flatShading: true });
  for (let i = 0; i < 34; i++) {
    const a = (i / 34) * Math.PI * 2 + Math.random() * 0.1;
    const d = 700 + Math.random() * 250;
    const h = 70 + Math.random() * 170;
    const hill = new THREE.Mesh(
      new THREE.SphereGeometry(1, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2),
      hillMat,
    );
    hill.scale.set(140 + Math.random() * 160, h, 140 + Math.random() * 120);
    hill.position.set(Math.cos(a) * d, -12, Math.sin(a) * d);
    hill.rotation.y = Math.random() * 3;
    scene.add(hill);
  }

  // ---- cones (dynamic props)
  const conePlaces: Array<[number, number]> = [];
  for (let i = 0; i < 9; i++) conePlaces.push([-100 + i * 15, 0]);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    conePlaces.push([90 + Math.cos(a) * 10, 85 + Math.sin(a) * 10]);
  }
  for (const cx of [-80, -30]) {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      conePlaces.push([cx + Math.cos(a) * 6, -95 + Math.sin(a) * 6]);
    }
  }
  for (let i = 0; i < 6; i++) conePlaces.push([40 + i * 8, 9 + (i % 2) * 0.01], [40 + i * 8, -9]);
  for (let i = 0; i < 16; i++) {
    conePlaces.push([(Math.random() - 0.5) * 300, (Math.random() < 0.5 ? 1 : -1) * (25 + Math.random() * 150)]);
  }
  const coneBody = new THREE.ConeGeometry(0.27, 0.72, 16, 1, true);
  coneBody.translate(0, 0.4, 0);
  const coneBase = new THREE.BoxGeometry(0.5, 0.04, 0.5);
  coneBase.translate(0, 0.02, 0);
  const coneBand = new THREE.CylinderGeometry(0.155, 0.19, 0.12, 16, 1, true);
  coneBand.translate(0, 0.45, 0);
  const coneMat = new THREE.MeshStandardMaterial({ color: lin(0xff6a00), roughness: 0.55, side: THREE.DoubleSide });
  const bandMat = new THREE.MeshStandardMaterial({ color: lin(0xf5f5f5), roughness: 0.3, emissive: lin(0x333333) });
  const baseMat = new THREE.MeshStandardMaterial({ color: lin(0x1a1a1a), roughness: 0.8 });
  const cones: DynamicCone[] = conePlaces.map(([x, y]) => {
    const yaw = new THREE.Group();
    const tilt = new THREE.Group();
    yaw.add(tilt);
    for (const [g, m] of [
      [coneBody, coneMat],
      [coneBase, baseMat],
      [coneBand, bandMat],
    ] as Array<[THREE.BufferGeometry, THREE.Material]>) {
      const mesh = new THREE.Mesh(g, m);
      mesh.castShadow = true;
      tilt.add(mesh);
    }
    scene.add(yaw);
    const c: DynamicCone = {
      obj: yaw,
      tiltObj: tilt,
      home: [x, y],
      x,
      y,
      h: 0,
      vx: 0,
      vy: 0,
      vh: 0,
      yaw: 0,
      tilt: 0,
      tiltV: 0,
      active: false,
      hit: false,
    };
    resetCone(c);
    return c;
  });

  return { colliders, cones, lampMat, winMat, asphalt };
}

export function instanceCones(scene: THREE.Object3D, world: WorldSceneData): void {
  const cones = world.cones;
  const parts = cones[0].tiltObj.children as THREE.Mesh[];
  world.coneInstances = parts.map((p) => {
    const mesh = new THREE.InstancedMesh(p.geometry, p.material, cones.length);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(mesh);
    return mesh;
  });
  cones.forEach((c) => scene.remove(c.obj));
  world.conesDirty = true;
  syncConeInstances(world, true);
}

export function syncConeInstances(world: WorldSceneData, force = false): void {
  if (!world.coneInstances) return;
  if (!force && !world.conesDirty && !world.cones.some((c) => c.active)) return;
  world.cones.forEach((c, i) => {
    c.obj.updateMatrixWorld(true);
    world.coneInstances!.forEach((mesh) => mesh.setMatrixAt(i, c.tiltObj.matrixWorld));
  });
  world.coneInstances.forEach((mesh) => (mesh.instanceMatrix.needsUpdate = true));
  world.conesDirty = false;
}
