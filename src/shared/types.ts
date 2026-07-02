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
  | { type: 'postgres'; connectionString: string; table: string; schema?: string }
  | { type: 'sqlite'; filePath: string; table: string };

export type OperationConfig = {
  mode: 'insert' | 'upsert' | 'update';
  conflictOn?: string[];                                    // untuk upsert
  updateWhere?: { column: string; fromField?: string }[];   // untuk update
};

export type MappingRule = {
  from: string;              // dot-path from source, e.g. "profile.name"
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
  | 'toJsonString'
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
  fetchProgress?: { fetched: number; total: number; current?: string | number } | null;
  currentItem?: { index: number; total: number; label: string } | null;
};

// Reader & Writer interfaces
export interface Reader {
  fetchAll(onProgress: (fetched: number, total: number, current?: string | number) => void): Promise<unknown[]>;
}

export interface Writer {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  write(row: Record<string, unknown>, op: OperationConfig, table: string): Promise<void>;
}
