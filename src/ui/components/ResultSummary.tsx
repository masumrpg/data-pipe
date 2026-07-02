import { Box, Text } from 'ink';

type Props = { done: number; failed: number };

export function ResultSummary({ done, failed }: Props) {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text>
        <Text color="green">✓ {done} succeeded</Text>
        {'  '}
        {failed > 0
          ? <Text color="red">✗ {failed} failed</Text>
          : <Text color="green">✗ 0 failed</Text>
        }
      </Text>
      {failed > 0 && (
        <Text dimColor>Press <Text color="yellow">r</Text> to retry failed items</Text>
      )}
    </Box>
  );
}
