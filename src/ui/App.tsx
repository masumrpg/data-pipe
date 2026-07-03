import { useEffect, useState, useRef } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { usePipeline } from './hooks/usePipeline';
import { ProgressBar } from './components/ProgressBar';
import { StatusBadge } from './components/StatusBadge';
import { LogPanel } from './components/LogPanel';
import { ResultSummary } from './components/ResultSummary';
import type { PipelineConfig, MappingRule } from '../shared/types';

type Props = {
  config: PipelineConfig;
  dryRun?: boolean;
  autoQuit?: boolean;
  onComplete?: (success: boolean) => void;
};

function parseConnectionString(connStr: string) {
  try {
    const url = new URL(connStr);
    return {
      host: url.hostname || 'localhost',
      port: url.port || '5432',
      database: url.pathname.replace(/^\//, '') || 'postgres',
    };
  } catch {
    // Fallback for key-value format strings
    const hostMatch = connStr.match(/host=([^; ]+)/);
    const portMatch = connStr.match(/port=([^; ]+)/);
    const dbMatch = connStr.match(/(?:dbname|database)=([^; ]+)/);
    return {
      host: hostMatch ? hostMatch[1] : 'localhost',
      port: portMatch ? portMatch[1] : '5432',
      database: dbMatch ? dbMatch[1] : 'postgres',
    };
  }
}

function getTargetTables(mapping: MappingRule[], defaultTable: string): string[] {
  const tables = new Set<string>();

  function scan(rules: MappingRule[]) {
    for (const r of rules) {
      if (r.to && r.to.includes('.') && !r.expand) {
        const parts = r.to.split('.');
        if (parts[0]) {
          tables.add(parts[0]);
        }
      }
      if (r.mapping) {
        scan(r.mapping);
      }
    }
  }

  scan(mapping);

  if (tables.size === 0 && defaultTable) {
    tables.add(defaultTable);
  }

  return Array.from(tables);
}

export function App({ config, dryRun, autoQuit, onComplete }: Props) {
  const { state, pause, resume, cancel, retry } = usePipeline(config, dryRun);
  const { exit } = useApp();
  const { status, done, total, failed, logs } = state;

  const [metrics, setMetrics] = useState({
    speed: 0,
    eta: '',
    elapsed: '00:00',
    ram: '0.0 MB',
  });
  const startTimeRef = useRef<number | null>(null);

  useEffect(() => {
    if (status === 'running' && !startTimeRef.current) {
      startTimeRef.current = Date.now();
    }

    const interval = setInterval(() => {
      let elapsedStr = '00:00';
      let speed = 0;
      let etaStr = '';

      if (startTimeRef.current) {
        const elapsedMs = Date.now() - startTimeRef.current;
        const totalSecs = Math.floor(elapsedMs / 1000);
        const mins = Math.floor(totalSecs / 60).toString().padStart(2, '0');
        const secs = (totalSecs % 60).toString().padStart(2, '0');
        elapsedStr = `${mins}:${secs}`;

        if (done > 0 && totalSecs > 0) {
          speed = done / totalSecs;
        }

        if (speed > 0 && total > done) {
          const remainingSecs = Math.ceil((total - done) / speed);
          if (remainingSecs < 60) {
            etaStr = `${remainingSecs}s`;
          } else {
            const remMins = Math.floor(remainingSecs / 60);
            const remSecs = remainingSecs % 60;
            etaStr = `${remMins}m ${remSecs}s`;
          }
        }
      }

      let ramStr = '0.0 MB';
      if (typeof process !== 'undefined' && process.memoryUsage) {
        const usage = process.memoryUsage().heapUsed;
        ramStr = `${(usage / 1024 / 1024).toFixed(1)} MB`;
      }

      setMetrics({
        speed,
        eta: etaStr,
        elapsed: elapsedStr,
        ram: ramStr,
      });
    }, 500);

    return () => clearInterval(interval);
  }, [status, done, total]);

  useEffect(() => {
    if (status === 'done' || status === 'error') {
      const isSuccess = status === 'done' && failed.length === 0;
      if (onComplete) {
        isSuccess ? onComplete(true) : onComplete(false);
      }
      if (autoQuit) {
        exit();
      }
    }
  }, [status, failed.length, autoQuit, onComplete, exit]);

  // Connection parsing for postgres
  const pgInfo = config.target.type === 'postgres'
    ? parseConnectionString(config.target.connectionString)
    : null;

  // Extracted write tables
  const writeTables = getTargetTables(config.mapping, config.target.table ?? '');

  // Keyboard controls
  useInput((input, key) => {
    if (input === 'p' && status === 'running') pause();
    if (input === 'p' && status === 'paused')  resume();
    if (input === 'c' && status !== 'done' && status !== 'error') cancel();
    if (input === 'r' && status === 'done' && failed.length > 0) retry();
    if ((input === 'q' || key.escape) && (status === 'done' || status === 'error')) exit();
  });


  // Find the last error log to show as a summary if status is error
  const lastErrorLog = status === 'error' 
    ? [...logs].reverse().find(l => l.level === 'error') 
    : null;
  const lastWarnLog = status === 'error'
    ? [...logs].reverse().find(l => l.level === 'warn')
    : null;

  return (
    <Box flexDirection="column" padding={1} gap={1}>

      {/* Header */}
      <Box gap={2} alignItems="center">
        <Text bold color="cyan">DataPipe</Text>
        <Text dimColor>›</Text>
        <Text>{config.name}</Text>
        {dryRun && <Text color="yellow">[DRY RUN]</Text>}
      </Box>

      {/* Pipeline Info Panel */}
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="gray"
        paddingX={1}
        paddingY={0}
      >
        {/* Source Section */}
        <Box gap={1}>
          <Text bold color="yellow">SOURCE:</Text>
          <Text>{config.source.type.toUpperCase()}</Text>
        </Box>
        <Box flexDirection="column" marginLeft={2} marginBottom={1}>
          {config.source.type === 'api' ? (
            config.source.requests.map((req) => (
              <Text key={req.id} dimColor>• {req.id}: {req.url}</Text>
            ))
          ) : (
            <Text dimColor>• Path: {'filePath' in config.source ? (config.source as any).filePath : ''}</Text>
          )}
        </Box>

        {/* Target Section */}
        <Box gap={1}>
          <Text bold color="green">TARGET:</Text>
          <Text>{config.target.type.toUpperCase()}</Text>
        </Box>
        <Box flexDirection="column" marginLeft={2}>
          {config.target.type === 'postgres' && pgInfo ? (
            <>
              <Text dimColor>• Host: {pgInfo.host}:{pgInfo.port} (DB: {pgInfo.database})</Text>
              {config.target.schema && <Text dimColor>• Schema: {config.target.schema}</Text>}
              {config.target.table && <Text dimColor>• Entry Table/View: {config.target.table}</Text>}
              {writeTables.length > 0 && (
                <Text dimColor>• Write Tables: {writeTables.join(', ')}</Text>
              )}
            </>
          ) : (
            <>
              <Text dimColor>• File: {'filePath' in config.target ? (config.target as any).filePath : ''}</Text>
              {config.target.table && <Text dimColor>• Table: {config.target.table}</Text>}
            </>
          )}
        </Box>
      </Box>

      {/* Status + progress */}
      <Box flexDirection="column" gap={1}>
        <Box gap={2} alignItems="center">
          <StatusBadge status={status} />
          {(status === 'running' || status === 'paused' || status === 'done') && (
            <Text dimColor>
              ⏱️  {metrics.elapsed} | 🚀  {metrics.speed.toFixed(1)} items/s | 🧠  {metrics.ram}
            </Text>
          )}
        </Box>
        {(status === 'running' || status === 'paused' || status === 'done') && (
          <ProgressBar
            done={done}
            total={total}
            hasFailed={failed.length > 0}
            eta={metrics.eta}
          />
        )}
        {status === 'fetching' && state.fetchProgress && (
          <ProgressBar
            done={state.fetchProgress.fetched}
            total={state.fetchProgress.total}
            label="pages"
          />
        )}
        {status === 'fetching' && state.fetchProgress?.current && (
          <Box marginLeft={1}>
            <Text bold color="yellow">➔ Requesting: </Text>
            <Text dimColor>Page/Index {state.fetchProgress.current}</Text>
          </Box>
        )}
        {(status === 'running' || status === 'paused') && state.currentItem && (
          <Box marginLeft={1}>
            <Text bold color="magenta">➔ Processing: </Text>
            <Text bold color="white">[{state.currentItem.index}/{state.currentItem.total}] </Text>
            <Text color="cyan">{state.currentItem.label}</Text>
          </Box>
        )}
      </Box>

      {/* Log */}
      <LogPanel logs={logs} maxLines={12} />

      {/* Error Card */}
      {status === 'error' && (
        <Box flexDirection="column" borderStyle="double" borderColor="red" paddingX={1} marginTop={1}>
          <Text bold color="red">✗ FATAL PIPELINE ERROR</Text>
          {lastErrorLog && (
            <Box marginTop={1}>
              <Text color="white" bold>Detail: {lastErrorLog.msg}</Text>
            </Box>
          )}
          {lastWarnLog && (
            <Box marginTop={1}>
              <Text color="yellow">{lastWarnLog.msg}</Text>
            </Box>
          )}
          <Box marginTop={1}>
            <Text dimColor>Press [q] or [Esc] to exit</Text>
          </Box>
        </Box>
      )}

      {/* Result */}
      {status === 'done' && (
        <ResultSummary done={done} failed={failed.length} />
      )}

      {/* Controls hint */}
      <Box marginTop={1}>
        <Text dimColor>
          {status === 'running' && '[p] pause  [c] cancel'}
          {status === 'paused'  && '[p] resume  [c] cancel'}
          {status === 'done'    && (failed.length > 0 ? '[r] retry  [q] quit' : '[q] quit')}
          {status === 'error'   && '[q] quit'}
        </Text>
      </Box>

    </Box>
  );
}
