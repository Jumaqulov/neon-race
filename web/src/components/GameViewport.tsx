import { useEffect, useRef } from 'react';
import type { GameEngine } from '../game/GameEngine.ts';

export interface GameViewportProps {
  onEngineReady: (engine: GameEngine) => void;
  onEngineDispose?: (engine: GameEngine) => void;
  createEngine: () => GameEngine;
}

export function GameViewport({ onEngineReady, onEngineDispose, createEngine }: GameViewportProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    const engine = createEngine();
    engine.init(container);
    onEngineReady(engine);

    return () => {
      engine.dispose();
      onEngineDispose?.(engine);
    };
  }, [createEngine, onEngineReady, onEngineDispose]);

  return <div id="gl-viewport" ref={containerRef} />;
}
