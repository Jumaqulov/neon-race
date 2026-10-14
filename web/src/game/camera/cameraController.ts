import * as THREE from 'three';
import { clamp, type CarPhysics } from '../physics/carPhysics.ts';
import { SUN_DIR } from '../rendering/batching.ts';
import type { MuscleCarModel } from '../vehicle/muscleCar.ts';

export const wrapAngle = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

interface InspectDragState {
  id: number;
  x: number;
  y: number;
}

export class CameraController {
  public camYaw = 0;
  public camShake = 0;
  public orbitA = 0.6;
  public fovT = 60;
  public inspectA = -0.62;
  public inspectElevation = 0.27;
  public inspectDistance = 6.1;
  public inspectReturn = 0;

  private inspectDrag: InspectDragState | null = null;
  private readonly tmpV = new THREE.Vector3();
  private readonly tmpL = new THREE.Vector3();
  private readonly shadowRight = new THREE.Vector3(SUN_DIR.z, 0, -SUN_DIR.x).normalize();
  private readonly shadowUp = new THREE.Vector3().crossVectors(SUN_DIR, this.shadowRight).normalize();
  private readonly shadowCentre = new THREE.Vector3();

  private domElement: HTMLElement | null = null;
  private canInspect: () => boolean = () => false;

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (!this.canInspect() || !this.domElement) return;
    this.inspectDrag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    try {
      this.domElement.setPointerCapture(e.pointerId);
    } catch {
      // ignore if capture unavailable
    }
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (!this.inspectDrag || this.inspectDrag.id !== e.pointerId) return;
    this.inspectA -= (e.clientX - this.inspectDrag.x) * 0.007;
    this.inspectElevation = clamp(this.inspectElevation + (e.clientY - this.inspectDrag.y) * 0.004, 0.07, 1.1);
    this.inspectDrag.x = e.clientX;
    this.inspectDrag.y = e.clientY;
  };

  private readonly onPointerEnd = (): void => {
    this.inspectDrag = null;
  };

  private readonly onWheel = (e: WheelEvent): void => {
    if (!this.canInspect()) return;
    e.preventDefault();
    this.inspectDistance = clamp(this.inspectDistance + e.deltaY * 0.008, 3.6, 11);
  };

  attach(domElement: HTMLElement, canInspect: () => boolean): void {
    this.detach();
    this.domElement = domElement;
    this.canInspect = canInspect;
    domElement.addEventListener('pointerdown', this.onPointerDown);
    domElement.addEventListener('pointermove', this.onPointerMove);
    domElement.addEventListener('pointerup', this.onPointerEnd);
    domElement.addEventListener('pointercancel', this.onPointerEnd);
    domElement.addEventListener('lostpointercapture', this.onPointerEnd);
    domElement.addEventListener('wheel', this.onWheel, { passive: false });
  }

  detach(): void {
    if (!this.domElement) return;
    this.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.domElement.removeEventListener('pointermove', this.onPointerMove);
    this.domElement.removeEventListener('pointerup', this.onPointerEnd);
    this.domElement.removeEventListener('pointercancel', this.onPointerEnd);
    this.domElement.removeEventListener('lostpointercapture', this.onPointerEnd);
    this.domElement.removeEventListener('wheel', this.onWheel);
    this.domElement = null;
    this.inspectDrag = null;
  }

  update(
    dt: number,
    started: boolean,
    camMode: number,
    phys: CarPhysics,
    car: MuscleCarModel,
    camera: THREE.PerspectiveCamera,
    sky: THREE.Mesh,
    sun: THREE.DirectionalLight,
    canvasHeight: number,
    particleScaleUniforms: Array<{ value: number }>,
  ): void {
    const spd = phys.speed;
    const pos = car.group.position;
    const mode = started ? camMode : 3;

    if (mode <= 1) {
      const target = phys.heading + (phys.u > 2 ? Math.max(-0.9, Math.min(0.9, phys.beta)) * 0.55 : 0);
      this.camYaw += wrapAngle(target - this.camYaw) * (1 - Math.exp(-dt * 3.5));
      const far = mode === 1;
      const dist = (far ? 10.4 : 6.9) + spd * 0.017;
      const h = (far ? 4.0 : 2.5) + spd * 0.009;
      this.tmpV.set(pos.x - Math.cos(this.camYaw) * dist, h, pos.z + Math.sin(this.camYaw) * dist);
      camera.position.lerp(this.tmpV, 1 - Math.exp(-dt * 12));
      this.tmpL.set(pos.x + Math.cos(this.camYaw) * 2.5, 1.0, pos.z - Math.sin(this.camYaw) * 2.5);
      this.fovT = 58 + Math.min(24, spd * 0.32);
    } else if (mode === 2) {
      car.shell.localToWorld(this.tmpV.set(0.05, 1.6, 0));
      camera.position.copy(this.tmpV);
      car.shell.localToWorld(this.tmpL.set(20, 0.9, 0));
      this.fovT = 62 + Math.min(16, spd * 0.22);
      this.camYaw = phys.heading;
    } else if (mode === 4) {
      const a = this.inspectA - phys.heading;
      const horizontal = this.inspectDistance * Math.cos(this.inspectElevation);
      this.tmpV.set(
        pos.x + Math.cos(a) * horizontal,
        0.65 + Math.sin(this.inspectElevation) * this.inspectDistance,
        pos.z + Math.sin(a) * horizontal,
      );
      camera.position.lerp(this.tmpV, 1 - Math.exp(-dt * 10));
      this.tmpL.set(pos.x, 0.78, pos.z);
      this.fovT = 43;
      this.camYaw = phys.heading;
    } else {
      this.orbitA += dt * 0.22;
      this.tmpV.set(pos.x + Math.cos(this.orbitA) * 9.5, 2.6, pos.z + Math.sin(this.orbitA) * 9.5);
      camera.position.lerp(this.tmpV, 1 - Math.exp(-dt * 6));
      this.tmpL.set(pos.x, 0.8, pos.z);
      this.fovT = 48;
      this.camYaw = phys.heading;
    }

    const reducedMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (this.camShake > 0.001 && !reducedMotion) {
      camera.position.x += (Math.random() - 0.5) * this.camShake * 0.6;
      camera.position.y += (Math.random() - 0.5) * this.camShake * 0.4;
      this.camShake *= Math.exp(-dt * 10);
    }

    camera.lookAt(this.tmpL);
    camera.fov += (this.fovT - camera.fov) * (1 - Math.exp(-dt * 4));
    camera.updateProjectionMatrix();
    sky.position.copy(camera.position);

    const scale = canvasHeight / (2 * Math.tan((camera.fov * Math.PI) / 360));
    for (const u of particleScaleUniforms) {
      u.value = scale;
    }

    // Snap in the light's own XY plane, so the shadow texels do not swim as the
    // car/camera moves. This follows the actual deformed chassis silhouette.
    const texel = 36 / sun.shadow.mapSize.x;
    this.shadowCentre.copy(pos);
    const x = this.shadowCentre.dot(this.shadowRight);
    const y = this.shadowCentre.dot(this.shadowUp);
    this.shadowCentre
      .addScaledVector(this.shadowRight, Math.round(x / texel) * texel - x)
      .addScaledVector(this.shadowUp, Math.round(y / texel) * texel - y);
    sun.position.copy(SUN_DIR).multiplyScalar(90).add(this.shadowCentre);
    sun.target.position.copy(this.shadowCentre);
  }
}
