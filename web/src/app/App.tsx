import { useCallback, useEffect, useState } from 'react';
import { GameHud } from '../components/GameHud.tsx';
import { GameToolbar } from '../components/GameToolbar.tsx';
import { GameViewport } from '../components/GameViewport.tsx';
import { RaceHud } from '../components/race/RaceHud.tsx';
import { RaceResults } from '../components/race/RaceResults.tsx';
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

  const handleEngineDispose = useCallback((disposedInstance: GameEngine) => {
    setEngine((current) => (current === disposedInstance ? null : current));
  }, []);

  useEffect(() => {
    if (!engine || engine.isDisposed()) return;
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

  const handleRegisterGauges = useCallback(
    (cluster: HTMLCanvasElement | null, gMeter: HTMLCanvasElement | null) => {
      engine?.setGaugeCanvases(cluster, gMeter);
    },
    [engine],
  );

  const isRaceMode = snapshot?.mode === 'neon_circuit';

  const shellClasses = [
    'game-shell',
    isRaceMode ? 'race-mode' : 'proving-mode',
    snapshot?.helpOpen ? 'help-open' : '',
    snapshot?.touchMode ? 'touch' : '',
    snapshot?.inspecting ? 'inspecting' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={shellClasses}>
      <GameViewport
        createEngine={createEngine}
        onEngineReady={handleEngineReady}
        onEngineDispose={handleEngineDispose}
      />
      {snapshot && (
        <>
          {isRaceMode ? (
            <>
              <RaceHud
                snapshot={snapshot}
                onCommand={handleCommand}
                onRegisterGauges={handleRegisterGauges}
              />
              {snapshot.race && snapshot.race.phase === 'finished' ? (
                <RaceResults
                  race={snapshot.race}
                  conditionPercent={snapshot.damage.conditionPercent}
                  onCommand={handleCommand}
                />
              ) : null}
            </>
          ) : (
            <>
              <GameToolbar snapshot={snapshot} onCommand={handleCommand} />
              <GameHud snapshot={snapshot} engine={engine} />
            </>
          )}
          <TouchControls
            onCommand={handleCommand}
            showBoost={isRaceMode}
            boostStatus={snapshot.race?.boost.status ?? 'empty'}
          />
          <StartScreen snapshot={snapshot} onCommand={handleCommand} />
        </>
      )}
    </div>
  );
}
