import type { SourceConfig, Reader } from '../../shared/types';
import { JsonReader } from './json.reader';
import { CsvReader } from './csv.reader';
import { ApiReader } from './api.reader';

export function createReader(config: SourceConfig): Reader {
  switch (config.type) {
    case 'json': return new JsonReader(config);
    case 'csv':  return new CsvReader(config);
    case 'api':  return new ApiReader(config);
    default:     throw new Error(`Source type tidak dikenal`);
  }
}
