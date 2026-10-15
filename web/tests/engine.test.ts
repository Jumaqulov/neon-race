import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GameEngine } from '../src/game/GameEngine.ts';
import { SoundEngine } from '../src/game/audio/soundEngine.ts';
import { InputController, isInteractiveTarget } from '../src/game/input/inputController.ts';
import { ResourceTracker } from '../src/game/rendering/resourceTracker.ts';
import type { StorageAdapter } from '../src/storage/settingsStore.ts';

function createMemoryStorage(): StorageAdapter & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem(key: string): string | null {
      return data.has(key) ? data.get(key)! : null;
    },
    setItem(key: string, value: string): void {
      data.set(key, value);
    },
  };
}

function spyDispose<T extends { dispose: () => void }>(resource: T): { resource: T; getCount: () => number } {
  let count = 0;
  const orig = resource.dispose.bind(resource);
  resource.dispose = () => {
    count++;
    orig();
  };
  return { resource, getCount: () => count };
}

test('Headless GameEngine creation, snapshot subscription, and idempotent dispose()', () => {
  const storage = createMemoryStorage();
  const engine = new GameEngine({ headless: true, storage });
  let notifications = 0;
  const unsubscribe = engine.subscribe(() => {
    notifications++;
  });

  engine.init(null);
  assert.equal(engine.getSnapshot().ready, true);
  assert.equal(engine.getSnapshot().started, false);
  assert.equal(engine.isDisposed(), false);
  assert(notifications >= 1);

  // Calling dispose multiple times must be safe and idempotent
  engine.dispose();
  assert.equal(engine.isDisposed(), true);
  engine.dispose();

  const countBefore = notifications;
  engine.start(); // ignored after dispose
  engine.dispatch({ type: 'HOTKEY', code: 'KeyC' }); // ignored after dispose
  assert.equal(notifications, countBefore);
  unsubscribe();
});

test('Headless GameEngine sequential dispose and recreate leaves only one active instance', () => {
  const storage = createMemoryStorage();

  const firstEngine = new GameEngine({ headless: true, storage });
  let firstUpdates = 0;
  firstEngine.subscribe(() => {
    firstUpdates++;
  });
  firstEngine.init(null);
  assert.equal(firstEngine.getSnapshot().ready, true);

  firstEngine.dispose();
  const frozenFirstUpdates = firstUpdates;

  const secondEngine = new GameEngine({ headless: true, storage });
  let secondUpdates = 0;
  secondEngine.subscribe(() => {
    secondUpdates++;
  });
  secondEngine.init(null);
  secondEngine.dispatch({ type: 'START' });

  assert.equal(firstUpdates, frozenFirstUpdates, 'Disposed engine must not emit updates');
  assert.equal(secondEngine.getSnapshot().started, true);
  assert(secondUpdates >= 2);

  secondEngine.dispose();
});

