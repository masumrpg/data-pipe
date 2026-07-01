import { useState, useEffect, useCallback, useRef } from 'react';
import { PipelineEngine } from '../../pipeline/engine';
import type { PipelineConfig, RunState, LogEntry } from '../../shared/types';

export function usePipeline(config: PipelineConfig, dryRun: boolean = false) {
  const engineRef = useRef<PipelineEngine | null>(null);
  const [state, setState] = useState<RunState>({
    status: 'idle', total: 0, done: 0, failed: [], logs: [],
  });

  useEffect(() => {
    const engine = new PipelineEngine(config, dryRun);
    engineRef.current = engine;

    engine.on('status',   (s)   => setState(p => ({ ...p, status: s })));
    engine.on('total',    (t)   => setState(p => ({ ...p, total: t })));
    engine.on('progress', (pg)  => setState(p => ({ ...p, done: pg.done })));
    engine.on('log',      (l: LogEntry) => setState(p => ({ ...p, logs: [...p.logs.slice(-200), l] })));
    engine.on('item-failed', (f) => setState(p => ({ ...p, failed: [...p.failed, f] })));
    engine.on('done',     (s)   => setState({ ...s, fetchProgress: null, currentItem: null }));
    engine.on('error',    ()    => setState(p => ({ ...p, status: 'error', fetchProgress: null, currentItem: null })));
    engine.on('fetch-progress', (fp) => setState(p => ({ ...p, fetchProgress: fp })));
    engine.on('item-processing', (ip) => setState(p => ({ ...p, currentItem: ip, fetchProgress: null })));

    // Auto-start
    engine.run();

    return () => { engine.removeAllListeners(); };
  }, []);

  const pause  = useCallback(() => engineRef.current?.pause(), []);
  const resume = useCallback(() => engineRef.current?.resume(), []);
  const cancel = useCallback(() => engineRef.current?.cancel(), []);
  const retry  = useCallback(() => engineRef.current?.retryFailed(), []);

  return { state, pause, resume, cancel, retry };
}
