import * as THREE from 'three';
import {
  ARENA,
  CAMS,
  PAINTS,
  START_POSE,
  type GameCommand,
  type GameInput,
  type GameMode,
  type GameSettings,
  type GameSnapshot,
} from '../shared/types.ts';
import { loadInitialSettings, store, type StorageAdapter } from '../storage/settingsStore.ts';
import { SoundEngine } from './audio/soundEngine.ts';
import { CameraController, wrapAngle } from './camera/cameraController.ts';
import { BreakawayParts, CrashParticles, LensDebris, MetalDebris } from './damage/debris.ts';
import { VehicleDamage, type DamageSnapshot } from './damage/vehicleDamage.ts';
import { ExhaustSmoke, SkidMarks, Smoke, type ExhaustSnapshot } from './effects/particles.ts';
import { InputController } from './input/inputController.ts';
import { CarPhysics, clamp, lerp } from './physics/carPhysics.ts';
import { ColliderGrid, collide } from './physics/collisions.ts';
import { RaceSession, type RaceSessionSnapshot } from './race/raceSession.ts';
import { NEON_CIRCUIT_TRACK } from './race/trackDefinition.ts';
import { AdaptiveQuality } from './rendering/adaptiveQuality.ts';
import { applySkyTheme, isMeshObject, lin, makeSkyMaterial, mergeRigidMeshes, THEMES } from './rendering/batching.ts';
import { GaugeRenderer } from './rendering/gauges.ts';
import { isSpriteObject, ResourceTracker } from './rendering/resourceTracker.ts';
import { createMuscleCar, optimizeCarMeshes, type MuscleCarModel } from './vehicle/muscleCar.ts';
import { buildNeonCircuitWorld, type NeonCircuitWorld } from './world/neonCircuit.ts';
import { buildWorld, instanceCones, resetCone, syncConeInstances, updateCones, type WorldSceneData } from './world/provingGround.ts';

export interface CarLabDiagnosticAPI {
  version: string;
  mode: () => GameMode;
  snapshot: () => DamageSnapshot | null;
  race: () => RaceSessionSnapshot | null;
  track: () => {
    id: string;
    totalLength: number;
    roadWidth: number;
    checkpoints: number;
    boostPads: number;
    samples: Array<{ s: number; x: number; y: number; heading: number }>;
  };
  physics: () => {
    x: number;
    y: number;
    speed: number;
    gear: number;
    rpm: number;
    thr: number;
    brk: number;
    hb: boolean;
    heading: number;
    yawRate: number;
    engineHealth: number;
    steeringHealth: number;
    finite: boolean;
    suspension: { heave: number; heaveV: number; roll: number; rollV: number; pitch: number; pitchV: number };
    wheels: Array<{ front: boolean; left: boolean; load: number; steer: number; slip: number }>;
    baseHz: number;
    microsteps: number;
  };
  exhaust: () => ExhaustSnapshot | null;
  shadows: () => { enabled: boolean; mapSize: number; kind: string };
  debris: () => { glass: number; metal: number; bodyParts: number; capacity: number };
  quality: () => {
    mode: string;
    level: number;
    label: string;
    pixelRatio: number;
    fps: number;
    savedDrawObjects: number;
  };
  stepWithInput: (input: GameInput, dt?: number) => void;
  activateBoost: () => void;
  readonly rendererInfo: { calls: number; triangles: number; geometries: number; textures: number };
}

declare global {
  interface Window {
    carLab?: CarLabDiagnosticAPI;
    neonLocal?: Readonly<{
      version: string;
      mode: string;
      multiplayer: boolean;
      threeRevision: string;
    }>;
  }
}

export interface GameEngineOptions {
  headless?: boolean;
  storage?: StorageAdapter | null;
  initialMode?: GameMode;
}

const STEP = 1 / 120;
const fmt = (n: number): string => Math.round(n).toLocaleString('en-US');