test('ResourceTracker disposes Mesh, InstancedMesh, Points, LineSegments, Sprite material, texture maps, and shader uniforms once without disposing shared Sprite geometry or external resources', () => {
  const tracker = new ResourceTracker();
  const scene = new THREE.Scene();

  // 1. Shared geometry & material used by two meshes + map & roughnessMap textures
  const sharedGeo = spyDispose(new THREE.BoxGeometry(1, 1, 1));
  const mapTex = spyDispose(new THREE.Texture());
  const roughTex = spyDispose(new THREE.Texture());
  const sharedMat = spyDispose(
    new THREE.MeshStandardMaterial({
      map: mapTex.resource,
      roughnessMap: roughTex.resource,
    }),
  );
  const mesh1 = new THREE.Mesh(sharedGeo.resource, sharedMat.resource);
  const mesh2 = new THREE.Mesh(sharedGeo.resource, sharedMat.resource);
  scene.add(mesh1, mesh2);

  // 2. Mesh with Material[] array
  const multiGeo = spyDispose(new THREE.BufferGeometry());
  const matA = spyDispose(new THREE.MeshBasicMaterial());
  const matB = spyDispose(new THREE.MeshBasicMaterial());
  const multiMesh = new THREE.Mesh(multiGeo.resource, [matA.resource, matB.resource]);
  scene.add(multiMesh);

  // 3. Points with ShaderMaterial and uniform texture
  const pointsGeo = spyDispose(new THREE.BufferGeometry());
  const uniformTex = spyDispose(new THREE.Texture());
  const pointsMat = spyDispose(
    new THREE.ShaderMaterial({
      uniforms: {
        map: { value: uniformTex.resource },
        scale: { value: 500 },
      },
    }),
  );
  const points = new THREE.Points(pointsGeo.resource, pointsMat.resource);
  scene.add(points);

  // 4. LineSegments (cracks / crash sparks)
  const lineGeo = spyDispose(new THREE.BufferGeometry());
  const lineMat = spyDispose(new THREE.LineBasicMaterial());
  const lines = new THREE.LineSegments(lineGeo.resource, lineMat.resource);
  scene.add(lines);

  // 5. Sprite (shares Three.js internal Sprite geometry, owns SpriteMaterial + glow texture)
  const glowTex = spyDispose(new THREE.Texture());
  const spriteMat = spyDispose(new THREE.SpriteMaterial({ map: glowTex.resource }));
  const sprite = new THREE.Sprite(spriteMat.resource);
  const spriteGeoSpy = spyDispose(sprite.geometry);
  scene.add(sprite);

  // 6. External shared resource that must NOT be disposed by this tracker
  const externalGeo = spyDispose(new THREE.BoxGeometry(2, 2, 2));
  const externalTex = spyDispose(new THREE.Texture());
  const externalMat = spyDispose(new THREE.MeshBasicMaterial({ map: externalTex.resource }));
  tracker.markExternal(externalGeo.resource);
  tracker.markExternal(externalTex.resource);
  tracker.markExternal(externalMat.resource);
  scene.add(new THREE.Mesh(externalGeo.resource, externalMat.resource));

  tracker.captureTree(scene);

  // Detach mesh2 before dispose to verify detached objects are still cleaned up
  scene.remove(mesh2);

  tracker.dispose();
  // Second dispose call must be a safe no-op
  tracker.dispose();

  assert.equal(sharedGeo.getCount(), 1, 'Shared geometry must be disposed exactly once');
  assert.equal(sharedMat.getCount(), 1, 'Shared material must be disposed exactly once');
  assert.equal(mapTex.getCount(), 1, 'Material map texture must be disposed once');
  assert.equal(roughTex.getCount(), 1, 'Material roughnessMap texture must be disposed once');
  assert.equal(multiGeo.getCount(), 1, 'Multi-material mesh geometry must be disposed once');
  assert.equal(matA.getCount(), 1, 'Material array item A must be disposed once');
  assert.equal(matB.getCount(), 1, 'Material array item B must be disposed once');
  assert.equal(pointsGeo.getCount(), 1, 'Points geometry must be disposed once');
  assert.equal(pointsMat.getCount(), 1, 'Points ShaderMaterial must be disposed once');
  assert.equal(uniformTex.getCount(), 1, 'ShaderMaterial uniform texture must be disposed once');
  assert.equal(lineGeo.getCount(), 1, 'LineSegments geometry must be disposed once');
  assert.equal(lineMat.getCount(), 1, 'LineSegments material must be disposed once');
  assert.equal(spriteMat.getCount(), 1, 'SpriteMaterial must be disposed once');
  assert.equal(glowTex.getCount(), 1, 'Sprite glow texture must be disposed once');
  assert.equal(spriteGeoSpy.getCount(), 0, 'Shared Three.js Sprite geometry must NEVER be disposed');
  assert.equal(externalGeo.getCount(), 0, 'Externally owned geometry must not be disposed');
  assert.equal(externalMat.getCount(), 0, 'Externally owned material must not be disposed');
  assert.equal(externalTex.getCount(), 0, 'Externally owned texture must not be disposed');
});

