# DataPipe

Generic data pipeline CLI — define source, mapping, dan target via file konfigurasi JSON/YAML, jalankan via terminal dengan UI interaktif berbasis **React Ink**.

---

## Stack

| Layer | Pilihan |
|---|---|
| Runtime | **Bun** |
| UI Terminal | **React Ink** |
| DB | **PostgreSQL** (`pg`) · **SQLite** (`bun:sqlite`) |
| Config parser | **js-yaml** |
| CSV parser | **papaparse** |
| Language | **TypeScript** |

---

## Struktur Folder

```
datapipe/
├── src/
│   ├── index.tsx               ← entry point (Ink render)
│   ├── cli.ts                  ← parse argv, load config
│   ├── pipeline/
│   │   ├── engine.ts           ← orchestrator utama
│   │   ├── reader/
│   │   │   ├── index.ts        ← factory reader
│   │   │   ├── json.reader.ts
│   │   │   ├── csv.reader.ts
│   │   │   └── api.reader.ts
│   │   ├── mapper.ts           ← field mapping + transform
│   │   └── writer/
│   │       ├── index.ts        ← factory writer
│   │       ├── postgres.writer.ts
│   │       └── sqlite.writer.ts
│   ├── ui/
│   │   ├── App.tsx             ← root Ink component
│   │   ├── components/
│   │   │   ├── ProgressBar.tsx
│   │   │   ├── LogPanel.tsx
│   │   │   ├── StatusBadge.tsx
│   │   │   └── ResultSummary.tsx
│   │   └── hooks/
│   │       └── usePipeline.ts  ← state + engine bridge
│   └── shared/
│       └── types.ts            ← semua types
├── pipelines/                  ← folder config pipeline
│   ├── pipeline.schema.json
│   ├── equran/
│   │   ├── pipeline.json
│   │   ├── input/
│   │   └── output/
│   ├── products/
│   │   ├── pipeline.json
│   │   ├── input/
│   │   │   └── products.csv
│   │   ├── output/
│   │   │   └── products.db
│   │   └── init-db.ts
│   └── quran/
│       ├── init-db.ts          ← inisialisasi schema DB postgres
│       └── pipeline.json       ← pipeline config untuk generic CLI
└── package.json
```

---

## Install

```bash
bun init -y
bun add ink react
bun add pg papaparse js-yaml
bun add -d @types/react @types/pg @types/papaparse @types/js-yaml typescript
```

---

## Cara Pakai

```bash
# Inisialisasi DB postgres & schema untuk quran
bun run pipelines/quran/init-db.ts

# Seed data quran (fetch API & write ke postgres)
bun run src/index.tsx --pipeline pipelines/quran/pipeline.json

# Dry run — fetch + mapping tapi tidak insert ke DB
bun run src/index.tsx --pipeline pipelines/quran/pipeline.json --dry-run

# Retry item gagal dari run sebelumnya (baca dari failed.json)
bun run src/index.tsx --pipeline pipelines/quran/pipeline.json --retry

# Test koneksi DB saja
bun run src/index.tsx --pipeline pipelines/quran/pipeline.json --test-connection
```

---

## Format Konfigurasi Pipeline

Satu file = satu pipeline. Simpan di folder `pipelines/`.

### Contoh — API multi-source + merge (Quran)

```json
{
  "name": "Quran Seed — equran.id + tajweed",
  "version": "1.0",

  "source": {
    "type": "api",
    "pagination": {
      "type": "range",
      "param": "index",
      "from": 1,
      "to": 114
    },
    "requests": [
      {
        "id": "equran",
        "url": "https://equran.id/api/v2/surat/{index}",
        "resultPath": "data"
      },
      {
        "id": "tajweed",
        "url": "https://api.alquran.cloud/v1/surah/{index}/quran-tajweed",
        "resultPath": "data"
      }
    ],
    "mergeKey": "index",
    "delayMs": 300
  },

  "target": {
    "type": "postgres",
    "connectionString": "postgresql://user:pass@localhost:5432/qurandb",
    "table": "quran_ayat"
  },

  "operation": {
    "mode": "upsert",
    "conflictOn": ["nomor_surah", "nomor_ayat"]
  },

  "mapping": [
    { "from": "equran.nomor",     "to": "nomor_surah" },
    { "from": "equran.nama",      "to": "nama_surah" },
    { "from": "equran.namaLatin", "to": "nama_latin" },
    { "from": "equran.arti",      "to": "nama_indonesia" },
    {
      "from": "equran.ayat",
      "expand": true,
      "mapping": [
        { "from": "nomorAyat",               "to": "nomor_ayat" },
        { "from": "teksArab",                "to": "teks_arab" },
        { "from": "teksLatin",               "to": "teks_latin" },
        { "from": "teksIndonesia",           "to": "teks_indonesia" },
        { "from": "audio.01",               "to": "audio_alafasy" },
        { "from": "tajweed.ayahs[nomorAyat].text", "to": "teks_arab_tajweed" }
      ]
    }
  ]
}
```

