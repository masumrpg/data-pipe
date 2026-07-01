import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import Papa from 'papaparse';
import type { Reader } from '../../shared/types';
import { fileError, parseError } from '../../shared/errors';

type CsvSourceConfig = {
  type: 'csv';
  filePath: string;
  delimiter: string;
  hasHeader: boolean;
};

export class CsvReader implements Reader {
  constructor(private config: CsvSourceConfig) {}

  async fetchAll(onProgress: (fetched: number, total: number, current?: string | number) => void): Promise<unknown[]> {
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

    // Check empty file
    if (raw.trim().length === 0) {
      throw parseError(filePath, 'CSV', new Error('File CSV kosong.'));
    }

    // Parse CSV
    const result = Papa.parse(raw, {
      header: this.config.hasHeader,
      delimiter: this.config.delimiter,
      skipEmptyLines: true,
      dynamicTyping: true,
    });

    if (result.errors.length > 0) {
      const fatalErrors = result.errors.filter((e) => e.type === 'Quotes' || e.type === 'FieldMismatch');
      if (fatalErrors.length > 0) {
        const errMsgs = fatalErrors.slice(0, 3).map((e) => `Baris ${(e.row ?? 0) + 1}: ${e.message}`).join('; ');
        throw parseError(filePath, 'CSV', new Error(errMsgs));
      }
    }

    const data = result.data as unknown[];

    if (data.length === 0) {
      throw parseError(filePath, 'CSV', new Error('CSV tidak memiliki data (0 baris).'));
    }

    onProgress(data.length, data.length, 'file');
    return data;
  }
}
