import { useEffect, useRef } from 'react';
import type { GameEngine } from '../game/GameEngine.ts';
import type { GameSnapshot } from '../shared/types.ts';

export interface GameHudProps {
  snapshot: GameSnapshot;
  engine: GameEngine | null;
}

const fmt = (n: number): string => Math.round(n).toLocaleString('en-US');

export function GameHud({ snapshot, engine }: GameHudProps) {
  const clusterRef = useRef<HTMLCanvasElement | null>(null);
  const gMeterRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!engine) return;
    engine.setGaugeCanvases(clusterRef.current, gMeterRef.current);
    return () => {
      engine.setGaugeCanvases(null, null);
    };
  }, [engine]);

  const { damage, drift, paused, slowMotion, gForceText, conesHit, bestDrift, toastMessage } = snapshot;

  const frontPct = Math.round(damage.zones.front * 100);
  const rearPct = Math.round(damage.zones.rear * 100);
  const leftPct = Math.round(damage.zones.left * 100);
  const rightPct = Math.round(damage.zones.right * 100);

  const driftClasses = [
    'panel',
    drift.visible ? 'show' : '',
    drift.mode === 'banked' ? 'banked' : '',
    drift.mode === 'crashed' ? 'crashed' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <>
      <div id="brand" className="panel">
        <div className="dot" />
        <b>Proving Ground</b>
        <span>
          <kbd>H</kbd> controls
        </span>
      </div>

      <div id="help" className="panel">
        <div>
          <kbd>W</kbd> <kbd>↑</kbd>
        </div>
        <span>Gaz</span>
        <div>
          <kbd>S</kbd> <kbd>↓</kbd>
        </div>
        <span>Brake · hold when stopped to reverse</span>
        <div>
          <kbd>A</kbd> <kbd>D</kbd> <kbd>←</kbd> <kbd>→</kbd>
        </div>
        <span>Rul</span>
        <div>
          <kbd>Space</kbd>
        </div>
        <span>Qo‘l tormozi</span>
        <div>
          <kbd>T</kbd>
        </div>
        <span>Traction control (off = power slides)</span>
        <div>
          <kbd>C</kbd> <kbd>L</kbd> <kbd>N</kbd>
        </div>
        <span>Camera · headlights · day / night</span>
        <div>
          <kbd>P</kbd> <kbd>U</kbd> <kbd>M</kbd>
        </div>
        <span>Paint · units · sound</span>
        <div>
          <kbd>R</kbd>
        </div>
        <span>Reset car and cones</span>
        <div>
          <kbd>O</kbd> <kbd>Z</kbd> <kbd>X</kbd> <kbd>B</kbd>
        </div>
        <span>Side lights · left / right indicators · hazards</span>
        <div>
          <kbd>I</kbd> <kbd>F</kbd>
        </div>
        <span>Inspect / drag / zoom · repair body and lamps</span>
        <div>
          <kbd>V</kbd> <kbd>Q</kbd>
        </div>
        <span>In-game crash test · shadows on / off</span>
        <div>Gamepad</div>
        <span>Stick steer · RT / LT · A handbrake · Y camera</span>
      </div>

      <section
        id="damagepanel"
        className={`panel${damage.recentImpactFlash ? ' impact' : ''}`}
        aria-label="Vehicle body condition"
      >
        <div className="damage-heading">
          KUZOV HOLATI{' '}
          <div className="signals">
            <span id="left-signal" className={damage.leftSignalLit ? 'lit' : ''}>
              ◀
            </span>
            <span id="right-signal" className={damage.rightSignalLit ? 'lit' : ''}>
              ▶
            </span>
          </div>
        </div>
        <div className="condition-line">
          <b id="condition">{damage.conditionPercent}%</b>
          <span id="damage-state">{damage.damageStateText}</span>
        </div>
        <div className="zone">
          <span>Old</span>
          <div
            className="zone-track"
            role="progressbar"
            aria-label="Front damage"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={frontPct}
          >
            <i id="zone-front" style={{ width: `${damage.zones.front * 100}%` }} />
          </div>
        </div>
        <div className="zone">
          <span>Orqa</span>
          <div
            className="zone-track"
            role="progressbar"
            aria-label="Rear damage"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={rearPct}
          >
            <i id="zone-rear" style={{ width: `${damage.zones.rear * 100}%` }} />
          </div>
        </div>
        <div className="zone">
          <span>Chap</span>
          <div
            className="zone-track"
            role="progressbar"
            aria-label="Left damage"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={leftPct}
          >
            <i id="zone-left" style={{ width: `${damage.zones.left * 100}%` }} />
          </div>
        </div>
        <div className="zone">
          <span>O‘ng</span>
          <div
            className="zone-track"
            role="progressbar"
            aria-label="Right damage"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={rightPct}
          >
            <i id="zone-right" style={{ width: `${damage.zones.right * 100}%` }} />
          </div>
        </div>
        <div className="telemetry">
          <span>Dvigatel</span>
          <b id="engine-health">{damage.engineHealthPercent}%</b>
        </div>
        <div className="telemetry">
          <span>Rul holati</span>
          <b id="steering-health">{damage.steeringStatusText}</b>
        </div>
        <div className="telemetry">
          <span>Faralar</span>
          <b id="headlamp-count">
            {damage.intactHeadlamps} / {damage.totalHeadlamps}
          </b>
        </div>
        <div className="telemetry">
          <span>Egzoz yuki</span>
          <b id="exhaust-load">{damage.exhaustLoadPercent}%</b>
        </div>
        <div className="exhaust-track">
          <i id="exhaust-fill" style={{ width: `${damage.exhaustLoadRatio * 100}%` }} />
        </div>
        <div id="impact-note">{damage.impactNoteText}</div>
      </section>

      <div id="inspect-hint" className="panel">
        Drag to rotate · Scroll to zoom · <kbd>I</kbd> driving view · <kbd>F</kbd> repair
      </div>

      <div id="pauseflag" className={`panel${paused ? ' show' : ''}`}>
        PAUZA <span>Davom etish uchun Esc</span>
      </div>
      <div id="slowflag" className={`panel${slowMotion && !paused ? ' show' : ''}`}>
        0.25× · SEKIN HARAKAT
      </div>

      <div id="drift" className={driftClasses}>
        <div id="dlbl">{drift.label}</div>
        <div>
          <span id="dpts">{drift.pointsText}</span>
          <span id="dmult">{drift.multText}</span>
        </div>
        <div id="dsub">{drift.subText}</div>
      </div>

      <div id="gwrap" className="panel">
        <canvas id="gmeter" ref={gMeterRef} />
        <div className="stats">
          <span>Yuklanish</span>
          <b id="gval">{gForceText}</b>
          <span>Konuslar</span>
          <b id="cones">{conesHit}</b>
          <span>Eng yaxshi drift</span>
          <b id="best">{fmt(bestDrift)}</b>
        </div>
      </div>

      <canvas id="cluster" ref={clusterRef} />

      <div id="toast" className={`panel${toastMessage ? ' show' : ''}`}>
        {toastMessage || ''}
      </div>
    </>
  );
}