### Contoh — CSV lokal ke SQLite

```json
{
  "name": "Import produk dari CSV",
  "source": {
    "type": "csv",
    "filePath": "./exports/products.csv",
    "delimiter": ",",
    "hasHeader": true
  },
  "target": {
    "type": "sqlite",
    "filePath": "./local.db",
    "table": "products"
  },
  "operation": {
    "mode": "update",
    "updateWhere": [{ "column": "sku", "fromField": "SKU" }]
  },
  "mapping": [
    { "from": "SKU",       "to": "sku" },
    { "from": "Name",      "to": "name" },
    { "from": "Price",     "to": "price",      "transform": "toFloat" },
    { "from": "Stock",     "to": "stock",      "transform": "toInt" },
    { "from": "UpdatedAt", "to": "updated_at", "transform": "toISODate" }
  ]
}
```

### Contoh — JSON lokal ke PostgreSQL

```json
{
  "name": "Import users dari JSON",
  "source": {
    "type": "json",
    "filePath": "./data/users.json",
    "resultPath": "data.users"
  },
  "target": {
    "type": "postgres",
    "connectionString": "postgresql://user:pass@localhost:5432/appdb",
    "table": "users"
  },
  "operation": {
    "mode": "insert"
  },
  "mapping": [
    { "from": "id",    "to": "external_id" },
    { "from": "name",  "to": "full_name",   "transform": "trim" },
    { "from": "email", "to": "email",       "transform": "toLower" },
    { "from": "role",  "to": "role",        "default": "user" }
  ]
}
```

---

## Shared Types (`src/shared/types.ts`)

```ts
export type SourceConfig =
  | { type: 'json'; filePath: string; resultPath?: string }
  | { type: 'csv'; filePath: string; delimiter: string; hasHeader: boolean }
  | {
      type: 'api';
      requests: ApiRequest[];
      pagination: PaginationConfig;
      mergeKey: string;
      delayMs: number;
    };

export type ApiRequest = {
  id: string;
  url: string;           // {index} diganti nilai pagination
  resultPath?: string;   // dot-path ke array data, misal "data.items"
  headers?: Record<string, string>;
};

export type PaginationConfig =
  | { type: 'range'; param: string; from: number; to: number }
  | { type: 'cursor'; param: string; nextPath: string }
  | { type: 'none' };

export type TargetConfig =
  | { type: 'postgres'; connectionString: string; table: string }
  | { type: 'sqlite'; filePath: string; table: string };

export type OperationConfig = {
  mode: 'insert' | 'upsert' | 'update';
  conflictOn?: string[];                                    // untuk upsert
  updateWhere?: { column: string; fromField: string }[];   // untuk update
};

export type MappingRule = {
  from: string;              // dot-path dari source, misal "equran.namaLatin"
  to: string;                // nama kolom di DB target
  transform?: TransformKey;
  default?: unknown;         // nilai default kalau null/undefined
  expand?: boolean;          // expand array → multiple rows
  mapping?: MappingRule[];   // child mapping kalau expand: true
};

export type TransformKey =
  | 'toInt'
  | 'toFloat'
  | 'toString'
  | 'toISODate'
  | 'toLower'
  | 'toUpper'
  | 'trim'
  | 'nullIfEmpty';

export type PipelineConfig = {
  name: string;
  version: string;
  source: SourceConfig;
  target: TargetConfig;
  operation: OperationConfig;
  mapping: MappingRule[];
};

// State yang mengalir dari engine ke UI
export type RunStatus = 'idle' | 'connecting' | 'fetching' | 'running' | 'paused' | 'done' | 'error';

export type LogEntry = {
  ts: string;
  level: 'info' | 'warn' | 'error';
  msg: string;
};

export type RunState = {
  status: RunStatus;
  total: number;
  done: number;
  failed: { item: unknown; error: string }[];
  logs: LogEntry[];
};
```

