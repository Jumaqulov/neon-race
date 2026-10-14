import { PAINTS, type GameCommand, type GameSnapshot } from '../shared/types.ts';

export interface GameToolbarProps {
  snapshot: GameSnapshot;
  onCommand: (command: GameCommand) => void;
}

export function GameToolbar({ snapshot, onCommand }: GameToolbarProps) {
  const { settings, camLabel, qualityLabel, slowMotion, paused, performanceText } = snapshot;

  const handleHotkey = (code: string) => () => {
    onCommand({ type: 'HOTKEY', code });
  };

  const handlePaint = (color: number) => () => {
    onCommand({ type: 'SET_PAINT', color });
  };

  const sideLightsOn = settings.markers || settings.lights;
  const isInspect = settings.cam === 4;

  return (
    <div id="toolbar">
      <div className="row panel">
        <button type="button" className="tb on" data-key="KeyC" onClick={handleHotkey('KeyC')}>
          <kbd>C</kbd>Cam <span className="v">{camLabel}</span>
        </button>
        <button
          type="button"
          className={`tb${settings.tcs ? ' on' : ''}`}
          data-key="KeyT"
          onClick={handleHotkey('KeyT')}
        >
          <kbd>T</kbd>TCS <span className="v">{settings.tcs ? 'On' : 'Off'}</span>
        </button>
        <button
          type="button"
          className={`tb${settings.lights ? ' on' : ''}`}
          data-key="KeyL"
          onClick={handleHotkey('KeyL')}
        >
          <kbd>L</kbd>Lights <span className="v">{settings.lights ? 'On' : 'Off'}</span>
        </button>
        <button
          type="button"
          className={`tb${settings.night ? ' on' : ''}`}
          data-key="KeyN"
          onClick={handleHotkey('KeyN')}
        >
          <kbd>N</kbd>
          <span className="v">{settings.night ? 'Night' : 'Day'}</span>
        </button>
        <button
          type="button"
          className={`tb${settings.sound ? ' on' : ''}`}
          data-key="KeyM"
          onClick={handleHotkey('KeyM')}
        >
          <kbd>M</kbd>Sound <span className="v">{settings.sound ? 'On' : 'Off'}</span>
        </button>
        <button type="button" className="tb on" data-key="KeyU" onClick={handleHotkey('KeyU')}>
          <kbd>U</kbd>
          <span className="v">{settings.mph ? 'mph' : 'km/h'}</span>
        </button>
        <button type="button" className="tb" data-key="KeyR" onClick={handleHotkey('KeyR')}>
          <kbd>R</kbd>Reset <span className="v"></span>
        </button>
      </div>

      <div className="row panel detail-row" aria-label="Vehicle detail controls">
        <button
          type="button"
          className={`tb${sideLightsOn ? ' on' : ''}`}
          data-key="KeyO"
          title="O · Side and parking lights"
          onClick={handleHotkey('KeyO')}
        >
          <kbd>O</kbd>Side lights <span className="v">{sideLightsOn ? 'On' : 'Off'}</span>
        </button>
        <button
          type="button"
          className={`tb${settings.turn === 'left' ? ' on' : ''}`}
          data-key="KeyZ"
          title="Z · Left indicators"
          onClick={handleHotkey('KeyZ')}
        >
          <kbd>Z</kbd>◀ <span className="v"></span>
        </button>
        <button
          type="button"
          className={`tb${settings.turn === 'right' ? ' on' : ''}`}
          data-key="KeyX"
          title="X · Right indicators"
          onClick={handleHotkey('KeyX')}
        >
          <kbd>X</kbd>▶ <span className="v"></span>
        </button>
        <button
          type="button"
          className={`tb${settings.hazards ? ' on' : ''}`}
          data-key="KeyB"
          title="B · Hazard lights"
          onClick={handleHotkey('KeyB')}
        >
          <kbd>B</kbd>Hazards <span className="v">{settings.hazards ? 'On' : 'Off'}</span>
        </button>
        <button
          type="button"
          className={`tb${isInspect ? ' on' : ''}`}
          data-key="KeyI"
          title="I · Inspect the car"
          onClick={handleHotkey('KeyI')}
        >
          <kbd>I</kbd>Ko‘rish <span className="v">{isInspect ? 'On' : ''}</span>
        </button>
        <button
          type="button"
          className="tb"
          data-key="KeyF"
          title="F · Repair without moving the car"
          onClick={handleHotkey('KeyF')}
        >
          <kbd>F</kbd>Ta’mir <span className="v"></span>
        </button>
      </div>

      <div className="row panel" aria-label="Crash and graphics controls">
        <button
          type="button"
          className="tb"
          data-key="KeyV"
          title="Stage an unoccupied in-game wall crash"
          onClick={handleHotkey('KeyV')}
        >
          <kbd>V</kbd>Sinov <span className="v">80 km/h</span>
        </button>
        <button
          type="button"
          className={`tb${settings.shadows ? ' on' : ''}`}
          data-key="KeyQ"
          title="Toggle geometry shadows"
          onClick={handleHotkey('KeyQ')}
        >
          <kbd>Q</kbd>Soya <span className="v">{settings.shadows ? 'On' : 'Off'}</span>
        </button>
        <button
          type="button"
          className="tb on"
          data-key="KeyG"
          title="Grafika sifatini o‘zgartirish"
          onClick={handleHotkey('KeyG')}
        >
          <kbd>G</kbd>Sifat <span className="v">{qualityLabel}</span>
        </button>
        <button
          type="button"
          className={`tb${slowMotion ? ' on' : ''}`}
          data-key="KeyY"
          title="Harakatni 4 marta sekinlashtirish"
          onClick={handleHotkey('KeyY')}
        >
          <kbd>Y</kbd>Sekin <span className="v">{slowMotion ? '0.25×' : '1×'}</span>
        </button>
        <button
          type="button"
          className={`tb${paused ? ' on' : ''}`}
          data-key="Escape"
          title="Pauza"
          onClick={handleHotkey('Escape')}
        >
          <kbd>Esc</kbd>
          <span className="v">{paused ? '▶' : 'Ⅱ'}</span>
        </button>
      </div>

      <div id="performance" className="panel" aria-live="off">
        {performanceText}
      </div>

      <div id="swatches" className="panel" aria-label="Paint colour">
        {PAINTS.map(([hex, name]) => (
          <button
            type="button"
            key={hex}
            className={`sw${settings.paint === hex ? ' sel' : ''}`}
            data-c={hex}
            title={name}
            aria-label={name}
            style={{ background: '#' + hex.toString(16).padStart(6, '0') }}
            onClick={handlePaint(hex)}
          />
        ))}
      </div>
    </div>
  );
}
