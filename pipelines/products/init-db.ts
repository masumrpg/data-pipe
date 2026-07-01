import { Database } from 'bun:sqlite';
import { resolve } from 'path';
import { existsSync, mkdirSync } from 'fs';

const dbDir = resolve(__dirname, 'output');
if (!existsSync(dbDir)) {
  mkdirSync(dbDir, { recursive: true });
}

const dbPath = resolve(dbDir, 'products.db');
console.log(`Initializing SQLite database at: ${dbPath}`);

const db = new Database(dbPath);

// Create table products
db.run(`
  CREATE TABLE IF NOT EXISTS products (
    sku TEXT PRIMARY KEY,
    name TEXT,
    price REAL,
    stock INTEGER,
    updated_at TEXT
  )
`);

// Clear any old data
db.run(`DELETE FROM products`);

// Insert initial old values (to be updated/upserted by the pipeline)
const insert = db.prepare(`
  INSERT INTO products (sku, name, price, stock, updated_at)
  VALUES (?, ?, ?, ?, ?)
`);

insert.run('PROD-001', 'Old Wireless Mouse', 19.99, 10, '2026-06-01T00:00:00.000Z');
insert.run('PROD-002', 'Old Keyboard', 70.00, 5, '2026-06-01T00:00:00.000Z');

console.log('Successfully initialized database table "products" with 2 seeded rows.');
db.close();
