import * as THREE from 'three';
import type { CircleCollider } from '../physics/collisions.ts';
import {
  findNearestTrackPoint,
  sampleTrackAtS,
  type TrackDefinition,
  type TrackGate,
} from '../race/trackDefinition.ts';

export interface NeonCircuitWorld {
  group: THREE.Group;
  colliders: CircleCollider[];
  update: (params: {
    time: number;
    nextCheckpointIndex: number;
    availablePadIds: readonly number[];
    countdownNumber: 3 | 2 | 1 | 0 | null;
  }) => void;
}

function makeCircuitRoadTexture(maxAniso: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const g = c.getContext('2d');
  if (g) {
    // Dark evening asphalt base
    g.fillStyle = '#141922';
    g.fillRect(0, 0, 512, 512);

    // Subtle longitudinal tire wear tracks
    const wearGradLeft = g.createLinearGradient(90, 0, 210, 0);
    wearGradLeft.addColorStop(0, 'rgba(8, 11, 16, 0)');
    wearGradLeft.addColorStop(0.5, 'rgba(8, 11, 16, 0.45)');
    wearGradLeft.addColorStop(1, 'rgba(8, 11, 16, 0)');
    g.fillStyle = wearGradLeft;
    g.fillRect(90, 0, 120, 512);

    const wearGradRight = g.createLinearGradient(302, 0, 422, 0);
    wearGradRight.addColorStop(0, 'rgba(8, 11, 16, 0)');
    wearGradRight.addColorStop(0.5, 'rgba(8, 11, 16, 0.45)');
    wearGradRight.addColorStop(1, 'rgba(8, 11, 16, 0)');
    g.fillStyle = wearGradRight;
    g.fillRect(302, 0, 120, 512);

    // Fine asphalt aggregate grain
    for (let i = 0; i < 4500; i++) {
      const x = (i * 73) % 512;
      const y = (i * 197) % 512;
      const v = 22 + (i % 18);
      g.fillStyle = `rgb(${v},${v + 4},${v + 10})`;
      g.fillRect(x, y, 2, 2);
    }

    // Outer solid neon-cyan & white edge lines
    g.fillStyle = '#00e5ff';
    g.fillRect(14, 0, 8, 512);
    g.fillRect(490, 0, 8, 512);

    g.fillStyle = 'rgba(235, 245, 255, 0.85)';
    g.fillRect(26, 0, 5, 512);
    g.fillRect(481, 0, 5, 512);

    // Dashed centerline
    g.fillStyle = 'rgba(0, 229, 255, 0.55)';
    for (let y = 0; y < 512; y += 64) {
      g.fillRect(253, y + 8, 6, 36);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = maxAniso;
  return tex;
}

function makeCheckeredTexture(maxAniso: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d');
  if (g) {
    const cols = 16;
    const rows = 4;
    const cw = c.width / cols;
    const ch = c.height / rows;
    for (let r = 0; r < rows; r++) {
      for (let col = 0; col < cols; col++) {
        g.fillStyle = (r + col) % 2 === 0 ? '#f4f8fb' : '#10151d';
        g.fillRect(col * cw, r * ch, cw, ch);
      }
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = maxAniso;
  return tex;
}

function makeGantryBannerTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 96;
  const g = c.getContext('2d');
  if (g) {
    g.fillStyle = '#090e16';
    g.fillRect(0, 0, 512, 96);
    g.strokeStyle = '#00e5ff';
    g.lineWidth = 4;
    g.strokeRect(4, 4, 504, 88);
    g.fillStyle = '#00e5ff';
    g.font = '900 36px Bahnschrift, Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('NEON CIRCUIT // 3 LAPS', 256, 48);
  }
  return new THREE.CanvasTexture(c);
}

function makeChevronTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const g = c.getContext('2d');
  if (g) {
    g.fillStyle = '#0b1018';
    g.fillRect(0, 0, 128, 64);
    g.strokeStyle = '#00e5ff';
    g.lineWidth = 3;
    g.strokeRect(2, 2, 124, 60);

    g.fillStyle = '#ffb81c';
    for (const offset of [22, 62]) {
      g.beginPath();
      g.moveTo(offset, 12);
      g.lineTo(offset + 24, 32);
      g.lineTo(offset, 52);
      g.lineTo(offset + 12, 52);
      g.lineTo(offset + 36, 32);
      g.lineTo(offset + 12, 12);
      g.closePath();
      g.fill();
    }
  }
  return new THREE.CanvasTexture(c);
}

function buildTrackRibbonGeometry(track: TrackDefinition): THREE.BufferGeometry {
  const samples = track.samples;
  const n = samples.length;
  const positions = new Float32Array((n + 1) * 2 * 3);
  const normals = new Float32Array((n + 1) * 2 * 3);
  const uvs = new Float32Array((n + 1) * 2 * 2);
  const indices: number[] = [];

  for (let i = 0; i <= n; i++) {
    const s = samples[i % n];
    const vCoord = (i === n ? track.totalLength : s.s) / 14;
    const baseV = i * 2;

    // Left edge in Three.js coords: (leftX, 0.015, -leftY)
    positions[baseV * 3 + 0] = s.leftX;
    positions[baseV * 3 + 1] = 0.015;
    positions[baseV * 3 + 2] = -s.leftY;
    normals[baseV * 3 + 1] = 1;
    uvs[baseV * 2 + 0] = 0;
    uvs[baseV * 2 + 1] = vCoord;

    // Right edge in Three.js coords: (rightX, 0.015, -rightY)
    const rightV = baseV + 1;
    positions[rightV * 3 + 0] = s.rightX;
    positions[rightV * 3 + 1] = 0.015;
    positions[rightV * 3 + 2] = -s.rightY;
    normals[rightV * 3 + 1] = 1;
    uvs[rightV * 2 + 0] = 1;
    uvs[rightV * 2 + 1] = vCoord;

    if (i < n) {
      const a = baseV;
      const b = baseV + 1;
      const c = baseV + 2;
      const d = baseV + 3;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

function buildCurbGeometry(track: TrackDefinition): THREE.BufferGeometry {
  const samples = track.samples;
  const n = samples.length;
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  let vertCount = 0;

  const addQuad = (
    ax: number,
    az: number,
    bx: number,
    bz: number,
    cx: number,
    cz: number,
    dx: number,
    dz: number,
    r: number,
    g: number,
    b: number,
  ) => {
    const y = 0.032;
    positions.push(ax, y, az, bx, y, bz, cx, y, cz, dx, y, dz);
    normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
    colors.push(r, g, b, r, g, b, r, g, b, r, g, b);
    indices.push(
      vertCount,
      vertCount + 2,
      vertCount + 1,
      vertCount + 1,
      vertCount + 2,
      vertCount + 3,
    );
    vertCount += 4;
  };

  for (let i = 0; i < n; i++) {
    const s0 = samples[i];
    const s1 = samples[(i + 1) % n];
    const isAccent = i % 2 === 0;
    const r = isAccent ? 0.0 : 0.88;
    const g = isAccent ? 0.82 : 0.92;
    const b = isAccent ? 0.96 : 0.96;

    // Left curb between road left and barrier left
    addQuad(
      s0.barrierLeftX,
      -s0.barrierLeftY,
      s0.leftX,
      -s0.leftY,
      s1.barrierLeftX,
      -s1.barrierLeftY,
      s1.leftX,
      -s1.leftY,
      r,
      g,
      b,
    );

    // Right curb between road right and barrier right
    addQuad(
      s0.rightX,
      -s0.rightY,
      s0.barrierRightX,
      -s0.barrierRightY,
      s1.rightX,
      -s1.rightY,
      s1.barrierRightX,
      -s1.barrierRightY,
      r,
      g,
      b,
    );
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  return geo;
}

function buildBarrierWallGeometry(
  track: TrackDefinition,
  wallHeight: number,
  yBottom = 0,
): THREE.BufferGeometry {
  const samples = track.samples;
  const n = samples.length;
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  let vertCount = 0;

  const pushFace = (
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    nx: number,
    nz: number,
  ) => {
    positions.push(
      x0,
      yBottom,
      z0,
      x1,
      yBottom,
      z1,
      x0,
      yBottom + wallHeight,
      z0,
      x1,
      yBottom + wallHeight,
      z1,
    );
    normals.push(nx, 0, nz, nx, 0, nz, nx, 0, nz, nx, 0, nz);
    indices.push(
      vertCount,
      vertCount + 1,
      vertCount + 2,
      vertCount + 1,
      vertCount + 3,
      vertCount + 2,
    );
    vertCount += 4;
  };

  for (let i = 0; i < n; i++) {
    const s0 = samples[i];
    const s1 = samples[(i + 1) % n];

    // Inner (left) barrier facing right toward road (-nx, +ny in Three.js)
    pushFace(
      s0.barrierLeftX,
      -s0.barrierLeftY,
      s1.barrierLeftX,
      -s1.barrierLeftY,
      -s0.nx,
      s0.ny,
    );

    // Outer (right) barrier facing left toward road (+nx, -ny in Three.js)
    pushFace(
      s1.barrierRightX,
      -s1.barrierRightY,
      s0.barrierRightX,
      -s0.barrierRightY,
      s0.nx,
      -s0.ny,
    );
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setIndex(indices);
  return geo;
}

export function buildNeonCircuitWorld(
  track: TrackDefinition,
  maxAniso: number,
): NeonCircuitWorld {
  const group = new THREE.Group();
  group.name = 'NeonCircuitWorld';
  const colliders: CircleCollider[] = [];

  // 1. Evening industrial ground plane
  const groundMat = new THREE.MeshStandardMaterial({
    color: 0x0c1017,
    roughness: 0.94,
    metalness: 0.06,
  });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(760, 760), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.01;
  ground.receiveShadow = true;
  group.add(ground);

  // 2. Main asphalt ribbon
  const roadTex = makeCircuitRoadTexture(maxAniso);
  const roadMat = new THREE.MeshStandardMaterial({
    map: roadTex,
    roughness: 0.78,
    metalness: 0.08,
  });
  const roadMesh = new THREE.Mesh(buildTrackRibbonGeometry(track), roadMat);
  roadMesh.receiveShadow = true;
  group.add(roadMesh);

  // 3. Curbs
  const curbMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.65,
    metalness: 0.1,
  });
  const curbMesh = new THREE.Mesh(buildCurbGeometry(track), curbMat);
  curbMesh.receiveShadow = true;
  group.add(curbMesh);

  // 4. Physical barrier walls + glowing top neon strip
  const barrierMat = new THREE.MeshStandardMaterial({
    color: 0x1b2330,
    roughness: 0.72,
    metalness: 0.25,
  });
  const barrierMesh = new THREE.Mesh(buildBarrierWallGeometry(track, 0.9, 0), barrierMat);
  barrierMesh.castShadow = true;
  barrierMesh.receiveShadow = true;
  group.add(barrierMesh);

  const neonStripMat = new THREE.MeshBasicMaterial({
    color: 0x00e5ff,
    side: THREE.DoubleSide,
  });
  const neonStripMesh = new THREE.Mesh(
    buildBarrierWallGeometry(track, 0.09, 0.88),
    neonStripMat,
  );
  group.add(neonStripMesh);

  // 5. Start/Finish Gantry Arch & Checkered Line (aligned with track.startFinishGate)
  const sfGate = track.startFinishGate;
  const sfGroup = new THREE.Group();
  sfGroup.position.set(sfGate.x, 0, -sfGate.y);
  sfGroup.rotation.y = Math.atan2(sfGate.ny, sfGate.nx);

  const checkeredMat = new THREE.MeshStandardMaterial({
    map: makeCheckeredTexture(maxAniso),
    roughness: 0.6,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
  const checkeredPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(2.6, track.roadWidth),
    checkeredMat,
  );
  checkeredPlane.rotation.x = -Math.PI / 2;
  checkeredPlane.position.y = 0.026;
  sfGroup.add(checkeredPlane);

  const gantrySteelMat = new THREE.MeshStandardMaterial({
    color: 0x18202c,
    roughness: 0.5,
    metalness: 0.65,
  });
  const spanHalf = track.barrierHalfWidth + 0.5;
  const gantryHeight = 6.2;
  const pillarGeo = new THREE.BoxGeometry(0.7, gantryHeight, 0.7);
  const leftPillar = new THREE.Mesh(pillarGeo, gantrySteelMat);
  leftPillar.position.set(0, gantryHeight * 0.5, -spanHalf);
  const rightPillar = new THREE.Mesh(pillarGeo, gantrySteelMat);
  rightPillar.position.set(0, gantryHeight * 0.5, spanHalf);
  const crossBeam = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 0.85, spanHalf * 2 + 0.8),
    gantrySteelMat,
  );
  crossBeam.position.set(0, gantryHeight - 0.3, 0);
  sfGroup.add(leftPillar, rightPillar, crossBeam);

  const bannerTex = makeGantryBannerTexture();
  const bannerMat = new THREE.MeshBasicMaterial({ map: bannerTex });
  const bannerBoard = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.35, 11.5), bannerMat);
  bannerBoard.position.set(-0.48, gantryHeight - 0.3, 0);
  sfGroup.add(bannerBoard);

  // 5 countdown light pods on the gantry facing the starting grid
  const countdownPodMaterials: THREE.MeshBasicMaterial[] = [];
  const podGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.16, 16);
  podGeo.rotateZ(Math.PI / 2);
  for (let i = 0; i < 5; i++) {
    const podMat = new THREE.MeshBasicMaterial({ color: 0x222a35 });
    countdownPodMaterials.push(podMat);
    const pod = new THREE.Mesh(podGeo, podMat);
    pod.position.set(-0.52, gantryHeight - 1.25, (i - 2) * 1.15);
    sfGroup.add(pod);
  }
  group.add(sfGroup);

  // 6. Industrial Neon Tunnel (from track.tunnel.startS to track.tunnel.endS)
  const tunnelGroup = new THREE.Group();
  const tunnelPortalCount = 14;
  const tunnelSpan = track.barrierHalfWidth + 0.65;
  const tunnelHeight = track.tunnel.height;
  const tunnelWallMat = new THREE.MeshStandardMaterial({
    color: 0x121822,
    roughness: 0.75,
    metalness: 0.4,
  });
  const tunnelCyanMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff });
  const tunnelMagentaMat = new THREE.MeshBasicMaterial({ color: 0xff2a85 });

  const portalLegGeo = new THREE.BoxGeometry(1.2, tunnelHeight, 0.65);
  const portalRoofGeo = new THREE.BoxGeometry(2.6, 0.65, tunnelSpan * 2 + 1.2);
  const neonBarGeo = new THREE.BoxGeometry(0.25, 0.12, tunnelSpan * 1.75);

  for (let i = 0; i <= tunnelPortalCount; i++) {
    const alpha = i / tunnelPortalCount;
    const s = track.tunnel.startS + (track.tunnel.endS - track.tunnel.startS) * alpha;
    const pt = sampleTrackAtS(track.samples, track.totalLength, s);

    const frame = new THREE.Group();
    frame.position.set(pt.x, 0, -pt.y);
    frame.rotation.y = pt.heading;

    const lLeg = new THREE.Mesh(portalLegGeo, tunnelWallMat);
    lLeg.position.set(0, tunnelHeight * 0.5, -tunnelSpan);
    const rLeg = new THREE.Mesh(portalLegGeo, tunnelWallMat);
    rLeg.position.set(0, tunnelHeight * 0.5, tunnelSpan);
    const roof = new THREE.Mesh(portalRoofGeo, tunnelWallMat);
    roof.position.set(0, tunnelHeight, 0);

    const lightBar = new THREE.Mesh(
      neonBarGeo,
      i % 3 === 0 ? tunnelMagentaMat : tunnelCyanMat,
    );
    lightBar.position.set(0, tunnelHeight - 0.36, 0);

    frame.add(lLeg, rLeg, roof, lightBar);
    tunnelGroup.add(frame);
  }
  group.add(tunnelGroup);

  // 7. Checkpoint Neon Pylons & Ground Bars
  const cpPassiveMat = new THREE.MeshBasicMaterial({ color: 0x005f88 });
  const cpActiveMat = new THREE.MeshBasicMaterial({ color: 0x00ffaa });
  const cpBaseMat = new THREE.MeshStandardMaterial({
    color: 0x1b2430,
    roughness: 0.5,
    metalness: 0.6,
  });
  const pylonBaseGeo = new THREE.CylinderGeometry(0.26, 0.32, 0.8, 10);
  const pylonLightGeo = new THREE.CylinderGeometry(0.14, 0.14, 3.6, 10);
  const cpStripGeo = new THREE.PlaneGeometry(0.45, track.roadWidth);

  const checkpointVisuals: Array<{
    gate: TrackGate;
    leftGlow: THREE.Mesh;
    rightGlow: THREE.Mesh;
    roadStrip: THREE.Mesh;
  }> = [];

  for (const cp of track.checkpoints) {
    const cpGroup = new THREE.Group();
    cpGroup.position.set(cp.x, 0, -cp.y);
    cpGroup.rotation.y = Math.atan2(cp.ny, cp.nx);

    const zOffset = track.barrierHalfWidth + 0.35;
    const lBase = new THREE.Mesh(pylonBaseGeo, cpBaseMat);
    lBase.position.set(0, 0.4, -zOffset);
    const rBase = new THREE.Mesh(pylonBaseGeo, cpBaseMat);
    rBase.position.set(0, 0.4, zOffset);

    const leftGlow = new THREE.Mesh(pylonLightGeo, cpPassiveMat);
    leftGlow.position.set(0, 2.5, -zOffset);
    const rightGlow = new THREE.Mesh(pylonLightGeo, cpPassiveMat);
    rightGlow.position.set(0, 2.5, zOffset);

    const roadStrip = new THREE.Mesh(cpStripGeo, cpPassiveMat);
    roadStrip.rotation.x = -Math.PI / 2;
    roadStrip.position.y = 0.022;

    cpGroup.add(lBase, rBase, leftGlow, rightGlow, roadStrip);
    group.add(cpGroup);
    checkpointVisuals.push({ gate: cp, leftGlow, rightGlow, roadStrip });
  }

  // 8. Boost Pickup Pads (4 pads on track)
  const boostRingGeo = new THREE.RingGeometry(1.1, 1.9, 24);
  boostRingGeo.rotateX(-Math.PI / 2);
  const boostCoreGeo = new THREE.OctahedronGeometry(0.65, 0);

  const boostRingActiveMat = new THREE.MeshBasicMaterial({
    color: 0xffb81c,
    side: THREE.DoubleSide,
  });
  const boostRingInactiveMat = new THREE.MeshBasicMaterial({
    color: 0x333c4a,
    side: THREE.DoubleSide,
  });
  const boostCoreMat = new THREE.MeshBasicMaterial({
    color: 0x00ffd5,
  });

  const boostVisuals: Array<{
    id: number;
    ring: THREE.Mesh;
    core: THREE.Mesh;
  }> = [];

  for (const pad of track.boostPads) {
    const padGroup = new THREE.Group();
    padGroup.position.set(pad.x, 0, -pad.y);

    const ring = new THREE.Mesh(boostRingGeo, boostRingActiveMat);
    ring.position.y = 0.035;

    const core = new THREE.Mesh(boostCoreGeo, boostCoreMat);
    core.position.y = 0.95;

    padGroup.add(ring, core);
    group.add(padGroup);
    boostVisuals.push({ id: pad.id, ring, core });
  }

  // 9. Turn Chevron Warning Boards on outside of curves
  const chevronTex = makeChevronTexture();
  const chevronBoardMat = new THREE.MeshBasicMaterial({ map: chevronTex });
  const chevronPostMat = new THREE.MeshStandardMaterial({
    color: 0x1e2631,
    roughness: 0.6,
    metalness: 0.5,
  });
  const chevronBoardGeo = new THREE.BoxGeometry(0.12, 1.1, 2.2);
  const chevronPostGeo = new THREE.CylinderGeometry(0.08, 0.08, 1.6, 8);

  const chevronPositionsS = [
    0.13, 0.16, 0.19, 0.36, 0.39, 0.42, 0.5, 0.62, 0.66, 0.72, 0.86, 0.9,
  ];
  for (const frac of chevronPositionsS) {
    const pt = sampleTrackAtS(track.samples, track.totalLength, frac * track.totalLength);
    // Place on outer (right) side of the barrier
    const signGroup = new THREE.Group();
    const outDist = track.barrierHalfWidth + 1.1;
    signGroup.position.set(
      pt.x - pt.nx * outDist,
      0,
      -(pt.y - pt.ny * outDist),
    );
    signGroup.rotation.y = pt.heading + 0.25;
    const post = new THREE.Mesh(chevronPostGeo, chevronPostMat);
    post.position.y = 0.8;
    const board = new THREE.Mesh(chevronBoardGeo, chevronBoardMat);
    board.position.y = 1.45;
    signGroup.add(post, board);
    group.add(signGroup);
  }

  // 10. Instanced Shipping Containers & Industrial Warehouses (safely outside track corridor)
  const containerGeo = new THREE.BoxGeometry(6.2, 2.7, 2.5);
  const containerMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.72,
    metalness: 0.32,
  });
  const candidateContainerPoses: Array<{
    x: number;
    y: number;
    z: number;
    yaw: number;
    color: number;
  }> = [];

  const palette = [0x1b3b5c, 0x7a2e22, 0x1d4d4f, 0x2b3442, 0x6b4c1b];
  for (let i = 0; i < 48; i++) {
    const s = (i / 48) * track.totalLength;
    // Skip tunnel span
    if (s >= track.tunnel.startS - 12 && s <= track.tunnel.endS + 12) continue;
    const pt = sampleTrackAtS(track.samples, track.totalLength, s);
    const side = i % 2 === 0 ? 1 : -1;
    const offset = track.barrierHalfWidth + 6.5 + (i % 3) * 2.2;
    const cx = pt.x + pt.nx * side * offset;
    const cy = pt.y + pt.ny * side * offset;

    // Ensure container is well outside the entire track loop
    const nearest = findNearestTrackPoint(track, cx, cy);
    if (nearest.distance < track.barrierHalfWidth + 4.5) continue;

    candidateContainerPoses.push({
      x: cx,
      y: 1.35,
      z: -cy,
      yaw: pt.heading,
      color: palette[i % palette.length],
    });
    if (i % 3 === 0) {
      // Stacked second container
      candidateContainerPoses.push({
        x: cx,
        y: 4.05,
        z: -cy,
        yaw: pt.heading + 0.03,
        color: palette[(i + 2) % palette.length],
      });
    }
  }

  const containerInst = new THREE.InstancedMesh(
    containerGeo,
    containerMat,
    candidateContainerPoses.length,
  );
  containerInst.castShadow = true;
  containerInst.receiveShadow = true;
  const dummy = new THREE.Object3D();
  const tempColor = new THREE.Color();
  candidateContainerPoses.forEach((pose, idx) => {
    dummy.position.set(pose.x, pose.y, pose.z);
    dummy.rotation.set(0, pose.yaw, 0);
    dummy.updateMatrix();
    containerInst.setMatrixAt(idx, dummy.matrix);
    tempColor.setHex(pose.color);
    containerInst.setColorAt(idx, tempColor);
  });
  containerInst.instanceMatrix.needsUpdate = true;
  if (containerInst.instanceColor) containerInst.instanceColor.needsUpdate = true;
  group.add(containerInst);

  // 11. Distant Industrial Skyline & Warehouse Blocks with Neon Trim
  const warehouseSpecs: Array<[number, number, number, number, number, number]> = [
    [-210, 0, -140, 42, 18, 28],
    [-10, 0, -145, 56, 16, 24],
    [195, 0, -125, 38, 22, 32],
    [215, 0, 15, 34, 26, 48],
    [185, 0, 135, 44, 20, 30],
    [15, 0, 150, 62, 19, 26],
    [-185, 0, 135, 46, 24, 34],
    [-215, 0, -10, 36, 21, 52],
    // Inner courtyard industrial structures (checked against track distance)
    [-45, 0, -15, 26, 14, 20],
    [45, 0, -10, 28, 16, 22],
  ];

  const warehouseMat = new THREE.MeshStandardMaterial({
    color: 0x111722,
    roughness: 0.85,
    metalness: 0.2,
  });

  warehouseSpecs.forEach(([wx, , wz, w, h, d], idx) => {
    const nearest = findNearestTrackPoint(track, wx, -wz);
    if (nearest.distance < track.barrierHalfWidth + Math.hypot(w, d) * 0.55 + 4) {
      return;
    }
    const bldg = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), warehouseMat);
    bldg.position.set(wx, h * 0.5, wz);
    bldg.castShadow = true;
    bldg.receiveShadow = true;
    group.add(bldg);

    const trim = new THREE.Mesh(
      new THREE.BoxGeometry(w + 0.3, 0.28, d + 0.3),
      idx % 2 === 0 ? tunnelCyanMat : tunnelMagentaMat,
    );
    trim.position.set(wx, h - 0.6, wz);
    group.add(trim);
  });

  // Update function called each frame
  const update = ({
    time,
    nextCheckpointIndex,
    availablePadIds,
    countdownNumber,
  }: {
    time: number;
    nextCheckpointIndex: number;
    availablePadIds: readonly number[];
    countdownNumber: 3 | 2 | 1 | 0 | null;
  }) => {
    // 1. Update checkpoint highlight
    for (let i = 0; i < checkpointVisuals.length; i++) {
      const vis = checkpointVisuals[i];
      const isNext = i === nextCheckpointIndex;
      const mat = isNext ? cpActiveMat : cpPassiveMat;
      vis.leftGlow.material = mat;
      vis.rightGlow.material = mat;
      vis.roadStrip.material = mat;
    }

    // 2. Update boost pads
    for (const padVis of boostVisuals) {
      const available = availablePadIds.includes(padVis.id);
      padVis.core.visible = available;
      padVis.ring.material = available ? boostRingActiveMat : boostRingInactiveMat;
      if (available) {
        padVis.core.position.y = 0.9 + Math.sin(time * 4.2 + padVis.id) * 0.16;
        padVis.core.rotation.y = time * 2.4 + padVis.id;
      }
    }

    // 3. Update Start/Finish gantry countdown lights
    for (let i = 0; i < countdownPodMaterials.length; i++) {
      const mat = countdownPodMaterials[i];
      if (countdownNumber === 0) {
        mat.color.setHex(0x34d17a); // Green GO!
      } else if (countdownNumber === 3 && i < 2) {
        mat.color.setHex(0xff3b30);
      } else if (countdownNumber === 2 && i < 4) {
        mat.color.setHex(0xffb21a);
      } else if (countdownNumber === 1) {
        mat.color.setHex(0xff3b30);
      } else {
        mat.color.setHex(0x00e5ff);
      }
    }
  };

  return {
    group,
    colliders,
    update,
  };
}