function detectTouchDevice(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  if (window.innerWidth > 0 && (window.innerWidth <= 640 || window.innerHeight <= 450)) {
    return true;
  }
  return (
    window.matchMedia('(pointer: coarse)').matches ||
    (typeof navigator !== 'undefined' &&
      navigator.maxTouchPoints > 0 &&
      !window.matchMedia('(pointer: fine)').matches)
  );
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export class GameEngine {
  public readonly phys: CarPhysics;
  public readonly settings: GameSettings;
  public readonly input: InputController;
  public readonly audio: SoundEngine;
  public readonly cameraCtrl: CameraController;
  public readonly gauges: GaugeRenderer;
  public readonly resources: ResourceTracker;
  public readonly raceSession: RaceSession;

  private readonly headless: boolean;
  private readonly storage: StorageAdapter | null | undefined;
  private readonly listeners = new Set<() => void>();

  private mode: GameMode = 'proving_ground';
  private container: HTMLElement | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private provingGroundGroup: THREE.Group | null = null;
  private neonCircuitWorld: NeonCircuitWorld | null = null;
  private neonColliderGrid: ColliderGrid;
  private boostTrailGroup: THREE.Group | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private hemi: THREE.HemisphereLight | null = null;
  private sun: THREE.DirectionalLight | null = null;
  private fillLight: THREE.DirectionalLight | null = null;
  private skyMat: THREE.ShaderMaterial | null = null;
  private sky: THREE.Mesh | null = null;
  private envTargets: Record<'day' | 'night', THREE.WebGLRenderTarget> | null = null;
  private envs: Record<'day' | 'night', THREE.Texture> | null = null;
  private world: WorldSceneData | null = null;
  private colliderGrid: ColliderGrid;
  private quality: AdaptiveQuality | null = null;
  private skids: SkidMarks | null = null;
  private smoke: Smoke | null = null;
  private engineVapor: Smoke | null = null;
  private exhaust: ExhaustSmoke | null = null;
  private car: MuscleCarModel | null = null;
  private parts: BreakawayParts | null = null;
  private metalShards: MetalDebris | null = null;
  private damage: VehicleDamage | null = null;
  private crashParticles: CrashParticles | null = null;
  private glassShards: LensDebris | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private carLabToken: CarLabDiagnosticAPI | null = null;
  private lastDisposedMemoryInfo: { geometries: number; textures: number } | null = null;

  private ready = false;
  private started = false;
  private paused = false;
  private slowMotion = false;
  private helpOpen = false;
  private touchMode = false;
  private contextLost = false;
  private disposed = false;
  private error: string | null = null;
  private loadingStatus = 'Mashina va maydon tayyorlanmoqda';
  private toastMessage: string | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  private rafId: number | null = null;
  private lastTime = 0;
  private acc = 0;
  private renderAlpha = 1;
  private thudCool = 0;
  private simulationSteps = 0;
  private vaporAccumulator = 0;
  private hudT = 0;
  private clusterT = 0;
  private impactFlashT = 0;
  private activeBoostAccel = 0;
  private activeBoostMaxSpeed = 60.0;
  private boostFovOffset = 0;

  private readonly previousPose = {
    x: START_POSE[0],
    y: START_POSE[1],
    heading: START_POSE[2],
    wheels: [0, 0, 0, 0],
  };

  private readonly stats = { cones: 0 };
  private readonly drift = {
    cur: 0,
    mult: 1,
    time: 0,
    grace: 0,
    total: 0,
    best: 0,
    flash: 0,
    shown: 0,
    state: '' as '' | 'banked' | 'crashed',
  };

  private readonly tmpV = new THREE.Vector3();
  private readonly wpos = new THREE.Vector3();
  private cachedSnapshot: GameSnapshot;

  private readonly handleWindowResize = (): void => {
    if (this.disposed) return;
    if (!this.container) {
      this.resize(window.innerWidth, window.innerHeight);
    } else {
      const rect = this.container.getBoundingClientRect();
      this.resize(rect.width || window.innerWidth, rect.height || window.innerHeight);
    }
  };

  private readonly handleVisibilityChange = (): void => {
    if (this.disposed) return;
    if (typeof document !== 'undefined' && document.hidden) {
      this.input.clearAll();
      this.acc = 0;
      if (this.started) {
        this.paused = true;
        if (this.mode === 'neon_circuit') {
          this.raceSession.pause();
        }
      }
      this.audio.suspend();
    }
    this.lastTime = typeof performance !== 'undefined' ? performance.now() : 0;
    this.emitSnapshot();
  };

  private readonly handleContextLost = (e: Event): void => {
    if (this.disposed) return;
    e.preventDefault();
    this.contextLost = true;
    this.paused = true;
    if (this.mode === 'neon_circuit') {
      this.raceSession.pause();
    }
    this.toast('Grafik kontekst uzildi. Tiklanish kutilmoqda.');
  };

  private readonly handleContextRestored = (): void => {
    if (this.disposed) return;
    this.contextLost = false;
    if (this.renderer) this.renderer.shadowMap.needsUpdate = true;
    this.lastTime = typeof performance !== 'undefined' ? performance.now() : 0;
    this.toast('Grafika tiklandi · davom etish uchun Esc');
  };

  private readonly handleCanvasPointerDown = (): void => {
    this.focusCanvas();
  };

  constructor(options: GameEngineOptions = {}) {
    this.headless = Boolean(options.headless);
    this.storage = options.storage;
    this.mode = options.initialMode ?? 'proving_ground';
    this.settings = loadInitialSettings(this.storage);
    this.drift.best = Number(store.get('best', 0, this.storage)) || 0;
    this.touchMode = detectTouchDevice();
    this.phys = new CarPhysics({ tcs: this.settings.tcs });
    this.phys.reset(...START_POSE);
    this.colliderGrid = new ColliderGrid([]);
    this.neonColliderGrid = new ColliderGrid([]);
    this.raceSession = new RaceSession(NEON_CIRCUIT_TRACK);
    this.audio = new SoundEngine();
    this.cameraCtrl = new CameraController();
    this.gauges = new GaugeRenderer();
    this.resources = new ResourceTracker();
    this.input = new InputController({
      isStarted: () => this.started,
      onStart: () => this.start(),
      onToggleKey: (code) => this.toggleKey(code),
      onInputReset: () => this.emitSnapshot(),
    });
    if (this.mode === 'neon_circuit') {
      this.raceSession.resetToReady();
      const sp = NEON_CIRCUIT_TRACK.startSpawn;
      this.phys.reset(sp.x, sp.y, sp.heading);
      this.resetRenderPose();
    }
    this.cachedSnapshot = this.buildSnapshot();
  }

  isDisposed(): boolean {
    return this.disposed;
  }

  isLoopActive(): boolean {
    return !this.disposed && this.rafId !== null;
  }

  getMemoryInfo(): { geometries: number; textures: number } {
    if (this.renderer) {
      return {
        geometries: this.renderer.info.memory.geometries,
        textures: this.renderer.info.memory.textures,
      };
    }
    return this.lastDisposedMemoryInfo ?? { geometries: 0, textures: 0 };
  }

  focusCanvas(): void {
    if (this.disposed) return;
    const target = this.renderer?.domElement ?? this.container;
    if (target && typeof target.focus === 'function') {
      try {
        target.focus({ preventScroll: true });
      } catch {
        target.focus();
      }
    }
  }

  init(container: HTMLElement | null): void {
    if (this.disposed) return;
    this.container = container;
    this.touchMode = detectTouchDevice();

    if (this.headless) {
      if (container && container.tabIndex < 0) {
        container.tabIndex = 0;
      }
      this.registerGlobalDiagnostics();
      this.ready = true;
      this.loadingStatus = 'WASD: haydash · V: sinov · G: grafika · Y: 0.25× · Esc: pauza';
      this.input.attach();
      this.emitSnapshot();
      return;
    }

    if (!container) {
      this.fail('O‘yin konteyneri topilmadi.');
      return;
    }

    if (typeof window !== 'undefined' && window.location?.protocol === 'file:') {
      this.fail('HTML’ni ikki marta bosib ochmang. npm start orqali ishga tushiring va terminaldagi manzilni oching.');
      return;
    }

    if (String(THREE.REVISION) !== '128') {
      this.fail('Ushbu V3 uchun Three.js r128 kerak.');
      return;
    }

    try {
      const width = container.clientWidth || window.innerWidth || 1280;
      const height = container.clientHeight || window.innerHeight || 720;

      const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.15));
      renderer.setSize(width, height);
      renderer.shadowMap.enabled = this.settings.shadows;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.shadowMap.autoUpdate = false;
      renderer.shadowMap.needsUpdate = true;
      renderer.outputEncoding = THREE.sRGBEncoding;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.domElement.id = 'gl';
      renderer.domElement.tabIndex = 0;
      renderer.domElement.setAttribute('aria-label', 'Game canvas');

      // Ensure no duplicate #gl canvas inside container
      while (container.firstChild) {
        container.removeChild(container.firstChild);
      }
      container.appendChild(renderer.domElement);
      this.renderer = renderer;

      const scene = new THREE.Scene();
      scene.fog = new THREE.Fog(0xbfd2e2, 200, 1600);
      this.scene = scene;

      const camera = new THREE.PerspectiveCamera(60, width / Math.max(1, height), 0.1, 2600);
      camera.position.set(START_POSE[0] + 9, 3, -START_POSE[1] + 6);
      this.camera = camera;

      const hemi = new THREE.HemisphereLight(lin(0xdfefff), lin(0x4a4436), 0.3);
      const sun = new THREE.DirectionalLight(0xfff1dc, 1.7);
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      Object.assign(sun.shadow.camera, { left: -18, right: 18, top: 18, bottom: -18, near: 50, far: 140 });
      sun.shadow.bias = -0.000035;
      sun.shadow.normalBias = 0.006;
      sun.shadow.camera.updateProjectionMatrix();
      const fillLight = new THREE.DirectionalLight(lin(0xbad5e9), 0.20);
      fillLight.position.set(-30, 16, -15);
      scene.add(fillLight, hemi, sun, sun.target);
      this.hemi = hemi;
      this.sun = sun;
      this.fillLight = fillLight;

      const skyMat = makeSkyMaterial();
      const sky = new THREE.Mesh(new THREE.SphereGeometry(2000, 32, 16), skyMat);
      sky.frustumCulled = false;
      sky.renderOrder = -1;
      scene.add(sky);
      this.skyMat = skyMat;
      this.sky = sky;
      this.resources.captureTree(sky);

      const pmrem = new THREE.PMREMGenerator(renderer);
      const envTargets = {} as Record<'day' | 'night', THREE.WebGLRenderTarget>;
      const envs = {} as Record<'day' | 'night', THREE.Texture>;
      try {
        for (const name of ['day', 'night'] as const) {
          const s = new THREE.Scene();
          const m = makeSkyMaterial();
          const cloudMat = new THREE.MeshBasicMaterial({
            color: lin(name === 'day' ? 0xc8d9e3 : 0x172637),
            side: THREE.DoubleSide,
          });
          try {
            applySkyTheme(m, THEMES[name]);
            m.uniforms.glow.value = (m.uniforms.glow.value as number) * 0.35;
            for (const k of ['top', 'horizon', 'bottom'] as const) {
              (m.uniforms[k].value as THREE.Color).multiplyScalar(0.8);
            }
            s.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), m));
            for (let j = 0; j < 3; j++) {
              const card = new THREE.Mesh(new THREE.PlaneGeometry(8, 1.0 + j * 0.3), cloudMat);
              card.position.set(-3 + j * 3, 4.0 + j * 0.6, 3 - j * 4);
              card.lookAt(0, 0, 0);
              s.add(card);
            }
            // Prevent Three.js r128 PMREMGenerator from rendering its internal module-global
            // backgroundBox geometry when the full-sphere sky dome already encloses the scene.
            s.background = {} as unknown as THREE.Texture;
            const rt = pmrem.fromScene(s, 0.06);
            s.background = null;
            envTargets[name] = rt;
            envs[name] = rt.texture;
            this.resources.trackRenderTarget(rt);
          } finally {
            s.traverse((o) => {
              if (isMeshObject(o) && o.geometry) o.geometry.dispose();
            });
            m.dispose();
            cloudMat.dispose();
          }
        }
      } finally {
        pmrem.dispose();
      }
      this.envTargets = envTargets;
      this.envs = envs;

      const provingGroundGroup = new THREE.Group();
      provingGroundGroup.name = 'ProvingGroundWorld';
      scene.add(provingGroundGroup);
      this.provingGroundGroup = provingGroundGroup;

      const world = buildWorld(provingGroundGroup, renderer);
      this.resources.captureTree(provingGroundGroup);
      instanceCones(provingGroundGroup, world);
      const worldSavedDraws = mergeRigidMeshes(provingGroundGroup);
      this.resources.captureTree(provingGroundGroup);
      for (const cone of world.cones) {
        this.resources.captureTree(cone.obj);
      }
      this.world = world;
      this.colliderGrid = new ColliderGrid(world.colliders.circles);

      const neonWorld = buildNeonCircuitWorld(
        NEON_CIRCUIT_TRACK,
        renderer.capabilities.getMaxAnisotropy(),
      );
      neonWorld.group.visible = this.mode === 'neon_circuit';
      provingGroundGroup.visible = this.mode === 'proving_ground';
      scene.add(neonWorld.group);
      this.resources.captureTree(neonWorld.group);
      this.neonCircuitWorld = neonWorld;
      this.neonColliderGrid = new ColliderGrid(neonWorld.colliders);

      const quality = new AdaptiveQuality(renderer, sun, skyMat, width, height);
      this.quality = quality;

      this.skids = new SkidMarks(scene);
      this.smoke = new Smoke(scene, 480);
      this.engineVapor = new Smoke(scene, 90);
      (this.engineVapor.mat.uniforms.color.value as THREE.Color).setHex(0xc9cfd1);
      this.exhaust = new ExhaustSmoke(scene);

      const car = createMuscleCar(this.settings.paint);
      const carSpriteGeometry = new THREE.Sprite().geometry.clone();
      car.group.traverse((obj) => {
        if (isSpriteObject(obj)) {
          obj.geometry = carSpriteGeometry;
          obj.userData.ownsGeometry = true;
        }
      });

      // Attach neon boost exhaust & light trail meshes to the rear of the car
      const boostTrailGroup = new THREE.Group();
      boostTrailGroup.visible = false;
      const flameGeo = new THREE.ConeGeometry(0.11, 0.95, 10);
      flameGeo.rotateX(-Math.PI / 2);
      const flameMat = new THREE.MeshBasicMaterial({
        color: 0x00ffd5,
        transparent: true,
        opacity: 0.85,
      });
      const leftFlame = new THREE.Mesh(flameGeo, flameMat);
      leftFlame.position.set(-2.7, 0.32, -0.46);
      const rightFlame = new THREE.Mesh(flameGeo, flameMat);
      rightFlame.position.set(-2.7, 0.32, 0.46);
      boostTrailGroup.add(leftFlame, rightFlame);
      car.group.add(boostTrailGroup);
      this.boostTrailGroup = boostTrailGroup;

      this.resources.captureTree(car.group);
      scene.add(car.group);
      quality.savedDraws = worldSavedDraws + optimizeCarMeshes(car) + (world.cones.length * 3 - 3);
      this.car = car;

      this.parts = new BreakawayParts(scene, car);
      this.metalShards = new MetalDebris(scene);
      this.damage = new VehicleDamage(car);
      this.crashParticles = new CrashParticles(scene);
      this.glassShards = new LensDebris(scene);
      this.resources.captureTree(scene);

      this.phys.onImpact = (event) => this.damage?.enqueue(event);
      if (this.mode === 'neon_circuit') {
        const sp = NEON_CIRCUIT_TRACK.startSpawn;
        this.phys.reset(sp.x, sp.y, sp.heading);
        this.applyTheme(true);
      } else {
        this.phys.reset(...START_POSE);
        this.applyTheme(false);
      }
      this.resetRenderPose();

      this.input.attach();
      this.cameraCtrl.attach(
        renderer.domElement,
        () => this.started && this.mode === 'proving_ground' && this.settings.cam === 4,
      );

      renderer.domElement.addEventListener('pointerdown', this.handleCanvasPointerDown);
      renderer.domElement.addEventListener('webglcontextlost', this.handleContextLost);
      renderer.domElement.addEventListener('webglcontextrestored', this.handleContextRestored);
      window.addEventListener('resize', this.handleWindowResize);
      document.addEventListener('visibilitychange', this.handleVisibilityChange);

      if (typeof ResizeObserver !== 'undefined') {
        this.resizeObserver = new ResizeObserver((entries) => {
          const entry = entries[0];
          if (entry && entry.contentRect.width > 0 && entry.contentRect.height > 0) {
            this.resize(entry.contentRect.width, entry.contentRect.height);
          }
        });
        this.resizeObserver.observe(container);
      }

      this.registerGlobalDiagnostics();
      this.ready = true;
      this.loadingStatus = 'WASD: haydash · E: boost · R: qaytarish · Esc: pauza';
      this.emitSnapshot();

      this.lastTime = performance.now();
      this.rafId = requestAnimationFrame(this.frame);
    } catch (err) {
      try {
        this.cleanupInternal();
      } catch {
        // preserve original initialization error
      }
      const msg = err instanceof Error ? err.message : String(err);
      this.fail('WebGL sahnasini yaratishda xato: ' + msg);
    }
  }

  private fail(message: string): void {
    this.error = message;
    this.loadingStatus = message;
    this.emitSnapshot();
  }

  private registerGlobalDiagnostics(): void {
    if (typeof window === 'undefined') return;
    const getRenderer = (): THREE.WebGLRenderer | null => this.renderer;
    const api: CarLabDiagnosticAPI = Object.freeze({
      version: 'physics-graphics-3.1',
      mode: () => this.mode,
      snapshot: () => (this.damage ? this.damage.snapshot() : null),
      race: () => (this.mode === 'neon_circuit' ? this.raceSession.getSnapshot() : null),
      track: () => ({
        id: NEON_CIRCUIT_TRACK.id,
        totalLength: NEON_CIRCUIT_TRACK.totalLength,
        roadWidth: NEON_CIRCUIT_TRACK.roadWidth,
        checkpoints: NEON_CIRCUIT_TRACK.checkpoints.length,
        boostPads: NEON_CIRCUIT_TRACK.boostPads.length,
        samples: NEON_CIRCUIT_TRACK.samples.map((s) => ({
          s: s.s,
          x: s.x,
          y: s.y,
          heading: s.heading,
        })),
      }),
      physics: () => ({
        x: this.phys.x,
        y: this.phys.y,
        speed: this.phys.speed * 3.6,
        gear: this.phys.gear,
        rpm: this.phys.rpm,
        thr: this.phys.thr,
        brk: this.phys.brk,
        hb: this.phys.hb,
        heading: this.phys.heading,
        yawRate: this.phys.r,
        engineHealth: this.phys.engineHealth,
        steeringHealth: this.phys.steeringHealth,
        finite: [this.phys.x, this.phys.y, this.phys.u, this.phys.v, this.phys.r].every(Number.isFinite),
        suspension: { ...this.phys.suspension },
        wheels: this.phys.wheels.map((w) => ({
          front: w.front,
          left: w.left,
          load: w.load,
          steer: w.steer,
          slip: w.slip,
        })),
        baseHz: 120,
        microsteps: this.simulationSteps,
      }),
      exhaust: () => (this.exhaust ? this.exhaust.snapshot() : null),
      shadows: () => ({
        enabled: Boolean(this.renderer?.shadowMap.enabled),
        mapSize: this.sun ? this.sun.shadow.mapSize.x : 0,
        kind: 'cached-geometry-PCF',
      }),
      debris: () => ({
        glass: this.glassShards ? this.glassShards.active : 0,
        metal: this.metalShards ? this.metalShards.active : 0,
        bodyParts: this.parts ? this.parts.active : 0,
        capacity:
          (this.glassShards ? this.glassShards.max : 0) +
          (this.metalShards ? this.metalShards.max : 0) +
          (this.parts ? this.parts.parts.length : 0),
      }),
      quality: () => ({
        mode: this.quality ? this.quality.mode : 'auto',
        level: this.quality ? this.quality.level : 1,
        label: this.quality ? this.quality.label : 'Auto · Muvozanat',
        pixelRatio: this.quality ? this.quality.scale : 1,
        fps: this.quality ? this.quality.fps : 60,
        savedDrawObjects: this.quality ? this.quality.savedDraws : 0,
      }),
      stepWithInput: (input: GameInput, dt = STEP) => {
        this.rememberPose();
        this.advanceSimulation(input, dt);
        this.renderAlpha = 1;
        this.syncCar();
        if (this.neonCircuitWorld && this.mode === 'neon_circuit') {
          const raceSnap = this.raceSession.getSnapshot();
          this.neonCircuitWorld.update({
            time: this.damage ? this.damage.time : this.phys.time,
            nextCheckpointIndex: raceSnap.checkpoint.nextCheckpointIndex,
            availablePadIds: raceSnap.boost.availablePadIds,
            countdownNumber: raceSnap.countdownNumber,
          });
        }
        this.emitSnapshot();
      },
      activateBoost: () => {
        this.activateBoost();
      },
      get rendererInfo() {
        const r = getRenderer();
        return {
          calls: r ? r.info.render.calls : 0,
          triangles: r ? r.info.render.triangles : 0,
          geometries: r ? r.info.memory.geometries : 0,
          textures: r ? r.info.memory.textures : 0,
        };
      },
    });
    this.carLabToken = api;
    window.carLab = api;
    window.neonLocal = Object.freeze({
      version: '0.2.0',
      mode: 'local-only',
      multiplayer: false,
      threeRevision: '128',
    });
  }

  setGaugeCanvases(clusterCanvas: HTMLCanvasElement | null, gMeterCanvas: HTMLCanvasElement | null): void {
    if (this.disposed) return;
    this.gauges.setCanvases(clusterCanvas, gMeterCanvas);
    if (clusterCanvas || gMeterCanvas) {
      this.gauges.draw(this.phys, this.settings.mph, this.touchMode);
    }
  }

  public getMode(): GameMode {
    return this.mode;
  }

  public setMode(mode: GameMode): void {
    if (this.disposed) return;
    this.mode = mode;
    this.paused = false;
    this.slowMotion = false;
    this.helpOpen = false;
    this.activeBoostAccel = 0;
    if (this.boostTrailGroup) {
      this.boostTrailGroup.visible = false;
    }
    if (this.provingGroundGroup) {
      this.provingGroundGroup.visible = mode === 'proving_ground';
    }
    if (this.neonCircuitWorld) {
      this.neonCircuitWorld.group.visible = mode === 'neon_circuit';
    }
    if (mode === 'neon_circuit') {
      if (this.settings.cam === 4) {
        this.settings.cam = 0;
      }
      this.applyTheme(true);
      this.raceSession.resetToReady();
      const sp = NEON_CIRCUIT_TRACK.startSpawn;
      this.resetCarToPose(sp.x, sp.y, sp.heading);
      this.loadingStatus = 'WASD: haydash · E: boost · R: qaytarish · Esc: pauza';
    } else {
      this.applyTheme(false);
      this.resetCar();
      this.loadingStatus = 'WASD: haydash · V: sinov · G: grafika · Y: 0.25× · Esc: pauza';
    }
    this.emitSnapshot();
  }

  start(mode?: GameMode): void {
    if (this.disposed || this.error) return;
    if (mode && mode !== this.mode) {
      this.setMode(mode);
    } else if (this.started && !mode) {
      return;
    }
    this.started = true;
    this.paused = false;
    if (this.mode === 'neon_circuit') {
      this.applyTheme(true);
      this.raceSession.resetToReady();
      const sp = NEON_CIRCUIT_TRACK.startSpawn;
      this.resetCarToPose(sp.x, sp.y, sp.heading);
    }
    if (!this.headless) {
      const ok = this.audio.init(this.settings.sound);
      if (!ok) {
        this.toast('Brauzerda Web Audio mavjud emas · ovozsiz rejim');
      } else if (!this.settings.sound) {
        this.audio.setEnabled(false);
      }
    }
    if (typeof document !== 'undefined') {
      const active = document.activeElement as HTMLElement | null;
      const inSplash = Boolean(active && (active.id === 'go' || active.closest?.('#splash')));
      if (!active || active === document.body || active === document.documentElement || inSplash) {
        this.focusCanvas();
      }
    }
    this.emitSnapshot();
  }

  public startRaceCountdown(): void {
    if (this.disposed || this.error) return;
    if (this.mode !== 'neon_circuit') {
      this.setMode('neon_circuit');
    }
    if (!this.started) {
      this.started = true;
      if (!this.headless) {
        const ok = this.audio.init(this.settings.sound);
        if (ok && !this.settings.sound) {
          this.audio.setEnabled(false);
        }
      }
    }
    this.paused = false;
    this.slowMotion = false;
    this.activeBoostAccel = 0;
    if (this.boostTrailGroup) {
      this.boostTrailGroup.visible = false;
    }
    const sp = NEON_CIRCUIT_TRACK.startSpawn;
    this.resetCarToPose(sp.x, sp.y, sp.heading);
    this.raceSession.startCountdown();
    this.audio.resume();
    this.focusCanvas();
    this.emitSnapshot();
  }

  public returnToMenu(): void {
    if (this.disposed) return;
    this.input.clearAll();
    this.started = false;
    this.paused = false;
    this.slowMotion = false;
    this.helpOpen = false;
    this.activeBoostAccel = 0;
    if (this.boostTrailGroup) {
      this.boostTrailGroup.visible = false;
    }
    if (this.mode === 'neon_circuit') {
      this.raceSession.resetToReady();
      const sp = NEON_CIRCUIT_TRACK.startSpawn;
      this.resetCarToPose(sp.x, sp.y, sp.heading);
    } else {
      this.resetCar();
    }
    this.emitSnapshot();
  }

  public respawnRaceCar(): void {
    if (this.disposed || this.mode !== 'neon_circuit') return;
    const pose = this.raceSession.respawnAtLastCheckpoint();
    if (!pose) return;
    this.activeBoostAccel = 0;
    if (this.boostTrailGroup) {
      this.boostTrailGroup.visible = false;
    }
    this.resetCarToPose(pose.x, pose.y, pose.heading);
    this.paused = false;
    this.audio.resume();
    this.toast('Trassaga qaytarildi (+5s jarima)');
    this.focusCanvas();
    this.emitSnapshot();
  }

  public activateBoost(): void {
    if (this.disposed || this.mode !== 'neon_circuit' || !this.started || this.paused) return;
    this.raceSession.requestBoost();
    this.emitSnapshot();
  }

  pause(): void {
    if (this.disposed || this.paused) return;
    if (this.mode === 'neon_circuit') {
      const phase = this.raceSession.getPhase();
      if (phase === 'ready' || phase === 'finished') return;
      this.raceSession.pause();
    }
    this.paused = true;
    this.acc = 0;
    this.audio.suspend();
    this.emitSnapshot();
  }

  resume(): void {
    if (this.disposed || !this.paused) return;
    if (this.mode === 'neon_circuit') {
      this.raceSession.resume();
    }
    this.paused = false;
    this.acc = 0;
    this.audio.resume();
    this.focusCanvas();
    this.emitSnapshot();
  }

  resize(width: number, height: number): void {
    if (this.disposed || width <= 0 || height <= 0) return;
    const nextTouch = detectTouchDevice() || width <= 640 || height <= 450;
    if (nextTouch !== this.touchMode) {
      this.touchMode = nextTouch;
      this.emitSnapshot();
    }
    if (this.camera) {
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
    }
    if (this.quality) {
      this.quality.setViewportSize(width, height);
    }
    if (this.renderer) {
      this.renderer.setSize(width, height);
    }
    this.gauges.resize();
  }

  dispatch(command: GameCommand): void {
    if (this.disposed) return;
    switch (command.type) {
      case 'START':
        this.start(command.mode);
        break;
      case 'SELECT_MODE':
        this.setMode(command.mode);
        break;
      case 'START_RACE':
      case 'RESTART_RACE':
        this.startRaceCountdown();
        break;
      case 'RETURN_TO_MENU':
        this.returnToMenu();
        break;
      case 'RESPAWN_RACE':
        this.respawnRaceCar();
        break;
      case 'ACTIVATE_BOOST':
        this.activateBoost();
        break;
      case 'HOTKEY':
        if (!this.started) this.start();
        this.toggleKey(command.code);
        break;
      case 'SET_PAINT':
        this.setPaint(command.color);
        break;
      case 'TOUCH_INPUT':
        this.input.setTouch(command.control, command.active);
        if (command.control === 'boost' && command.active) {
          this.activateBoost();
        }
        break;
      case 'TOGGLE_HELP':
        this.helpOpen = !this.helpOpen;
        this.emitSnapshot();
        break;
      case 'PAUSE':
        if (command.paused === undefined) {
          this.toggleKey('Escape');
        } else if (command.paused) {
          this.pause();
        } else {
          this.resume();
        }
        break;
    }
  }

  getSnapshot(): GameSnapshot {
    return this.cachedSnapshot;
  }

  subscribe(listener: () => void): () => void {
    if (this.disposed) {
      return () => {};
    }
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emitSnapshot(): void {
    if (this.disposed) return;
    this.cachedSnapshot = this.buildSnapshot();
    for (const listener of this.listeners) {
      listener();
    }
  }

  private toast(msg: string): void {
    if (this.disposed) return;
    this.toastMessage = msg;
    if (this.toastTimer !== null) {
      clearTimeout(this.toastTimer);
    }
    this.toastTimer = setTimeout(() => {
      if (this.disposed) return;
      this.toastMessage = null;
      this.toastTimer = null;
      this.emitSnapshot();
    }, 1500);
    this.emitSnapshot();
  }

  private applyTheme(night: boolean): void {
    const t = THEMES[night ? 'night' : 'day'];
    this.settings.night = night;
    this.settings.lights = night;
    if (this.skyMat) applySkyTheme(this.skyMat, t);
    if (this.scene && this.scene.fog && this.renderer) {
      this.scene.fog.color.copy(lin(t.fog));
      this.renderer.setClearColor(this.scene.fog.color);
    }
    if (this.hemi) this.hemi.intensity = t.hemi;
    if (this.sun) {
      this.sun.intensity = t.sun;
      this.sun.color.setHex(t.sunColor);
    }
    if (this.scene && this.envs) {
      this.scene.environment = this.envs[night ? 'night' : 'day'];
    }
    if (this.renderer) {
      this.renderer.toneMappingExposure = t.exposure;
      this.renderer.shadowMap.needsUpdate = true;
    }
    if (this.smoke) (this.smoke.mat.uniforms.color.value as THREE.Color).setHex(t.smoke);
    if (this.exhaust) this.exhaust.setNight(night);
    if (this.fillLight) this.fillLight.intensity = night ? 0.035 : 0.20;
    if (this.world) {
      this.world.lampMat.emissiveIntensity = t.poles;
      this.world.winMat.emissiveIntensity = night ? 0.9 : 0;
    }
  }

  private setPaint(hex: number): void {
    if (this.disposed) return;
    this.settings.paint = hex;
    store.set('paint', hex, this.storage);
    this.car?.setPaint(hex);
    this.emitSnapshot();
  }

  public toggleKey(code: string): void {
    if (this.disposed) return;
    const isRaceMode = this.mode === 'neon_circuit';

    // Block Proving-Ground-only cheats/tools in Race mode
    if (isRaceMode && (code === 'KeyF' || code === 'KeyV' || code === 'KeyY' || code === 'KeyI' || code === 'KeyN')) {
      return;
    }

    switch (code) {
      case 'KeyE':
        if (isRaceMode) {
          this.activateBoost();
        }
        return;
      case 'KeyC': {
        const maxCams = isRaceMode ? 4 : CAMS.length;
        this.settings.cam = (this.settings.cam + 1) % maxCams;
        store.set('cam', this.settings.cam, this.storage);
        this.toast('Camera · ' + CAMS[this.settings.cam]);
        break;
      }
      case 'KeyT':
        this.settings.tcs = this.phys.p.tcs = !this.phys.p.tcs;
        store.set('tcs', this.settings.tcs, this.storage);
        this.toast(this.settings.tcs ? 'Traction control on' : 'Traction control off · go sideways');
        break;
      case 'KeyL':
        this.settings.lights = !this.settings.lights;
        this.toast(this.settings.lights ? 'Headlights on' : 'Headlights off');
        break;
      case 'KeyN':
        this.applyTheme(!this.settings.night);
        this.toast(this.settings.night ? 'Night' : 'Day');
        break;
      case 'KeyM':
        this.settings.sound = !this.settings.sound;
        store.set('sound', this.settings.sound, this.storage);
        this.audio.setEnabled(this.settings.sound);
        this.toast(this.settings.sound ? 'Sound on' : 'Sound off');
        break;
      case 'KeyU':
        this.settings.mph = !this.settings.mph;
        store.set('mph', this.settings.mph, this.storage);
        break;
      case 'KeyR':
        if (isRaceMode) {
          this.respawnRaceCar();
          return;
        }
        this.resetCar();
        this.toast('Reset');
        break;
      case 'KeyH':
        this.helpOpen = !this.helpOpen;
        break;
      case 'KeyO':
        this.settings.markers = !this.settings.markers;
        this.toast(
          this.settings.markers
            ? 'Side / parking lights on'
            : 'Side / parking lights off (headlights override)',
        );
        break;
      case 'KeyZ':
        this.settings.turn = this.settings.turn === 'left' ? 'off' : 'left';
        this.settings.hazards = false;
        break;
      case 'KeyX':
        this.settings.turn = this.settings.turn === 'right' ? 'off' : 'right';
        this.settings.hazards = false;
        break;
      case 'KeyB':
        this.settings.hazards = !this.settings.hazards;
        this.settings.turn = 'off';
        break;
      case 'KeyF':
        this.repairCar();
        this.toast('Bodywork and lights repaired');
        break;
      case 'KeyQ':
        this.settings.shadows = !this.settings.shadows;
        if (this.renderer && this.scene) {
          this.renderer.shadowMap.enabled = this.settings.shadows;
          this.renderer.shadowMap.needsUpdate = true;
          this.scene.traverse((o) => {
            if (isMeshObject(o) && o.material) {
              const list = Array.isArray(o.material) ? o.material : [o.material];
              list.forEach((m) => (m.needsUpdate = true));
            }
          });
        }
        store.set('shadowsV3', this.settings.shadows, this.storage);
        this.toast(this.settings.shadows ? 'Soyalar yoqildi' : 'Soyalar o‘chirildi');
        break;
      case 'KeyG':
        if (this.quality) {
          this.toast('Grafika: ' + this.quality.cycle());
        }
        break;
      case 'KeyY':
        this.slowMotion = !this.slowMotion;
        this.toast(this.slowMotion ? 'Sekinlashtirish: 0.25×' : 'Oddiy tezlik: 1×');
        break;
      case 'Escape':
        if (isRaceMode) {
          const phase = this.raceSession.getPhase();
          if (phase === 'ready' || phase === 'finished') {
            return;
          }
          if (this.paused) {
            this.resume();
          } else {
            this.pause();
          }
          return;
        }
        this.paused = !this.paused;
        this.acc = 0;
        if (this.paused) this.audio.suspend();
        else this.audio.resume();
        this.toast(this.paused ? 'Pauza · davom etish uchun Esc' : 'Davom etamiz');
        break;
      case 'KeyV':
        this.launchCrashTest();
        break;
      case 'KeyI':
        if (this.settings.cam !== 4) {
          this.cameraCtrl.inspectReturn = this.settings.cam;
          this.settings.cam = 4;
        } else {
          this.settings.cam = this.cameraCtrl.inspectReturn;
        }
        store.set('cam', this.settings.cam, this.storage);
        this.toast(this.settings.cam === 4 ? 'Inspect · drag to rotate, scroll to zoom' : 'Driving camera');
        break;
      case 'KeyP': {
        const i = PAINTS.findIndex((p) => p[0] === this.settings.paint);
        this.setPaint(PAINTS[(i + 1) % PAINTS.length][0]);
        break;
      }
    }
    this.emitSnapshot();
  }

  public repairCar(): void {
    if (this.disposed) return;
    this.parts?.repair();
    this.damage?.repair();
    this.phys.setDamage(this.damage ? this.damage.zones : { front: 0, rear: 0, left: 0, right: 0 }, this.car?.wheels);
    this.crashParticles?.clear();
    this.glassShards?.clear();
    this.metalShards?.clear();
    if (this.engineVapor) {
      this.engineVapor.life.set(this.engineVapor.span);
      this.engineVapor.alpha.fill(0);
      this.engineVapor.points.geometry.attributes.alpha.needsUpdate = true;
    }
    this.phys.suspension.heave = 0;
    this.phys.suspension.heaveV = 0;
    this.phys.suspension.roll = 0;
    this.phys.suspension.rollV = 0;
    this.phys.suspension.pitch = 0;
    this.phys.suspension.pitchV = 0;
    if (this.renderer) this.renderer.shadowMap.needsUpdate = true;
    this.cameraCtrl.camShake = 0;
  }

  private resetCarToPose(x: number, y: number, heading: number): void {
    this.repairCar();
    this.phys.reset(x, y, heading);
    this.exhaust?.clear();
    this.resetRenderPose();
    this.skids?.clear();
    this.cameraCtrl.camYaw = 0;
    this.drift.cur = 0;
    this.drift.time = 0;
    this.drift.mult = 1;
  }

  public resetCar(): void {
    if (this.disposed) return;
    this.resetCarToPose(START_POSE[0], START_POSE[1], START_POSE[2]);
    if (this.world) {
      this.world.cones.forEach(resetCone);
      this.world.conesDirty = true;
      syncConeInstances(this.world, true);
    }
    this.stats.cones = 0;
  }

  public launchCrashTest(): void {
    if (this.disposed || this.mode === 'neon_circuit') return;
    this.repairCar();
    this.exhaust?.clear();
    this.skids?.breakAll();
    // A real, unoccupied in-game wall collision; no pre-baked damage animation.
    this.phys.reset(ARENA - 12, 0, 0);
    this.phys.u = 80 / 3.6;
    this.phys.gear = 3;
    this.cameraCtrl.camYaw = 0;
    this.paused = false;
    this.audio.resume();
    this.resetRenderPose();
    this.settings.cam = 1;
    this.camera?.position.set(this.phys.x - 11, 4, 0);
    this.toast('O‘yin sinovi · 80 km/h · Y: sekinlashtirish · I: ko‘rish');
  }

  private rememberPose(): void {
    this.previousPose.x = this.phys.x;
    this.previousPose.y = this.phys.y;
    this.previousPose.heading = this.phys.heading;
    this.phys.wheels.forEach((w, i) => {
      this.previousPose.wheels[i] = w.spin;
    });
  }

  private resetRenderPose(): void {
    this.rememberPose();
    this.renderAlpha = 1;
    this.acc = 0;
  }

  private hitCones(): void {
    if (!this.world || this.mode !== 'proving_ground') return;
    const ch = Math.cos(this.phys.heading);
    const sh = Math.sin(this.phys.heading);
    const [vx, vy] = this.phys.worldVel();
    const L = this.phys.p.halfLength + 0.22;
    const W = this.phys.p.halfWidth + 0.22;
    for (const c of this.world.cones) {
      if (c.h > 0.7) continue;
      const dx = c.x - this.phys.x;
      const dy = c.y - this.phys.y;
      if (dx * dx + dy * dy > 12) continue;
      const lx = dx * ch + dy * sh;
      const ly = -dx * sh + dy * ch;
      if (Math.abs(lx) > L || Math.abs(ly) > W) continue;
      const px = L - Math.abs(lx);
      const py = W - Math.abs(ly);
      const nlx = px < py ? Math.sign(lx) : 0;
      const nly = px < py ? 0 : Math.sign(ly);
      const nx = nlx * ch - nly * sh;
      const ny = nlx * sh + nly * ch;
      const pvx = vx - this.phys.r * dy;
      const pvy = vy + this.phys.r * dx;
      const sp = Math.hypot(pvx, pvy);
      const push = Math.min(px, py) + 0.03;
      c.x += nx * push;
      c.y += ny * push;
      if (pvx * nx + pvy * ny < 0.05 && c.active) continue;
      const kick = 1 + sp * 0.15;
      c.vx = pvx * 1.12 + nx * kick;
      c.vy = pvy * 1.12 + ny * kick;
      c.vh = Math.min(7, 0.6 + sp * 0.2);
      c.tiltV = 3 + sp * 0.55;
      c.yaw = Math.atan2(c.vy, c.vx);
      c.active = true;
      this.world.conesDirty = true;
      if (!c.hit) {
        c.hit = true;
        this.stats.cones++;
        this.audio.cone(sp);
      }
      this.phys.u *= 0.996;
    }
  }

  public advanceSimulation(input: GameInput, h: number): number {
    if (this.disposed) return 0;

    if (this.mode === 'neon_circuit') {
      const phase = this.raceSession.getPhase();
      if (phase === 'ready' || phase === 'paused') {
        this.phys.u = 0;
        this.phys.v = 0;
        this.phys.r = 0;
        this.activeBoostAccel = 0;
        return 0;
      }

      if (phase === 'countdown') {
        this.phys.u = 0;
        this.phys.v = 0;
        this.phys.r = 0;
        this.activeBoostAccel = 0;
        const res = this.raceSession.step({
          x: this.phys.x,
          y: this.phys.y,
          heading: this.phys.heading,
          vx: 0,
          vy: 0,
          forwardSpeed: 0,
          forwardInput: false,
          brakeInput: false,
          handbrakeInput: false,
          dt: h,
        });
        if (res.countdownTick !== null) {
          this.audio.countdownBeep(res.countdownTick === 0);
          this.emitSnapshot();
        }
        return 0;
      }

      if (phase === 'finished') {
        this.activeBoostAccel = 0;
        const finishInput: GameInput = {
          throttle: 0,
          brake: 0.85,
          steer: 0,
          handbrake: false,
          boostAccel: 0,
        };
        const count = clamp(
          Math.ceil(((this.phys.speed + Math.abs(this.phys.r) * 2.8) * h) / 0.14),
          1,
          8,
        );
        const sub = h / count;
        let impact = 0;
        for (let i = 0; i < count; i++) {
          this.phys.step(finishInput, sub);
          impact = Math.max(
            impact,
            collide(this.phys, this.neonColliderGrid, 0, NEON_CIRCUIT_TRACK.barrierSegments),
          );
          this.simulationSteps++;
        }
        const damp = Math.exp(-h * 3.5);
        this.phys.u *= damp;
        this.phys.v *= damp;
        this.phys.r *= damp;
        return impact;
      }

      // Active 'racing' phase
      const forwardInput = (input.throttle ?? 0) > 0.05;
      const brakeInput = (input.brake ?? 0) > 0.05;
      const handbrakeInput = Boolean(input.handbrake);

      const raceInput: GameInput = {
        ...input,
        boostAccel: input.boostAccel ?? this.activeBoostAccel,
        boostMaxSpeed: input.boostMaxSpeed ?? this.activeBoostMaxSpeed,
      };

      const count = clamp(
        Math.ceil(((this.phys.speed + Math.abs(this.phys.r) * 2.8) * h) / 0.14),
        1,
        8,
      );
      const sub = h / count;
      let impact = 0;
      for (let i = 0; i < count; i++) {
        this.phys.step(raceInput, sub);
        impact = Math.max(
          impact,
          collide(this.phys, this.neonColliderGrid, 0, NEON_CIRCUIT_TRACK.barrierSegments),
        );
        this.simulationSteps++;
      }

      const [vx, vy] = this.phys.worldVel();
      const raceRes = this.raceSession.step({
        x: this.phys.x,
        y: this.phys.y,
        heading: this.phys.heading,
        vx,
        vy,
        forwardSpeed: this.phys.u,
        forwardInput,
        brakeInput,
        handbrakeInput,
        dt: h,
      });

      this.activeBoostAccel = raceRes.boostAccel;
      this.activeBoostMaxSpeed = raceRes.boostMaxSpeed;

      if (raceRes.checkpointsPassed.length > 0) {
        this.audio.checkpointChime();
      }
      if (raceRes.lapCompleted !== null) {
        this.audio.lapChime(raceRes.raceFinished);
      }
      if (raceRes.boostPickedUp !== null) {
        this.audio.boostPickup();
      }
      if (raceRes.boostActivated) {
        this.audio.boostActivate();
      }
      if (
        raceRes.checkpointsPassed.length > 0 ||
        raceRes.lapCompleted !== null ||
        raceRes.boostPickedUp !== null ||
        raceRes.boostActivated ||
        raceRes.raceFinished
      ) {
        this.emitSnapshot();
      }

      return impact;
    }

    // Default Proving Ground simulation
    const count = clamp(Math.ceil(((this.phys.speed + Math.abs(this.phys.r) * 2.8) * h) / 0.14), 1, 8);
    const sub = h / count;
    let impact = 0;
    for (let i = 0; i < count; i++) {
      this.phys.step(input, sub);
      impact = Math.max(impact, collide(this.phys, this.colliderGrid));
      this.hitCones();
      if (this.world) updateCones(this.world.cones, sub);
      this.simulationSteps++;
    }
    return impact;
  }

  private syncCar(): void {
    if (!this.car) return;
    const a = this.paused ? 1 : this.renderAlpha;
    this.car.group.position.set(
      lerp(this.previousPose.x, this.phys.x, a),
      0,
      -lerp(this.previousPose.y, this.phys.y, a),
    );
    this.car.group.rotation.y =
      this.previousPose.heading + wrapAngle(this.phys.heading - this.previousPose.heading) * a;
    for (let i = 0; i < this.car.wheels.length; i++) {
      const w = this.car.wheels[i];
      const pw = this.phys.wheels[i];
      w.root.rotation.y = pw.steer;
      w.root.rotation.x = w.damage.camber;
      w.root.position.z = w.home.z - Math.sign(w.home.z) * w.damage.inset;
      w.root.position.y = w.home.y + pw.road;
      w.spin.rotation.z = -(lerp(this.previousPose.wheels[i], pw.spin, a) % (Math.PI * 2));
    }
    const s = this.phys.suspension;
    this.car.body.position.y = 0.45 + s.heave;
    this.car.body.rotation.set(s.roll, 0, s.pitch);
    const isBoosting =
      this.mode === 'neon_circuit' && this.raceSession.getSnapshot().boost.isActive;
    if (this.boostTrailGroup) {
      this.boostTrailGroup.visible = isBoosting;
      if (isBoosting) {
        const pulse = 0.85 + 0.25 * Math.sin(this.phys.time * 45);
        this.boostTrailGroup.scale.set(1, 1, pulse);
      }
    }
    this.car.setLights({
      head: this.settings.lights,
      brake: this.phys.braking ? 1 : 0,
      reverse: this.phys.gear < 0 && this.phys.u < -0.1,
      night: this.settings.night,
      markers: this.settings.markers,
      turn: this.settings.turn,
      hazards: this.settings.hazards,
      time: this.damage ? this.damage.time : this.phys.time,
    });
  }

  private updateEffects(dt: number): void {
    if (!this.car || !this.skids || !this.smoke || !this.exhaust || !this.engineVapor || !this.quality) return;
    this.car.group.updateMatrixWorld(true);
    const hx = Math.cos(this.phys.heading);
    const hz = -Math.sin(this.phys.heading);
    const [vx, vy] = this.phys.worldVel();
    const fxScale = this.quality.profile.fx;

    this.car.wheels.forEach((w, i) => {
      w.root.getWorldPosition(this.wpos);
      const k = this.phys.wheels[i].slip;
      this.skids!.add(i, this.wpos.x, this.wpos.z, hx, hz, k);
      const rate = (w.front ? (k > 0.6 ? k * 12 : 0) : k > 0.3 ? k * 44 : 0) * fxScale;
      let n = rate * dt;
      while (n > 0) {
        if (n >= 1 || Math.random() < n) {
          this.smoke!.spawn(
            this.wpos.x + (Math.random() - 0.5) * 0.4,
            0.25,
            this.wpos.z + (Math.random() - 0.5) * 0.4,
            vx * 0.22 + (Math.random() - 0.5) * 1.2,
            0.4 + Math.random() * 0.7,
            -vy * 0.22 + (Math.random() - 0.5) * 1.2,
            0.9 + Math.random() * 0.5,
            0.18 + 0.22 * k,
            1.6 + Math.random() * 1.2,
          );
        }
        n -= 1;
      }
    });
    this.skids.flush();
    this.smoke.update(dt);
    this.exhaust.emit(dt, this.car, this.phys, this.started && !this.paused);
    this.exhaust.update(dt);
    const vapor = clamp((0.57 - this.phys.engineHealth) * 2.7, 0, 1);
    this.vaporAccumulator += vapor * 15 * dt * fxScale;
    if (this.vaporAccumulator >= 1) {
      this.car.shell.localToWorld(this.tmpV.set(1.15, 0.9, 0));
      const count = Math.min(4, Math.floor(this.vaporAccumulator));
      this.vaporAccumulator -= count;
      for (let i = 0; i < count; i++) {
        this.engineVapor.spawn(
          this.tmpV.x,
          this.tmpV.y,
          this.tmpV.z,
          vx * 0.15,
          0.35 + Math.random() * 0.35,
          -vy * 0.15,
          0.24,
          0.13,
          1.2 + Math.random() * 0.7,
        );
      }
    }
    this.engineVapor.update(dt);
  }

  private updateDrift(dt: number): void {
    const ang = Math.abs(this.phys.beta);
    const spd = this.phys.speed;
    if (ang > 0.2 && spd > 8 && this.phys.u > 2) {
      this.drift.time += dt;
      this.drift.grace = 1.1;
      this.drift.mult = 1 + Math.min(4, Math.floor(this.drift.time / 2.5));
      this.drift.cur += ang * 57.3 * spd * dt * 0.5 * this.drift.mult;
      this.drift.state = '';
    } else if (this.drift.cur > 0) {
      this.drift.grace -= dt;
      if (this.drift.grace <= 0) {
        const pts = Math.round(this.drift.cur);
        this.drift.total += pts;
        if (pts > this.drift.best) {
          this.drift.best = pts;
          store.set('best', pts, this.storage);
        }
        this.endDrift('banked', pts);
      }
    }
    if (this.drift.flash > 0) this.drift.flash -= dt;
  }

  private endDrift(state: 'banked' | 'crashed', pts: number): void {
    this.drift.state = state;
    this.drift.shown = pts;
    this.drift.flash = 1.6;
    this.drift.cur = 0;
    this.drift.time = 0;
    this.drift.mult = 1;
  }

  private readonly frame = (now: number): void => {
    if (this.disposed) return;
    this.rafId = requestAnimationFrame(this.frame);
    const rawDt = Math.max(0, (now - this.lastTime) / 1000);
    this.lastTime = now;
    if ((typeof document !== 'undefined' && document.hidden) || this.contextLost) {
      this.acc = 0;
      return;
    }

    const realDt = Math.min(0.1, rawDt);
    const dt =
      this.paused
        ? 0
        : realDt * (this.mode === 'proving_ground' && this.slowMotion ? 0.25 : 1);
    const input = this.started ? this.input.readInput() : {};
    this.acc += dt;
    let steps = 0;
    let impact = 0;
    while (this.acc >= STEP && steps < 12) {
      this.rememberPose();
      impact = Math.max(impact, this.advanceSimulation(input, STEP));
      this.acc -= STEP;
      steps++;
    }
    if (steps === 12 && this.acc >= STEP) this.acc %= STEP;
    this.renderAlpha = this.paused ? 1 : clamp(this.acc / STEP, 0, 1);

    this.thudCool -= dt;
    if (impact > 2500) {
      this.cameraCtrl.camShake = Math.min(0.75, this.cameraCtrl.camShake + impact / 40000);
      if (this.thudCool <= 0) {
        this.audio.thud(impact);
        this.thudCool = 0.25;
      }
      if (impact > 6000 && this.drift.cur > 0) {
        this.endDrift('crashed', Math.round(this.drift.cur));
      }
    }

    const impacts = this.damage ? this.damage.process() : [];
    if (impacts.length > 0 && this.damage && this.car && this.quality && this.smoke) {
      this.impactFlashT = 0.18;
      for (const hit of impacts) {
        this.crashParticles?.spawn(hit);
        this.metalShards?.spawn(hit);
        const count = Math.max(2, Math.round(8 * this.quality.profile.fx));
        for (let i = 0; i < count; i++) {
          this.smoke.spawn(
            hit.px,
            0.55,
            -hit.py,
            hit.nx * 0.7 + (Math.random() - 0.5),
            0.3 + Math.random(),
            -hit.ny * 0.7 + (Math.random() - 0.5),
            0.32,
            0.13,
            0.5 + Math.random() * 0.65,
          );
        }
        this.phys.setDamage(this.damage.zones, this.car.wheels);
      }
    } else if (this.impactFlashT > 0) {
      this.impactFlashT = Math.max(0, this.impactFlashT - realDt);
    }

    this.damage?.update(dt);
    this.crashParticles?.update(dt);
    this.glassShards?.update(dt);
    this.metalShards?.update(dt);
    this.syncCar();
    this.car?.group.updateMatrixWorld(true);
    if (this.world && this.mode === 'proving_ground') syncConeInstances(this.world);
    if (this.neonCircuitWorld && this.mode === 'neon_circuit') {
      const raceSnap = this.raceSession.getSnapshot();
      this.neonCircuitWorld.update({
        time: this.damage ? this.damage.time : this.phys.time,
        nextCheckpointIndex: raceSnap.checkpoint.nextCheckpointIndex,
        availablePadIds: raceSnap.boost.availablePadIds,
        countdownNumber: raceSnap.countdownNumber,
      });
    }

    if (this.parts && this.damage) {
      for (const hit of impacts) this.parts.handle(hit, this.damage.zones);
    }
    const movingParts = this.parts ? this.parts.update(dt) : false;
    const breaks = this.damage ? this.damage.takeBreaks() : [];
    if (this.glassShards && this.car) {
      for (const entry of breaks) {
        this.glassShards.burst(entry.fixture, entry.event, this.car, [
          entry.event.beforeVX || 0,
          entry.event.beforeVY || 0,
        ]);
      }
    }
    if (breaks.length) this.audio.glass();
    if (dt > 0) this.updateEffects(dt);
    if (this.started && !this.paused && this.mode === 'proving_ground') {
      this.updateDrift(dt);
    }

    if (
      this.car &&
      this.camera &&
      this.sky &&
      this.sun &&
      this.renderer &&
      this.smoke &&
      this.exhaust &&
      this.engineVapor
    ) {
      this.cameraCtrl.update(
        realDt,
        this.started,
        this.settings.cam,
        this.phys,
        this.car,
        this.camera,
        this.sky,
        this.sun,
        this.renderer.domElement.height,
        [
          this.smoke.mat.uniforms.scale as { value: number },
          this.exhaust.mat.uniforms.scale as { value: number },
          this.engineVapor.mat.uniforms.scale as { value: number },
        ],
      );

      // Subtle bounded FOV kick during active boost (respecting prefers-reduced-motion)
      const boostActive =
        this.mode === 'neon_circuit' &&
        this.raceSession.getSnapshot().boost.isActive &&
        !prefersReducedMotion();
      const targetFovOffset = boostActive ? 6.5 : 0;
      this.boostFovOffset += (targetFovOffset - this.boostFovOffset) * (1 - Math.exp(-realDt * 10));
      if (this.boostFovOffset > 0.05) {
        this.camera.fov = Math.min(76, this.camera.fov + this.boostFovOffset);
        this.camera.updateProjectionMatrix();
      }
    }

    if (!this.paused) {
      this.audio.update({
        rpm: this.phys.rpm,
        thr: this.phys.thr,
        slipR: this.phys.slipR,
        slipF: this.phys.slipF,
        speed: this.phys.speed,
      });
    }

    let qualityChanged = false;
    if (this.quality && this.world && this.damage) {
      const prevLevel = this.quality.level;
      this.quality.update(rawDt, this.started && !this.paused);
      if (this.quality.level !== prevLevel) qualityChanged = true;
      this.quality.shadow(
        realDt,
        !this.paused &&
          (this.phys.speed > 0.02 ||
            Math.abs(this.phys.suspension.heaveV) > 0.001 ||
            movingParts ||
            this.world.cones.some((c) => c.active) ||
            this.damage.entries.some((e) => e.dirty)),
      );
    }

    this.clusterT += realDt;
    if (this.clusterT >= 1 / 30) {
      this.gauges.draw(this.phys, this.settings.mph, this.touchMode);
      this.clusterT = 0;
    }

    this.hudT += realDt;
    if (this.hudT >= 0.08 || impacts.length > 0 || qualityChanged) {
      this.hudT = 0;
      this.emitSnapshot();
    }

    if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
  };

  private buildSnapshot(): GameSnapshot {
    const zones = this.damage ? { ...this.damage.zones } : { front: 0, rear: 0, left: 0, right: 0 };
    const zs = Object.values(zones);
    const condition = clamp(1 - Math.max(...zs) * 0.55 - zs.reduce((a, b) => a + b, 0) * 0.1125, 0, 1);
    const intactHeadlamps = this.car
      ? this.car.fixtures.filter((f) => f.kind === 'head' && !f.broken).length
      : 4;
    const exhaustLoad = this.exhaust ? this.exhaust.load : 0;
    const lastImpact = this.damage ? this.damage.lastImpact : null;
    const contacts = this.damage ? this.damage.contacts : 0;
    const damageTime = this.damage ? this.damage.time : this.phys.time;
    const flash = damageTime % 0.8 < 0.4;

    const liveDrift = this.drift.cur > 0;
    const showDrift = liveDrift || this.drift.flash > 0;
    let driftLabel = 'DRIFT';
    let driftPoints = '0';
    let driftMult = '';
    let driftSub = '';

    if (liveDrift) {
      driftPoints = fmt(this.drift.cur);
      driftMult = this.drift.mult > 1 ? '×' + this.drift.mult : '';
      driftLabel = 'DRIFT';
      driftSub = `${Math.round(Math.abs(this.phys.beta) * 57.3)}° · hold it`;
    } else if (this.drift.flash > 0) {
      driftPoints = (this.drift.state === 'banked' ? '+' : '') + fmt(this.drift.shown);
      driftMult = '';
      driftLabel = this.drift.state === 'banked' ? 'BANKED' : 'WIPED OUT';
      driftSub = `Session ${fmt(this.drift.total)} · Best ${fmt(this.drift.best)}`;
    }

    const qualityLabel = this.quality ? this.quality.label : 'Auto · Muvozanat';
    const fps = this.quality ? Math.round(this.quality.fps) : 60;

    return {
      mode: this.mode,
      ready: this.ready,
      started: this.started,
      paused: this.paused,
      slowMotion: this.slowMotion,
      helpOpen: this.helpOpen,
      touchMode: this.touchMode,
      inspecting: this.started && this.mode === 'proving_ground' && this.settings.cam === 4,
      error: this.error,
      loadingStatus: this.loadingStatus,
      toastMessage: this.toastMessage,
      settings: { ...this.settings },
      camLabel: CAMS[this.settings.cam] || 'Chase',
      qualityLabel,
      performanceText: `${fps} FPS · ${qualityLabel} · 120 Hz`,
      gForceText: (Math.hypot(this.phys.ax, this.phys.ay) / 9.81).toFixed(2),
      conesHit: this.stats.cones,
      bestDrift: this.drift.best,
      damage: {
        conditionPercent: Math.round(condition * 100),
        zones,
        engineHealthPercent: Math.round(this.phys.engineHealth * 100),
        steeringStatusText:
          this.phys.steeringHealth > 0.85
            ? 'Yaxshi'
            : this.phys.steeringHealth > 0.55
              ? 'Shikastlangan'
              : 'Og‘ir shikast',
        intactHeadlamps,
        totalHeadlamps: 4,
        exhaustLoadPercent: Math.round(exhaustLoad * 100),
        exhaustLoadRatio: exhaustLoad,
        damageStateText: lastImpact ? `${lastImpact.severity} · ${lastImpact.zone}` : 'Pristine',
        impactNoteText: lastImpact
          ? `${(lastImpact.energy / 1000).toFixed(1)} kJ absorbed · ${contacts} impact${contacts === 1 ? '' : 's'}`
          : 'Persistent panel deformation',
        recentImpactFlash: this.impactFlashT > 0,
        leftSignalLit: flash && (this.settings.hazards || this.settings.turn === 'left'),
        rightSignalLit: flash && (this.settings.hazards || this.settings.turn === 'right'),
      },
      drift: {
        visible: showDrift,
        mode: liveDrift ? '' : this.drift.state,
        label: driftLabel,
        pointsText: driftPoints,
        multText: driftMult,
        subText: driftSub,
        best: this.drift.best,
        total: this.drift.total,
      },
      telemetry: {
        rpm: this.phys.rpm,
        upRpm: this.phys.p.upRpm,
        redline: this.phys.p.redline,
        gear: this.phys.gear,
        speed: this.phys.speed,
        thr: this.phys.thr,
        tcsEnabled: this.phys.p.tcs,
        tcsActive: this.phys.tcsActive,
        hb: this.phys.hb,
        limiter: this.phys.limiter,
        mph: this.settings.mph,
        ax: this.phys.ax,
        ay: this.phys.ay,
      },
      race: this.mode === 'neon_circuit' ? this.raceSession.getSnapshot() : null,
    };
  }

  private cleanupInternal(): void {
    const errors: unknown[] = [];
    const safeRun = (fn: () => void): void => {
      try {
        fn();
      } catch (err) {
        errors.push(err);
      }
    };

    safeRun(() => {
      if (this.rafId !== null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(this.rafId);
        this.rafId = null;
      }
    });

    safeRun(() => {
      if (this.toastTimer !== null) {
        clearTimeout(this.toastTimer);
        this.toastTimer = null;
      }
    });

    safeRun(() => this.input.detach());
    safeRun(() => this.cameraCtrl.detach());
    safeRun(() => this.audio.dispose());

    safeRun(() => {
      if (this.resizeObserver) {
        this.resizeObserver.disconnect();
        this.resizeObserver = null;
      }
    });

    safeRun(() => {
      if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
        window.removeEventListener('resize', this.handleWindowResize);
      }
    });

    safeRun(() => {
      if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
        document.removeEventListener('visibilitychange', this.handleVisibilityChange);
      }
    });

    safeRun(() => {
      if (this.renderer) {
        this.renderer.domElement.removeEventListener('pointerdown', this.handleCanvasPointerDown);
        this.renderer.domElement.removeEventListener('webglcontextlost', this.handleContextLost);
        this.renderer.domElement.removeEventListener('webglcontextrestored', this.handleContextRestored);
      }
    });

    safeRun(() => {
      if (this.envTargets) {
        this.resources.trackRenderTarget(this.envTargets.day);
        this.resources.trackRenderTarget(this.envTargets.night);
      }
      if (this.sun?.shadow?.map) {
        this.resources.trackRenderTarget(this.sun.shadow.map as THREE.WebGLRenderTarget);
      }
      if (this.parts) {
        for (const p of this.parts.parts) {
          this.resources.captureTree(p.obj);
        }
      }
      if (this.world) {
        for (const c of this.world.cones) {
          this.resources.captureTree(c.obj);
        }
      }
      if (this.provingGroundGroup) {
        this.resources.captureTree(this.provingGroundGroup);
      }
      if (this.neonCircuitWorld) {
        this.resources.captureTree(this.neonCircuitWorld.group);
      }
      if (this.car) {
        this.resources.captureTree(this.car.group);
      }
      if (this.scene) {
        this.resources.captureTree(this.scene);
        this.scene.environment = null;
        this.scene.fog = null;
      }
    });

    safeRun(() => {
      this.resources.dispose();
    });

    safeRun(() => {
      if (this.scene) {
        this.scene.clear();
        this.scene = null;
      }
    });

    safeRun(() => {
      if (this.renderer) {
        const renderer = this.renderer;
        this.renderer = null;
        renderer.renderLists?.dispose?.();
        renderer.dispose();
        this.lastDisposedMemoryInfo = {
          geometries: renderer.info.memory.geometries,
          textures: renderer.info.memory.textures,
        };
        renderer.forceContextLoss?.();
        if (renderer.domElement.parentNode) {
          renderer.domElement.parentNode.removeChild(renderer.domElement);
        }
      }
    });

    safeRun(() => {
      if (typeof window !== 'undefined' && this.carLabToken && window.carLab === this.carLabToken) {
        delete window.carLab;
      }
      this.carLabToken = null;
    });

    this.phys.onImpact = undefined;
    this.gauges.setCanvases(null, null);
    this.envTargets = null;
    this.envs = null;
    this.world = null;
    this.provingGroundGroup = null;
    this.neonCircuitWorld = null;
    this.boostTrailGroup = null;
    this.car = null;
    this.damage = null;
    this.parts = null;
    this.skids = null;
    this.smoke = null;
    this.engineVapor = null;
    this.exhaust = null;
    this.crashParticles = null;
    this.glassShards = null;
    this.metalShards = null;
    this.quality = null;
    this.hemi = null;
    this.sun = null;
    this.fillLight = null;
    this.sky = null;
    this.skyMat = null;
    this.camera = null;
    this.container = null;
    this.listeners.clear();

    if (errors.length === 1) {
      throw errors[0];
    }
    if (errors.length > 1) {
      throw new AggregateError(errors, 'Multiple errors occurred during GameEngine.dispose()');
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.ready = false;
    this.started = false;
    this.paused = true;
    this.cleanupInternal();
  }
}
