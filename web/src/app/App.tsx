import { useCallback, useEffect, useState } from 'react';
import { GameHud } from '../components/GameHud.tsx';
import { GameToolbar } from '../components/GameToolbar.tsx';
import { GameViewport } from '../components/GameViewport.tsx';
import { StartScreen } from '../components/StartScreen.tsx';
import { TouchControls } from '../components/TouchControls.tsx';
import { GameEngine } from '../game/GameEngine.ts';
import type { GameCommand, GameSnapshot } from '../shared/types.ts';

export function App() {
  const [engine, setEngine] = useState<GameEngine | null>(null);
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(null);

  const createEngine = useCallback(() => new GameEngine(), []);

  const handleEngineReady = useCallback((instance: GameEngine) => {
    setEngine(instance);
    setSnapshot(instance.getSnapshot());
  }, []);

  useEffect(() => {
    if (!engine) return;
    setSnapshot(engine.getSnapshot());
    const unsubscribe = engine.subscribe(() => {
      setSnapshot(engine.getSnapshot());
    });
    return unsubscribe;
  }, [engine]);

  const handleCommand = useCallback(
    (command: GameCommand) => {
      engine?.dispatch(command);
    },
    [engine],
  );

  const shellClasses = [
    'game-shell',
    snapshot?.helpOpen ? 'help-open' : '',
    snapshot?.touchMode ? 'touch' : '',
    snapshot?.inspecting ? 'inspecting' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={shellClasses}>
      <GameViewport createEngine={createEngine} onEngineReady={handleEngineReady} />
      {snapshot && (
        <>
          <GameToolbar snapshot={snapshot} onCommand={handleCommand} />
          <GameHud snapshot={snapshot} engine={engine} />
          <TouchControls onCommand={handleCommand} />
          <StartScreen snapshot={snapshot} onCommand={handleCommand} />
        </>
      )}
    </div>
  );
}
