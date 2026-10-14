export interface GameInput {
  throttle?: number;
  brake?: number;
  steer?: number;
  handbrake?: boolean;
  analog?: boolean;
}

export type TurnSignalMode = 'off' | 'left' | 'right';
export type QualityMode = 'auto' | 'high' | 'medium' | 'low';
export type SurfaceType = 'concrete' | 'tyres' | 'pole';
export type DamageZoneName = 'front' | 'rear' | 'left' | 'right';
export type TouchControlKey = 'throttle' | 'brake' | 'left' | 'right' | 'handbrake';

export interface GameSettings {
  cam: number;
  tcs: boolean;
  lights: boolean;
  night: boolean;
  markers: boolean;
  turn: TurnSignalMode;
  hazards: boolean;
  shadows: boolean;
  sound: boolean;
  mph: boolean;
  paint: number;
}

export interface DamageZones {
  front: number;
  rear: number;
  left: number;
  right: number;
}

export interface WheelDamageOffset {
  toe: number;
  camber: number;
  inset: number;
}

export interface ImpactEvent {
  px: number;
  py: number;
  nx: number;
  ny: number;
  localX: number;
  localZ: number;
  localNX: number;
  localNZ: number;
  impulse: number;
  normalSpeed: number;
  energy: number;
  surface: SurfaceType;
  height: number;
  deltaV: number;
  beforeVX: number;
  beforeVY: number;
  beforeR: number;
  postVX: number;
  postVY: number;
}

export interface CrushHit {
  x: number;
  y: number;
  z: number;
  nx: number;
  nz: number;
  width: number;
  height: number;
  reach: number;
  depth: number;
  energy: number;
  surface: SurfaceType;
}

export interface LastImpactSummary {
  zone: DamageZoneName;
  severity: 'Light' | 'Moderate' | 'Heavy';
  energy: number;
  normalSpeed: number;
  depth: number;
  newCrush: number;
}

export interface DamageState {
  conditionPercent: number;
  zones: DamageZones;
  engineHealthPercent: number;
  steeringStatusText: 'Yaxshi' | 'Shikastlangan' | 'Og‘ir shikast';
  intactHeadlamps: number;
  totalHeadlamps: number;
  exhaustLoadPercent: number;
  exhaustLoadRatio: number;
  damageStateText: string;
  impactNoteText: string;
  recentImpactFlash: boolean;
  leftSignalLit: boolean;
  rightSignalLit: boolean;
}

export interface DriftHudState {
  visible: boolean;
  mode: '' | 'banked' | 'crashed';
  label: string;
  pointsText: string;
  multText: string;
  subText: string;
  best: number;
  total: number;
}

export interface ClusterTelemetry {
  rpm: number;
  upRpm: number;
  redline: number;
  gear: number;
  speed: number;
  thr: number;
  tcsEnabled: boolean;
  tcsActive: boolean;
  hb: boolean;
  limiter: boolean;
  mph: boolean;
  ax: number;
  ay: number;
}

export interface GameSnapshot {
  ready: boolean;
  started: boolean;
  paused: boolean;
  slowMotion: boolean;
  helpOpen: boolean;
  touchMode: boolean;
  inspecting: boolean;
  error: string | null;
  loadingStatus: string;
  toastMessage: string | null;
  settings: GameSettings;
  camLabel: string;
  qualityLabel: string;
  performanceText: string;
  gForceText: string;
  conesHit: number;
  bestDrift: number;
  damage: DamageState;
  drift: DriftHudState;
  telemetry: ClusterTelemetry;
}

export type GameCommand =
  | { type: 'START' }
  | { type: 'HOTKEY'; code: string }
  | { type: 'SET_PAINT'; color: number }
  | { type: 'TOUCH_INPUT'; control: TouchControlKey; active: boolean }
  | { type: 'TOGGLE_HELP' }
  | { type: 'PAUSE'; paused?: boolean };

export const PAINTS: ReadonlyArray<readonly [number, string]> = [
  [0xc8102e, 'Candy red'],
  [0x1f62c7, 'Grabber blue'],
  [0x1f4d36, 'Highland green'],
  [0xf0b400, 'School-bus yellow'],
  [0xe4571d, 'Competition orange'],
  [0x5a2a86, 'Plum crazy'],
  [0x111214, 'Tuxedo black'],
  [0xeeeeea, 'Wimbledon white'],
];

export const CAMS: readonly string[] = ['Chase', 'Far chase', 'Hood', 'Orbit', 'Inspect'];
export const START_POSE: readonly [number, number, number] = [-172, 0, 0];
export const ARENA = 200;
