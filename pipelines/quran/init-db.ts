import pg from 'pg';

const { Client } = pg;

// Connection configurations
const pgConfigBase = {
  host: 'localhost',
  port: 5432,
  user: 'ma-sum',
  password: '',
};

async function init() {
  console.log('Connecting to default "postgres" database...');
  const clientDefault = new Client({ ...pgConfigBase, database: 'postgres' });
  await clientDefault.connect();

  console.log('Checking if database "quran_pipe_data" exists...');
  const checkDbQuery = await clientDefault.query(
    "SELECT 1 FROM pg_database WHERE datname = 'quran_pipe_data'"
  );

  if (checkDbQuery.rowCount === 0) {
    console.log('Creating database "quran_pipe_data"...');
    await clientDefault.query('CREATE DATABASE quran_pipe_data');
    console.log('✓ Database "quran_pipe_data" created successfully.');
  } else {
    console.log('✓ Database "quran_pipe_data" already exists.');
  }

  await clientDefault.end();

  // Connect to the newly created database
  console.log('Connecting to "quran_pipe_data" database...');
  const clientDb = new Client({ ...pgConfigBase, database: 'quran_pipe_data' });
  await clientDb.connect();

  console.log('Dropping existing tables to refresh constraints...');
  await clientDb.query(`
    DROP TABLE IF EXISTS tafsir CASCADE;
    DROP TABLE IF EXISTS ayat_audio CASCADE;
    DROP TABLE IF EXISTS ayats CASCADE;
    DROP TABLE IF EXISTS surahs CASCADE;
    DROP TABLE IF EXISTS reciters CASCADE;
  `);

  console.log('Creating tables...');

  // 1. Reciters Table

  await clientDb.query(`
    CREATE TABLE IF NOT EXISTS reciters (
        id SERIAL PRIMARY KEY,
        code VARCHAR(10) UNIQUE NOT NULL,
        name VARCHAR(100) NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // 2. Surahs Table
  await clientDb.query(`
    CREATE TABLE IF NOT EXISTS surahs (
        nomor INT PRIMARY KEY,
        nama TEXT NOT NULL,
        nama_latin VARCHAR(100) NOT NULL,
        jumlah_ayat INT NOT NULL,
        tempat_turun VARCHAR(20) CHECK (tempat_turun IN ('Mekah', 'Madinah')),
        arti TEXT,
        deskripsi TEXT,
        audio_full JSONB,
        surat_selanjutnya_nomor INT REFERENCES surahs(nomor),
        surat_sebelumnya_nomor INT REFERENCES surahs(nomor),
        created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // 3. Ayats Table
  await clientDb.query(`
    CREATE TABLE IF NOT EXISTS ayats (
        id SERIAL PRIMARY KEY,
        surah_nomor INT REFERENCES surahs(nomor) ON DELETE CASCADE,
        nomor_ayat INT NOT NULL,
        teks_arab TEXT NOT NULL,
        teks_latin TEXT,
        teks_indonesia TEXT,
        UNIQUE(surah_nomor, nomor_ayat)
    );
  `);

  // 4. Ayat Audio Table
  await clientDb.query(`
    CREATE TABLE IF NOT EXISTS ayat_audio (
        id SERIAL PRIMARY KEY,
        ayat_id INT REFERENCES ayats(id) ON DELETE CASCADE,
        reciter_code VARCHAR(10) REFERENCES reciters(code),
        audio_url TEXT NOT NULL,
        UNIQUE(ayat_id, reciter_code)
    );
  `);

  // 5. Tafsir Table
  await clientDb.query(`
    CREATE TABLE IF NOT EXISTS tafsir (
        id SERIAL PRIMARY KEY,
        ayat_id INT REFERENCES ayats(id) ON DELETE CASCADE UNIQUE,
        ayat_nomor INT NOT NULL,
        teks TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // Indexes
  await clientDb.query(`CREATE INDEX IF NOT EXISTS idx_ayats_surah ON ayats(surah_nomor);`);
  await clientDb.query(`CREATE INDEX IF NOT EXISTS idx_ayat_audio_ayat ON ayat_audio(ayat_id);`);
  await clientDb.query(`CREATE INDEX IF NOT EXISTS idx_tafsir_ayat ON tafsir(ayat_id);`);

  console.log('✓ Tables and indexes ensured.');

  // Pre-seed reciters (01 to 06)
  console.log('Seeding reciters...');
  const reciters = [
    { code: '01', name: 'Syeikh Abdurrahman As-Sudais' },
    { code: '02', name: 'Syeikh Abdul Muhsin Al-Qasim' },
    { code: '03', name: 'Syeikh Salah Al-Budair' },
    { code: '04', name: 'Syeikh Abdullah Al-Juhany' },
    { code: '05', name: 'Syeikh Yasser Al-Dossari' },
    { code: '06', name: 'Syeikh Mishary Rashid Alafasy' },
  ];

  for (const reciter of reciters) {
    await clientDb.query(
      `INSERT INTO reciters (code, name) 
       VALUES ($1, $2) 
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name`,
      [reciter.code, reciter.name]
    );
  }
  console.log('✓ Seeding reciters completed.');

  // Create the Flattened Import View using table.column aliases
  console.log('Creating flattened import view v_quran_import...');
  await clientDb.query(`DROP VIEW IF EXISTS v_quran_import CASCADE;`);
  await clientDb.query(`
    CREATE OR REPLACE VIEW v_quran_import AS
    SELECT
        s.nomor AS "surahs.nomor",
        s.nama AS "surahs.nama",
        s.nama_latin AS "surahs.nama_latin",
        s.jumlah_ayat AS "surahs.jumlah_ayat",
        s.tempat_turun AS "surahs.tempat_turun",
        s.arti AS "surahs.arti",
        s.deskripsi AS "surahs.deskripsi",
        s.audio_full AS "surahs.audio_full",
        s.surat_selanjutnya_nomor AS "surahs.surat_selanjutnya_nomor",
        s.surat_sebelumnya_nomor AS "surahs.surat_sebelumnya_nomor",
        a.nomor_ayat AS "ayats.nomor_ayat",
        a.teks_arab AS "ayats.teks_arab",
        a.teks_latin AS "ayats.teks_latin",
        a.teks_indonesia AS "ayats.teks_indonesia",
        NULL::TEXT AS "ayat_audio.audio_01",
        NULL::TEXT AS "ayat_audio.audio_02",
        NULL::TEXT AS "ayat_audio.audio_03",
        NULL::TEXT AS "ayat_audio.audio_04",
        NULL::TEXT AS "ayat_audio.audio_05",
        NULL::TEXT AS "ayat_audio.audio_06",
        NULL::TEXT AS "tafsir.teks"
    FROM surahs s
    JOIN ayats a ON a.surah_nomor = s.nomor;
  `);

  // Create INSTEAD OF INSERT Trigger Function mapping "table.column" inputs
  console.log('Creating INSTEAD OF INSERT trigger function...');
  await clientDb.query(`
    CREATE OR REPLACE FUNCTION insert_quran_flat()
    RETURNS TRIGGER AS $$
    DECLARE
        v_ayat_id INT;
    BEGIN
        -- 1. Insert surahs (use DO NOTHING to handle flat row duplicates of the same surah in a single run)
        INSERT INTO surahs (
            nomor, nama, nama_latin, jumlah_ayat, tempat_turun, arti, deskripsi, audio_full
        ) VALUES (
            NEW."surahs.nomor", NEW."surahs.nama", NEW."surahs.nama_latin", NEW."surahs.jumlah_ayat", 
            NEW."surahs.tempat_turun", NEW."surahs.arti", NEW."surahs.deskripsi", NEW."surahs.audio_full"
        )
        ON CONFLICT (nomor) DO NOTHING;

        -- Self-heal next/prev surah foreign keys
        IF EXISTS(SELECT 1 FROM surahs WHERE nomor = NEW."surahs.nomor" - 1) THEN
            UPDATE surahs SET surat_selanjutnya_nomor = NEW."surahs.nomor" WHERE nomor = NEW."surahs.nomor" - 1;
            UPDATE surahs SET surat_sebelumnya_nomor = NEW."surahs.nomor" - 1 WHERE nomor = NEW."surahs.nomor";
        END IF;
        IF EXISTS(SELECT 1 FROM surahs WHERE nomor = NEW."surahs.nomor" + 1) THEN
            UPDATE surahs SET surat_sebelumnya_nomor = NEW."surahs.nomor" WHERE nomor = NEW."surahs.nomor" + 1;
            UPDATE surahs SET surat_selanjutnya_nomor = NEW."surahs.nomor" + 1 WHERE nomor = NEW."surahs.nomor";
        END IF;

        -- 2. Insert ayats (No ON CONFLICT: raise duplicate key exception on conflict)
        INSERT INTO ayats (surah_nomor, nomor_ayat, teks_arab, teks_latin, teks_indonesia)
        VALUES (NEW."surahs.nomor", NEW."ayats.nomor_ayat", NEW."ayats.teks_arab", NEW."ayats.teks_latin", NEW."ayats.teks_indonesia")
        RETURNING id INTO v_ayat_id;

        -- 3. Insert audio for each reciter code (No ON CONFLICT: raise exception on duplicate audio)
        IF NEW."ayat_audio.audio_01" IS NOT NULL AND NEW."ayat_audio.audio_01" <> '' THEN
            INSERT INTO ayat_audio (ayat_id, reciter_code, audio_url)
            VALUES (v_ayat_id, '01', NEW."ayat_audio.audio_01");
        END IF;
        IF NEW."ayat_audio.audio_02" IS NOT NULL AND NEW."ayat_audio.audio_02" <> '' THEN
            INSERT INTO ayat_audio (ayat_id, reciter_code, audio_url)
            VALUES (v_ayat_id, '02', NEW."ayat_audio.audio_02");
        END IF;
        IF NEW."ayat_audio.audio_03" IS NOT NULL AND NEW."ayat_audio.audio_03" <> '' THEN
            INSERT INTO ayat_audio (ayat_id, reciter_code, audio_url)
            VALUES (v_ayat_id, '03', NEW."ayat_audio.audio_03");
        END IF;
        IF NEW."ayat_audio.audio_04" IS NOT NULL AND NEW."ayat_audio.audio_04" <> '' THEN
            INSERT INTO ayat_audio (ayat_id, reciter_code, audio_url)
            VALUES (v_ayat_id, '04', NEW."ayat_audio.audio_04");
        END IF;
        IF NEW."ayat_audio.audio_05" IS NOT NULL AND NEW."ayat_audio.audio_05" <> '' THEN
            INSERT INTO ayat_audio (ayat_id, reciter_code, audio_url)
            VALUES (v_ayat_id, '05', NEW."ayat_audio.audio_05");
        END IF;
        IF NEW."ayat_audio.audio_06" IS NOT NULL AND NEW."ayat_audio.audio_06" <> '' THEN
            INSERT INTO ayat_audio (ayat_id, reciter_code, audio_url)
            VALUES (v_ayat_id, '06', NEW."ayat_audio.audio_06");
        END IF;

        -- 4. Insert tafsirs (No ON CONFLICT: raise exception on duplicate tafsir)
        IF NEW."tafsir.teks" IS NOT NULL AND NEW."tafsir.teks" <> '' THEN
            INSERT INTO tafsir (ayat_id, ayat_nomor, teks)
            VALUES (v_ayat_id, NEW."ayats.nomor_ayat", NEW."tafsir.teks");
        END IF;

        RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  // Associate the trigger to the view
  console.log('Creating trigger trg_insert_quran_flat on v_quran_import...');
  await clientDb.query(`DROP TRIGGER IF EXISTS trg_insert_quran_flat ON v_quran_import;`);
  await clientDb.query(`
    CREATE TRIGGER trg_insert_quran_flat
    INSTEAD OF INSERT ON v_quran_import
    FOR EACH ROW
    EXECUTE FUNCTION insert_quran_flat();
  `);

  console.log('✓ Database view and trigger setup successfully!');

  await clientDb.end();
  console.log('Database initialization completed successfully!');
}

init().catch((err) => {
  console.error('Fatal initialization error:', err);
  process.exit(1);
});