test('ResourceTracker owns PMREM WebGLRenderTarget without double-disposing its texture and continues cleanup on error', () => {
  const tracker = new ResourceTracker();
  const pmremTarget = new THREE.WebGLRenderTarget(16, 16);
  let targetDisposeCount = 0;
  let texStandaloneDisposeCount = 0;
  let insideTargetDispose = false;

  const origTexDispose = pmremTarget.texture.dispose.bind(pmremTarget.texture);
  pmremTarget.texture.dispose = () => {
    if (!insideTargetDispose) {
      texStandaloneDisposeCount++;
    }
    origTexDispose();
  };

  const origTargetDispose = pmremTarget.dispose.bind(pmremTarget);
  pmremTarget.dispose = () => {
    targetDisposeCount++;
    insideTargetDispose = true;
    try {
      origTargetDispose();
    } finally {
      insideTargetDispose = false;
    }
  };

  // Track both the render target and a material referencing its .texture as envMap
  const envMat = spyDispose(new THREE.MeshStandardMaterial({ envMap: pmremTarget.texture }));
  const badGeo = new THREE.BufferGeometry();
  badGeo.dispose = () => {
    throw new Error('Simulated geometry dispose failure');
  };
  const goodGeo = spyDispose(new THREE.BufferGeometry());

  tracker.trackRenderTarget(pmremTarget);
  tracker.trackGeometry(badGeo);
  tracker.trackGeometry(goodGeo.resource);
  tracker.trackMaterial(envMat.resource);

  assert.throws(
    () => tracker.dispose(),
    /Simulated geometry dispose failure/,
    'Dispose error must be surfaced after all other resources are cleaned up',
  );

  assert.equal(goodGeo.getCount(), 1, 'Remaining geometry must still be disposed after an earlier failure');
  assert.equal(envMat.getCount(), 1, 'Material must still be disposed after geometry failure');
  assert.equal(targetDisposeCount, 1, 'PMREM WebGLRenderTarget must be disposed once');
  assert.equal(
    texStandaloneDisposeCount,
    0,
    'PMREM render target texture must not be disposed separately from its owning RenderTarget',
  );

  // Subsequent dispose() must be idempotent and not throw again
  assert.doesNotThrow(() => tracker.dispose());
});

test('window.carLab diagnostic ownership only removes its own instance token on dispose()', () => {
  const prevWindow = (globalThis as { window?: unknown }).window;
  const mockWindow: Record<string, unknown> = {};
  (globalThis as { window?: unknown }).window = mockWindow;

  try {
    const engineA = new GameEngine({ headless: true, storage: createMemoryStorage() });
    const engineB = new GameEngine({ headless: true, storage: createMemoryStorage() });

    // Invoke registerGlobalDiagnostics via private method access for headless verification
    (engineA as unknown as { registerGlobalDiagnostics: () => void }).registerGlobalDiagnostics();
    const tokenA = mockWindow.carLab;
    assert(tokenA, 'engineA should register window.carLab');

    (engineB as unknown as { registerGlobalDiagnostics: () => void }).registerGlobalDiagnostics();
    const tokenB = mockWindow.carLab;
    assert(tokenB && tokenB !== tokenA, 'engineB should replace window.carLab with its own token');

    // Disposing older engineA must NOT delete engineB's window.carLab
    engineA.dispose();
    assert.equal(mockWindow.carLab, tokenB, 'Disposing old engine must not clobber newer engine carLab');

    // Disposing active engineB MUST delete its own window.carLab so no closure retains engineB
    engineB.dispose();
    assert.equal(mockWindow.carLab, undefined, 'Disposing active engine must remove window.carLab');
  } finally {
    (globalThis as { window?: unknown }).window = prevWindow;
  }
});

