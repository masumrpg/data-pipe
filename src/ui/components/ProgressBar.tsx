import { Box, Text } from 'ink';

type Props = {
  done: number;
  total: number;
  width?: number;
  hasFailed?: boolean;
  label?: string;
};

export function ProgressBar({ done, total, width = 40, hasFailed, label = 'items' }: Props) {
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  const filled  = Math.round((percent / 100) * width);
  const empty   = width - filled;
  const bar     = '█'.repeat(filled) + '░'.repeat(empty);
  const color   = hasFailed ? 'yellow' : percent === 100 ? 'green' : 'cyan';

  return (
    <Box flexDirection="column" marginY={0}>
      <Text color={color}>{bar} {percent}%</Text>
      <Text dimColor>{done} / {total} {label}</Text>
    </Box>
  );
}
