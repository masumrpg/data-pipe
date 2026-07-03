import { Box, Text } from 'ink';
import type { LogEntry } from '../../shared/types';

const LEVEL_COLOR = {
  info:  'white',
  warn:  'yellow',
  error: 'red',
} as const;

type Props = { logs: LogEntry[]; maxLines?: number };

export function LogPanel({ logs, maxLines = 12 }: Props) {
  const visible = logs.slice(-maxLines);

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="gray"
      paddingX={1}
      marginTop={1}
    >
      <Text dimColor>── log ──────────────────────────────</Text>
      {visible.length === 0
        ? <Text dimColor>Waiting...</Text>
        : visible.map((l, i) => {
          let prefix = '';
          if (l.level === 'warn') prefix = '⚠️  [WARN] ';
          if (l.level === 'error') prefix = '🚨  [ERROR] ';

          return (
            <Text key={i} color={LEVEL_COLOR[l.level]} bold={l.level === 'error'}>
              <Text dimColor>{l.ts.slice(11, 19)}</Text>
              {' '}{prefix}{l.msg}
            </Text>
          );
        })
      }
    </Box>
  );
}
