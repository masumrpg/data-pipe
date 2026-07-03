import pg from 'pg';
import type { Writer, OperationConfig, ExplicitRelation, MappingRule } from '../../shared/types';

const { Client } = pg;

type PostgresTargetConfig = {
  type: 'postgres';
  connectionString: string;
  table: string;
  schema?: string;
  relations?: ExplicitRelation[];
};

interface ForeignKey {
  table: string;
  column: string;
  parentTable: string;
  parentColumn: string;
}

interface PrimaryKey {
  table: string;
  column: string;
}

export class PostgresWriter implements Writer {
  private client: InstanceType<typeof Client>;
  private foreignKeys: ForeignKey[] = [];
  private primaryKeys: PrimaryKey[] = [];
  private tableColumns: Record<string, string[]> = {};
  private lookupCache: Record<string, unknown> = {};

  constructor(private config: PostgresTargetConfig) {
    this.client = new Client({ connectionString: config.connectionString });
  }

  async connect(): Promise<void> {
    await this.client.connect();
    const schema = this.config.schema || 'public';
    if (schema !== 'public') {
      await this.client.query(`SET search_path TO "${schema}", public`);
    }
    await this.loadSchemaMetadata();
  }

  async disconnect(): Promise<void> {
    await this.client.end();
  }

  private async loadSchemaMetadata(): Promise<void> {
    const schema = this.config.schema || 'public';
    try {
      // 1. Load Foreign Keys
      const fkRes = await this.client.query(`
        SELECT
            tc.table_name AS table,
            kcu.column_name AS column,
            ccu.table_name AS parent_table,
            ccu.column_name AS parent_column
        FROM
            information_schema.table_constraints AS tc
            JOIN information_schema.key_column_usage AS kcu
              ON tc.constraint_name = kcu.constraint_name
              AND tc.table_schema = kcu.table_schema
            JOIN information_schema.constraint_column_usage AS ccu
              ON ccu.constraint_name = tc.constraint_name
        WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = $1;
      `, [schema]);
      this.foreignKeys = fkRes.rows.map(r => ({
        table: r.table,
        column: r.column,
        parentTable: r.parent_table,
        parentColumn: r.parent_column,
      }));

      // 2. Load Primary Keys
      const pkRes = await this.client.query(`
        SELECT kcu.table_name AS table, kcu.column_name AS column
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = $1;
      `, [schema]);
      this.primaryKeys = pkRes.rows.map(r => ({
        table: r.table,
        column: r.column,
      }));

      // 4. Load all Columns of all public tables
      const colRes = await this.client.query(`
        SELECT table_name AS table, column_name AS column
        FROM information_schema.columns
        WHERE table_schema = $1;
      `, [schema]);
      this.tableColumns = {};
      for (const row of colRes.rows) {
        if (!this.tableColumns[row.table]) {
          this.tableColumns[row.table] = [];
        }
        this.tableColumns[row.table]?.push(row.column);
      }

      // 5. Infer relationships dynamically based on common naming conventions
      const tablesList = Object.keys(this.tableColumns);
      for (const childTable of tablesList) {
        const columns = this.tableColumns[childTable] || [];
        for (const col of columns) {
          for (const parentTable of tablesList) {
            if (parentTable === childTable) continue;
            const baseParentTable = parentTable.replace(/^[a-zA-Z]+_/, '');
            const singularParent = baseParentTable.endsWith('s') ? baseParentTable.slice(0, -1) : baseParentTable;
            
            // Handle common synonyms, e.g. "ayat" table matching "verse_id" foreign key columns
            const synonyms: Record<string, string[]> = {
              ayat: ['verse'],
              verse: ['ayat'],
            };
            const parentNames = [singularParent, ...(synonyms[singularParent] || [])];
            const matchedParentName = parentNames.find(name => col.startsWith(`${name}_`));

            if (matchedParentName) {
              const parentCol = col.substring(matchedParentName.length + 1);
              const parentCols = this.tableColumns[parentTable] || [];
              if (parentCols.includes(parentCol)) {
                const exists = this.foreignKeys.some(
                  fk => fk.table === childTable && fk.column === col && fk.parentTable === parentTable && fk.parentColumn === parentCol
                );
                if (!exists) {
                  this.foreignKeys.push({
                    table: childTable,
                    column: col,
                    parentTable: parentTable,
                    parentColumn: parentCol,
                  });
                }
              }
            }
          }
        }
      }
      if (this.config.relations) {
        for (const rel of this.config.relations) {
          const exists = this.foreignKeys.some(
            fk => fk.table === rel.table && fk.column === rel.column && fk.parentTable === rel.parentTable && fk.parentColumn === rel.parentColumn
          );
          if (!exists) {
            this.foreignKeys.push(rel);
          }
        }
      }
    } catch (err: any) {
      // Quietly ignore if schema load fails (limited permissions)
    }
  }

