import { useEffect, useRef } from 'react';
import { formatRaceTime } from '../../game/race/raceSession.ts';
import type { GameCommand, GameSnapshot } from '../../shared/types.ts';

export interface RaceHudProps {
  snapshot: GameSnapshot;
  onCommand: (command: GameCommand) => void;
  onRegisterGauges: (
    cluster: HTMLCanvasElement | null,
    gMeter: HTMLCanvasElement | null,
  ) => void;
}

export function RaceHud({
  snapshot,
  onCommand,
  onRegisterGauges,
}: RaceHudProps) {
  const clusterRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    onRegisterGauges(clusterRef.current, null);
    return () => {
      onRegisterGauges(null, null);
    };
  }, [onRegisterGauges]);

  const { race, damage, telemetry, settings, camLabel, toastMessage } = snapshot;
  if (!race) return null;

  const speedVal = Math.round(telemetry.speed * (settings.mph ? 2.23694 : 3.6));
  const speedUnit = settings.mph ? 'mph' : 'km/h';

  const boostLabel =
    race.boost.status === 'active'
      ? `Faol (${race.boost.remainingTime.toFixed(1)}s)`
      : race.boost.status === 'ready'
        ? 'Tayyor [E]'
        : 'Bo‘sh';

  return (
    <div id="race-hud" data-testid="race-hud">
      {/* Top-Left: Track Title & Quick Utility Bar */}
      <div id="race-top-left" className="panel race-panel">
        <div className="race-brand-row">
          <span className="neon-dot" />
          <b>NEON CIRCUIT</b>
          <span className="race-sub">KECHKI SANOAT POYGASI</span>
        </div>
        <div className="race-quick-actions">
          <button
            type="button"
            className="tb on"
            onClick={() => onCommand({ type: 'HOTKEY', code: 'KeyC' })}
            title="Kamerani almashtirish (C)"
          >
            <kbd>C</kbd>
            <span className="v">{camLabel}</span>
          </button>
          <button
            type="button"
            className={`tb${settings.sound ? ' on' : ''}`}
            onClick={() => onCommand({ type: 'HOTKEY', code: 'KeyM' })}
            title="Ovoz (M)"
          >
            <kbd>M</kbd>
            <span className="v">{settings.sound ? 'Ovoz' : 'Jim'}</span>
          </button>
          <button
            type="button"
            className="tb on"
            onClick={() => onCommand({ type: 'HOTKEY', code: 'KeyU' })}
            title="Tezlik birligi (U)"
          >
            <kbd>U</kbd>
            <span className="v">{speedUnit}</span>
          </button>
          {race.phase === 'racing' || race.phase === 'countdown' ? (
            <button
              type="button"
              className="tb"
              data-testid="race-pause-btn"
              onClick={() => onCommand({ type: 'PAUSE', paused: true })}
              title="Pauza (Esc)"
            >
              <kbd>Esc</kbd>
              <span className="v">Pauza</span>
            </button>
          ) : null}
          <button
            type="button"
            className="tb"
            data-testid="race-hud-menu-btn"
            onClick={() => onCommand({ type: 'RETURN_TO_MENU' })}
            title="Asosiy menyuga qaytish"
          >
            <span className="v">Menyu</span>
          </button>
        </div>
      </div>

      {/* Top-Center: Lap, Checkpoints & Race Clocks */}
      <div id="race-top-center" className="panel race-panel" data-testid="race-lap-panel">
        <div className="race-stat-block">
          <span className="race-lbl">AYLANA</span>
          <b className="race-val accent" data-testid="race-lap-value">
            {race.currentLap} / {race.totalLaps}
          </b>
        </div>
        <div className="race-divider" />
        <div className="race-stat-block">
          <span className="race-lbl">JORIY AYLANA</span>
          <b className="race-val mono" data-testid="race-lap-time">
            {formatRaceTime(race.currentLapTime)}
          </b>
        </div>
        <div className="race-divider" />
        <div className="race-stat-block">
          <span className="race-lbl">UMUMIY VAQT</span>
          <b className="race-val mono" data-testid="race-total-time">
            {formatRaceTime(race.rawTotalTime)}
          </b>
          {race.penaltyTime > 0 ? (
            <span className="race-penalty-tag" data-testid="race-penalty-tag">
              +{race.penaltyTime.toFixed(0)}s jarima
            </span>
          ) : null}
        </div>
        <div className="race-divider" />
        <div className="race-stat-block">
          <span className="race-lbl">CHECKPOINT</span>
          <b className="race-val" data-testid="race-cp-value">
            {race.checkpoint.passedInCurrentLap}/{race.checkpoint.totalCheckpoints}
          </b>
        </div>
      </div>

      {/* Top-Right: Boost, Speed & Condition */}
      <div id="race-top-right" className="panel race-panel">
        <div className="race-boost-row">
          <div>
            <span className="race-lbl">NEON BOOST</span>
            <div
              className={`race-boost-status ${race.boost.status}`}
              data-testid="race-boost-status"
            >
              {boostLabel}
            </div>
          </div>
          {race.boost.status === 'ready' && race.phase === 'racing' ? (
            <button
              type="button"
              className="race-boost-trigger-btn"
              data-testid="hud-boost-btn"
              onClick={() => onCommand({ type: 'ACTIVATE_BOOST' })}
            >
              BOOST [E]
            </button>
          ) : null}
        </div>
        <div className="race-boost-bar-track">
          <i
            className={`race-boost-bar-fill ${race.boost.status}`}
            style={{ width: `${Math.round(race.boost.fractionRemaining * 100)}%` }}
          />
        </div>

        <div className="race-status-footer">
          <div className="race-mini-stat">
            <span>TEZLIK</span>
            <b data-testid="race-speed-value">
              {speedVal} <small>{speedUnit}</small>
            </b>
          </div>
          <div className="race-mini-stat">
            <span>HOLAT</span>
            <b data-testid="race-condition-value">{damage.conditionPercent}%</b>
          </div>
          {race.phase === 'racing' ? (
            <button
              type="button"
              className="race-respawn-btn"
              data-testid="race-respawn-btn"
              onClick={() => onCommand({ type: 'RESPAWN_RACE' })}
              title="Oxirgi checkpoint’ga qaytarish (+5s jarima)"
            >
              <kbd>R</kbd> Qaytarish (+5s)
            </button>
          ) : null}
        </div>
      </div>

      {/* Contextual Banner (Checkpoint / Boost / Wrong Way / Missed Checkpoint) */}
      {race.banner ? (
        <div
          id="race-banner"
          className={`panel race-banner ${race.banner.tone}`}
          data-testid="race-banner"
        >
          {race.banner.text}
        </div>
      ) : null}

      {/* Countdown Overlay (3 - 2 - 1 - BOSHLANDI!) */}
      {race.countdownNumber !== null && race.phase !== 'paused' ? (
        <div
          id="race-countdown"
          className={`race-countdown-overlay num-${race.countdownNumber}`}
          data-testid="race-countdown"
        >
          <div className="countdown-digit">
            {race.countdownNumber === 0 ? 'BOSHLANDI!' : race.countdownNumber}
          </div>
          <div className="countdown-sub">
            {race.countdownNumber === 0
              ? 'Gazni bosing · Boost padlarni yig‘ing!'
              : 'Startga tayyorlaning — harakat bloklangan'}
          </div>
        </div>
      ) : null}

      {/* Starting Grid Ready Overlay */}
      {race.phase === 'ready' ? (
        <div id="race-ready-overlay" className="race-modal-backdrop" data-testid="race-ready-overlay">
          <div className="card panel race-ready-card">
            <div className="eyebrow">START CHIZIG‘I · NEON CIRCUIT</div>
            <h2>Poygaga tayyormisiz?</h2>
            <p>
              Trassa uzunligi 760 m · 3 aylana · 10 ta checkpoint darvozasi va 4 ta
              energiya boost nuqtasi. Start signalidan so‘ng barcha darvozalardan
              tartib bilan o‘ting.
            </p>
            <div className="race-ready-actions">
              <button
                type="button"
                id="start-race-btn"
                className="mode-start-btn neon"
                data-testid="start-race-btn"
                onClick={() => onCommand({ type: 'START_RACE' })}
              >
                Poygani boshlash
              </button>
              <button
                type="button"
                className="race-secondary-btn"
                data-testid="ready-menu-btn"
                onClick={() => onCommand({ type: 'RETURN_TO_MENU' })}
              >
                Menyuga qaytish
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Pause Modal in Race Mode */}
      {race.phase === 'paused' ? (
        <div id="race-pause-modal" className="race-modal-backdrop" data-testid="race-pause-modal">
          <div className="card panel race-pause-card">
            <div className="eyebrow">POYGA TO‘XTATILDI</div>
            <h2>Pauza</h2>
            <p>Poyga vaqti va boost taymeri vaqtincha muzlatildi.</p>
            <div className="race-pause-actions">
              <button
                type="button"
                className="mode-start-btn neon"
                data-testid="pause-resume-btn"
                onClick={() => onCommand({ type: 'PAUSE', paused: false })}
              >
                Davom ettirish (Esc)
              </button>
              {race.pausedFromPhase === 'racing' ? (
                <button
                  type="button"
                  className="race-secondary-btn"
                  data-testid="pause-respawn-btn"
                  onClick={() => onCommand({ type: 'RESPAWN_RACE' })}
                >
                  Trassaga qaytarish (+5s jarima)
                </button>
              ) : null}
              <button
                type="button"
                className="race-secondary-btn"
                data-testid="pause-restart-btn"
                onClick={() => onCommand({ type: 'RESTART_RACE' })}
              >
                Qayta poyga
              </button>
              <button
                type="button"
                className="race-secondary-btn"
                data-testid="pause-menu-btn"
                onClick={() => onCommand({ type: 'RETURN_TO_MENU' })}
              >
                Menyuga qaytish
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <canvas id="cluster" ref={clusterRef} width={500} height={500} />

      <div id="toast" className={`panel${toastMessage ? ' show' : ''}`}>
        {toastMessage ?? ''}
      </div>
    </div>
  );
}
