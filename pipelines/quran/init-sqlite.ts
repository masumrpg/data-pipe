import { Database } from 'bun:sqlite';
import { mkdirSync, existsSync } from 'fs';
import { dirname, resolve } from 'path';

const dbPath = resolve(import.meta.dirname, 'output/quran.db');

// Ensure output directory exists
const dir = dirname(dbPath);
if (!existsSync(dir)) {
  mkdirSync(dir, { recursive: true });
}

console.log(`Initializing SQLite database at: ${dbPath}`);
const db = new Database(dbPath);

// Enable foreign keys
db.run('PRAGMA foreign_keys = ON');

// Create tables
db.run(`
CREATE TABLE IF NOT EXISTS reciters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code VARCHAR(10) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`);

db.run(`
CREATE TABLE IF NOT EXISTS surahs (
    number INT PRIMARY KEY,
    name TEXT NOT NULL,
    latin_name VARCHAR(100) NOT NULL,
    total_verses INT NOT NULL,
    revelation_place VARCHAR(20) CHECK (revelation_place IN ('Mekah', 'Madinah')),
    translation TEXT,
    description TEXT,
    full_audio TEXT,
    next_surah_number INT REFERENCES surahs(number) ON DELETE SET NULL,
    previous_surah_number INT REFERENCES surahs(number) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`);

db.run(`
CREATE TABLE IF NOT EXISTS ayats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    surah_number INT REFERENCES surahs(number) ON DELETE CASCADE,
    verse_number INT NOT NULL,
    arabic_text TEXT NOT NULL,
    tajweed_arabic_text TEXT NULL,
    latin_text TEXT,
    indonesian_text TEXT,
    UNIQUE(surah_number, verse_number)
);
`);

db.run(`
CREATE TABLE IF NOT EXISTS ayat_audio (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    verse_id INT REFERENCES ayats(id) ON DELETE CASCADE,
    reciter_code VARCHAR(10) REFERENCES reciters(code) ON DELETE RESTRICT,
    audio_url TEXT NOT NULL,
    UNIQUE(verse_id, reciter_code)
);
`);

db.run(`
CREATE TABLE IF NOT EXISTS tafsir (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    verse_id INT REFERENCES ayats(id) ON DELETE CASCADE UNIQUE,
    verse_number INT NOT NULL,
    text TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`);

// Create Indexes
db.run(`CREATE INDEX IF NOT EXISTS idx_ayats_surah ON ayats(surah_number);`);
db.run(`CREATE INDEX IF NOT EXISTS idx_ayat_audio_ayat ON ayat_audio(verse_id);`);
db.run(`CREATE INDEX IF NOT EXISTS idx_tafsir_ayat ON tafsir(verse_id);`);

// Insert default reciters
const reciters = [
  { code: '01', name: 'Syeikh Abdurrahman As-Sudais' },
  { code: '02', name: 'Syeikh Abdul Muhsin Al-Qasim' },
  { code: '03', name: 'Syeikh Salah Al-Budair' },
  { code: '04', name: 'Syeikh Abdullah Al-Juhany' },
  { code: '05', name: 'Syeikh Yasser Al-Dossari' },
  { code: '06', name: 'Syeikh Mishary Rashid Alafasy' }
];

const insertReciter = db.prepare(`
  INSERT INTO reciters (code, name) VALUES ($code, $name)
  ON CONFLICT (code) DO NOTHING
`);

for (const reciter of reciters) {
  insertReciter.run({ $code: reciter.code, $name: reciter.name });
}

console.log('✓ SQLite database initialized successfully.');
db.close();
