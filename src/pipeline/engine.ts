import { EventEmitter } from 'events';
import { createReader } from './reader/index';
import { createWriter } from './writer/index';
import { applyMapping } from './mapper';
import type { PipelineConfig, RunState, LogEntry } from '../shared/types';
import { DataPipeError, connectionError, writeError, fetchError } from '../shared/errors';

function getItemLabel(item: unknown): string {
  if (item == null) return '';
  if (typeof item !== 'object') return String(item);
  
  const record = item as Record<string, unknown>;

  // Check top-level candidates
  const candidates = ['namaLatin', 'name', 'title', 'nama', 'sku', 'id', 'nomor'];
  for (const key of candidates) {
    if (record[key] !== undefined) {
      return String(record[key]);
    }
  }

  // Check nested candidates (in case requests are merged, e.g. item.equran.namaLatin)
  for (const key of Object.keys(record)) {
    const val = record[key];
    if (val && typeof val === 'object') {
      const nestedLabel = getItemLabel(val);
      if (nestedLabel) return nestedLabel;
    }
  }

  // Fallback to first string/number value
  for (const key of Object.keys(record)) {
    const val = record[key];
    if (typeof val === 'string' || typeof val === 'number') {
      return `${key}: ${val}`;
    }
  }

  return '';
}

export class PipelineEngine extends EventEmitter {
  private paused = false;
  private cancelled = false;
  private state: RunState = {
    status: 'idle',
    total: 0,
    done: 0,
    failed: [],
    logs: [],
  };

  constructor(
    private config: PipelineConfig,
    private dryRun: boolean = false,
  ) {
    super();
  }

  private log(level: LogEntry['level'], msg: string) {
    const entry: LogEntry = { ts: new Date().toISOString(), level, msg };
    this.state.logs.push(entry);
    this.emit('log', entry);
  }

  private setStatus(status: RunState['status']) {
    this.state.status = status;
    this.emit('status', status);
  }

  getState() {
    return { ...this.state };
  }

  async run() {
    this.cancelled = false;
    this.paused = false;
    this.state = { status: 'idle', total: 0, done: 0, failed: [], logs: [] };

    try {
      // ── Connect to target DB ──
      let writer: ReturnType<typeof createWriter> | null = null;

      if (!this.dryRun) {
        this.setStatus('connecting');
        this.log('info', `Connecting to ${this.config.target.type}...`);

        try {
          writer = createWriter(this.config.target);
          await writer.connect();
          this.log('info', `✓ Connected to ${this.config.target.type}`);
        } catch (err: any) {
          const dpErr = err instanceof DataPipeError
            ? err
            : connectionError(this.config.target.type, err);
          this.log('error', dpErr.message);
          if (dpErr.hint) this.log('warn', `💡 ${dpErr.hint}`);
          this.setStatus('error');
          this.emit('error', dpErr);
          return;
        }
      } else {
        this.log('info', '🏷️  Dry run — skipping database connection');
      }

      // Helper function to process a single item
      const processItem = async (item: unknown, idx: number, total: number) => {
        this.emit('item-processing', {
          index: idx + 1,
          total: total,
          label: getItemLabel(item),
        });

        // Handle pause
        while (this.paused && !this.cancelled) {
          await new Promise((r) => setTimeout(r, 100));
        }
        if (this.cancelled) {
          this.log('warn', `Pipeline cancelled at item ${idx + 1}/${total}`);
          return false;
        }

        try {
          const rows = applyMapping(item, this.config.mapping);

          if (rows.length === 0) {
            this.log('warn', `Item ${idx + 1}: mapping returned 0 rows (skipped)`);
          }

          if (!this.dryRun && writer) {
            for (const row of rows) {
              try {
                await writer.write(row, this.config.operation, this.config.target.table, this.config.mapping);
              } catch (err: any) {
                const dpErr = err instanceof DataPipeError
                  ? err
                  : writeError(this.config.target.table, err);
                throw dpErr;
              }
            }
          }

          this.state.done++;
          const currentTotal = this.state.total || total || 1;
          this.emit('progress', {
            done: this.state.done,
            total: currentTotal,
            percent: Math.round((this.state.done / currentTotal) * 100),
          });
        } catch (err: any) {
          const errMsg = err instanceof DataPipeError ? err.message : err.message ?? String(err);
          const failed = { item, error: errMsg };
          this.state.failed.push(failed);
          this.log('error', `Item ${idx + 1} failed: ${errMsg}`);
          if (err instanceof DataPipeError && err.hint) {
            this.log('warn', `💡 ${err.hint}`);
          }
          this.emit('item-failed', failed);
        }
        return true;
      };

      const reader = createReader(this.config.source);
      let itemIndex = 0;

      if (reader.stream) {
        this.setStatus('fetching');
        this.log('info', `Streaming data from ${this.config.source.type}...`);

        try {
          await reader.stream(
            async (chunk) => {
              if (this.state.status === 'fetching' || this.state.status === 'connecting') {
                this.setStatus('running');
              }
              for (const item of chunk) {
                const idx = itemIndex++;
                const keepGoing = await processItem(item, idx, this.state.total || chunk.length);
                if (!keepGoing) break;
              }
            },
            (fetched, total, current) => {
              this.state.total = total;
              this.emit('total', total);
              this.emit('fetch-progress', { fetched, total, current });
            }
          );
        } catch (err: any) {
          const dpErr = err instanceof DataPipeError ? err : this.wrapFetchError(err);
          this.log('error', dpErr.message);
          if (dpErr.hint) this.log('warn', `💡 ${dpErr.hint}`);
          this.setStatus('error');
          this.emit('error', dpErr);
          if (writer) {
            try { await writer.disconnect(); } catch {}
          }
          return;
        }
      } else {
        this.setStatus('fetching');
        this.log('info', `Fetching data from ${this.config.source.type}...`);

        let items: unknown[];
        try {
          items = await reader.fetchAll((fetched, total, current) => {
            this.emit('fetch-progress', { fetched, total, current });
          });
        } catch (err: any) {
          const dpErr = err instanceof DataPipeError ? err : this.wrapFetchError(err);
          this.log('error', dpErr.message);
          if (dpErr.hint) this.log('warn', `💡 ${dpErr.hint}`);
          this.setStatus('error');
          this.emit('error', dpErr);
          if (writer) {
            try { await writer.disconnect(); } catch {}
          }
          return;
        }

        if (items.length === 0) {
          this.log('warn', 'No data found from the source.');
          this.setStatus('done');
          this.emit('done', this.state);
          if (writer) {
            try { await writer.disconnect(); } catch {}
          }
          return;
        }

        this.state.total = items.length;
        this.emit('total', items.length);
        this.log('info', `✓ Total items: ${items.length}`);

        this.setStatus('running');
        for (const item of items) {
          const idx = itemIndex++;
          const keepGoing = await processItem(item, idx, items.length);
          if (!keepGoing) break;
        }
      }

      // ── Cleanup ──
      if (writer) {
        try {
          await writer.disconnect();
        } catch (err: any) {
          this.log('warn', `Failed to close database connection: ${err.message}`);
        }
      }

      this.setStatus('done');

      const summary = this.dryRun
        ? `Dry run complete — ${this.state.done} items processed (nothing written to DB)`
        : `Complete — succeeded: ${this.state.done}, failed: ${this.state.failed.length}`;
      this.log('info', summary);

      // Save failed items to file for retry
      if (this.state.failed.length > 0) {
        try {
          const failedPath = './datapipe-failed.json';
          const { writeFileSync } = await import('fs');
          writeFileSync(failedPath, JSON.stringify(this.state.failed, null, 2));
          this.log('info', `Failed items list saved to ${failedPath}`);
        } catch {
          this.log('warn', 'Failed to write failed items list to file.');
        }
      }

      this.emit('done', this.state);
    } catch (err: any) {
      // Catch-all for truly unexpected errors
      const msg = err instanceof DataPipeError ? err.message : `Unexpected: ${err.message}`;
      this.log('error', msg);
      if (err instanceof DataPipeError && err.hint) {
        this.log('warn', `💡 ${err.hint}`);
      }
      this.setStatus('error');
      this.emit('error', err);
    }
  }