test('InputController separates interactive UI focus (buttons, child spans/SVGs, inputs) from driving keys and prevents stuck keys', () => {
  let started = false;
  const toggled: string[] = [];
  const input = new InputController({
    isStarted: () => started,
    onStart: () => {
      started = true;
    },
    onToggleKey: (code) => toggled.push(code),
  });

  // Verify interactive targets including BUTTON, child span/svg inside BUTTON, role="button", A[href], INPUT, TEXTAREA, DIALOG
  const buttonEl = { tagName: 'BUTTON' };
  const childSpanInsideButton = { tagName: 'SPAN', parentElement: buttonEl };
  const childSvgPathInsideButton = { tagName: 'path', parentElement: { tagName: 'svg', parentElement: buttonEl } };
  const roleButtonEl = { tagName: 'DIV', getAttribute: (k: string) => (k === 'role' ? 'button' : null) };
  const canvasEl = { tagName: 'CANVAS', id: 'gl' };
  const viewportDiv = { tagName: 'DIV', id: 'gl-viewport' };

  assert.equal(isInteractiveTarget(buttonEl as unknown as EventTarget), true);
  assert.equal(isInteractiveTarget(childSpanInsideButton as unknown as EventTarget), true);
  assert.equal(isInteractiveTarget(childSvgPathInsideButton as unknown as EventTarget), true);
  assert.equal(isInteractiveTarget(roleButtonEl as unknown as EventTarget), true);
  assert.equal(isInteractiveTarget({ tagName: 'INPUT' } as unknown as EventTarget), true);
  assert.equal(isInteractiveTarget({ tagName: 'TEXTAREA' } as unknown as EventTarget), true);
  assert.equal(isInteractiveTarget({ tagName: 'SELECT' } as unknown as EventTarget), true);
  assert.equal(isInteractiveTarget({ tagName: 'DIALOG' } as unknown as EventTarget), true);
  assert.equal(isInteractiveTarget({ tagName: 'DIV', isContentEditable: true } as unknown as EventTarget), true);
  assert.equal(isInteractiveTarget(canvasEl as unknown as EventTarget), false);
  assert.equal(isInteractiveTarget(viewportDiv as unknown as EventTarget), false);

  // Simulate driving with KeyW held down, then focus moves to an interactive element -> clearKeys() releases KeyW
  input.keys.KeyW = true;
  input.keys.Space = true;
  assert.equal(input.readInput().throttle, 1);
  assert.equal(input.readInput().handbrake, true);

  input.clearKeys();
  assert.equal(input.readInput().throttle, 0);
  assert.equal(input.readInput().handbrake, false);

  // Touch input and clearAll
  input.setTouch('throttle', true);
  input.setTouch('handbrake', true);
  assert.equal(started, true);
  assert.equal(input.readInput().throttle, 1);
  assert.equal(input.readInput().handbrake, true);

  input.clearAll();
  const afterClear = input.readInput();
  assert.equal(afterClear.throttle, 0);
  assert.equal(afterClear.brake, 0);
  assert.equal(afterClear.steer, 0);
  assert.equal(afterClear.handbrake, false);
});

