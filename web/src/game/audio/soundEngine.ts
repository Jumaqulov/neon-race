// ---------------------------------------------------------------
// Audio: synthesized V8, tyre squeal, wind, impacts
// ---------------------------------------------------------------
export interface AudioUpdateInput {
  rpm: number;
  thr: number;
  slipR: number;
  slipF: number;
  speed: number;
}

interface OscLayer {
  o: OscillatorNode;
  g: GainNode;
  mul: number;
}

interface NoiseLoopLayer {
  s: AudioBufferSourceNode;
  f: BiquadFilterNode;
  g: GainNode;
}

interface WebkitWindow extends Window {
  webkitAudioContext?: typeof AudioContext;
}

export class SoundEngine {
  public ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private out: DynamicsCompressorNode | null = null;
  private shaper: WaveShaperNode | null = null;
  private lp: BiquadFilterNode | null = null;
  private eng: GainNode | null = null;
  private oscs: OscLayer[] = [];
  private lfo: OscillatorNode | null = null;
  private lfoG: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private skid: NoiseLoopLayer | null = null;
  private wind: NoiseLoopLayer | null = null;
  private readonly oneShots = new Set<AudioScheduledSourceNode>();
  private closePromise: Promise<void> | null = null;
  private disposed = false;

  isDisposed(): boolean {
    return this.disposed;
  }

  waitForClose(): Promise<void> {
    return this.closePromise ?? Promise.resolve();
  }

  init(soundEnabled: boolean): boolean {
    if (this.disposed) return false;
    if (this.ctx) {
      if (this.ctx.state === 'suspended') {
        const ctxRef = this.ctx;
        void ctxRef
          .resume()
          .then(() => {
            if (this.disposed && ctxRef.state !== 'closed') {
              void ctxRef.close().catch(() => {});
            }
          })
          .catch(() => {});
      }
      return true;
    }
    if (typeof window === 'undefined') return false;
    const win = window as WebkitWindow;
    const AC = window.AudioContext || win.webkitAudioContext;
    if (!AC) return false;

    try {
      const c = (this.ctx = new AC());
      this.master = c.createGain();
      this.master.gain.value = soundEnabled ? 0.5 : 0;
      const comp = c.createDynamicsCompressor();
      comp.connect(this.master);
      this.master.connect(c.destination);
      this.out = comp;

      const shaper = c.createWaveShaper();
      const curve = new Float32Array(1024);
      for (let i = 0; i < 1024; i++) curve[i] = Math.tanh((i / 511.5 - 1) * 2.2);
      shaper.curve = curve;
      this.shaper = shaper;

      this.lp = c.createBiquadFilter();
      this.lp.type = 'lowpass';
      this.lp.Q.value = 2.5;
      this.eng = c.createGain();
      this.eng.gain.value = 0;

      const specs: Array<[OscillatorType, number, number]> = [
        ['sawtooth', 1, 0.45],
        ['sawtooth', 0.5, 0.5],
        ['square', 2.01, 0.08],
      ];
      this.oscs = specs.map(([type, mul, gain]) => {
        const o = c.createOscillator();
        const g = c.createGain();
        o.type = type;
        g.gain.value = gain;
        o.connect(g);
        g.connect(shaper);
        o.start();
        return { o, g, mul };
      });

      shaper.connect(this.lp);
      this.lp.connect(this.eng);
      this.eng.connect(comp);

      this.lfo = c.createOscillator();
      this.lfoG = c.createGain();
      this.lfoG.gain.value = 0;
      this.lfo.connect(this.lfoG);
      this.lfoG.connect(this.eng.gain);
      this.lfo.start();

      const buf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this.noise = buf;

      const loop = (filterType: BiquadFilterType, freq: number, q: number): NoiseLoopLayer => {
        const s = c.createBufferSource();
        const f = c.createBiquadFilter();
        const g = c.createGain();
        s.buffer = buf;
        s.loop = true;
        f.type = filterType;
        f.frequency.value = freq;
        f.Q.value = q;
        g.gain.value = 0;
        s.connect(f);
        f.connect(g);
        g.connect(comp);
        s.start(0, Math.random());
        return { s, f, g };
      };

      this.skid = loop('bandpass', 1100, 6);
      this.wind = loop('lowpass', 380, 0.7);
      return true;
    } catch {
      this.ctx = null;
      return false;
    }
  }