---

## Engine (`src/pipeline/engine.ts`)

Engine berjalan di Node/Bun process biasa — tidak perlu IPC karena Ink berjalan di proses yang sama. Gunakan **EventEmitter** untuk emit progress ke UI.

```ts
import { EventEmitter } from 'events';
import { createReader } from './reader';
import { createWriter } from './writer';
import { applyMapping } from './mapper';
import type { PipelineConfig, RunState, LogEntry } from '../shared/types';

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

  constructor(private config: PipelineConfig) {
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

  getState() { return { ...this.state }; }

  async run() {
    this.cancelled = false;
    this.paused = false;
    this.state = { status: 'idle', total: 0, done: 0, failed: [], logs: [] };

    try {
      this.setStatus('connecting');
      const writer = createWriter(this.config.target);
      await writer.connect();
      this.log('info', `Terhubung ke ${this.config.target.type}`);

      this.setStatus('fetching');
      const reader = createReader(this.config.source);
      const items = await reader.fetchAll((fetched, total) => {
        this.emit('fetch-progress', { fetched, total });
      });

      this.state.total = items.length;
      this.emit('total', items.length);
      this.log('info', `Total item: ${items.length}`);

      this.setStatus('running');

      for (const item of items) {
        while (this.paused && !this.cancelled) {
          await new Promise(r => setTimeout(r, 100));
        }
        if (this.cancelled) break;

        try {
          const rows = applyMapping(item, this.config.mapping);
          for (const row of rows) {
            await writer.write(row, this.config.operation, this.config.target.table);
          }
          this.state.done++;
          this.emit('progress', {
            done: this.state.done,
            total: this.state.total,
            percent: Math.round((this.state.done / this.state.total) * 100),
          });
        } catch (err: any) {
          const failed = { item, error: err.message };
          this.state.failed.push(failed);
          this.log('error', `Item gagal: ${err.message}`);
          this.emit('item-failed', failed);
        }
      }

      await writer.disconnect();
      this.setStatus('done');
      this.log('info', `Selesai — berhasil: ${this.state.done}, gagal: ${this.state.failed.length}`);
      this.emit('done', this.state);

    } catch (err: any) {
      this.log('error', `Fatal: ${err.message}`);
      this.setStatus('error');
      this.emit('error', err);
    }
  }

  pause()  { this.paused = true;  this.setStatus('paused'); }
  resume() { this.paused = false; this.setStatus('running'); }
  cancel() { this.cancelled = true; this.paused = false; }

  async retryFailed() {
    const toRetry = [...this.state.failed];
    this.state.failed = [];
    this.log('info', `Retry ${toRetry.length} item gagal...`);

    const writer = createWriter(this.config.target);
    await writer.connect();

    for (const { item } of toRetry) {
      try {
        const rows = applyMapping(item, this.config.mapping);
        for (const row of rows) {
          await writer.write(row, this.config.operation, this.config.target.table);
        }
        this.state.done++;
        this.log('info', 'Retry berhasil');
      } catch (err: any) {
        this.state.failed.push({ item, error: err.message });
        this.log('error', `Retry gagal: ${err.message}`);
      }
    }

    await writer.disconnect();
    this.emit('retry-done', { remaining: this.state.failed.length });
  }
}
```

---

## UI dengan React Ink

### Hook (`src/ui/hooks/usePipeline.ts`)

```ts
import { useState, useEffect, useCallback, useRef } from 'react';
import { PipelineEngine } from '../../pipeline/engine';
import type { PipelineConfig, RunState, LogEntry } from '../../shared/types';

export function usePipeline(config: PipelineConfig) {
  const engineRef = useRef<PipelineEngine | null>(null);
  const [state, setState] = useState<RunState>({
    status: 'idle', total: 0, done: 0, failed: [], logs: [],
  });

  useEffect(() => {
    const engine = new PipelineEngine(config);
    engineRef.current = engine;

    engine.on('status',   (s)   => setState(p => ({ ...p, status: s })));
    engine.on('total',    (t)   => setState(p => ({ ...p, total: t })));
    engine.on('progress', (pg)  => setState(p => ({ ...p, done: pg.done })));
    engine.on('log',      (l: LogEntry) => setState(p => ({ ...p, logs: [...p.logs.slice(-200), l] })));
    engine.on('item-failed', (f) => setState(p => ({ ...p, failed: [...p.failed, f] })));
    engine.on('done',     (s)   => setState(s));

    // Auto-start
    engine.run();

    return () => { engine.removeAllListeners(); };
  }, []);

  const pause  = useCallback(() => engineRef.current?.pause(), []);
  const resume = useCallback(() => engineRef.current?.resume(), []);
  const cancel = useCallback(() => engineRef.current?.cancel(), []);
  const retry  = useCallback(() => engineRef.current?.retryFailed(), []);

  return { state, pause, resume, cancel, retry };
}
```

