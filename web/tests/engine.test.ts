import test from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from '../src/game/GameEngine.ts';
import { InputController, isInteractiveTarget } from '../src/game/input/inputController.ts';
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

test('Engine creation, snapshot subscription, and idempotent dispose()', () => {
  const storage = createMemoryStorage();
  const engine = new GameEngine({ headless: true, storage });
  let notifications = 0;
  const unsubscribe = engine.subscribe(() => {
    notifications++;
  });

  engine.init(null);
  assert.equal(engine.getSnapshot().ready, true);
  assert.equal(engine.getSnapshot().started, false);
  assert(notifications >= 1);

  // Calling dispose multiple times must be safe and idempotent
  engine.dispose();
  engine.dispose();

  const countBefore = notifications;
  engine.start(); // ignored after dispose
  assert.equal(notifications, countBefore);
  unsubscribe();
});

test('StrictMode mount -> unmount -> remount lifecycle leaves only one active engine', () => {
  const storage = createMemoryStorage();

  // First mount (StrictMode initial mount)
  const firstEngine = new GameEngine({ headless: true, storage });
  let firstUpdates = 0;
  firstEngine.subscribe(() => {
    firstUpdates++;
  });
  firstEngine.init(null);
  assert.equal(firstEngine.getSnapshot().ready, true);

  // StrictMode simulated unmount
  firstEngine.dispose();
  const frozenFirstUpdates = firstUpdates;

  // StrictMode simulated second mount
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

test('InputController clears pressed keys and touch state on clearAll() and ignores interactive form elements', () => {
  let started = false;
  const toggled: string[] = [];
  const input = new InputController({
    isStarted: () => started,
    onStart: () => {
      started = true;
    },
    onToggleKey: (code) => toggled.push(code),
  });

  input.keys.KeyW = true;
  input.keys.KeyA = true;
  input.setTouch('throttle', true);
  input.setTouch('handbrake', true);
  assert.equal(started, true);
  assert.equal(input.readInput().throttle, 1);
  assert.equal(input.readInput().steer, 1);
  assert.equal(input.readInput().handbrake, true);

  input.clearAll();
  const afterClear = input.readInput();
  assert.equal(afterClear.throttle, 0);
  assert.equal(afterClear.brake, 0);
  assert.equal(afterClear.steer, 0);
  assert.equal(afterClear.handbrake, false);

  // Verify interactive targets (input, textarea, dialog) are detected so hotkeys do not misfire
  assert.equal(isInteractiveTarget({ tagName: 'INPUT' } as unknown as EventTarget), true);
  assert.equal(isInteractiveTarget({ tagName: 'TEXTAREA' } as unknown as EventTarget), true);
  assert.equal(isInteractiveTarget({ tagName: 'DIALOG' } as unknown as EventTarget), true);
  assert.equal(isInteractiveTarget({ tagName: 'DIV', isContentEditable: true } as unknown as EventTarget), true);
  assert.equal(isInteractiveTarget({ tagName: 'DIV', isContentEditable: false } as unknown as EventTarget), false);
});

test('UI commands synchronize with GameEngine state and persist localStorage keys', () => {
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
