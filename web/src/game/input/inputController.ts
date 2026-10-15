// ---------------------------------------------------------------
// Input: keyboard, touch, gamepad
// ---------------------------------------------------------------
import type { GameInput, TouchControlKey } from '../../shared/types.ts';

const INTERACTIVE_TAGS = new Set([
  'BUTTON',
  'INPUT',
  'TEXTAREA',
  'SELECT',
  'DIALOG',
  'SUMMARY',
  'OPTION',
  'OPTGROUP',
  'A',
]);

const INTERACTIVE_ROLES = new Set([
  'button',
  'link',
  'checkbox',
  'switch',
  'radio',
  'menuitem',
  'tab',
  'textbox',
  'combobox',
  'listbox',
  'slider',
  'spinbutton',
  'dialog',
  'alertdialog',
]);

const INTERACTIVE_SELECTOR = [
  'button',
  'input',
  'textarea',
  'select',
  'dialog',
  'summary',
  'a[href]',
  '[contenteditable="true"]',
  '[contenteditable=""]',
  '[role="button"]',
  '[role="link"]',
  '[role="checkbox"]',
  '[role="switch"]',
  '[role="radio"]',
  '[role="menuitem"]',
  '[role="tab"]',
  '[role="textbox"]',
  '[role="combobox"]',
  '[role="listbox"]',
  '[role="slider"]',
  '[role="spinbutton"]',
  '[role="dialog"]',
  '[role="alertdialog"]',
].join(', ');

interface ElementLike {
  tagName?: string;
  isContentEditable?: boolean;
  contentEditable?: string;
  role?: string;
  getAttribute?: (name: string) => string | null;
  closest?: (selector: string) => Element | null;
  parentElement?: ElementLike | null;
  parentNode?: ElementLike | null;
}

function isSingleNodeInteractive(node: ElementLike): boolean {
  if (node.isContentEditable === true) return true;
  if (node.contentEditable === 'true' || node.contentEditable === '') return true;
  if (typeof node.getAttribute === 'function') {
    const ce = node.getAttribute('contenteditable');
    if (ce === 'true' || ce === '') return true;
    const roleAttr = node.getAttribute('role')?.toLowerCase();
    if (roleAttr && INTERACTIVE_ROLES.has(roleAttr)) return true;
  }
  if (typeof node.role === 'string' && INTERACTIVE_ROLES.has(node.role.toLowerCase())) {
    return true;
  }
  if (typeof node.tagName === 'string' && node.tagName.length > 0) {
    const tag = node.tagName.toUpperCase();
    if (tag === 'A') {
      if (typeof node.getAttribute === 'function') {
        return node.getAttribute('href') !== null;
      }
      return true;
    }
    if (INTERACTIVE_TAGS.has(tag)) return true;
  }
  return false;
}

export function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') return false;
  let current: ElementLike | null = target as ElementLike;

  if (typeof current.closest === 'function') {
    const matched = current.closest(INTERACTIVE_SELECTOR);
    if (matched) return true;
  }

  let depth = 0;
  while (current && depth < 32) {
    if (isSingleNodeInteractive(current)) return true;
    current = current.parentElement ?? current.parentNode ?? null;
    depth++;
  }
  return false;
}

export interface InputCallbacks {
  isStarted: () => boolean;
  onStart: () => void;
  onToggleKey: (code: string) => void;
  onInputReset?: () => void;
}

const TOUCH_KEYS: readonly TouchControlKey[] = ['throttle', 'brake', 'left', 'right', 'handbrake', 'boost'];

export class InputController {
  public readonly keys: Record<string, boolean> = {};
  public readonly touch: Record<TouchControlKey, number> = {
    throttle: 0,
    brake: 0,
    left: 0,
    right: 0,
    handbrake: 0,
    boost: 0,
  };
  private padCamWas = false;
  private attached = false;
  private readonly callbacks: InputCallbacks;

  private readonly handleKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'Tab') return;
    const activeEl = typeof document !== 'undefined' ? document.activeElement : null;
    if (isInteractiveTarget(e.target) || isInteractiveTarget(activeEl)) {
      return;
    }
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

  private readonly handleFocusIn = (e: FocusEvent): void => {
    if (isInteractiveTarget(e.target)) {
      this.clearKeys();
    }
  };

  private readonly handleBlur = (): void => {
    this.clearAll();
  };

  private readonly handleVisibilityChange = (): void => {
    if (typeof document !== 'undefined' && document.hidden) {
      this.clearAll();
    }
  };

  private readonly handlePointerCancel = (): void => {
    this.clearTouch();
  };

  private readonly handleLostPointerCapture = (e: PointerEvent): void => {
    const target = e.target as HTMLElement | null;
    const attr = target?.getAttribute?.('data-t') as TouchControlKey | null | undefined;
    if (attr && TOUCH_KEYS.includes(attr)) {
      this.touch[attr] = 0;
      this.callbacks.onInputReset?.();
    }
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
    window.addEventListener('pointercancel', this.handlePointerCancel);
    window.addEventListener('lostpointercapture', this.handleLostPointerCapture);
    if (typeof document !== 'undefined') {
      document.addEventListener('focusin', this.handleFocusIn);
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
    }
  }

  detach(): void {
    if (!this.attached || typeof window === 'undefined') return;
    this.attached = false;
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleBlur);
    window.removeEventListener('pointercancel', this.handlePointerCancel);
    window.removeEventListener('lostpointercapture', this.handleLostPointerCapture);
    if (typeof document !== 'undefined') {
      document.removeEventListener('focusin', this.handleFocusIn);
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    }
    this.clearAll();
  }

  clearKeys(): void {
    let changed = false;
    for (const k of Object.keys(this.keys)) {
      if (this.keys[k]) {
        this.keys[k] = false;
        changed = true;
      }
    }
    if (changed) {
      this.callbacks.onInputReset?.();
    }
  }

  clearTouch(): void {
    let changed = false;
    for (const key of TOUCH_KEYS) {
      if (this.touch[key] !== 0) {
        this.touch[key] = 0;
        changed = true;
      }
    }
    if (changed) {
      this.callbacks.onInputReset?.();
    }
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
