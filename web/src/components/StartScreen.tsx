import { ModeSelect } from './ModeSelect.tsx';
import type { GameCommand, GameSnapshot } from '../shared/types.ts';

export interface StartScreenProps {
  snapshot: GameSnapshot;
  onCommand: (command: GameCommand) => void;
}

export function StartScreen({ snapshot, onCommand }: StartScreenProps) {
  const { started, ready, error, loadingStatus, mode } = snapshot;

  const handleReload = () => {
    window.location.reload();
  };

  return (
    <div id="splash" className={started && !error ? 'hide' : ''}>
      <div className="card panel start-menu-card">
        <div className="eyebrow">NEON RACE · STAGE 3.1 EDITION</div>
        <h1>Neon Race</h1>
        <p>
          Yangi <strong>Poyga — Neon Circuit</strong> trassasida 3 aylanali poygada
          bellashing yoki <strong>Poligon</strong> rejimida avtomobil fizikasi, drift va
          shikastlanish tizimini erkin sinab ko‘ring.
        </p>

        {!error ? (
          <ModeSelect
            selectedMode={mode}
            ready={ready}
            error={error}
            onCommand={onCommand}
          />
        ) : (
          <button
            type="button"
            id="go"
            className="mode-start-btn proving"
            onClick={handleReload}
          >
            Qayta yuklash
          </button>
        )}

        <div className="keys">
          <div>
            <kbd>W</kbd>
            <kbd>↑</kbd>
          </div>
          <span>Gaz</span>
          <div>
            <kbd>A</kbd>
            <kbd>D</kbd>
          </div>
          <span>Rul</span>
          <div>
            <kbd>S</kbd>
            <kbd>↓</kbd>
          </div>
          <span>Tormoz / orqaga</span>
          <div>
            <kbd>Space</kbd>
          </div>
          <span>Qo‘l tormozi</span>
          <div>
            <kbd>E</kbd>
          </div>
          <span>Boost (Poyga)</span>
          <div>
            <kbd>R</kbd>
          </div>
          <span>Qaytarish</span>
          <div>
            <kbd>C</kbd>
          </div>
          <span>Kamera</span>
          <div>
            <kbd>Esc</kbd>
          </div>
          <span>Pauza</span>
        </div>
        <div className="touch-note">
          Chapda rul · O‘ngda Gaz, Tormoz, HB va BOOST tugmalari.
        </div>
        <div id="loading-status" role={error ? 'alert' : undefined}>
          {loadingStatus}
        </div>
      </div>
    </div>
  );
}
