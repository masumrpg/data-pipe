import type { Reader, ApiRequest, PaginationConfig } from '../../shared/types';
import { fetchError, DataPipeError } from '../../shared/errors';

type ApiSourceConfig = {
  type: 'api';
  requests: ApiRequest[];
  pagination: PaginationConfig;
  mergeKey: string;
  delayMs: number;
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function safeFetch(url: string, headers?: Record<string, string>): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: headers ?? {},
    });
  } catch (err: any) {
    if (err.message?.includes('ECONNREFUSED') || err.message?.includes('ENOTFOUND')) {
      throw fetchError(url, undefined, new Error(`Server tidak dapat dijangkau. Periksa URL dan koneksi internet.`));
    }
    if (err.message?.includes('timeout') || err.name === 'TimeoutError') {
      throw fetchError(url, undefined, new Error('Request timeout. Server terlalu lama merespon.'));
    }
    throw fetchError(url, undefined, err);
  }

  if (!response.ok) {
    const statusHints: Record<number, string> = {
      400: 'Bad Request — periksa parameter/query string URL.',
      401: 'Unauthorized — periksa Authorization header/token.',
      403: 'Forbidden — akses ditolak. Periksa API key/permission.',
      404: 'Not Found — URL endpoint tidak ditemukan.',
      429: 'Rate Limited — terlalu banyak request. Tambah delayMs.',
      500: 'Internal Server Error — masalah di server API.',
      502: 'Bad Gateway — server API sedang down.',
      503: 'Service Unavailable — server API sedang maintenance.',
    };

    const hint = statusHints[response.status] ?? `HTTP ${response.status}`;
    throw fetchError(url, response.status, new Error(hint));
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch (err: any) {
    throw new DataPipeError(
      'PARSE_ERROR',
      `Gagal parse response JSON dari ${url}`,
      'Response bukan JSON yang valid. Periksa URL endpoint.',
      err,
    );
  }

  return json;
}

export class ApiReader implements Reader {
  constructor(private config: ApiSourceConfig) {}

  async fetchAll(onProgress: (fetched: number, total: number, current?: string | number) => void): Promise<unknown[]> {
    const { pagination, requests, mergeKey, delayMs } = this.config;

    if (pagination.type === 'range') {
      return this.fetchRange(pagination, requests, mergeKey, delayMs, onProgress);
    }

    if (pagination.type === 'cursor') {
      return this.fetchCursor(pagination, requests, delayMs, onProgress);
    }

    // type === 'none'
    return this.fetchSingle(requests, onProgress);
  }

  private async fetchRange(
    pagination: Extract<PaginationConfig, { type: 'range' }>,
    requests: ApiRequest[],
    mergeKey: string,
    delayMs: number,
    onProgress: (fetched: number, total: number, current?: string | number) => void,
  ): Promise<unknown[]> {
    const results: unknown[] = [];
    const total = pagination.to - pagination.from + 1;

    for (let i = pagination.from; i <= pagination.to; i++) {
      const merged: Record<string, unknown> = {};

      for (const req of requests) {
        const url = req.url.replace(`{${pagination.param}}`, String(i));
        const json = await safeFetch(url, req.headers);
        const data = req.resultPath ? getByPath(json, req.resultPath) : json;
        merged[req.id] = data;
      }

      // Attach the pagination index for context
      merged[mergeKey] = i;
      results.push(merged);

      onProgress(results.length, total, i);

      if (delayMs > 0 && i < pagination.to) {
        await delay(delayMs);
      }
    }

    return results;
  }

  private async fetchCursor(
    pagination: Extract<PaginationConfig, { type: 'cursor' }>,
    requests: ApiRequest[],
    delayMs: number,
    onProgress: (fetched: number, total: number, current?: string | number) => void,
  ): Promise<unknown[]> {
    const results: unknown[] = [];
    let cursor: string | null = null;
    let page = 0;
    const maxPages = 10000; // Safety limit

    do {
      if (page >= maxPages) {
        throw new DataPipeError(
          'FETCH_ERROR',
          `Cursor pagination exceeded limit of ${maxPages} pages.`,
          'Potential infinite loop detected — verify nextPath in config.',
        );
      }

      for (const req of requests) {
        let url = req.url;
        if (cursor) {
          const separator = url.includes('?') ? '&' : '?';
          url = `${url}${separator}${pagination.param}=${cursor}`;
        }

        const json = await safeFetch(url, req.headers);
        const data = req.resultPath ? getByPath(json, req.resultPath) : json;

        if (Array.isArray(data)) {
          results.push(...data);
        } else {
          results.push(data);
        }

        // Extract next cursor
        cursor = getByPath(json, pagination.nextPath) as string | null;
      }

      page++;
      onProgress(results.length, results.length, cursor ?? 'last');

      if (delayMs > 0 && cursor) {
        await delay(delayMs);
      }
    } while (cursor);

    return results;
  }

  private async fetchSingle(
    requests: ApiRequest[],
    onProgress: (fetched: number, total: number, current?: string | number) => void,
  ): Promise<unknown[]> {
    const merged: Record<string, unknown> = {};

    for (const req of requests) {
      const json = await safeFetch(req.url, req.headers);
      const data = req.resultPath ? getByPath(json, req.resultPath) : json;
      merged[req.id] = data;
    }

    onProgress(1, 1, 'single');

    // If single request returns array, return as-is
    if (requests.length === 1) {
      const data = merged[requests[0]!.id];
      if (Array.isArray(data)) return data;
    }

    return [merged];
  }
}
