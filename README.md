# 🚀 DataPipe CLI

**DataPipe** is a generic, configuration-driven CLI engine for **ETL** (*Extract, Transform, Load*) pipelines. Define your source, mapping, and target database entirely inside JSON/YAML configurations, and run it with a beautiful, real-time interactive **React Ink TUI** (Terminal User Interface).

---

## 📑 Table of Contents
- [Key Features](#-key-features)
- [Installation](#-installation)
- [CLI Command Usage](#-cli-command-usage)
- [Pipeline Configuration (JSON Schema)](#-pipeline-configuration-json-schema)
- [Ingestion Case Studies & Config Samples](#-ingestion-case-studies--config-samples)
  - [Case 1: JSON to Postgres (Insert Mode)](#case-1-json-to-postgres-insert-mode)
  - [Case 2: CSV to SQLite (Upsert & Type Transforms)](#case-2-csv-to-sqlite-upsert--type-transforms)
  - [Case 3: Relational API to SQLite (Streaming + Explicit Relations + Lookups)](#case-3-relational-api-to-sqlite-streaming--explicit-relations--lookups)
- [Mapping & Transform Rules](#-mapping--transform-rules)
- [TUI Keyboard Controls](#-tui-keyboard-controls)
- [CI/CD & Automated Scripting](#-cicd--automated-scripting)

---

## ✨ Key Features

- 📂 **Multi-Source**: Reads local **JSON**, **CSV** files, or fetches data directly from **REST APIs**.
- 🗄️ **Multi-Target**: Writes dynamically to **PostgreSQL** or **SQLite** databases.
- ⚙️ **Hybrid Runtime**: Runs natively on both Node.js (via `better-sqlite3`) and Bun (via `bun:sqlite`).
- ⏱️ **Real-time TUI Metrics**: Live progress bars, throughput metrics (`items/s`), active RAM usage, elapsed duration, and estimated time of arrival (`ETA`).
- ⚡ **Incremental Ingestion**: Streams large JSON/CSV files and Paginated APIs chunk-by-chunk to guarantee low memory footprints (OOM-safe).
- 🔗 **Constraint-Less Relation Mapping**: Automatically resolves parent-child primary/foreign keys with support for *Explicit Relations Override* and *Lookup Caching*.
- 🤖 **CI/CD Friendly**: Suppresses interactive ANSI renders with `--raw` logging and supports headless process terminations with `--auto-quit`.

---

## 📦 Installation

### 1. Local Setup (Development)
Clone this repository and install local package dependencies:
```bash
cd data-pipe
bun install   # or npm install / pnpm install / yarn install
```

### 2. Global Installation (CLI Command)
After publishing to the npm registry, install the CLI globally on any machine:
```bash
npm install -g @masumdev/data-pipe   # or pnpm add -g / yarn global add / bun install -g
```

---

## 🎮 CLI Command Usage

```bash
datapipe [options]
```

### Options:
| Argument | Shorthand | Description |
|---|---|---|
| `--pipeline <path>` | `-p <path>` | Path to the pipeline JSON or YAML configuration file. |
| `--dry-run` | — | Fetch and transform the source data without writing anything to the target database. |
| `--auto-quit` | `-q` | Automatically close the TUI rendering upon completion or failure (exits with code `0` or `1`). |
| `--raw` | — | Emits line-by-line plain text logs (forces non-TTY mode suitable for CI/CD environments). |
| `--retry` | — | Retries processing failed items recorded from the previous run. |
| `--version` | `-v` | Prints current CLI engine version. |
| `--help` | `-h` | Renders CLI usage instructions. |

---

## 📋 Pipeline Configuration (JSON Schema)

Every pipeline is defined using a JSON file. Always reference the **JSON Schema** in the root property to unlock IDE autocomplete, validation warnings, and property hovers:

```json
{
  "$schema": "./pipeline.schema.json",
  "name": "My Ingestion Pipeline",
  "version": "1.0",
  "source": { ... },
  "target": { ... },
  "operation": { ... },
  "mapping": [ ... ]
}
```

---

## 📝 Ingestion Case Studies & Config Samples

### Case 1: JSON to Postgres (Insert Mode)
Extracts a list of users from a local nested JSON array and appends them to a Postgres database.

```json
{
  "$schema": "../pipeline.schema.json",
  "name": "Import Users from JSON",
  "version": "1.0",
  "source": {
    "type": "json",
    "filePath": "./data/users.json",
    "resultPath": "users_list"
  },
  "target": {
    "type": "postgres",
    "connectionString": "postgresql://postgres:secret@localhost:5432/mydb",
    "schema": "public",
    "table": "users"
  },
  "operation": {
    "mode": "insert"
  },
  "mapping": [
    { "from": "id", "to": "id" },
    { "from": "profile.name", "to": "full_name", "transform": "trim" },
    { "from": "profile.email", "to": "email_address", "transform": "toLower" },
    { "from": "status", "to": "is_active", "default": "active" }
  ]
}
```

---

### Case 2: CSV to SQLite (Upsert & Type Transforms)
Parses a CSV file containing products, applies float/integer conversions, and performs an `upsert` matching on the `sku` key.

```json
{
  "$schema": "../pipeline.schema.json",
  "name": "Sync Products from CSV",
  "version": "1.0",
  "source": {
    "type": "csv",
    "filePath": "./data/products.csv",
    "delimiter": ",",
    "hasHeader": true
  },
  "target": {
    "type": "sqlite",
    "filePath": "./dist/products.db",
    "table": "m_products"
  },
  "operation": {
    "mode": "upsert",
    "conflictOn": ["sku"]
  },
  "mapping": [
    { "from": "SKU", "to": "sku", "transform": "trim" },
    { "from": "Title", "to": "title" },
    { "from": "Price", "to": "price", "transform": "toFloat", "default": 0.0 },
    { "from": "Stock", "to": "stock_quantity", "transform": "toInt", "default": 0 },
    { "from": "Description", "to": "description", "transform": "nullIfEmpty" }
  ]
}
```

---

### Case 3: Relational API to SQLite (Streaming + Explicit Relations + Lookups)
Fetches Quran chapters and verse translations from multiple REST APIs. It splits flattened array data into normalized SQLite tables, links parent primary keys to child foreign keys dynamically, and resolves foreign keys using **Explicit Relations** and **Lookups**.

```json
{
  "$schema": "../pipeline.schema.json",
  "name": "Quran Relational SQLite Seeding",
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
        "id": "tafsir",
        "url": "https://equran.id/api/v2/tafsir/{index}",
        "resultPath": "data"
      }
    ],
    "mergeKey": "index",
    "delayMs": 300
  },
  "target": {
    "type": "sqlite",
    "filePath": "pipelines/quran/output/quran.db",
    "table": "surahs",
    "relations": [
      {
        "table": "ayat_audio",
        "column": "verse_id",
        "parentTable": "ayats",
        "parentColumn": "id"
      }
    ]
  },
  "operation": {
    "mode": "insert"
  },
  "mapping": [
    { "from": "equran.nomor",      "to": "surahs.number" },
    { "from": "equran.nama",       "to": "surahs.name" },
    { "from": "equran.namaLatin",  "to": "surahs.latin_name" },
    { "from": "equran.jumlahAyat", "to": "surahs.total_verses", "transform": "toInt" },
    {
      "from": "equran.ayat",
      "to": "_expand",
      "expand": true,
      "mapping": [
        { "from": "nomorAyat",     "to": "ayats.verse_number", "transform": "toInt" },
        { "from": "teksArab",      "to": "ayats.arabic_text" },
        { "from": "teksLatin",     "to": "ayats.latin_text" },
        { "from": "teksIndonesia", "to": "ayats.indonesian_text" },
        
        // Lookup relation: Get chapter ID from 'surahs' where 'number' equals 'equran.nomor'
        {
          "from": "equran.nomor",
          "to": "ayats.surah_id",
          "lookup": { "table": "surahs", "key": "number", "returning": "id" }
        },
        
        // Unpivoting dynamic columns into child table 'ayat_audio'
        { "from": "audio.01",      "to": "ayat_audio.audio_01" },
        { "from": "audio.02",      "to": "ayat_audio.audio_02" },
        
        { "from": "nomorAyat",     "to": "tafsir.verse_number", "transform": "toInt" },
        { "from": "tafsir.tafsir[nomorAyat].teks", "to": "tafsir.text" },
        
        // Lookup relation: Get verse ID from 'ayats' to map onto 'tafsir' table
        {
          "from": "nomorAyat",
          "to": "tafsir.verse_id",
          "lookup": { "table": "ayats", "key": "verse_number", "returning": "id" }
        }
      ]
    }
  ]
}
```

---

## 🔀 Mapping & Transform Rules

### Transform Keys (`transform`):
- `toInt`: Parses string to integer.
- `toFloat`: Parses string to decimal/float.
- `toString`: Standard coercion to string.
- `toJsonString`: Serializes objects/arrays to stringified JSON for text/json DB columns.
- `toISODate`: Formats standard date inputs to ISO 8601 strings.
- `toLower` / `toUpper`: Changes string casing to lowercase / uppercase.
- `trim`: Strips outer left/right white spaces.
- `nullIfEmpty`: Coerces empty or blank strings to `null`.

---

## ⌨️ TUI Keyboard Controls

While running in interactive TUI mode inside your terminal, control the process using the following keys:

| Key | Execution Status | Action |
|---|---|---|
| `p` | Running | ⏸ Pauses the pipeline. |
| `p` | Paused | ▶ Resumes the pipeline. |
| `c` | Running or Paused | ✗ Cancels the pipeline execution. |
| `r` | Done (with failed items) | 🔁 Retries processing failed rows. |
| `q` / `Esc` | Done or Error | Closes the TUI and exits the terminal. |

---

## 🤖 CI/CD & Automated Scripting

To run DataPipe inside headless environments (such as GitHub Actions or background cron tasks) and prevent interactive console redraw pollution, run it with `--raw` and `--auto-quit`:

```bash
datapipe --pipeline pipelines/my-pipeline.json --raw --auto-quit
```

### GitHub Actions Workflow Example:
```yaml
name: Daily Data Ingestion
on:
  schedule:
    - cron: '0 0 * * *' # Every day at midnight

jobs:
  run-pipeline:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1
      
      - name: Install DataPipe Globally
        run: bun install -g @masumdev/data-pipe
        
      - name: Run Pipeline
        run: datapipe -p pipelines/daily-sync.json --raw -q
```

---

## 📄 License
MIT License.
