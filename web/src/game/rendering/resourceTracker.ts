import type * as THREE from 'three';

export interface DisposableResource {
  dispose: () => void;
}

export interface DisposableRenderTarget extends DisposableResource {
  texture?: THREE.Texture | THREE.Texture[];
}

export interface ResourceTrackerCounts {
  geometries: number;
  materials: number;
  textures: number;
  renderTargets: number;
}

const MATERIAL_TEXTURE_KEYS = [
  'map',
  'alphaMap',
  'aoMap',
  'bumpMap',
  'clearcoatMap',
  'clearcoatNormalMap',
  'clearcoatRoughnessMap',
  'displacementMap',
  'emissiveMap',
  'envMap',
  'gradientMap',
  'lightMap',
  'metalnessMap',
  'normalMap',
  'roughnessMap',
  'specularMap',
  'transmissionMap',
] as const;

export function isDisposable(value: unknown): value is DisposableResource {
  return Boolean(value && typeof value === 'object' && typeof (value as DisposableResource).dispose === 'function');
}

export function isTextureObject(value: unknown): value is THREE.Texture {
  return Boolean(value && typeof value === 'object' && (value as THREE.Texture).isTexture && isDisposable(value));
}

export function isRenderTargetObject(value: unknown): value is THREE.WebGLRenderTarget {
  return Boolean(
    value &&
      typeof value === 'object' &&
      ((value as THREE.WebGLRenderTarget).isWebGLRenderTarget ||
        ('texture' in (value as object) && isDisposable(value) && !isTextureObject(value))),
  );
}

export function isSpriteObject(obj: THREE.Object3D): obj is THREE.Sprite {
  return Boolean((obj as THREE.Sprite).isSprite || obj.type === 'Sprite');
}

/**
 * Tracks GPU-backed Three.js resources (BufferGeometry, Material, Texture, WebGLRenderTarget)
 * owned by a single GameEngine instance so they are disposed exactly once even if detached
 * from the scene during mesh batching, cone instancing, damage tessellation, or breakaway parts.
 */
export class ResourceTracker {
  private readonly geometries = new Set<DisposableResource>();
  private readonly materials = new Set<DisposableResource>();
  private readonly textures = new Set<DisposableResource>();
  private readonly renderTargets = new Set<DisposableRenderTarget>();
  private readonly externalResources = new WeakSet<object>();
  private readonly renderTargetTextures = new WeakSet<object>();

  /**
   * Marks a resource (or all resources on a shared Object3D/Material) as owned externally
   * so this tracker will never dispose it.
   */
  markExternal(resource: unknown): void {
    if (!resource || typeof resource !== 'object') return;
    this.externalResources.add(resource);
    this.geometries.delete(resource as DisposableResource);
    this.materials.delete(resource as DisposableResource);
    this.textures.delete(resource as DisposableResource);
    this.renderTargets.delete(resource as DisposableRenderTarget);
  }

  trackGeometry(geometry: unknown): void {
    if (!isDisposable(geometry) || this.externalResources.has(geometry)) return;
    this.geometries.add(geometry);
  }

  trackTexture(texture: unknown): void {
    if (!isTextureObject(texture)) return;
    if (this.externalResources.has(texture) || this.renderTargetTextures.has(texture)) return;
    this.textures.add(texture);
  }

  trackRenderTarget(target: unknown): void {
    if (!isRenderTargetObject(target) || this.externalResources.has(target)) return;
    this.renderTargets.add(target);
    const tex = target.texture;
    if (Array.isArray(tex)) {
      for (const item of tex) {
        if (item && typeof item === 'object') {
          this.renderTargetTextures.add(item);
          this.textures.delete(item);
        }
      }
    } else if (tex && typeof tex === 'object') {
      this.renderTargetTextures.add(tex);
      this.textures.delete(tex);
    }
  }

  trackMaterial(material: unknown): void {
    if (!material) return;
    if (Array.isArray(material)) {
      for (const item of material) this.trackMaterial(item);
      return;
    }
    if (!isDisposable(material) || this.externalResources.has(material)) return;
    this.materials.add(material);
    this.collectMaterialTextures(material as THREE.Material);
  }

