import type { CarPhysics } from '../physics/carPhysics.ts';

export class GaugeRenderer {
  private clusterCv: HTMLCanvasElement | null = null;
  private clusterCtx: CanvasRenderingContext2D | null = null;
  private gCv: HTMLCanvasElement | null = null;
  private gCtx: CanvasRenderingContext2D | null = null;
  private clusterSize = 250;
  private gSize = 92;
  private dpr = 1;
  private readonly gTrail: Array<[number, number]> = [];

  setCanvases(clusterCv: HTMLCanvasElement | null, gCv: HTMLCanvasElement | null): void {
    this.clusterCv = clusterCv;
    this.clusterCtx = clusterCv ? clusterCv.getContext('2d') : null;
    this.gCv = gCv;
    this.gCtx = gCv ? gCv.getContext('2d') : null;
    this.resize();
  }

  resize(): void {
    this.dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
    if (this.clusterCv) {
      this.clusterSize = this.fitCanvas(this.clusterCv) || 250;
    }
    if (this.gCv) {
      this.gSize = this.fitCanvas(this.gCv) || 92;
    }
  }

  private fitCanvas(cv: HTMLCanvasElement): number {
    const r = cv.getBoundingClientRect();
    const w = r.width || cv.clientWidth || 100;
    const h = r.height || cv.clientHeight || 100;
    cv.width = Math.round(w * this.dpr);
    cv.height = Math.round(h * this.dpr);
    return w;
  }

  draw(phys: CarPhysics, mph: boolean, touchMode: boolean): void {
    this.drawCluster(phys, mph);
    if (!touchMode) {
      this.drawGMeter(phys);
    }
  }

  private drawCluster(phys: CarPhysics, mph: boolean): void {
    const c = this.clusterCtx;
    if (!c) return;
    const S = this.clusterSize;
    const cx = S / 2;
    const cy = S / 2;
    const R = S * 0.45;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, S, S);
    const MAX = 8000;
    const A0 = Math.PI * 0.75;
    const A1 = Math.PI * 2.25;
    const ang = (r: number) => A0 + ((A1 - A0) * Math.min(r, MAX)) / MAX;
    const face = c.createRadialGradient(cx, cy - R * 0.3, R * 0.1, cx, cy, R * 1.05);
    face.addColorStop(0, 'rgba(30,33,40,.94)');
    face.addColorStop(1, 'rgba(8,9,12,.94)');
    c.beginPath();
    c.arc(cx, cy, R * 1.04, 0, Math.PI * 2);
    c.fillStyle = face;
    c.fill();
    c.lineWidth = 1.5;
    c.strokeStyle = 'rgba(255,255,255,.14)';
    c.stroke();

    const rpm = phys.rpm;
    const hot = rpm > phys.p.upRpm;
    c.lineCap = 'butt';
    c.beginPath();
    c.arc(cx, cy, R * 0.9, ang(phys.p.redline), A1);
    c.lineWidth = R * 0.06;
    c.strokeStyle = 'rgba(255,59,48,.75)';
    c.stroke();
    c.beginPath();
    c.arc(cx, cy, R * 0.9, A0, ang(rpm));
    c.lineWidth = R * 0.06;
    c.strokeStyle = hot ? 'rgba(255,80,60,.95)' : 'rgba(255,178,26,.9)';
    c.stroke();

    for (let r = 0; r <= MAX; r += 250) {
      const a = ang(r);
      const major = r % 1000 === 0;
      const r0 = R * (major ? 0.76 : 0.82);
      const r1 = R * 0.97;
      c.beginPath();
      c.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      c.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      c.lineWidth = major ? 2.4 : 1.1;
      c.strokeStyle = r >= phys.p.redline ? '#ff5a4f' : major ? '#e8ecf1' : 'rgba(232,236,241,.4)';
      c.stroke();
      if (major) {
        c.fillStyle = r >= phys.p.redline ? '#ff6b61' : '#cfd5dc';
        c.font = `600 ${R * 0.14}px "Saira Semi Condensed", system-ui, sans-serif`;
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(String(r / 1000), cx + Math.cos(a) * R * 0.62, cy + Math.sin(a) * R * 0.62);
      }
    }

