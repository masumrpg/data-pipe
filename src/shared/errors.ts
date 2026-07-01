import type { PipelineConfig } from './types';

export class DataPipeError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly hint?: string,
    public override readonly cause?: Error,
  ) {
    super(message);
    this.name = 'DataPipeError';
  }
}

// ─── Error Factories ──────────────────────────────────────────

export function configError(message: string, hint?: string): DataPipeError {
  return new DataPipeError('CONFIG_ERROR', message, hint);
}

export function fileError(filePath: string, cause?: Error): DataPipeError {
  const msg = cause?.message?.includes('ENOENT')
    ? `File not found: ${filePath}`
    : cause?.message?.includes('EACCES')
      ? `Permission denied reading file: ${filePath}`
      : `Failed to read file: ${filePath}`;

  return new DataPipeError('FILE_ERROR', msg, 'Please verify the file path and check file permissions.', cause);
}

export function parseError(filePath: string, format: string, cause?: Error): DataPipeError {
  return new DataPipeError(
    'PARSE_ERROR',
    `Failed to parse ${format} file: ${filePath}`,
    `Ensure the file is valid ${format}. Details: ${cause?.message ?? 'unknown'}`,
    cause,
  );
}

export function connectionError(type: string, cause?: Error): DataPipeError {
  const detail = extractDbErrorMessage(cause);
  const hints: Record<string, string> = {
    postgres: 'Check connection string, ensure PostgreSQL server is running and user/password are correct.',
    sqlite: 'Check database file path and ensure the parent folder exists.',
  };

  return new DataPipeError(
    'CONNECTION_ERROR',
    `Failed to connect to ${type}: ${detail}`,
    hints[type] ?? 'Please verify database connection settings.',
    cause,
  );
}

export function writeError(table: string, cause?: Error): DataPipeError {
  const detail = extractDbErrorMessage(cause);
  return new DataPipeError(
    'WRITE_ERROR',
    `Failed to write to table "${table}": ${detail}`,
    'Verify the table name, columns, and compatibility of data types.',
    cause,
  );
}

export function fetchError(url: string, status?: number, cause?: Error): DataPipeError {
  const msg = status
    ? `HTTP ${status} from ${url}`
    : `Fetch failed: ${url}`;

  return new DataPipeError(
    'FETCH_ERROR',
    msg,
    cause?.message?.includes('fetch')
      ? 'Verify the URL and ensure the target server is reachable.'
      : `Details: ${cause?.message ?? 'unknown'}`,
    cause,
  );
}

// ─── Config Validator ─────────────────────────────────────────

export function validateConfig(config: unknown): asserts config is PipelineConfig {
  if (!config || typeof config !== 'object') {
    throw configError('Config must be a JSON/YAML object.');
  }

  const c = config as Record<string, unknown>;

  if (!c['name'] || typeof c['name'] !== 'string') {
    throw configError('Field "name" is required (string).', 'Add "name": "Pipeline Name" in your config.');
  }

  if (!c['source'] || typeof c['source'] !== 'object') {
    throw configError('Field "source" is required.', 'Add source configuration (json/csv/api).');
  }

  if (!c['target'] || typeof c['target'] !== 'object') {
    throw configError('Field "target" is required.', 'Add target configuration (postgres/sqlite).');
  }

  if (!c['operation'] || typeof c['operation'] !== 'object') {
    throw configError('Field "operation" is required.', 'Add "operation": { "mode": "insert" }.');
  }

  if (!c['mapping'] || !Array.isArray(c['mapping']) || c['mapping'].length === 0) {
    throw configError('Field "mapping" is required (array, min 1 item).', 'Add mapping rules.');
  }

  // Validate source
  validateSource(c['source'] as Record<string, unknown>);

  // Validate target
  validateTarget(c['target'] as Record<string, unknown>);

  // Validate operation
  validateOperation(c['operation'] as Record<string, unknown>);

  // Validate mapping
  for (const [i, rule] of (c['mapping'] as unknown[]).entries()) {
    validateMappingRule(rule, i);
  }
}

