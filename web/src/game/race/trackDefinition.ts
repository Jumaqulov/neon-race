export interface Vec2 {
  x: number;
  y: number;
}

export interface TrackSample {
  /** Arc-length along centerline from Start/Finish (meters) */
  s: number;
  /** Planar world coordinates (meters; x = three.x, y = -three.z) */
  x: number;
  y: number;
  /** Unit tangent vector pointing in forward race direction */
  tx: number;
  ty: number;
  /** Unit left normal vector (-ty, tx) */
  nx: number;
  ny: number;
  /** Forward heading angle in radians (atan2(ty, tx)) */
  heading: number;
  /** Left edge of driveable asphalt (roadHalfWidth) */
  leftX: number;
  leftY: number;
  /** Right edge of driveable asphalt (-roadHalfWidth) */
  rightX: number;
  rightY: number;
  /** Left physical barrier wall position (barrierHalfWidth) */
  barrierLeftX: number;
  barrierLeftY: number;
  /** Right physical barrier wall position (-barrierHalfWidth) */
  barrierRightX: number;
  barrierRightY: number;
}

export interface TrackGate {
  /** 0 for Start/Finish, 1..N for ordered checkpoints */
  index: number;
  /** Arc-length position along track (meters) */
  s: number;
  /** Center point of gate */
  x: number;
  y: number;
  /** Forward unit normal of the gate (race direction) */
  nx: number;
  ny: number;
  /** Left endpoint of finite gate segment */
  ax: number;
  ay: number;
  /** Right endpoint of finite gate segment */
  bx: number;
  by: number;
  /** Half-width of the gate segment (meters) */
  halfWidth: number;
  /** Safe respawn pose for this gate */
  respawn: {
    x: number;
    y: number;
    heading: number;
  };
}

export interface BoostPadDefinition {
  id: number;
  s: number;
  x: number;
  y: number;
  heading: number;
  radius: number;
}

export interface BarrierSegment {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  /** Inward normal pointing toward track centerline */
  nx: number;
  ny: number;
  halfThickness: number;
}

export interface TunnelSection {
  startS: number;
  endS: number;
  height: number;
  width: number;
}

export interface TrackDefinition {
  id: string;
  name: string;
  totalLength: number;
  roadWidth: number;
  roadHalfWidth: number;
  barrierHalfWidth: number;
  corridorHalfWidth: number;
  samples: readonly TrackSample[];
  startFinishGate: TrackGate;
  checkpoints: readonly TrackGate[];
  startSpawn: {
    x: number;
    y: number;
    heading: number;
  };
  boostPads: readonly BoostPadDefinition[];
  barrierSegments: readonly BarrierSegment[];
  tunnel: TunnelSection;
}

const CONTROL_POINTS: ReadonlyArray<Vec2> = [
  { x: -85, y: -80 }, // 0: South straight entry
  { x: 0, y: -80 },   // 1: Start/Finish straight center
  { x: 85, y: -80 },  // 2: South straight exit
  { x: 135, y: -52 }, // 3: South-East sweeping turn
  { x: 146, y: 5 },   // 4: East industrial tunnel straight
  { x: 128, y: 64 },  // 5: North-East corner
  { x: 72, y: 88 },   // 6: North S-curve entry
  { x: 18, y: 62 },   // 7: S-curve inflection right
  { x: -38, y: 88 },  // 8: S-curve inflection left
  { x: -98, y: 76 },  // 9: North-West sweeping corner
  { x: -136, y: 22 }, // 10: West back-straight
  { x: -128, y: -48 }, // 11: South-West corner onto main straight
];