test('Headless GameEngine UI commands synchronize state and persist localStorage keys', () => {
  const storage = createMemoryStorage();
  const engine = new GameEngine({ headless: true, storage });
  engine.init(null);

  engine.dispatch({ type: 'START' });
  assert.equal(engine.getSnapshot().started, true);

  // Toggle Camera (KeyC)
  engine.dispatch({ type: 'HOTKEY', code: 'KeyC' });
  assert.equal(engine.getSnapshot().settings.cam, 1);
  assert.equal(engine.getSnapshot().camLabel, 'Far chase');
  assert.equal(storage.getItem('musclecar.cam'), '1');

  // Toggle TCS (KeyT)
  engine.dispatch({ type: 'HOTKEY', code: 'KeyT' });
  assert.equal(engine.getSnapshot().settings.tcs, false);
  assert.equal(engine.phys.p.tcs, false);
  assert.equal(storage.getItem('musclecar.tcs'), 'false');

  // Toggle Night mode (KeyN) -> also enables headlights
  engine.dispatch({ type: 'HOTKEY', code: 'KeyN' });
  assert.equal(engine.getSnapshot().settings.night, true);
  assert.equal(engine.getSnapshot().settings.lights, true);

  // Toggle Turn signals & Hazards (KeyZ, KeyX, KeyB)
  engine.dispatch({ type: 'HOTKEY', code: 'KeyZ' });
  assert.equal(engine.getSnapshot().settings.turn, 'left');
  engine.dispatch({ type: 'HOTKEY', code: 'KeyB' });
  assert.equal(engine.getSnapshot().settings.hazards, true);
  assert.equal(engine.getSnapshot().settings.turn, 'off');

  // Toggle Units (KeyU), Sound (KeyM), Shadows (KeyQ), Slow motion (KeyY), Inspect (KeyI)
  engine.dispatch({ type: 'HOTKEY', code: 'KeyU' });
  assert.equal(engine.getSnapshot().settings.mph, true);
  assert.equal(storage.getItem('musclecar.mph'), 'true');

  engine.dispatch({ type: 'HOTKEY', code: 'KeyM' });
  assert.equal(engine.getSnapshot().settings.sound, false);
  assert.equal(storage.getItem('musclecar.sound'), 'false');

  engine.dispatch({ type: 'HOTKEY', code: 'KeyQ' });
  assert.equal(engine.getSnapshot().settings.shadows, false);
  assert.equal(storage.getItem('musclecar.shadowsV3'), 'false');

  engine.dispatch({ type: 'HOTKEY', code: 'KeyY' });
  assert.equal(engine.getSnapshot().slowMotion, true);

  engine.dispatch({ type: 'HOTKEY', code: 'KeyI' });
  assert.equal(engine.getSnapshot().settings.cam, 4);
  assert.equal(engine.getSnapshot().inspecting, true);

  // Set Paint color
  engine.dispatch({ type: 'SET_PAINT', color: 0x1f62c7 });
  assert.equal(engine.getSnapshot().settings.paint, 0x1f62c7);
  assert.equal(storage.getItem('musclecar.paint'), String(0x1f62c7));

  // In-game 80 km/h crash test (KeyV) and Reset (KeyR)
  engine.dispatch({ type: 'HOTKEY', code: 'KeyV' });
  assert(Math.abs(engine.phys.u - 80 / 3.6) < 1e-6);
  assert.equal(engine.phys.gear, 3);

  engine.dispatch({ type: 'HOTKEY', code: 'KeyR' });
  assert.equal(engine.phys.speed, 0);
  assert.equal(engine.phys.x, -172);

  // Pause & Resume
  engine.dispatch({ type: 'PAUSE', paused: true });
  assert.equal(engine.getSnapshot().paused, true);
  engine.dispatch({ type: 'PAUSE', paused: false });
  assert.equal(engine.getSnapshot().paused, false);

  engine.dispose();
});

