import type { TargetConfig, Writer } from '../../shared/types';
import { PostgresWriter } from './postgres.writer';
import { SqliteWriter } from './sqlite.writer';

export function createWriter(config: TargetConfig): Writer {
  switch (config.type) {
    case 'postgres': return new PostgresWriter(config);
    case 'sqlite':   return new SqliteWriter(config);
    default:         throw new Error(`Target type tidak dikenal`);
  }
}