function validateSource(source: Record<string, unknown>) {
  const validTypes = ['json', 'csv', 'api'];
  if (!validTypes.includes(source['type'] as string)) {
    throw configError(
      `Invalid source type "${source['type']}".`,
      `Use one of: ${validTypes.join(', ')}`,
    );
  }

  if (source['type'] === 'json') {
    if (!source['filePath']) {
      throw configError('source.filePath is required for type "json".');
    }
  }

  if (source['type'] === 'csv') {
    if (!source['filePath']) throw configError('source.filePath is required for type "csv".');
    if (!source['delimiter']) throw configError('source.delimiter is required for type "csv".', 'Example: ","');
    if (typeof source['hasHeader'] !== 'boolean') {
      throw configError('source.hasHeader is required (true/false) for type "csv".');
    }
  }

  if (source['type'] === 'api') {
    if (!source['pagination'] || typeof source['pagination'] !== 'object') {
      throw configError('source.pagination is required for type "api".');
    }
    if (!source['requests'] || !Array.isArray(source['requests']) || source['requests'].length === 0) {
      throw configError('source.requests is required (array, min 1 request) for type "api".');
    }
    if (typeof source['delayMs'] !== 'number') {
      throw configError('source.delayMs is required (number) for type "api".', 'Example: 200');
    }

    // Validate each request
    for (const [i, req] of (source['requests'] as unknown[]).entries()) {
      const r = req as Record<string, unknown>;
      if (!r['id']) throw configError(`source.requests[${i}].id is required.`);
      if (!r['url']) throw configError(`source.requests[${i}].url is required.`);
    }

    // Validate pagination
    const pag = source['pagination'] as Record<string, unknown>;
    const pagTypes = ['range', 'cursor', 'none'];
    if (!pagTypes.includes(pag['type'] as string)) {
      throw configError(
        `Invalid source.pagination.type "${pag['type']}".`,
        `Use one of: ${pagTypes.join(', ')}`,
      );
    }

    if (pag['type'] === 'range') {
      if (!pag['param']) throw configError('source.pagination.param is required for type "range".');
      if (typeof pag['from'] !== 'number') throw configError('source.pagination.from is required (number).');
      if (typeof pag['to'] !== 'number') throw configError('source.pagination.to is required (number).');
      if ((pag['from'] as number) > (pag['to'] as number)) {
        throw configError('source.pagination.from cannot be greater than to.');
      }
    }

    if (pag['type'] === 'cursor') {
      if (!pag['param']) throw configError('source.pagination.param is required for type "cursor".');
      if (!pag['nextPath']) throw configError('source.pagination.nextPath is required for type "cursor".');
    }
  }
}

function validateTarget(target: Record<string, unknown>) {
  const validTypes = ['postgres', 'sqlite'];
  if (!validTypes.includes(target['type'] as string)) {
    throw configError(
      `Invalid target type "${target['type']}".`,
      `Use one of: ${validTypes.join(', ')}`,
    );
  }

  if (!target['table'] || typeof target['table'] !== 'string') {
    throw configError('target.table is required (string).');
  }

  if (target['type'] === 'postgres') {
    if (!target['connectionString'] || typeof target['connectionString'] !== 'string') {
      throw configError(
        'target.connectionString is required for type "postgres".',
        'Example: "postgresql://user:pass@localhost:5432/mydb"',
      );
    }
  }

  if (target['type'] === 'sqlite') {
    if (!target['filePath'] || typeof target['filePath'] !== 'string') {
      throw configError('target.filePath is required for type "sqlite".', 'Example: "./local.db"');
    }
  }
}

function validateOperation(op: Record<string, unknown>) {
  const validModes = ['insert', 'upsert', 'update'];
  if (!validModes.includes(op['mode'] as string)) {
    throw configError(
      `Invalid operation.mode "${op['mode']}".`,
      `Use one of: ${validModes.join(', ')}`,
    );
  }

  if (op['mode'] === 'upsert') {
    if (!op['conflictOn'] || !Array.isArray(op['conflictOn']) || op['conflictOn'].length === 0) {
      throw configError(
        'operation.conflictOn is required (array, min 1 column) for mode "upsert".',
        'Example: "conflictOn": ["email"]',
      );
    }
  }

  if (op['mode'] === 'update') {
    if (!op['updateWhere'] || !Array.isArray(op['updateWhere']) || op['updateWhere'].length === 0) {
      throw configError(
        'operation.updateWhere is required for mode "update".',
        'Example: "updateWhere": [{ "column": "sku", "fromField": "SKU" }]',
      );
    }
  }
}