test('SoundEngine cleans up partial nodes and closes AudioContext when initialization throws midway', async () => {
  const prevWindow = (globalThis as { window?: unknown }).window;

  interface MockNode {
    connected: number;
    disconnected: number;
    started: number;
    stopped: number;
    connect: () => void;
    disconnect: () => void;
    start: () => void;
    stop: () => void;
    gain: { value: number; setTargetAtTime: () => void; setValueAtTime: () => void; exponentialRampToValueAtTime: () => void };
    frequency: { value: number; setTargetAtTime: () => void; setValueAtTime: () => void; exponentialRampToValueAtTime: () => void };
    Q: { value: number };
    type: string;
    curve: Float32Array | null;
    buffer: unknown;
    loop: boolean;
  }

  const createdNodes: MockNode[] = [];
  const makeNode = (): MockNode => {
    const node: MockNode = {
      connected: 0,
      disconnected: 0,
      started: 0,
      stopped: 0,
      connect() {
        this.connected++;
      },
      disconnect() {
        this.disconnected++;
      },
      start() {
        this.started++;
      },
      stop() {
        if (this.started === 0) {
          throw new Error('InvalidStateError: cannot call stop without start');
        }
        this.stopped++;
      },
      gain: {
        value: 0,
        setTargetAtTime: () => {},
        setValueAtTime: () => {},
        exponentialRampToValueAtTime: () => {},
      },
      frequency: {
        value: 0,
        setTargetAtTime: () => {},
        setValueAtTime: () => {},
        exponentialRampToValueAtTime: () => {},
      },
      Q: { value: 0 },
      type: 'lowpass',
      curve: null,
      buffer: null,
      loop: false,
    };
    createdNodes.push(node);
    return node;
  };

  let failAt: 'createWaveShaper' | 'createBuffer' | 'none' = 'createWaveShaper';
  const createdContexts: Array<{ state: string; closeCalls: number }> = [];

  class FakeAudioContext {
    public state = 'running';
    public closeCalls = 0;
    public sampleRate = 44100;
    public currentTime = 0;
    public destination = {};

    constructor() {
      createdContexts.push(this);
    }

    createGain() {
      return makeNode();
    }

    createDynamicsCompressor() {
      return makeNode();
    }

    createWaveShaper() {
      if (failAt === 'createWaveShaper') {
        throw new Error('Simulated createWaveShaper failure');
      }
      return makeNode();
    }

    createBiquadFilter() {
      return makeNode();
    }

    createOscillator() {
      return makeNode();
    }

    createBuffer(_channels: number, length: number) {
      if (failAt === 'createBuffer') {
        throw new Error('Simulated createBuffer failure after oscillators started');
      }
      return {
        getChannelData: () => new Float32Array(length),
      };
    }

    createBufferSource() {
      return makeNode();
    }

    async close(): Promise<void> {
      this.closeCalls++;
      await new Promise((r) => setTimeout(r, 5));
      this.state = 'closed';
    }
  }

  (globalThis as { window?: unknown }).window = { AudioContext: FakeAudioContext };

  try {
    // Case A: Failure in createWaveShaper() right after master & compressor creation
    const audioA = new SoundEngine();
    const okA = audioA.init(true);
    assert.equal(okA, false, 'init() must return false when createWaveShaper throws');
    assert.equal(audioA.ctx, null, 'ctx reference must be cleared after failed init');
    assert.equal(createdContexts.length, 1);

    await audioA.waitForClose();
    assert.equal(createdContexts[0].closeCalls, 1, 'Failed init() must call close() on the created AudioContext');
    assert.equal(createdContexts[0].state, 'closed', 'AudioContext created before failure must transition to closed');
    assert(
      createdNodes.every((n) => n.disconnected >= 1),
      'All partially created AudioNodes (master, compressor) must be disconnected on failure',
    );

    audioA.dispose();
    await audioA.waitForClose();
    assert.equal(createdContexts[0].closeCalls, 1, 'dispose() after failed init must not double-close AudioContext');

    // Case B: Failure in createBuffer() after 3 oscillators + LFO have already started
    createdNodes.length = 0;
    failAt = 'createBuffer';
    const audioB = new SoundEngine();
    const okB = audioB.init(true);
    assert.equal(okB, false, 'init() must return false when createBuffer throws');
    assert.equal(audioB.ctx, null);
    assert.equal(createdContexts.length, 2);

    await audioB.waitForClose();
    assert.equal(createdContexts[1].closeCalls, 1, 'Failed init() after oscillator start must close AudioContext');
    assert.equal(createdContexts[1].state, 'closed');
    const startedOscs = createdNodes.filter((n) => n.started > 0);
    assert.equal(startedOscs.length, 4, '3 engine oscillators + 1 LFO were started before createBuffer threw');
    assert(
      startedOscs.every((n) => n.stopped === 1 && n.disconnected >= 1),
      'All started oscillators must be stopped and disconnected when init() fails midway',
    );
  } finally {
    (globalThis as { window?: unknown }).window = prevWindow;
  }
});

