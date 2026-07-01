import { Database } from 'bun:sqlite';
import type { Writer, OperationConfig } from '../../shared/types';

type SqliteTargetConfig = {
  type: 'sqlite';
  filePath: string;
  table: string;
};

export class SqliteWriter implements Writer {
  private db: Database | null = null;

  constructor(private config: SqliteTargetConfig) {}

  async connect(): Promise<void> {
    this.db = new Database(this.config.filePath);
    this.db.run('PRAGMA journal_mode = WAL');
  }

  async disconnect(): Promise<void> {
    this.db?.close();
    this.db = null;
  }

  async write(row: Record<string, unknown>, op: OperationConfig, table: string): Promise<void> {
    if (!this.db) throw new Error('Database not connected');

    const columns = Object.keys(row);
    const values = Object.values(row);
    const placeholders = columns.map(() => '?');

    switch (op.mode) {
      case 'insert': {
        const sql = `INSERT INTO ${table} (${columns.map(c => `"${c}"`).join(', ')}) VALUES (${placeholders.join(', ')})`;
        this.db.prepare(sql).run(...(values as any[]));
        break;
      }

      case 'upsert': {
        if (!op.conflictOn || op.conflictOn.length === 0) {
          throw new Error('upsert requires conflictOn');
        }
        const conflict = op.conflictOn.map(c => `"${c}"`).join(', ');
        const updates = columns
          .filter((c) => !op.conflictOn!.includes(c))
          .map((c) => `"${c}" = excluded."${c}"`)
          .join(', ');

        const sql = `INSERT INTO ${table} (${columns.map(c => `"${c}"`).join(', ')}) VALUES (${placeholders.join(', ')}) ON CONFLICT (${conflict}) DO UPDATE SET ${updates}`;
        this.db.prepare(sql).run(...(values as any[]));
        break;
      }

      case 'update': {
        if (!op.updateWhere || op.updateWhere.length === 0) {
          throw new Error('update requires updateWhere');
        }

        const setClauses: string[] = [];
        const whereClause: string[] = [];
        const params: unknown[] = [];

        // Build SET clause (exclude where-columns)
        const whereColumns = op.updateWhere.map((w) => w.column);
        for (const col of columns) {
          if (!whereColumns.includes(col)) {
            setClauses.push(`"${col}" = ?`);
            params.push(row[col]);
          }
        }

        // Build WHERE clause
        for (const w of op.updateWhere) {
          whereClause.push(`"${w.column}" = ?`);
          params.push(row[w.column]);
        }

        const sql = `UPDATE ${table} SET ${setClauses.join(', ')} WHERE ${whereClause.join(' AND ')}`;
        this.db.prepare(sql).run(...(params as any[]));
        break;
      }
    }
  }
}