function validateMappingRule(rule: unknown, index: number) {
  if (!rule || typeof rule !== 'object') {
    throw configError(`mapping[${index}] must be an object.`);
  }

  const r = rule as Record<string, unknown>;

  if (!r['from'] || typeof r['from'] !== 'string') {
    throw configError(`mapping[${index}].from is required (string).`);
  }

  if (!r['to'] || typeof r['to'] !== 'string') {
    throw configError(`mapping[${index}].to is required (string).`);
  }

  const validTransforms = ['toInt', 'toFloat', 'toString', 'toISODate', 'toLower', 'toUpper', 'trim', 'nullIfEmpty'];
  if (r['transform'] && !validTransforms.includes(r['transform'] as string)) {
    throw configError(
      `Invalid mapping[${index}].transform "${r['transform']}".`,
      `Use one of: ${validTransforms.join(', ')}`,
    );
  }

  if (r['expand'] === true) {
    if (!r['mapping'] || !Array.isArray(r['mapping']) || r['mapping'].length === 0) {
      throw configError(
        `mapping[${index}] with expand: true must contain "mapping" (array, min 1 item).`,
      );
    }
    for (const [ci, childRule] of (r['mapping'] as unknown[]).entries()) {
      validateMappingRule(childRule, ci);
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────

function extractDbErrorMessage(err?: Error): string {
  if (!err) return 'Unknown error';

  const msg = err.message;

  // PostgreSQL specific errors
  if (msg.includes('ECONNREFUSED')) return 'Database server is unreachable (connection refused)';
  if (msg.includes('role') && msg.includes('does not exist')) {
    const match = msg.match(/role "(.+)" does not exist/);
    return match ? `Role "${match[1]}" does not exist` : 'Invalid database user role';
  }
  if (msg.includes('database') && msg.includes('does not exist')) {
    const match = msg.match(/database "(.+)" does not exist/);
    return match ? `Database "${match[1]}" not found` : 'Database not found';
  }
  if (msg.includes('password authentication failed')) return 'Incorrect password';
  if (msg.includes('SSL') || msg.includes('ssl')) return 'SSL connection error';
  if (msg.includes('timeout')) return 'Connection timeout';
  if (msg.includes('relation') && msg.includes('does not exist')) {
    const match = msg.match(/relation "(.+)" does not exist/);
    return match ? `Table "${match[1]}" not found` : 'Table not found';
  }
  if (msg.includes('column') && msg.includes('does not exist')) {
    const match = msg.match(/column "(.+)"/);
    return match ? `Column "${match[1]}" not found in table` : 'Column not found';
  }
  if (msg.includes('duplicate key')) return 'Duplicate key error (constraint violation)';
  if (msg.includes('not-null constraint')) return 'Required NOT NULL field is empty';
  if (msg.includes('violates check constraint')) return 'Data violates check constraint';

  // SQLite specific errors
  if (msg.includes('SQLITE_ERROR') && msg.includes('no such table')) {
    const match = msg.match(/no such table: (.+)/);
    return match ? `Table "${match[1]}" not found in SQLite` : 'Table not found';
  }
  if (msg.includes('SQLITE_CONSTRAINT')) return 'SQLite constraint violation';
  if (msg.includes('SQLITE_READONLY')) return 'SQLite database is read-only';
  if (msg.includes('SQLITE_CANTOPEN')) return 'Failed to open SQLite database file';

  return msg;
}

/**
 * Format DataPipeError into pretty terminal output (non-Ink fallback).
 */
export function formatErrorForTerminal(err: unknown): string {
  if (err instanceof DataPipeError) {
    const lines: string[] = [];
    lines.push('');
    lines.push(`  \x1b[1;31m✗ ERROR\x1b[0m  \x1b[90m[${err.code}]\x1b[0m`);
    lines.push('');
    lines.push(`  \x1b[1m${err.message}\x1b[0m`);
    if (err.hint) {
      lines.push('');
      lines.push(`  \x1b[33m💡 ${err.hint}\x1b[0m`);
    }
    lines.push('');
    return lines.join('\n');
  }

  if (err instanceof Error) {
    const lines: string[] = [];
    lines.push('');
    lines.push(`  \x1b[1;31m✗ ERROR\x1b[0m  \x1b[90m[UNEXPECTED]\x1b[0m`);
    lines.push('');
    lines.push(`  \x1b[1m${err.message}\x1b[0m`);
    lines.push('');
    return lines.join('\n');
  }

  return `\n  \x1b[1;31m✗ ERROR\x1b[0m  ${String(err)}\n`;
}
