import { ARENA, type SurfaceType } from '../../shared/types.ts';
import type { CarPhysics } from './carPhysics.ts';

export interface CircleCollider {
  x: number;
  y: number;
  r: number;
  surface?: SurfaceType;
}

export class ColliderGrid {
  public readonly size: number;
  public readonly cells: Map<string, CircleCollider[]>;
  public readonly output: CircleCollider[];

  constructor(circles: CircleCollider[], size = 12) {
    this.size = size;
    this.cells = new Map();
    this.output = [];
    for (const c of circles) {
      const key = Math.floor(c.x / size) + ',' + Math.floor(c.y / size);
      let list = this.cells.get(key);
      if (!list) {
        list = [];
        this.cells.set(key, list);
      }
      list.push(c);
    }
  }

  query(x: number, y: number): CircleCollider[] {
    const gx = Math.floor(x / this.size);
    const gy = Math.floor(y / this.size);
    const out = this.output;
    out.length = 0;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const list = this.cells.get(gx + dx + ',' + (gy + dy));
        if (list) {
          for (const c of list) out.push(c);
        }
      }
    }
    return out;
  }
}

export function collideCircle(phys: CarPhysics, c: CircleCollider): number {
  const dx = c.x - phys.x;
  const dy = c.y - phys.y;
  if (dx * dx + dy * dy > (c.r + 2.75) ** 2) return 0;
  const ch = Math.cos(phys.heading);
  const sh = Math.sin(phys.heading);
  const B = phys.bounds;
  const lx = dx * ch + dy * sh;
  const ly = -dx * sh + dy * ch;
  const qx = Math.max(-B.rear, Math.min(B.front, lx));
  const qy = Math.max(-B.right, Math.min(B.left, ly));
  const ex = lx - qx;
  const ey = ly - qy;
  const d = Math.hypot(ex, ey);
  if (d > c.r) return 0;
  let nlx: number;
  let nly: number;
  let depth: number;
  if (d > 1e-6) {
    nlx = -ex / d;
    nly = -ey / d;
    depth = c.r - d;
  } else if ((lx >= 0 ? B.front - lx : B.rear + lx) < (ly >= 0 ? B.left - ly : B.right + ly)) {
    nlx = -(Math.sign(lx) || 1);
    nly = 0;
    depth = (lx >= 0 ? B.front - lx : B.rear + lx) + c.r;
  } else {
    nlx = 0;
    nly = -(Math.sign(ly) || 1);
    depth = (ly >= 0 ? B.left - ly : B.right + ly) + c.r;
  }
  return phys.contact(
    phys.x + qx * ch - qy * sh,
    phys.y + qx * sh + qy * ch,
    nlx * ch - nly * sh,
    nlx * sh + nly * ch,
    depth,
    c.surface === 'tyres' ? 0.28 : 0.10,
    0.35,
    c.surface || 'pole',
  );
}

export function collide(phys: CarPhysics, colliderGrid: ColliderGrid, arena = ARENA): number {
  let j = 0;
  // A face-on wall hit uses a contact manifold centroid, not whichever
  // corner happens to be visited first. Oblique hits retain their yaw moment.
  const wallAxes: Array<[0 | 1, 1 | -1]> = [
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
  ];
  for (const [axis, sign] of wallAxes) {
    const touching = phys.corners().filter((p) => p[axis] * sign > arena);
    if (!touching.length) continue;
    let px = 0;
    let py = 0;
    let depth = 0;
    for (const p of touching) {
      px += p[0];
      py += p[1];
      depth = Math.max(depth, p[axis] * sign - arena);
    }
    px /= touching.length;
    py /= touching.length;
    const nx = axis === 0 ? -sign : 0;
    const ny = axis === 1 ? -sign : 0;
    j = Math.max(j, phys.contact(px, py, nx, ny, depth, 0.10, 0.30, 'concrete'));
  }
  for (const c of colliderGrid.query(phys.x, phys.y)) {
    j = Math.max(j, collideCircle(phys, c));
  }
  return j;
}