  pause() {
    this.paused = true;
    this.setStatus('paused');
    this.log('info', '⏸ Pipeline paused');
  }

  resume() {
    this.paused = false;
    this.setStatus('running');
    this.log('info', '▶ Pipeline resumed');
  }

  cancel() {
    this.cancelled = true;
    this.paused = false;
    this.log('warn', '✗ Cancelling pipeline...');
  }

  async retryFailed() {
    const toRetry = [...this.state.failed];
    if (toRetry.length === 0) {
      this.log('info', 'No failed items to retry.');
      return;
    }

    this.state.failed = [];
    this.setStatus('running');
    this.log('info', `🔁 Retrying ${toRetry.length} failed items...`);

    let writer: ReturnType<typeof createWriter>;
    try {
      writer = createWriter(this.config.target);
      await writer.connect();
    } catch (err: any) {
      const dpErr = err instanceof DataPipeError
        ? err
        : connectionError(this.config.target.type, err);
      this.log('error', `Retry failed: ${dpErr.message}`);
      if (dpErr.hint) this.log('warn', `💡 ${dpErr.hint}`);
      this.state.failed = toRetry;
      this.setStatus('done');
      this.emit('retry-done', { remaining: toRetry.length });
      return;
    }

    for (const { item } of toRetry) {
      try {
        const rows = applyMapping(item, this.config.mapping);
        for (const row of rows) {
          await writer.write(row, this.config.operation, this.config.target.table, this.config.mapping);
        }
        this.state.done++;
        this.log('info', '✓ Retry succeeded');
      } catch (err: any) {
        const errMsg = err instanceof DataPipeError ? err.message : err.message ?? String(err);
        this.state.failed.push({ item, error: errMsg });
        this.log('error', `Retry failed item: ${errMsg}`);
      }
    }

    try {
      await writer.disconnect();
    } catch {}

    this.setStatus('done');
    this.log('info', `Retry completed — remaining failures: ${this.state.failed.length}`);
    this.emit('retry-done', { remaining: this.state.failed.length });
  }

  private wrapFetchError(err: Error): DataPipeError {
    if (this.config.source.type === 'api') {
      return fetchError('API source', undefined, err);
    }
    const filePath = 'filePath' in this.config.source ? (this.config.source as any).filePath : 'unknown';
    return new DataPipeError('FETCH_ERROR', `Failed to read source: ${err.message}`, `Check file path: ${filePath}`);
  }
}