### Components

**`src/ui/components/ProgressBar.tsx`**:
```tsx
import React from 'react';
import { Box, Text } from 'ink';

type Props = {
  done: number;
  total: number;
  width?: number;
  hasFailed?: boolean;
};

export function ProgressBar({ done, total, width = 40, hasFailed }: Props) {
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  const filled  = Math.round((percent / 100) * width);
  const empty   = width - filled;
  const bar     = '█'.repeat(filled) + '░'.repeat(empty);
  const color   = hasFailed ? 'yellow' : percent === 100 ? 'green' : 'cyan';

  return (
    <Box flexDirection="column" marginY={0}>
      <Text color={color}>{bar} {percent}%</Text>
      <Text dimColor>{done} / {total} item</Text>
    </Box>
  );
}
```

**`src/ui/components/StatusBadge.tsx`**:
```tsx
import React from 'react';
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
```

**`src/ui/components/LogPanel.tsx`**:
```tsx
import React from 'react';
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
        ? <Text dimColor>Menunggu...</Text>
        : visible.map((l, i) => (
          <Text key={i} color={LEVEL_COLOR[l.level]}>
            <Text dimColor>{l.ts.slice(11, 19)}</Text>
            {' '}{l.msg}
          </Text>
        ))
      }
    </Box>
  );
}
```

**`src/ui/components/ResultSummary.tsx`**:
```tsx
import React from 'react';
import { Box, Text } from 'ink';

type Props = { done: number; failed: number; onRetry?: () => void };

export function ResultSummary({ done, failed, onRetry }: Props) {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text>
        <Text color="green">✓ {done} berhasil</Text>
        {'  '}
        {failed > 0
          ? <Text color="red">✗ {failed} gagal</Text>
          : <Text color="green">✗ 0 gagal</Text>
        }
      </Text>
      {failed > 0 && (
        <Text dimColor>Tekan <Text color="yellow">r</Text> untuk retry item gagal</Text>
      )}
    </Box>
  );
}
```

### Root App (`src/ui/App.tsx`)

```tsx
import React from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { usePipeline } from './hooks/usePipeline';
import { ProgressBar } from './components/ProgressBar';
import { StatusBadge } from './components/StatusBadge';
import { LogPanel } from './components/LogPanel';
import { ResultSummary } from './components/ResultSummary';
import type { PipelineConfig } from '../shared/types';

type Props = { config: PipelineConfig; dryRun?: boolean };

export function App({ config, dryRun }: Props) {
  const { state, pause, resume, cancel, retry } = usePipeline(config);
  const { exit } = useApp();
  const { status, done, total, failed, logs } = state;

  // Keyboard controls
  useInput((input, key) => {
    if (input === 'p' && status === 'running') pause();
    if (input === 'p' && status === 'paused')  resume();
    if (input === 'c' && status !== 'done')    cancel();
    if (input === 'r' && status === 'done' && failed.length > 0) retry();
    if ((input === 'q' || key.escape) && status === 'done') exit();
  });

  const percent = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <Box flexDirection="column" padding={1} gap={1}>

      {/* Header */}
      <Box gap={2} alignItems="center">
        <Text bold color="cyan">DataPipe</Text>
        <Text dimColor>›</Text>
        <Text>{config.name}</Text>
        {dryRun && <Text color="yellow">[DRY RUN]</Text>}
      </Box>

      {/* Status + progress */}
      <Box flexDirection="column" gap={1}>
        <StatusBadge status={status} />
        {(status === 'running' || status === 'paused' || status === 'done') && (
          <ProgressBar
            done={done}
            total={total}
            hasFailed={failed.length > 0}
          />
        )}
      </Box>

      {/* Log */}
      <LogPanel logs={logs} maxLines={14} />

      {/* Result */}
      {status === 'done' && (
        <ResultSummary done={done} failed={failed.length} onRetry={retry} />
      )}

      {/* Controls hint */}
      <Box marginTop={1}>
        <Text dimColor>
          {status === 'running' && '[p] pause  [c] cancel'}
          {status === 'paused'  && '[p] resume  [c] cancel'}
          {status === 'done'    && (failed.length > 0 ? '[r] retry  [q] keluar' : '[q] keluar')}
        </Text>
      </Box>

    </Box>
  );
}
```