  private getExecutionOrder(tables: string[]): string[] {
    const adj: Record<string, string[]> = {};
    const inDegree: Record<string, number> = {};

    for (const t of tables) {
      adj[t] = [];
      inDegree[t] = 0;
    }

    for (const fk of this.foreignKeys) {
      if (tables.includes(fk.table) && tables.includes(fk.parentTable)) {
        const list = adj[fk.parentTable];
        if (list) {
          list.push(fk.table);
        }
        const val = inDegree[fk.table];
        if (val !== undefined) {
          inDegree[fk.table] = val + 1;
        }
      }
    }

    const queue: string[] = [];
    for (const t of tables) {
      if (inDegree[t] === 0) {
        queue.push(t);
      }
    }

    const order: string[] = [];
    while (queue.length > 0) {
      const u = queue.shift()!;
      order.push(u);
      const neighbors = adj[u] || [];
      for (const v of neighbors) {
        const val = inDegree[v];
        if (val !== undefined) {
          inDegree[v] = val - 1;
          if (inDegree[v] === 0) {
            queue.push(v);
          }
        }
      }
    }

    for (const t of tables) {
      if (!order.includes(t)) {
        order.push(t);
      }
    }

    return order;
  }

  private normalizeRowData(row: Record<string, unknown>): Record<string, Record<string, unknown>[]> {
    const tableRows: Record<string, Record<string, unknown>[]> = {};

    for (const key of Object.keys(row)) {
      if (key.includes('.')) {
        const [table] = key.split('.');
        if (table && !tableRows[table]) {
          tableRows[table] = [{}];
        }
      }
    }

    // Dynamic unpivoting registry: table -> prefix -> array of { suffix, value }
    const unpivotCandidates: Record<string, Record<string, { suffix: string; value: unknown }[]>> = {};

    for (const key of Object.keys(row)) {
      if (!key.includes('.')) continue;
      const [table, column] = key.split('.') as [string, string];
      if (!table || !column) continue;
      const value = row[key];
      if (value === undefined) continue;

      const existingCols = this.tableColumns[table] || [];
      const rows = tableRows[table];
      if (existingCols.includes(column)) {
        if (rows && rows[0]) {
          rows[0][column] = value;
        }
      } else {
        // Column does not exist in the database table schema.
        // Check for generic unpivot pattern (e.g. prefix_suffix like audio_01)
        const match = column.match(/^([a-zA-Z_]+)_([a-zA-Z0-9]+)$/);
        if (match) {
          const [, prefix, suffix] = match;
          if (prefix && suffix) {
            if (!unpivotCandidates[table]) {
              unpivotCandidates[table] = {};
            }
            const tableCandidates = unpivotCandidates[table];
            if (tableCandidates) {
              if (!tableCandidates[prefix]) {
                tableCandidates[prefix] = [];
              }
              tableCandidates[prefix]?.push({ suffix, value });
            }
          }
        }
      }
    }

    // Process unpivoting dynamically based on naming conventions in target schema
    const tables = Object.keys(tableRows);
    for (const table of Object.keys(unpivotCandidates)) {
      const prefixes = unpivotCandidates[table] || {};
      const existingCols = this.tableColumns[table] || [];

      for (const prefix of Object.keys(prefixes)) {
        const items = prefixes[prefix] || [];
        
        // Find if target table contains:
        // 1. A key column: ends with _code, _key, _type, _id, or _name (e.g. "reciter_code")
        //    AND is not a foreign key pointing to another table in the current execution batch.
        const keyCol = existingCols.find(
          c => (c.endsWith('_code') || c.endsWith('_key') || c.endsWith('_type') || c.endsWith('_id') || c.endsWith('_name')) &&
               !this.foreignKeys.some(fk => fk.table === table && fk.column === c && tables.includes(fk.parentTable))
        );
        const valCol = existingCols.find(
          c => c.startsWith(prefix) && (c.endsWith('_url') || c.endsWith('_value') || c.endsWith('_text') || c.endsWith('_path'))
        );

        if (keyCol && valCol) {
          const rows = tableRows[table];
          // Remove default empty placeholder row if unpivoted rows are present
          if (rows && rows[0] && Object.keys(rows[0]).length === 0) {
            tableRows[table] = [];
          }

          for (const item of items) {
            if (item.value !== null && item.value !== undefined && String(item.value).trim().length > 0) {
              const newRow: Record<string, unknown> = {};
              newRow[keyCol] = item.suffix;
              newRow[valCol] = item.value;
              tableRows[table]?.push(newRow);
            }
          }
        }
      }
    }

    return tableRows;
  }

