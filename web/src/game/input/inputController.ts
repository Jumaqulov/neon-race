// ---------------------------------------------------------------
// Input: keyboard, touch, gamepad
// ---------------------------------------------------------------
import type { GameInput, TouchControlKey } from '../../shared/types.ts';

export function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') return false;
  const el = target as HTMLElement;
  if (!el.tagName) return false;
  const tag = el.tagName.toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'DIALOG') {
    return true;
  }
  if (el.isContentEditable) return true;
  if (typeof el.closest === 'function' && el.closest('input, textarea, select, dialog, [role="dialog"]')) {
    return true;
  }
  return false;
}

export interface InputCallbacks {
  isStarted: () => boolean;
  onStart: () => void;
  onToggleKey: (code: string) => void;
  onInputReset?: () => void;
}

export class InputController {
  public readonly keys: Record<string, boolean> = {};
  public readonly touch: Record<TouchControlKey, number> = {
    throttle: 0,
    brake: 0,
    left: 0,
    right: 0,
    handbrake: 0,
  };
  private padCamWas = false;
  private attached = false;
  private readonly callbacks: InputCallbacks;

  private readonly handleKeyDown = (e: KeyboardEvent): void => {
    if (isInteractiveTarget(e.target)) return;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
      e.preventDefault();
    }
    const first = !this.callbacks.isStarted();
    if (first) {
      this.callbacks.onStart();
    } else if (!e.repeat) {
      this.callbacks.onToggleKey(e.code);
    }
    this.keys[e.code] = true;
  };

  private readonly handleKeyUp = (e: KeyboardEvent): void => {
    this.keys[e.code] = false;
  };

  private readonly handleBlur = (): void => {
    this.clearAll();
  };

  constructor(callbacks: InputCallbacks) {
    this.callbacks = callbacks;
  }

  attach(): void {
    if (this.attached || typeof window === 'undefined') return;
    this.attached = true;
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleBlur);
  }

  detach(): void {
    if (!this.attached || typeof window === 'undefined') return;
    this.attached = false;
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleBlur);
    this.clearAll();
  }

  clearAll(): void {
    for (const k of Object.keys(this.keys)) {
      this.keys[k] = false;
    }
    this.touch.throttle = 0;
    this.touch.brake = 0;
    this.touch.left = 0;
    this.touch.right = 0;
    this.touch.handbrake = 0;
    this.callbacks.onInputReset?.();
  }

  setTouch(control: TouchControlKey, active: boolean): void {
    if (active && !this.callbacks.isStarted()) {
      this.callbacks.onStart();
    }
    this.touch[control] = active ? 1 : 0;
  }

  readInput(): GameInput {
    const k = this.keys;
    let throttle = Math.max(k.KeyW || k.ArrowUp ? 1 : 0, this.touch.throttle);
    let brake = Math.max(k.KeyS || k.ArrowDown ? 1 : 0, this.touch.brake);
    let steer =
      (k.KeyA || k.ArrowLeft ? 1 : 0) -
      (k.KeyD || k.ArrowRight ? 1 : 0) +
      this.touch.left -
      this.touch.right;
    let handbrake = !!(k.Space || this.touch.handbrake);
    let analog = false;

    let pads: Array<Gamepad | null> = [];
    try {
      pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    } catch {
      // Keyboard and touch remain usable when gamepads are restricted.
    }

    for (const gp of pads) {
      if (!gp) continue;
      const ax = gp.axes[0] || 0;
      if (Math.abs(ax) > 0.12) {
        steer = -Math.sign(ax) * ((Math.abs(ax) - 0.12) / 0.88) ** 1.4;
        analog = true;
      }
      throttle = Math.max(throttle, gp.buttons[7] ? gp.buttons[7].value : 0);
      brake = Math.max(brake, gp.buttons[6] ? gp.buttons[6].value : 0);
      handbrake =
        handbrake ||
        !!(gp.buttons[0] && gp.buttons[0].pressed) ||
        !!(gp.buttons[2] && gp.buttons[2].pressed);
      const camBtn = !!(gp.buttons[3] && gp.buttons[3].pressed);
      if (camBtn && !this.padCamWas) this.callbacks.onToggleKey('KeyC');
      this.padCamWas = camBtn;
      break;
    }

    return {
      throttle,
      brake,
      steer: Math.max(-1, Math.min(1, steer)),
      handbrake,
      analog,
    };
  }
}