  update(p: AudioUpdateInput): void {
    if (this.disposed || !this.ctx || !this.lp || !this.eng || !this.lfo || !this.lfoG || !this.skid || !this.wind) {
      return;
    }
    const t = this.ctx.currentTime;
    const f = (p.rpm / 60) * 4; // V8 firing frequency
    for (const { o, mul } of this.oscs) o.frequency.setTargetAtTime(f * mul, t, 0.015);
    this.lp.frequency.setTargetAtTime(260 + p.thr * 1500 + p.rpm * 0.16, t, 0.04);
    this.eng.gain.setTargetAtTime(0.13 + p.thr * 0.2, t, 0.05);
    this.lfo.frequency.setTargetAtTime(f * 0.25, t, 0.05);
    this.lfoG.gain.setTargetAtTime(p.thr < 0.1 ? 0.06 : 0.015, t, 0.1);
    const slip = Math.max(p.slipR, p.slipF * 0.8) * Math.min(1, p.speed / 4);
    this.skid.g.gain.setTargetAtTime(slip * 0.2, t, 0.04);
    this.skid.f.frequency.setTargetAtTime(850 + slip * 450 + p.speed * 3, t, 0.05);
    this.wind.g.gain.setTargetAtTime(Math.min(0.22, p.speed * p.speed * 0.00005), t, 0.1);
  }

  thud(j: number): void {
    if (this.disposed || !this.ctx || !this.noise || !this.out) return;
    const c = this.ctx;
    const s = c.createBufferSource();
    const f = c.createBiquadFilter();
    const g = c.createGain();
    const t = c.currentTime;
    s.buffer = this.noise;
    f.type = 'lowpass';
    f.frequency.value = 240;
    g.gain.setValueAtTime(Math.min(1, j / 12000), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    s.connect(f);
    f.connect(g);
    g.connect(this.out);
    this.oneShots.add(s);
    s.start(t, Math.random());
    s.stop(t + 0.45);
    s.onended = () => {
      this.oneShots.delete(s);
      s.disconnect();
      f.disconnect();
      g.disconnect();
    };
  }

  glass(): void {
    if (this.disposed || !this.ctx || !this.noise || !this.out) return;
    const c = this.ctx;
    const t = c.currentTime;
    const s = c.createBufferSource();
    const f = c.createBiquadFilter();
    const g = c.createGain();
    s.buffer = this.noise;
    f.type = 'highpass';
    f.frequency.value = 2300;
    g.gain.setValueAtTime(0.15, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.30);
    s.connect(f);
    f.connect(g);
    g.connect(this.out);
    this.oneShots.add(s);
    s.start(t);
    s.stop(t + 0.33);
    s.onended = () => {
      this.oneShots.delete(s);
      s.disconnect();
      f.disconnect();
      g.disconnect();
    };
  }

  cone(sp: number): void {
    if (this.disposed || !this.ctx || !this.out) return;
    const c = this.ctx;
    const o = c.createOscillator();
    const g = c.createGain();
    const t = c.currentTime;
    o.type = 'triangle';
    o.frequency.setValueAtTime(380, t);
    o.frequency.exponentialRampToValueAtTime(140, t + 0.12);
    g.gain.setValueAtTime(Math.min(0.35, 0.08 + sp * 0.01), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    o.connect(g);
    g.connect(this.out);
    this.oneShots.add(o);
    o.start(t);
    o.stop(t + 0.18);
    o.onended = () => {
      this.oneShots.delete(o);
      o.disconnect();
      g.disconnect();
    };
  }

  setEnabled(on: boolean): void {
    if (this.disposed) return;
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(on ? 0.5 : 0, this.ctx.currentTime, 0.05);
    }
  }

  suspend(): void {
    if (this.disposed) return;
    if (this.ctx && this.ctx.state === 'running') {
      void this.ctx.suspend().catch(() => {});
    }
  }

  resume(): void {
    if (this.disposed) return;
    if (this.ctx && this.ctx.state === 'suspended') {
      const ctxRef = this.ctx;
      void ctxRef
        .resume()
        .then(() => {
          if (this.disposed && ctxRef.state !== 'closed') {
            void ctxRef.close().catch(() => {});
          }
        })
        .catch(() => {});
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const { o, g } of this.oscs) {
      try {
        o.stop();
        o.disconnect();
        g.disconnect();
      } catch {
        // already stopped
      }
    }
    this.oscs = [];
    for (const node of this.oneShots) {
      try {
        node.stop();
        node.disconnect();
      } catch {
        // ignore
      }
    }
    this.oneShots.clear();
    if (this.lfo) {
      try {
        this.lfo.stop();
        this.lfo.disconnect();
      } catch {
        // ignore
      }
      this.lfo = null;
    }
    if (this.lfoG) {
      try {
        this.lfoG.disconnect();
      } catch {
        // ignore
      }
      this.lfoG = null;
    }
    for (const layer of [this.skid, this.wind]) {
      if (layer) {
        try {
          layer.s.stop();
          layer.s.disconnect();
          layer.f.disconnect();
          layer.g.disconnect();
        } catch {
          // ignore
        }
      }
    }
    this.skid = null;
    this.wind = null;
    for (const node of [this.shaper, this.lp, this.eng, this.out, this.master]) {
      if (node) {
        try {
          node.disconnect();
        } catch {
          // ignore
        }
      }
    }
    this.shaper = null;
    this.lp = null;
    this.eng = null;
    this.out = null;
    this.master = null;
    this.noise = null;
    if (this.ctx) {
      const c = this.ctx;
      this.ctx = null;
      this.closePromise = c.close().catch(() => {});
    }
  }
}
