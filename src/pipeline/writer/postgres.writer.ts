import pg from 'pg';
import type { Writer, OperationConfig } from '../../shared/types';

const { Client } = pg;

type PostgresTargetConfig = {
  type: 'postgres';
  connectionString: string;
  table: string;
};

export class PostgresWriter implements Writer {
  private client: InstanceType<typeof Client>;

  constructor(private config: PostgresTargetConfig) {
    this.client = new Client({ connectionString: config.connectionString });
  }

  async connect(): Promise<void> {
    await this.client.connect();
  }

  async disconnect(): Promise<void> {
    await this.client.end();
  }

  async write(row: Record<string, unknown>, op: OperationConfig, table: string): Promise<void> {
    const columns = Object.keys(row);
    const values = Object.values(row);
    const placeholders = columns.map((_, i) => `$${i + 1}`);

    switch (op.mode) {
      case 'insert': {
        const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`;
        await this.client.query(sql, values);
        break;
      }

      case 'upsert': {
        if (!op.conflictOn || op.conflictOn.length === 0) {
          throw new Error('upsert memerlukan conflictOn');
        }
        const conflict = op.conflictOn.join(', ');
        const updates = columns
          .filter((c) => !op.conflictOn!.includes(c))
          .map((c) => `${c} = EXCLUDED.${c}`)
          .join(', ');

        const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders.join(', ')}) ON CONFLICT (${conflict}) DO UPDATE SET ${updates}`;
        await this.client.query(sql, values);
        break;
      }

      case 'update': {
        if (!op.updateWhere || op.updateWhere.length === 0) {
          throw new Error('update memerlukan updateWhere');
        }

        const setClauses: string[] = [];
        const whereClause: string[] = [];
        const params: unknown[] = [];
        let paramIdx = 1;

        // Build SET clause (exclude where-columns)
        const whereColumns = op.updateWhere.map((w) => w.column);
        for (const col of columns) {
          if (!whereColumns.includes(col)) {
            setClauses.push(`${col} = $${paramIdx}`);
            params.push(row[col]);
            paramIdx++;
          }
        }

        // Build WHERE clause
        for (const w of op.updateWhere) {
          whereClause.push(`${w.column} = $${paramIdx}`);
          params.push(row[w.column]);
          paramIdx++;
        }

        const sql = `UPDATE ${table} SET ${setClauses.join(', ')} WHERE ${whereClause.join(' AND ')}`;
        await this.client.query(sql, params);
        break;
      }
    }
  }
}
