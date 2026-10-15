import { formatRaceTime, type RaceSessionSnapshot } from '../../game/race/raceSession.ts';
import type { GameCommand } from '../../shared/types.ts';

export interface RaceResultsProps {
  race: RaceSessionSnapshot;
  conditionPercent: number;
  onCommand: (command: GameCommand) => void;
}

export function RaceResults({
  race,
  conditionPercent,
  onCommand,
}: RaceResultsProps) {
  if (race.phase !== 'finished') return null;

  return (
    <div id="race-results" className="race-modal-backdrop" data-testid="race-results-modal">
      <div className="card panel race-results-card">
        <div className="eyebrow">MARRA · NEON CIRCUIT (3 AYLANA)</div>
        <h1>Poyga yakunlandi!</h1>

        <div className="results-hero-time">
          <span>YAKUNIY VAQT (SOF VAQT + JARIMA)</span>
          <strong data-testid="results-final-time">{formatRaceTime(race.finalTime)}</strong>
        </div>

        <div className="results-summary-grid">
          <div className="results-stat-item">
            <span>Sof umumiy vaqt</span>
            <b data-testid="results-raw-time">{formatRaceTime(race.rawTotalTime)}</b>
          </div>
          <div className="results-stat-item">
            <span>Umumiy jarima vaqti</span>
            <b data-testid="results-penalty-time">
              +{race.penaltyTime.toFixed(1)}s ({race.respawnCount} marta)
            </b>
          </div>
          <div className="results-stat-item">
            <span>Eng yaxshi aylana</span>
            <b className="accent" data-testid="results-best-lap">
              {race.bestLapTime !== null ? formatRaceTime(race.bestLapTime) : '—'}
            </b>
          </div>
          <div className="results-stat-item">
            <span>Ishlatilgan boostlar</span>
            <b data-testid="results-boosts-used">{race.boost.boostsUsed}</b>
          </div>
        </div>

        <div className="results-laps-section">
          <div className="results-laps-title">AYLANALAR BO‘YICHA VAQT</div>
          <div className="results-laps-list">
            {race.lapTimes.map((lapTime, idx) => {
              const isBest =
                race.bestLapTime !== null && Math.abs(lapTime - race.bestLapTime) < 1e-6;
              return (
                <div
                  key={idx}
                  className={`results-lap-row${isBest ? ' best' : ''}`}
                  data-testid={`results-lap-${idx + 1}`}
                >
                  <span>{idx + 1}-aylana</span>
                  <div className="results-lap-right">
                    {isBest ? <em className="best-badge">ENG YAXSHI</em> : null}
                    <b>{formatRaceTime(lapTime)}</b>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="results-condition-line">
          <span>Avtomobil yakuniy holati:</span>
          <b>{conditionPercent}%</b>
        </div>

        <div className="race-ready-actions">
          <button
            type="button"
            className="mode-start-btn neon"
            data-testid="restart-race-btn"
            onClick={() => onCommand({ type: 'RESTART_RACE' })}
          >
            Qayta poyga
          </button>
          <button
            type="button"
            className="race-secondary-btn"
            data-testid="results-menu-btn"
            onClick={() => onCommand({ type: 'RETURN_TO_MENU' })}
          >
            Menyuga qaytish
          </button>
        </div>
      </div>
    </div>
  );
}