### Entry Point (`src/index.tsx`)

```tsx
import React from 'react';
import { render } from 'ink';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import yaml from 'js-yaml';
import { App } from './ui/App';
import type { PipelineConfig } from './shared/types';

function parseArgs() {
  const args = process.argv.slice(2);
  const get  = (flag: string) => {
    const i = args.indexOf(flag);
    return i !== -1 ? args[i + 1] : null;
  };

  return {
    pipelinePath: get('--pipeline') ?? get('-p'),
    dryRun:       args.includes('--dry-run'),
    testConn:     args.includes('--test-connection'),
    retry:        args.includes('--retry'),
  };
}

async function main() {
  const { pipelinePath, dryRun } = parseArgs();

  if (!pipelinePath) {
    console.error('Usage: datapipe --pipeline <path/to/pipeline.json>');
    process.exit(1);
  }

  const raw  = readFileSync(resolve(pipelinePath), 'utf-8');
  const config: PipelineConfig = pipelinePath.endsWith('.yaml') || pipelinePath.endsWith('.yml')
    ? yaml.load(raw) as PipelineConfig
    : JSON.parse(raw);

  render(<App config={config} dryRun={dryRun} />);
}

main();
```

---

## Package.json

```json
{
  "name": "datapipe",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev":   "bun run src/index.tsx",
    "start": "bun run src/index.tsx",
    "build": "bun build src/index.tsx --outfile dist/datapipe.js --target bun"
  },
  "dependencies": {
    "ink": "^5.0.0",
    "react": "^18.0.0",
    "pg": "^8.11.0",
    "papaparse": "^5.4.1",
    "js-yaml": "^4.1.0"
  },
  "devDependencies": {
    "@types/react": "^18.0.0",
    "@types/pg": "^8.0.0",
    "@types/papaparse": "^5.0.0",
    "@types/js-yaml": "^4.0.0",
    "typescript": "^5.0.0"
  }
}
```

---

## Transform yang Tersedia

| Key | Fungsi |
|---|---|
| `toInt` | Parse ke integer |
| `toFloat` | Parse ke float |
| `toString` | Konversi ke string |
| `toISODate` | Parse ke ISO 8601 datetime string |
| `toLower` | Lowercase string |
| `toUpper` | Uppercase string |
| `trim` | Trim whitespace |
| `nullIfEmpty` | Return null kalau kosong/undefined |

Tambah transform baru di `src/pipeline/mapper.ts` di object `TRANSFORMS`.

---

## Operation Mode

| Mode | Keterangan |
|---|---|
| `insert` | INSERT biasa, error kalau duplicate |
| `upsert` | INSERT ... ON CONFLICT DO UPDATE (butuh `conflictOn`) |
| `update` | UPDATE WHERE (butuh `updateWhere`) |

---

## Menambah Source Type Baru

Buat file baru di `src/pipeline/reader/`, implementasikan interface:

```ts
export interface Reader {
  fetchAll(onProgress: (fetched: number, total: number) => void): Promise<unknown[]>;
}
```

Daftarkan di `src/pipeline/reader/index.ts`:

```ts
import type { SourceConfig } from '../../shared/types';
import { JsonReader } from './json.reader';
import { CsvReader }  from './csv.reader';
import { ApiReader }  from './api.reader';

export function createReader(config: SourceConfig) {
  switch (config.type) {
    case 'json': return new JsonReader(config);
    case 'csv':  return new CsvReader(config);
    case 'api':  return new ApiReader(config);
    default:     throw new Error(`Source type tidak dikenal`);
  }
}
```

## Menambah DB Writer Baru

Sama — buat file di `src/pipeline/writer/`, implementasikan interface:

```ts
export interface Writer {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  write(row: Record<string, unknown>, op: OperationConfig, table: string): Promise<void>;
}
```

Daftarkan di `src/pipeline/writer/index.ts`.