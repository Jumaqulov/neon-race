import type { GameCommand, GameMode } from '../shared/types.ts';

export interface ModeSelectProps {
  selectedMode: GameMode;
  ready: boolean;
  error: string | null;
  onCommand: (command: GameCommand) => void;
}

export function ModeSelect({
  selectedMode,
  ready,
  error,
  onCommand,
}: ModeSelectProps) {
  const disabled = !ready || Boolean(error);

  const handleSelectAndStart = (mode: GameMode) => () => {
    if (disabled) return;
    onCommand({ type: 'START', mode });
  };

  const handlePreviewMode = (mode: GameMode) => () => {
    if (disabled || selectedMode === mode) return;
    onCommand({ type: 'SELECT_MODE', mode });
  };

  return (
    <div className="mode-select-grid" data-testid="mode-select" role="group" aria-label="O‘yin rejimini tanlash">
      <div
        className={`mode-card${selectedMode === 'neon_circuit' ? ' selected' : ''}`}
        onMouseEnter={handlePreviewMode('neon_circuit')}
      >
        <div className="mode-card-badge neon">YANGI REJIM · 3.1</div>
        <h2>Poyga — Neon Circuit</h2>
        <p>
          Kechki sanoat kvartalidagi yopiq neon trassa. 3–2–1 start, 3 aylana, 10 ta
          checkpoint darvozasi, yig‘iladigan boost va vaqt hisobi.
        </p>
        <ul className="mode-features">
          <li>3 aylana · sof vaqt va jarima hisobi</li>
          <li>4 ta boost pickup · [E] yoki BOOST tugmasi</li>
          <li>[R] oxirgi checkpoint’ga qaytarish (+5s jarima)</li>
        </ul>
        <button
          type="button"
          className="mode-start-btn neon"
          data-testid="start-neon-circuit"
          disabled={disabled}
          onClick={handleSelectAndStart('neon_circuit')}
        >
          Poyga — Neon Circuit
        </button>
      </div>

      <div
        className={`mode-card${selectedMode === 'proving_ground' ? ' selected' : ''}`}
        onMouseEnter={handlePreviewMode('proving_ground')}
      >
        <div className="mode-card-badge">KLASSIK</div>
        <h2>Poligon — Erkin haydash va avtomobil sinovi</h2>
        <p>
          Erkin haydash maydoni: V8 fizika, slalom konuslar, drift ochkolari, kuzov
          deformatsiyasi, 80 km/h zarba sinovi va kamera poligoni.
        </p>
        <ul className="mode-features">
          <li>Erkin drift va konuslar slalomi</li>
          <li>[V] 80 km/h devor sinovi · [F] tezkor ta’mir</li>
          <li>[I] ko‘rish kamerasi · [Y] 0.25× sekinlashtirish</li>
        </ul>
        <button
          type="button"
          id="go"
          className="mode-start-btn proving"
          data-testid="start-proving-ground"
          disabled={disabled}
          onClick={handleSelectAndStart('proving_ground')}
        >
          Poligonda haydash
        </button>
      </div>
    </div>
  );
}
