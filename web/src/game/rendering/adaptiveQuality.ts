import type * as THREE from 'three';
import type { QualityMode } from '../../shared/types.ts';

export interface QualityProfile {
  name: string;
  ratio: number;
  shadow: number;
  fx: number;
  shadowHz: number;
}

export const QUALITY_PROFILES: readonly QualityProfile[] = [
  { name: 'Yengil', ratio: 0.85, shadow: 512, fx: 0.40, shadowHz: 20 },
  { name: 'Muvozanat', ratio: 1.15, shadow: 1024, fx: 0.70, shadowHz: 30 },
  { name: 'Yuqori', ratio: 1.65, shadow: 2048, fx: 1, shadowHz: 60 },
];

export class AdaptiveQuality {
  public readonly renderer: THREE.WebGLRenderer;
  public readonly sun: THREE.DirectionalLight;
  public readonly skyMat: THREE.ShaderMaterial;
  public mode: QualityMode = 'auto';
  public level = 1;
  public scale = 1;
  public average = 16.7;
  public fps = 60;
  public slow = 0;
  public fast = 0;
  public elapsed = 0;
  public shadowT = 0;
  public lastFrame = 0;
  public frames = 0;
  public samples = 0;
  public savedDraws = 0;
  public profile: QualityProfile = QUALITY_PROFILES[1];
  private viewportWidth: number;
  private viewportHeight: number;

  constructor(
    renderer: THREE.WebGLRenderer,
    sun: THREE.DirectionalLight,
    skyMat: THREE.ShaderMaterial,
    width = window.innerWidth,
    height = window.innerHeight,
  ) {
    this.renderer = renderer;
    this.sun = sun;
    this.skyMat = skyMat;
    this.viewportWidth = width;
    this.viewportHeight = height;
    this.apply();
  }

  setViewportSize(width: number, height: number): void {
    this.viewportWidth = width;
    this.viewportHeight = height;
  }

  apply(): void {
    const p = QUALITY_PROFILES[this.level];
    this.profile = p;
    this.scale = Math.min(window.devicePixelRatio || 1, p.ratio);
    this.renderer.setPixelRatio(this.scale);
    this.renderer.setSize(this.viewportWidth, this.viewportHeight);
    const shadow = this.sun.shadow;
    if (shadow.mapSize.x !== p.shadow) {
      shadow.mapSize.set(p.shadow, p.shadow);
      if (shadow.map) {
        (shadow.map as THREE.WebGLRenderTarget).dispose();
        // Reset shadow map so Three.js recreates it at the new resolution
        (shadow as unknown as { map: THREE.WebGLRenderTarget | null }).map = null;
      }
    }
    this.skyMat.uniforms.cloudDetail.value = this.level === 0 ? 0 : 1;
    this.renderer.shadowMap.needsUpdate = true;
    this.slow = 0;
    this.fast = 0;
    this.elapsed = 0;
  }

  cycle(): string {
    const modes: QualityMode[] = ['auto', 'high', 'medium', 'low'];
    this.mode = modes[(modes.indexOf(this.mode) + 1) % modes.length];
    this.level = this.mode === 'high' ? 2 : this.mode === 'low' ? 0 : 1;
    this.apply();
    return this.label;
  }

  update(realDt: number, busy: boolean): void {
    if (realDt <= 0 || realDt > 0.3) return;
    this.elapsed += realDt;
    this.average += (realDt * 1000 - this.average) * 0.035;
    this.fps = Math.min(240, 1000 / this.average);
    this.frames++;
    if (this.mode !== 'auto' || this.elapsed < 3 || !busy) return;
    this.slow = this.fps < 43 ? this.slow + realDt : Math.max(0, this.slow - realDt * 1.8);
    this.fast = this.fps > 57 ? this.fast + realDt : 0;
    if (this.slow > 2.5 && this.level > 0) {
      this.level--;
      this.apply();
    } else if (this.fast > 7 && this.level < 2) {
      this.level++;
      this.apply();
    }
  }

  shadow(dt: number, moving: boolean): void {
    this.shadowT += dt;
    if (moving && this.shadowT > 1 / this.profile.shadowHz) {
      this.renderer.shadowMap.needsUpdate = true;
      this.shadowT = 0;
    }
  }

  get label(): string {
    return (this.mode === 'auto' ? 'Auto · ' : '') + QUALITY_PROFILES[this.level].name;
  }
}
