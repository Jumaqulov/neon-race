// Shared plastic deformation field. +X=front; -Z=left; normal points inward.
// This is an energy-driven visual model, NOT a full soft-body/FEM solver.
import type { CrushHit, SurfaceType } from '../../shared/types.ts';
import { clamp, smooth } from '../physics/carPhysics.ts';

export interface CrushEventInput {
  energy: number;
  localNX: number;
  localNZ: number;
  localX: number;
  localZ: number;
  height?: number;
  surface?: SurfaceType;
}

export function impactWeight(x: number, y: number, z: number, hit: CrushHit): number {
  const dx = x - hit.x;
  const dz = z - hit.z;
  const inward = dx * hit.nx + dz * hit.nz;
  const tangent = -dx * hit.nz + dz * hit.nx;
  if (inward < -0.30 || inward >= hit.reach) return 0;
  const longitudinal = 1 - smooth(0, hit.reach, Math.max(0, inward));
  const transverse = 1 - smooth(hit.width * 0.24, hit.width, Math.abs(tangent));
  const vertical = 1 - smooth(hit.height * 0.42, hit.height, Math.abs(y - hit.y));
  return longitudinal * transverse * vertical;
}

export function impactDisplacement(
  x: number,
  y: number,
  z: number,
  hit: CrushHit,
  compliance = 1,
  out: [number, number, number] = [0, 0, 0],
): [number, number, number] {
  const w = impactWeight(x, y, z, hit) * compliance;
  if (w <= 0) {
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
    return out;
  }
  const inward = Math.max(0, (x - hit.x) * hit.nx + (z - hit.z) * hit.nz);
  const tangent = -(x - hit.x) * hit.nz + (z - hit.z) * hit.nx;
  const frontal = Math.abs(hit.nx) > 0.65;
  // The longitudinal envelope eases to zero at the stiff passenger cell.
  // Avoid a second stiffness ramp: multiplying two ramps can invert panels.
  const cellStiffness = frontal ? 1 : 0.80;
  const crush = hit.depth * w * cellStiffness;
  const upper = smooth(0.69, 1.00, y);
  const s = Math.min(1, inward / hit.reach);
  const ridge = Math.sin(Math.PI * s);
  // Broad upward hood folds, with smaller alternating metal creases. The
  // displacement is spatially coherent: trim/stripes share the same field.
  const accordion = ridge * (0.64 + 0.36 * Math.cos(s * Math.PI * 5.0 + tangent * 0.7));
  const crease = frontal ? 0.08 + 0.73 * accordion : 0.09 * Math.sin(inward * 12 + tangent * 2.1);
  const lift = crush * (upper * crease - (1 - upper) * 0.075);
  const splay = crush * (frontal ? 0.11 : 0.045) * Math.sin(tangent * 2.8) * (1 - s);
  out[0] = hit.nx * crush - hit.nz * splay;
  out[1] = lift;
  out[2] = hit.nz * crush + hit.nx * splay;
  return out;
}

export function makeCrushHit(event: CrushEventInput): CrushHit {
  const surface: SurfaceType = event.surface || 'concrete';
  const soft = surface === 'tyres';
  const energy = Math.max(0, event.energy - 1200) * (soft ? 0.30 : 1);
  const length = Math.hypot(event.localNX, event.localNZ) || 1;
  const nx = event.localNX / length;
  const nz = event.localNZ / length;
  const frontal = Math.abs(nx) > 0.65;
  return {
    x: clamp(event.localX, -2.50, 2.50),
    y: Number.isFinite(event.height) ? (event.height as number) : 0.67,
    z: clamp(event.localZ, -1.06, 1.06),
    nx,
    nz,
    width: surface === 'pole' ? 0.60 : frontal ? 1.55 : 1.52,
    height: frontal ? 0.97 : 0.82,
    reach: frontal ? 2.13 : 1.32,
    depth: clamp(Math.pow(energy / 160000, 0.60) * (frontal ? 0.98 : 0.58), 0, frontal ? 1.30 : 0.62),
    energy,
    surface,
  };
}