  private async writeRelational(row: Record<string, unknown>, rules?: MappingRule[]): Promise<void> {
    const tableRows = this.normalizeRowData(row);
    const tables = Object.keys(tableRows);
    const executionOrder = this.getExecutionOrder(tables);
    const generatedValues: Record<string, Record<string, unknown>[]> = {};

    await this.client.query('BEGIN');

    try {
      for (const table of executionOrder) {
        const rowsToInsert = tableRows[table];
        if (!rowsToInsert || rowsToInsert.length === 0) continue;

        for (let r of rowsToInsert) {
          if (Object.keys(r).length === 0) continue;

          // Resolve lookups
          if (rules) {
            r = await this.resolveLookups(r, table, rules);
          }

          // Resolve foreign keys
          for (const fk of this.foreignKeys) {
            if (fk.table === table) {
              const parentRows = generatedValues[fk.parentTable];
              if (parentRows && parentRows.length > 0) {
                const parentRow = parentRows[parentRows.length - 1];
                if (parentRow && parentRow[fk.parentColumn] !== undefined) {
                  r[fk.column] = parentRow[fk.parentColumn];
                }
              } else {
                const parentSourceRows = tableRows[fk.parentTable];
                if (parentSourceRows && parentSourceRows.length > 0) {
                  const parentSourceRow = parentSourceRows[0];
                  if (parentSourceRow && parentSourceRow[fk.parentColumn] !== undefined) {
                    r[fk.column] = parentSourceRow[fk.parentColumn];
                  }
                }
              }
            }
          }

          const cols = Object.keys(r);
          const vals = Object.values(r);
          const placeholders = cols.map((_, idx) => `$${idx + 1}`);

          const isLeaf = !this.foreignKeys.some(fk => fk.parentTable === table && tables.includes(fk.table));

          let sql = `INSERT INTO "${table}" (${cols.map(c => `"${c}"`).join(', ')}) VALUES (${placeholders.join(', ')})`;

          // For parent tables (non-leaf), use ON CONFLICT DO NOTHING to allow multiple child rows to reference the same parent
          if (!isLeaf) {
            const pk = this.primaryKeys.find(p => p.table === table)?.column;
            if (pk) {
              sql += ` ON CONFLICT ("${pk}") DO NOTHING`;
            }
          }

          sql += ` RETURNING *`;

          const res = await this.client.query(sql, vals);
          let insertedRow = res.rows[0];

          if (!insertedRow && !isLeaf) {
            const pk = this.primaryKeys.find(p => p.table === table)?.column;
            if (pk && r[pk] !== undefined) {
              const selectSql = `SELECT * FROM "${table}" WHERE "${pk}" = $1`;
              const selectRes = await this.client.query(selectSql, [r[pk]]);
              insertedRow = selectRes.rows[0];
            }
          }

          if (insertedRow) {
            if (!generatedValues[table]) generatedValues[table] = [];
            generatedValues[table]?.push(insertedRow);
          }
        }
      }
      await this.client.query('COMMIT');
    } catch (err) {
      await this.client.query('ROLLBACK');
      throw err;
    }
  }