  private collectMaterialTextures(material: THREE.Material): void {
    const rec = material as unknown as Record<string, unknown>;
    for (const key of MATERIAL_TEXTURE_KEYS) {
      const candidate = rec[key];
      if (isTextureObject(candidate)) {
        this.trackTexture(candidate);
      }
    }
    for (const value of Object.values(rec)) {
      if (isTextureObject(value)) {
        this.trackTexture(value);
      }
    }
    const uniforms = (material as THREE.ShaderMaterial).uniforms;
    if (uniforms && typeof uniforms === 'object') {
      for (const uniform of Object.values(uniforms)) {
        if (!uniform || typeof uniform !== 'object') continue;
        const val = (uniform as { value?: unknown }).value;
        if (isTextureObject(val)) {
          this.trackTexture(val);
        } else if (Array.isArray(val)) {
          for (const item of val) {
            if (isTextureObject(item)) this.trackTexture(item);
          }
        }
      }
    }
  }

  /**
   * Traverses an Object3D hierarchy and registers geometries, materials, textures,
   * shader uniform textures, and light shadow render targets.
   * Note: Three.js r128 THREE.Sprite shares a module-singleton BufferGeometry across all
   * Sprite instances; its geometry is automatically marked external and never disposed.
   */
  captureTree(root: THREE.Object3D | null | undefined): void {
    if (!root) return;
    const visit = (obj: THREE.Object3D): void => {
      if (isSpriteObject(obj)) {
        if (obj.geometry) {
          if (obj.userData?.ownsGeometry) {
            this.trackGeometry(obj.geometry);
          } else {
            this.markExternal(obj.geometry);
          }
        }
        this.trackMaterial(obj.material);
      } else {
        const withGeo = obj as THREE.Object3D & { geometry?: unknown; material?: unknown; isInstancedMesh?: boolean };
        if (withGeo.geometry) {
          this.trackGeometry(withGeo.geometry);
        }
        if (withGeo.material) {
          this.trackMaterial(withGeo.material);
        }
        if (withGeo.isInstancedMesh && isDisposable(obj)) {
          this.geometries.add(obj);
        }
      }

      const light = obj as THREE.Light & { shadow?: { map?: THREE.WebGLRenderTarget | null } };
      if (light.shadow?.map) {
        this.trackRenderTarget(light.shadow.map);
      }
    };

    if (typeof root.traverse === 'function') {
      root.traverse(visit);
    } else {
      visit(root);
    }
  }

  counts(): ResourceTrackerCounts {
    return {
      geometries: this.geometries.size,
      materials: this.materials.size,
      textures: this.textures.size,
      renderTargets: this.renderTargets.size,
    };
  }

  /**
   * Disposes all tracked resources once. Idempotent on repeated calls.
   * If any resource's dispose() throws, remaining resources still get disposed
   * before the error is rethrown.
   */
  dispose(): void {
    // Re-scan tracked materials in case texture maps or uniforms were assigned after creation.
    for (const mat of this.materials) {
      this.collectMaterialTextures(mat as THREE.Material);
    }

    const errors: unknown[] = [];
    const drain = <T extends DisposableResource>(set: Set<T>, skip?: (item: T) => boolean): void => {
      const items = Array.from(set);
      set.clear();
      for (const item of items) {
        if (this.externalResources.has(item)) continue;
        if (skip && skip(item)) continue;
        try {
          item.dispose();
        } catch (err) {
          errors.push(err);
        }
      }
    };

    drain(this.geometries);
    drain(this.materials);
    drain(this.textures, (tex) => this.renderTargetTextures.has(tex));
    drain(this.renderTargets);

    if (errors.length === 1) {
      throw errors[0];
    }
    if (errors.length > 1) {
      throw new AggregateError(errors, 'Multiple errors occurred while disposing tracked GPU resources');
    }
  }
}
