import React from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { usePipeline } from './hooks/usePipeline';
import { ProgressBar } from './components/ProgressBar';
import { StatusBadge } from './components/StatusBadge';
import { LogPanel } from './components/LogPanel';
import { ResultSummary } from './components/ResultSummary';
import type { PipelineConfig } from '../shared/types';

type Props = { config: PipelineConfig; dryRun?: boolean };

export function App({ config, dryRun }: Props) {
  const { state, pause, resume, cancel, retry } = usePipeline(config, dryRun);
  const { exit } = useApp();
  const { status, done, total, failed, logs } = state;

  // Keyboard controls
  useInput((input, key) => {
    if (input === 'p' && status === 'running') pause();
    if (input === 'p' && status === 'paused')  resume();
    if (input === 'c' && status !== 'done' && status !== 'error') cancel();
    if (input === 'r' && status === 'done' && failed.length > 0) retry();
    if ((input === 'q' || key.escape) && (status === 'done' || status === 'error')) exit();
  });

  const percent = total > 0 ? Math.round((done / total) * 100) : 0;

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

      {/* Status + progress */}
      <Box flexDirection="column" gap={1}>
        <StatusBadge status={status} />
        {(status === 'running' || status === 'paused' || status === 'done') && (
          <ProgressBar
            done={done}
            total={total}
            hasFailed={failed.length > 0}
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
        <ResultSummary done={done} failed={failed.length} onRetry={retry} />
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
