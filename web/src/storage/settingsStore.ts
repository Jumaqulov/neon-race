import { CAMS, type GameSettings } from '../shared/types.ts';
import { clamp } from '../game/physics/carPhysics.ts';

export interface StorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function getDefaultStorage(): StorageAdapter | null {
  try {
    if (typeof localStorage !== 'undefined' && localStorage !== null) {
      return localStorage;
    }
  } catch {
    // localStorage may be blocked or unavailable
  }
  return null;
}

export const store = {
  get<T>(key: string, fallback: T, storage: StorageAdapter | null = getDefaultStorage()): T {
    try {
      if (!storage) return fallback;
      const raw = storage.getItem('musclecar.' + key);
      return raw === null ? fallback : (JSON.parse(raw) as T);
    } catch {
      return fallback;
    }
  },
  set<T>(key: string, value: T, storage: StorageAdapter | null = getDefaultStorage()): void {
    try {
      if (!storage) return;
      storage.setItem('musclecar.' + key, JSON.stringify(value));
    } catch {
      // storage unavailable
    }
  },
};

export function loadInitialSettings(storage?: StorageAdapter | null): GameSettings {
  return {
    cam: clamp(Math.round(Number(store.get('cam', 0, storage))) || 0, 0, CAMS.length - 1),
    tcs: Boolean(store.get('tcs', true, storage)),
    lights: false,
    night: false,
    markers: true,
    turn: 'off',
    hazards: false,
    shadows: store.get<boolean>('shadowsV3', true, storage) !== false,
    sound: Boolean(store.get<boolean>('sound', true, storage)),
    mph: Boolean(store.get<boolean>('mph', false, storage)),
    paint: Number(store.get('paint', 0xc8102e, storage)) || 0xc8102e,
  };
}
