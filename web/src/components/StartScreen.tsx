import type { KeyboardEvent, PointerEvent } from 'react';
import type { GameCommand, GameSnapshot } from '../shared/types.ts';

export interface StartScreenProps {
  snapshot: GameSnapshot;
  onCommand: (command: GameCommand) => void;
}

export function StartScreen({ snapshot, onCommand }: StartScreenProps) {
  const { started, ready, error, loadingStatus, touchMode } = snapshot;

  const handleAction = () => {
    if (error) {
      window.location.reload();
      return;
    }
    onCommand({ type: 'START' });
  };

  const handlePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    handleAction();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.code === 'Enter' || e.code === 'Space') {
      e.preventDefault();
      e.stopPropagation();
      handleAction();
    }
  };

  const buttonLabel = error
    ? 'Qayta yuklash'
    : !ready
      ? 'Dvigatel yuklanmoqda…'
      : touchMode
        ? 'Boshlash'
        : 'O‘yinni boshlash';

  return (
    <div id="splash" className={started && !error ? 'hide' : ''}>
      <div className="card panel">
        <div className="eyebrow">V3 · PHYSICS &amp; GRAPHICS EDITION</div>
        <h1>
          Muscle Car
          <br />
          Proving Ground
        </h1>
        <p>
          To‘rtta g‘ildirak fizikasi, vazn ko‘chishi va mustaqil osma harakati. Zarba kuzovni bukadi, chiroqlarni
          sindiradi va boshqaruvga ta’sir qiladi. V — o‘yin ichidagi sinov; Y — sekinlashtirish; F — ta’mirlash.
        </p>
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
            <kbd>T</kbd>
          </div>
          <span>Sirpanish nazorati</span>
          <div>
            <kbd>C</kbd>
          </div>
          <span>Kamera</span>
          <div>
            <kbd>I</kbd>
          </div>
          <span>Yaqindan ko‘rish</span>
          <div>
            <kbd>F</kbd>
          </div>
          <span>Ta’mirlash</span>
        </div>
        <div className="touch-note">Chapdagi tugmalar — rul. O‘ngda gaz va tormoz. HB — qo‘l tormozi.</div>
        <div
          id="go"
          role="button"
          tabIndex={0}
          onClick={handleAction}
          onPointerDown={handlePointerDown}
          onKeyDown={handleKeyDown}
        >
          {buttonLabel}
        </div>
        <div id="loading-status" role={error ? 'alert' : undefined}>
          {loadingStatus}
        </div>
      </div>
    </div>
  );
}