function catmullRomPoint(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, t: number): Vec2 {
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    x:
      0.5 *
      (2 * p1.x +
        (-p0.x + p2.x) * t +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    y:
      0.5 *
      (2 * p1.y +
        (-p0.y + p2.y) * t +
        (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
        (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
  };
}

function buildRawSplinePoints(subdivisionsPerSegment: number): Vec2[] {
  const n = CONTROL_POINTS.length;
  const pts: Vec2[] = [];
  // Start at control point index 1 ((0, -80)) so s = 0 is right at the Start/Finish straight center
  for (let i = 0; i < n; i++) {
    const idx0 = (i + n) % n;
    const idx1 = (i + 1) % n;
    const idx2 = (i + 2) % n;
    const idx3 = (i + 3) % n;
    const p0 = CONTROL_POINTS[idx0];
    const p1 = CONTROL_POINTS[idx1];
    const p2 = CONTROL_POINTS[idx2];
    const p3 = CONTROL_POINTS[idx3];
    for (let step = 0; step < subdivisionsPerSegment; step++) {
      const t = step / subdivisionsPerSegment;
      pts.push(catmullRomPoint(p0, p1, p2, p3, t));
    }
  }
  return pts;
}

function buildUniformTrackSamples(
  sampleCount: number,
  roadHalfWidth: number,
  barrierHalfWidth: number,
): { samples: TrackSample[]; totalLength: number } {
  const raw = buildRawSplinePoints(40);
  const rawCount = raw.length;
  const cumLen = new Float64Array(rawCount + 1);
  for (let i = 0; i < rawCount; i++) {
    const a = raw[i];
    const b = raw[(i + 1) % rawCount];
    cumLen[i + 1] = cumLen[i] + Math.hypot(b.x - a.x, b.y - a.y);
  }
  const totalLength = cumLen[rawCount];

  const coords: Vec2[] = [];
  let rawIdx = 0;
  for (let i = 0; i < sampleCount; i++) {
    const targetS = (i / sampleCount) * totalLength;
    while (rawIdx < rawCount - 1 && cumLen[rawIdx + 1] < targetS) {
      rawIdx++;
    }
    const segStart = cumLen[rawIdx];
    const segLen = Math.max(1e-6, cumLen[rawIdx + 1] - segStart);
    const alpha = Math.max(0, Math.min(1, (targetS - segStart) / segLen));
    const a = raw[rawIdx];
    const b = raw[(rawIdx + 1) % rawCount];
    coords.push({
      x: a.x + (b.x - a.x) * alpha,
      y: a.y + (b.y - a.y) * alpha,
    });
  }

  const samples: TrackSample[] = [];
  for (let i = 0; i < sampleCount; i++) {
    const prev = coords[(i - 1 + sampleCount) % sampleCount];
    const curr = coords[i];
    const next = coords[(i + 1) % sampleCount];
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    const tx = dx / len;
    const ty = dy / len;
    // Left normal in (x, y) plane where +heading is CCW
    const nx = -ty;
    const ny = tx;
    const heading = Math.atan2(ty, tx);
    const s = (i / sampleCount) * totalLength;

    samples.push({
      s,
      x: curr.x,
      y: curr.y,
      tx,
      ty,
      nx,
      ny,
      heading,
      leftX: curr.x + nx * roadHalfWidth,
      leftY: curr.y + ny * roadHalfWidth,
      rightX: curr.x - nx * roadHalfWidth,
      rightY: curr.y - ny * roadHalfWidth,
      barrierLeftX: curr.x + nx * barrierHalfWidth,
      barrierLeftY: curr.y + ny * barrierHalfWidth,
      barrierRightX: curr.x - nx * barrierHalfWidth,
      barrierRightY: curr.y - ny * barrierHalfWidth,
    });
  }

  return { samples, totalLength };
}

export function sampleTrackAtS(
  samples: readonly TrackSample[],
  totalLength: number,
  sInput: number,
): TrackSample {
  const n = samples.length;
  const s = ((sInput % totalLength) + totalLength) % totalLength;
  const exactIdx = (s / totalLength) * n;
  const i0 = Math.floor(exactIdx) % n;
  const i1 = (i0 + 1) % n;
  const alpha = exactIdx - Math.floor(exactIdx);
  const a = samples[i0];
  const b = samples[i1];

  const x = a.x + (b.x - a.x) * alpha;
  const y = a.y + (b.y - a.y) * alpha;
  const rawTx = a.tx + (b.tx - a.tx) * alpha;
  const rawTy = a.ty + (b.ty - a.ty) * alpha;
  const tLen = Math.hypot(rawTx, rawTy) || 1;
  const tx = rawTx / tLen;
  const ty = rawTy / tLen;
  const nx = -ty;
  const ny = tx;
  const heading = Math.atan2(ty, tx);

  return {
    s,
    x,
    y,
    tx,
    ty,
    nx,
    ny,
    heading,
    leftX: a.leftX + (b.leftX - a.leftX) * alpha,
    leftY: a.leftY + (b.leftY - a.leftY) * alpha,
    rightX: a.rightX + (b.rightX - a.rightX) * alpha,
    rightY: a.rightY + (b.rightY - a.rightY) * alpha,
    barrierLeftX: a.barrierLeftX + (b.barrierLeftX - a.barrierLeftX) * alpha,
    barrierLeftY: a.barrierLeftY + (b.barrierLeftY - a.barrierLeftY) * alpha,
    barrierRightX: a.barrierRightX + (b.barrierRightX - a.barrierRightX) * alpha,
    barrierRightY: a.barrierRightY + (b.barrierRightY - a.barrierRightY) * alpha,
  };
}

function createGateAtS(
  samples: readonly TrackSample[],
  totalLength: number,
  index: number,
  s: number,
  halfWidth: number,
): TrackGate {
  const pt = sampleTrackAtS(samples, totalLength, s);
  return {
    index,
    s: pt.s,
    x: pt.x,
    y: pt.y,
    nx: pt.tx,
    ny: pt.ty,
    ax: pt.x + pt.nx * halfWidth,
    ay: pt.y + pt.ny * halfWidth,
    bx: pt.x - pt.nx * halfWidth,
    by: pt.y - pt.ny * halfWidth,
    halfWidth,
    respawn: {
      x: pt.x,
      y: pt.y,
      heading: pt.heading,
    },
  };
}

function buildBarrierSegments(samples: readonly TrackSample[]): BarrierSegment[] {
  const n = samples.length;
  const segments: BarrierSegment[] = [];
  const halfThickness = 0.45;

  for (let i = 0; i < n; i++) {
    const a = samples[i];
    const b = samples[(i + 1) % n];

    // Left (inner) barrier: normal points right (-nx, -ny) toward track center
    const ldx = b.barrierLeftX - a.barrierLeftX;
    const ldy = b.barrierLeftY - a.barrierLeftY;
    const lLen = Math.hypot(ldx, ldy) || 1;
    // Right-hand normal of forward segment (ldx, ldy) is (ldy / lLen, -ldx / lLen)
    segments.push({
      ax: a.barrierLeftX,
      ay: a.barrierLeftY,
      bx: b.barrierLeftX,
      by: b.barrierLeftY,
      nx: ldy / lLen,
      ny: -ldx / lLen,
      halfThickness,
    });

    // Right (outer) barrier: normal points left (-ldy / lLen, ldx / lLen) toward track center
    const rdx = b.barrierRightX - a.barrierRightX;
    const rdy = b.barrierRightY - a.barrierRightY;
    const rLen = Math.hypot(rdx, rdy) || 1;
    segments.push({
      ax: a.barrierRightX,
      ay: a.barrierRightY,
      bx: b.barrierRightX,
      by: b.barrierRightY,
      nx: -rdy / rLen,
      ny: rdx / rLen,
      halfThickness,
    });
  }

  return segments;
}

export function createNeonCircuitTrack(): TrackDefinition {
  const roadWidth = 14.0;
  const roadHalfWidth = roadWidth * 0.5; // 7.0m
  const barrierHalfWidth = 7.6; // 0.6m curb margin on each side before wall
  const corridorHalfWidth = 9.0; // Max corridor tolerance for checkpoint validation
  const sampleCount = 240;

  const { samples, totalLength } = buildUniformTrackSamples(
    sampleCount,
    roadHalfWidth,
    barrierHalfWidth,
  );

  const gateHalfWidth = barrierHalfWidth + 0.6; // Covers full width between physical walls
  const startFinishGate = createGateAtS(samples, totalLength, 0, 0, gateHalfWidth);

  // 10 ordered checkpoints evenly spaced around the circuit
  const checkpointCount = 10;
  const checkpoints: TrackGate[] = [];
  for (let i = 1; i <= checkpointCount; i++) {
    const s = (i / (checkpointCount + 1)) * totalLength;
    checkpoints.push(createGateAtS(samples, totalLength, i, s, gateHalfWidth));
  }

  // Spawn 6 meters behind the Start/Finish line on the main straight so initial launch crosses the arch cleanly
  const spawnSample = sampleTrackAtS(samples, totalLength, totalLength - 6.0);
  const startSpawn = {
    x: spawnSample.x,
    y: spawnSample.y,
    heading: spawnSample.heading,
  };

  // 4 Boost pickup pads around the circuit:
  // Pad 0 is 38m ahead of Start/Finish dead-center on the main straight (easy to collect on Lap 1)
  const boostFractions = [0.052, 0.285, 0.56, 0.81];
  const boostPads: BoostPadDefinition[] = boostFractions.map((frac, idx) => {
    const pt = sampleTrackAtS(samples, totalLength, frac * totalLength);
    return {
      id: idx,
      s: pt.s,
      x: pt.x,
      y: pt.y,
      heading: pt.heading,
      radius: 2.8,
    };
  });

  const barrierSegments = buildBarrierSegments(samples);

  // Industrial Neon Tunnel on the East section (around s = 22% to 33% of track)
  const tunnel: TunnelSection = {
    startS: totalLength * 0.22,
    endS: totalLength * 0.33,
    height: 7.5,
    width: barrierHalfWidth * 2 + 0.8,
  };

  return {
    id: 'neon_circuit',
    name: 'Neon Circuit',
    totalLength,
    roadWidth,
    roadHalfWidth,
    barrierHalfWidth,
    corridorHalfWidth,
    samples,
    startFinishGate,
    checkpoints,
    startSpawn,
    boostPads,
    barrierSegments,
    tunnel,
  };
}

export const NEON_CIRCUIT_TRACK: TrackDefinition = createNeonCircuitTrack();

export interface NearestTrackPointResult {
  sample: TrackSample;
  distance: number;
  signedLateralOffset: number;
}

/**
 * Finds the closest sample on the track centerline to (x, y) and refines by segment projection.
 */
export function findNearestTrackPoint(
  track: TrackDefinition,
  x: number,
  y: number,
): NearestTrackPointResult {
  const samples = track.samples;
  const n = samples.length;
  let bestIdx = 0;
  let bestDistSq = Infinity;

  for (let i = 0; i < n; i++) {
    const s = samples[i];
    const dx = x - s.x;
    const dy = y - s.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestDistSq) {
      bestDistSq = d2;
      bestIdx = i;
    }
  }

  const prevSample = samples[(bestIdx - 1 + n) % n];
  const currSample = samples[bestIdx];
  const nextSample = samples[(bestIdx + 1) % n];

  // Project onto [prevSample, currSample] and [currSample, nextSample] to get smooth arc-length s
  const candidates: Array<[TrackSample, TrackSample]> = [
    [prevSample, currSample],
    [currSample, nextSample],
  ];

  let bestS = currSample.s;
  let minDistance = Math.sqrt(bestDistSq);

  for (const [a, b] of candidates) {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const abLenSq = abx * abx + aby * aby;
    if (abLenSq > 1e-6) {
      const t = Math.max(0, Math.min(1, ((x - a.x) * abx + (y - a.y) * aby) / abLenSq));
      const px = a.x + abx * t;
      const py = a.y + aby * t;
      const d = Math.hypot(x - px, y - py);
      if (d <= minDistance) {
        minDistance = d;
        let ds = b.s - a.s;
        if (ds < 0) ds += track.totalLength;
        bestS = (a.s + ds * t) % track.totalLength;
      }
    }
  }

  const refined = sampleTrackAtS(samples, track.totalLength, bestS);
  const rx = x - refined.x;
  const ry = y - refined.y;
  const signedLateralOffset = rx * refined.nx + ry * refined.ny;
  const distance = Math.hypot(rx, ry);

  return {
    sample: refined,
    distance,
    signedLateralOffset,
  };
}