    // indicator pills
    const pills: Array<[string, 'on' | 'warn' | 'red' | 'off']> = [
      ['TCS', !phys.p.tcs ? 'off' : phys.tcsActive ? 'warn' : 'on'],
      ['HB', phys.hb ? 'red' : 'off'],
      ['LIM', phys.limiter ? 'red' : 'off'],
    ];
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    const colors: Record<'on' | 'warn' | 'red' | 'off', string> = {
      on: '#34d17a',
      warn: now % 300 < 150 ? '#ffb21a' : '#5a4310',
      red: '#ff3b30',
      off: 'rgba(255,255,255,.18)',
    };
    c.font = `700 ${R * 0.085}px "Saira Semi Condensed", system-ui, sans-serif`;
    pills.forEach(([label, st], i) => {
      const x = cx + (i - 1) * R * 0.3;
      const y = cy - R * 0.36;
      c.fillStyle = colors[st];
      c.fillText(label, x, y);
    });

    // needle
    const a = ang(rpm);
    c.save();
    c.shadowColor = 'rgba(255,90,30,.8)';
    c.shadowBlur = 10;
    c.beginPath();
    c.moveTo(cx + Math.cos(a) * R * 0.2, cy + Math.sin(a) * R * 0.2);
    c.lineTo(cx + Math.cos(a) * R * 0.92, cy + Math.sin(a) * R * 0.92);
    c.lineWidth = 3;
    c.lineCap = 'round';
    c.strokeStyle = '#ff5a1f';
    c.stroke();
    c.restore();

    // hub with gear
    c.beginPath();
    c.arc(cx, cy, R * 0.19, 0, Math.PI * 2);
    c.fillStyle = '#0b0c0f';
    c.fill();
    c.lineWidth = 2;
    c.strokeStyle = hot ? '#ff5a1f' : 'rgba(255,178,26,.65)';
    c.stroke();
    const gear = phys.gear < 0 ? 'R' : phys.speed < 0.3 && phys.thr < 0.05 ? 'N' : String(phys.gear);
    c.fillStyle = phys.gear < 0 ? '#ff6b61' : '#ffb21a';
    c.font = `800 ${R * 0.24}px "Saira Semi Condensed", system-ui, sans-serif`;
    c.fillText(gear, cx, cy + R * 0.01);

    // speed
    const v = Math.round(phys.speed * (mph ? 2.23694 : 3.6));
    c.fillStyle = '#f4f6f8';
    c.font = `800 ${R * 0.34}px "Saira Semi Condensed", system-ui, sans-serif`;
    c.fillText(String(v), cx, cy + R * 0.56);
    c.fillStyle = '#8f98a3';
    c.font = `600 ${R * 0.09}px "Saira Semi Condensed", system-ui, sans-serif`;
    c.fillText(mph ? 'MPH' : 'KM/H', cx, cy + R * 0.8);
  }

  private drawGMeter(phys: CarPhysics): void {
    const c = this.gCtx;
    if (!c) return;
    const S = this.gSize;
    const cx = S / 2;
    const cy = S / 2;
    const R = S * 0.44;
    const G = 9.81;
    const scale = R / 1.25;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, S, S);
    c.strokeStyle = 'rgba(255,255,255,.14)';
    c.lineWidth = 1;
    for (const g of [0.5, 1]) {
      c.beginPath();
      c.arc(cx, cy, g * scale, 0, Math.PI * 2);
      c.stroke();
    }
    c.beginPath();
    c.moveTo(cx - R, cy);
    c.lineTo(cx + R, cy);
    c.moveTo(cx, cy - R);
    c.lineTo(cx, cy + R);
    c.stroke();
    const x = cx + Math.max(-1.25, Math.min(1.25, -phys.ay / G)) * scale;
    const y = cy + Math.max(-1.25, Math.min(1.25, phys.ax / G)) * scale;
    this.gTrail.push([x, y]);
    if (this.gTrail.length > 24) this.gTrail.shift();
    this.gTrail.forEach(([tx, ty], i) => {
      c.fillStyle = `rgba(255,178,26,${(i / this.gTrail.length) * 0.35})`;
      c.beginPath();
      c.arc(tx, ty, 2, 0, 7);
      c.fill();
    });
    c.fillStyle = '#ffb21a';
    c.shadowColor = '#ffb21a';
    c.shadowBlur = 8;
    c.beginPath();
    c.arc(x, y, 4.5, 0, 7);
    c.fill();
    c.shadowBlur = 0;
  }
}
