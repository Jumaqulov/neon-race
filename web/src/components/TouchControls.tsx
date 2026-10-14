import { useEffect, useState, type PointerEvent } from 'react';
import type { GameCommand, TouchControlKey } from '../shared/types.ts';

export interface TouchControlsProps {
  onCommand: (command: GameCommand) => void;
}

const INITIAL_PRESSED: Record<TouchControlKey, boolean> = {
  left: false,
  right: false,
  handbrake: false,
  brake: false,
  throttle: false,
};

export function TouchControls({ onCommand }: TouchControlsProps) {
  const [pressed, setPressed] = useState<Record<TouchControlKey, boolean>>(INITIAL_PRESSED);

  useEffect(() => {
    const handleBlur = () => {
      setPressed(INITIAL_PRESSED);
    };
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('blur', handleBlur);
    };
  }, []);

  const handleDown = (control: TouchControlKey) => (e: PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore if pointer capture is unsupported
    }
    setPressed((prev) => ({ ...prev, [control]: true }));
    onCommand({ type: 'TOUCH_INPUT', control, active: true });
  };

  const handleUp = (control: TouchControlKey) => () => {
    setPressed((prev) => ({ ...prev, [control]: false }));
    onCommand({ type: 'TOUCH_INPUT', control, active: false });
  };

  return (
    <div id="touch">
      <div className="tpad l">
        <button
          className={`tbtn${pressed.left ? ' down' : ''}`}
          data-t="left"
          aria-label="Steer left"
          onPointerDown={handleDown('left')}
          onPointerUp={handleUp('left')}
          onPointerCancel={handleUp('left')}
          onLostPointerCapture={handleUp('left')}
        >
          <svg viewBox="0 0 24 24">
            <path d="M15.5 4 7 12l8.5 8 1.5-1.5L10 12l7-6.5z" />
          </svg>
        </button>
        <button
          className={`tbtn${pressed.right ? ' down' : ''}`}
          data-t="right"
          aria-label="Steer right"
          onPointerDown={handleDown('right')}
          onPointerUp={handleUp('right')}
          onPointerCancel={handleUp('right')}
          onLostPointerCapture={handleUp('right')}
        >
          <svg viewBox="0 0 24 24">
            <path d="M8.5 4 17 12l-8.5 8L7 18.5 14 12 7 5.5z" />
          </svg>
        </button>
      </div>
      <div className="tpad r">
        <button
          className={`tbtn${pressed.handbrake ? ' down' : ''}`}
          data-t="handbrake"
          onPointerDown={handleDown('handbrake')}
          onPointerUp={handleUp('handbrake')}
          onPointerCancel={handleUp('handbrake')}
          onLostPointerCapture={handleUp('handbrake')}
        >
          HB
        </button>
        <button
          className={`tbtn brk${pressed.brake ? ' down' : ''}`}
          data-t="brake"
          onPointerDown={handleDown('brake')}
          onPointerUp={handleUp('brake')}
          onPointerCancel={handleUp('brake')}
          onLostPointerCapture={handleUp('brake')}
        >
          BRAKE
        </button>
        <button
          className={`tbtn gas${pressed.throttle ? ' down' : ''}`}
          data-t="throttle"
          onPointerDown={handleDown('throttle')}
          onPointerUp={handleUp('throttle')}
          onPointerCancel={handleUp('throttle')}
          onLostPointerCapture={handleUp('throttle')}
        >
          GAS
        </button>
      </div>
    </div>
  );
}