  private async resolveLookups(
    row: Record<string, unknown>,
    table: string,
    rules: MappingRule[]
  ): Promise<Record<string, unknown>> {
    const result = { ...row };
    for (const col of Object.keys(result)) {
      const val = result[col];
      if (val == null) continue;

      const rule = this.findLookupRule(col, table, rules);
      if (rule && rule.lookup) {
        const { table: lookupTable, key: lookupKey, returning } = rule.lookup;
        result[col] = await this.executeLookup(lookupTable, lookupKey, returning, val);
      }
    }
    return result;
  }

  private findLookupRule(col: string, table: string, rules: MappingRule[]): MappingRule | undefined {
    for (const rule of rules) {
      if (rule.lookup) {
        if (rule.to === col || rule.to === `${table}.${col}`) {
          return rule;
        }
      }
      if (rule.mapping) {
        const found = this.findLookupRule(col, table, rule.mapping);
        if (found) return found;
      }
    }
    return undefined;
  }

  private async executeLookup(
    lookupTable: string,
    lookupKey: string,
    returning: string,
    value: unknown
  ): Promise<unknown> {
    const cacheKey = `${lookupTable}:${lookupKey}:${returning}:${value}`;
    if (this.lookupCache[cacheKey] !== undefined) {
      return this.lookupCache[cacheKey];
    }

    const sql = `SELECT "${returning}" FROM "${lookupTable}" WHERE "${lookupKey}" = $1`;
    const res = await this.client.query(sql, [value]);
    const resolvedValue = res.rows[0] ? res.rows[0][returning] : null;

    this.lookupCache[cacheKey] = resolvedValue;
    return resolvedValue;
  }

  async write(row: Record<string, unknown>, op: OperationConfig, table: string, rules?: MappingRule[]): Promise<void> {
    let resolvedRow = row;
    if (rules) {
      resolvedRow = await this.resolveLookups(row, table, rules);
    }

    const hasRelationalKeys = Object.keys(resolvedRow).some(k => k.includes('.'));
    if (hasRelationalKeys) {
      await this.writeRelational(resolvedRow, rules);
      return;
    }

    const columns = Object.keys(resolvedRow);
    const values = Object.values(resolvedRow);
    const placeholders = columns.map((_, i) => `$${i + 1}`);

    switch (op.mode) {
      case 'insert': {
        const sql = `INSERT INTO ${table} (${columns.map(c => `"${c}"`).join(', ')}) VALUES (${placeholders.join(', ')})`;
        await this.client.query(sql, values);
        break;
      }

      case 'upsert': {
        if (!op.conflictOn || op.conflictOn.length === 0) {
          throw new Error('upsert memerlukan conflictOn');
        }
        const conflict = op.conflictOn.map(c => `"${c}"`).join(', ');
        const updates = columns
          .filter((c) => !op.conflictOn!.includes(c))
          .map((c) => `"${c}" = EXCLUDED."${c}"`)
          .join(', ');

        const sql = `INSERT INTO ${table} (${columns.map(c => `"${c}"`).join(', ')}) VALUES (${placeholders.join(', ')}) ON CONFLICT (${conflict}) DO UPDATE SET ${updates}`;
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
            setClauses.push(`"${col}" = $${paramIdx}`);
            params.push(row[col]);
            paramIdx++;
          }
        }

        // Build WHERE clause
        for (const w of op.updateWhere) {
          whereClause.push(`"${w.column}" = $${paramIdx}`);
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
