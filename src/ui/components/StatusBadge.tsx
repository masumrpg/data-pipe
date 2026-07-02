import { Text } from 'ink';
import type { RunStatus } from '../../shared/types';

const STATUS_MAP: Record<RunStatus, { label: string; color: string }> = {
  idle:       { label: '○ IDLE',       color: 'gray' },
  connecting: { label: '◌ CONNECTING', color: 'yellow' },
  fetching:   { label: '⟳ FETCHING',   color: 'cyan' },
  running:    { label: '▶ RUNNING',    color: 'green' },
  paused:     { label: '⏸ PAUSED',     color: 'yellow' },
  done:       { label: '✓ DONE',       color: 'green' },
  error:      { label: '✗ ERROR',      color: 'red' },
};

export function StatusBadge({ status }: { status: RunStatus }) {
  const { label, color } = STATUS_MAP[status];
  return <Text bold color={color}>{label}</Text>;
}
