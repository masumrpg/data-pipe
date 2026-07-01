import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import type { Reader } from '../../shared/types';
import { fileError, parseError } from '../../shared/errors';

type JsonSourceConfig = {
  type: 'json';
  filePath: string;
  resultPath?: string;
};

/**
 * Resolve a dot-path to extract nested data from a JSON object.
 */
function getByPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce((acc: unknown, key) => {
    if (acc == null) return undefined;
    return (acc as Record<string, unknown>)[key];
  }, obj);
}

export class JsonReader implements Reader {
  constructor(private config: JsonSourceConfig) {}

  async fetchAll(onProgress: (fetched: number, total: number) => void): Promise<unknown[]> {
    const filePath = resolve(this.config.filePath);

    // Check file exists
    if (!existsSync(filePath)) {
      throw fileError(filePath);
    }

    // Read file
    let raw: string;
    try {
      raw = readFileSync(filePath, 'utf-8');
    } catch (err: any) {
      throw fileError(filePath, err);
    }

    // Parse JSON
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err: any) {
      throw parseError(filePath, 'JSON', err);
    }

    // Extract data
    let data: unknown[];
    if (this.config.resultPath) {
      const extracted = getByPath(parsed, this.config.resultPath);
      if (extracted == null) {
        throw parseError(
          filePath,
          'JSON',
          new Error(`resultPath "${this.config.resultPath}" mengembalikan null/undefined. Periksa struktur JSON.`),
        );
      }
      if (!Array.isArray(extracted)) {
        throw parseError(
          filePath,
          'JSON',
          new Error(`resultPath "${this.config.resultPath}" bukan array (tipe: ${typeof extracted}). Data harus berupa array.`),
        );
      }
      data = extracted;
    } else if (Array.isArray(parsed)) {
      data = parsed;
    } else {
      data = [parsed];
    }

    onProgress(data.length, data.length);
    return data;
  }
}
