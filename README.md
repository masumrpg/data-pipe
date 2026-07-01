# 🚀 DataPipe

Generic data pipeline CLI — define source, mapping, dan target via file konfigurasi JSON/YAML, jalankan via terminal dengan UI interaktif berbasis **React Ink**.

![Bun](https://img.shields.io/badge/runtime-Bun-f472b6?style=flat-square)
![TypeScript](https://img.shields.io/badge/lang-TypeScript-3178c6?style=flat-square)
![React Ink](https://img.shields.io/badge/UI-React_Ink-61dafb?style=flat-square)

---

## 📑 Daftar Isi

- [Fitur](#-fitur)
- [Stack](#-stack)
- [Instalasi](#-instalasi)
- [Quick Start](#-quick-start)
- [Cara Pakai](#-cara-pakai)
- [Format Konfigurasi Pipeline](#-format-konfigurasi-pipeline)
  - [Source](#source)
  - [Target](#target)
  - [Operation](#operation)
  - [Mapping](#mapping)
  - [Transform](#transform)
- [Contoh Lengkap](#-contoh-lengkap)
- [Template Siap Copas](#-template-siap-copas)
- [JSON Schema (Typesafe)](#-json-schema-typesafe)
- [Keyboard Controls](#-keyboard-controls)
- [Struktur Folder](#-struktur-folder)
- [Menambah Source / Writer Baru](#-menambah-source--writer-baru)

---

## ✨ Fitur

- 📂 **Multi-source** — baca dari JSON, CSV, atau REST API
- 🗄️ **Multi-target** — tulis ke PostgreSQL atau SQLite
- 🔄 **3 mode operasi** — `insert`, `upsert`, `update`
- 🗺️ **Field mapping** — dot-path, transform, default value
- 📦 **Array expand** — flatten nested array jadi multiple rows
- 🔗 **Multi-API merge** — gabungkan response dari beberapa endpoint
- 🎯 **JSON Schema** — autocomplete & validasi langsung di IDE
- ⏸️ **Pause/Resume/Cancel** — kontrol pipeline via keyboard
- 🔁 **Retry** — retry item yang gagal tanpa restart
- 📊 **Live UI** — progress bar, log panel, status badge di terminal

---

## 🧱 Stack

| Layer | Pilihan |
|---|---|
| Runtime | **Bun** |
| UI Terminal | **React Ink** |
| DB | **PostgreSQL** (`pg`) · **SQLite** (`bun:sqlite`) |
| Config parser | **js-yaml** |
| CSV parser | **papaparse** |
| Language | **TypeScript** |

---

## 📦 Instalasi

```bash
# 1. Clone / masuk ke folder project
cd data-pipe

# 2. Install dependencies
bun install
```

> **Prasyarat:** [Bun](https://bun.sh) harus sudah terinstall.

---

## ⚡ Quick Start

**Langkah 1** — Copy template sesuai kebutuhan:

```bash
cp pipelines/templates/template-csv-to-sqlite.json pipelines/my-pipeline.json
```

**Langkah 2** — Edit file, isi placeholder `___...___`:

```json
{
  "$schema": "./pipeline.schema.json",
  "name": "Import Data Karyawan",
  "version": "1.0",
  "source": {
    "type": "csv",
    "filePath": "./exports/karyawan.csv",
    "delimiter": ",",
    "hasHeader": true
  },
  "target": {
    "type": "sqlite",
    "filePath": "./data.db",
    "table": "karyawan"
  },
  "operation": {
    "mode": "insert"
  },
  "mapping": [
    { "from": "Nama",   "to": "nama",   "transform": "trim" },
    { "from": "Email",  "to": "email",  "transform": "toLower" },
    { "from": "Gaji",   "to": "gaji",   "transform": "toFloat" }
  ]
}
```

**Langkah 3** — Jalankan:

```bash
bun run src/index.tsx --pipeline pipelines/my-pipeline.json
```

Selesai! 🎉

---

## 🎮 Cara Pakai

### Menjalankan Pipeline

```bash
# Jalankan pipeline dari file config
bun run src/index.tsx --pipeline pipelines/my-pipeline.json

# Atau pakai shorthand -p
bun run src/index.tsx -p pipelines/my-pipeline.json
```

### Dry Run

Fetch + mapping tapi **tidak insert ke DB** — berguna untuk testing config:

```bash
bun run src/index.tsx --pipeline pipelines/my-pipeline.json --dry-run
```

### Format YAML

Selain JSON, config juga bisa ditulis dalam YAML:

```bash
bun run src/index.tsx --pipeline pipelines/my-pipeline.yaml
```

### Menggunakan npm scripts

```bash
# Jalankan via dev script
bun run dev -- --pipeline pipelines/my-pipeline.json
```

---

## 📋 Format Konfigurasi Pipeline

Satu file = satu pipeline. Simpan di folder `pipelines/`.

Struktur utama:

```json
{
  "$schema": "./pipeline.schema.json",
  "name": "Nama Pipeline",
  "version": "1.0",
  "source": { ... },
  "target": { ... },
  "operation": { ... },
  "mapping": [ ... ]
}
```

---

### Source

#### 📄 JSON File

```json
"source": {
  "type": "json",
  "filePath": "./data/users.json",
  "resultPath": "data.users"
}
```

| Field | Wajib | Keterangan |
|---|---|---|
| `type` | ✅ | Selalu `"json"` |
| `filePath` | ✅ | Path ke file JSON (relatif atau absolut) |
| `resultPath` | ❌ | Dot-path ke array data, misal `"data.users"`. Jika kosong, seluruh file dianggap array |

#### 📊 CSV File

```json
"source": {
  "type": "csv",
  "filePath": "./exports/products.csv",
  "delimiter": ",",
  "hasHeader": true
}
```

| Field | Wajib | Keterangan |
|---|---|---|
| `type` | ✅ | Selalu `"csv"` |
| `filePath` | ✅ | Path ke file CSV |
| `delimiter` | ✅ | Pemisah kolom: `,` `;` `\t` `\|` |
| `hasHeader` | ✅ | `true` jika baris pertama adalah header |

#### 🌐 REST API

```json
"source": {
  "type": "api",
  "pagination": {
    "type": "range",
    "param": "id",
    "from": 1,
    "to": 100
  },
  "requests": [
    {
      "id": "main",
      "url": "https://api.example.com/items/{id}",
      "resultPath": "data",
      "headers": {
        "Authorization": "Bearer TOKEN"
      }
    }
  ],
  "mergeKey": "id",
  "delayMs": 200
}
```

| Field | Wajib | Keterangan |
|---|---|---|
| `type` | ✅ | Selalu `"api"` |
| `pagination` | ✅ | Lihat tabel pagination di bawah |
| `requests` | ✅ | Array endpoint API |
| `mergeKey` | ✅ | Key penggabungan multi-request |
| `delayMs` | ✅ | Delay antar request (ms), untuk rate limiting |

**Tipe Pagination:**

| Type | Keterangan | Field Tambahan |
|---|---|---|
| `range` | Loop dari `from` sampai `to` | `param`, `from`, `to` |
| `cursor` | Loop sampai cursor null | `param`, `nextPath` |
| `none` | Single request, tanpa loop | — |

**Multi-Source Merge:**

Gunakan beberapa object di `requests` untuk fetch dari multiple API sekaligus:

```json
"requests": [
  { "id": "source_a", "url": "https://api-a.com/{id}", "resultPath": "data" },
  { "id": "source_b", "url": "https://api-b.com/{id}", "resultPath": "data" }
]
```

Hasilnya di-merge jadi: `{ source_a: {...}, source_b: {...}, id: 1 }`

Akses di mapping: `"from": "source_a.nama"`, `"from": "source_b.detail"`

---

### Target

#### 🐘 PostgreSQL

```json
"target": {
  "type": "postgres",
  "connectionString": "postgresql://user:pass@localhost:5432/mydb",
  "table": "users"
}
```

#### 📦 SQLite

```json
"target": {
  "type": "sqlite",
  "filePath": "./local.db",
  "table": "users"
}
```

---

### Operation

```json
"operation": {
  "mode": "insert"
}
```

| Mode | Keterangan | Field Tambahan |
|---|---|---|
| `insert` | INSERT biasa, error kalau duplicate | — |
| `upsert` | INSERT ON CONFLICT DO UPDATE | `conflictOn` (wajib) |
| `update` | UPDATE WHERE | `updateWhere` (wajib) |

**Contoh Upsert:**

```json
"operation": {
  "mode": "upsert",
  "conflictOn": ["email"]
}
```

> Jika `email` sudah ada di DB, row di-update. Jika belum, di-insert.

**Contoh Upsert Composite Key:**

```json
"operation": {
  "mode": "upsert",
  "conflictOn": ["nomor_surah", "nomor_ayat"]
}
```

**Contoh Update:**

```json
"operation": {
  "mode": "update",
  "updateWhere": [
    { "column": "sku", "fromField": "SKU" }
  ]
}
```

> `UPDATE products SET ... WHERE sku = (nilai dari field SKU di source)`

---

### Mapping

Mapping mendefinisikan bagaimana field dari source dipetakan ke kolom di target database.

```json
"mapping": [
  { "from": "fieldSource", "to": "kolom_db" },
  { "from": "fieldSource", "to": "kolom_db", "transform": "toLower" },
  { "from": "fieldSource", "to": "kolom_db", "default": "nilai_default" }
]
```

| Property | Wajib | Keterangan |
|---|---|---|
| `from` | ✅ | Dot-path ke field di source data |
| `to` | ✅ | Nama kolom di tabel target |
| `transform` | ❌ | Fungsi transform (lihat tabel Transform) |
| `default` | ❌ | Nilai default jika source field null/undefined |
| `expand` | ❌ | `true` untuk expand array → multiple rows |
| `mapping` | ❌ | Child mapping (wajib jika `expand: true`) |

#### Dot-Path

Akses nested object dengan titik:

```
"user.name"       → { user: { name: "Budi" } }          → "Budi"
"data.items"       → { data: { items: [...] } }          → [...]
"address.city"     → { address: { city: "Jakarta" } }    → "Jakarta"
```

#### Array Expand

Untuk flatten nested array jadi multiple rows:

```json
"mapping": [
  { "from": "nama_surah", "to": "surah" },
  {
    "from": "ayat",
    "to": "_expand",
    "expand": true,
    "mapping": [
      { "from": "nomorAyat",    "to": "nomor_ayat" },
      { "from": "teksArab",     "to": "teks_arab" },
      { "from": "teksIndonesia","to": "teks_indonesia" }
    ]
  }
]
```

**Input:**
```json
{ "nama_surah": "Al-Fatihah", "ayat": [
  { "nomorAyat": 1, "teksArab": "...", "teksIndonesia": "..." },
  { "nomorAyat": 2, "teksArab": "...", "teksIndonesia": "..." }
]}
```

**Output (2 rows):**
| surah | nomor_ayat | teks_arab | teks_indonesia |
|---|---|---|---|
| Al-Fatihah | 1 | ... | ... |
| Al-Fatihah | 2 | ... | ... |

> Field parent (`nama_surah`) otomatis di-copy ke setiap child row.

#### Cross-Source Reference

Referensi data dari source lain dalam expand:

```json
{ "from": "tajweed.ayahs[nomorAyat].text", "to": "teks_tajweed" }
```

Artinya: cari di `tajweed.ayahs` item yang `nomorAyat`-nya cocok dengan item saat ini, lalu ambil `.text`.

---

### Transform

| Key | Fungsi | Contoh Input → Output |
|---|---|---|
| `toInt` | Parse ke integer | `"42"` → `42` |
| `toFloat` | Parse ke float | `"3.14"` → `3.14` |
| `toString` | Konversi ke string | `123` → `"123"` |
| `toISODate` | Parse ke ISO 8601 | `"2024-01-15"` → `"2024-01-15T00:00:00.000Z"` |
| `toLower` | Lowercase | `"HELLO"` → `"hello"` |
| `toUpper` | Uppercase | `"hello"` → `"HELLO"` |
| `trim` | Hapus whitespace | `"  hi  "` → `"hi"` |
| `nullIfEmpty` | Null kalau kosong | `""` → `null` |

---

## 📝 Contoh Lengkap

### JSON → PostgreSQL (Insert)

```json
{
  "$schema": "./pipeline.schema.json",
  "name": "Import users dari JSON",
  "version": "1.0",
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
  "operation": { "mode": "insert" },
  "mapping": [
    { "from": "id",    "to": "external_id" },
    { "from": "name",  "to": "full_name",  "transform": "trim" },
    { "from": "email", "to": "email",      "transform": "toLower" },
    { "from": "role",  "to": "role",       "default": "user" }
  ]
}
```

### CSV → SQLite (Upsert)

```json
{
  "$schema": "./pipeline.schema.json",
  "name": "Sync contacts dari CSV",
  "version": "1.0",
  "source": {
    "type": "csv",
    "filePath": "./exports/contacts.csv",
    "delimiter": ",",
    "hasHeader": true
  },
  "target": {
    "type": "sqlite",
    "filePath": "./contacts.db",
    "table": "contacts"
  },
  "operation": {
    "mode": "upsert",
    "conflictOn": ["email"]
  },
  "mapping": [
    { "from": "Name",    "to": "name",    "transform": "trim" },
    { "from": "Email",   "to": "email",   "transform": "toLower" },
    { "from": "Phone",   "to": "phone",   "transform": "toString" },
    { "from": "Company", "to": "company", "transform": "nullIfEmpty" }
  ]
}
```

### API Multi-Source → PostgreSQL (Upsert + Expand)

```json
{
  "$schema": "./pipeline.schema.json",
  "name": "Quran Seed — equran.id + tajweed",
  "version": "1.0",
  "source": {
    "type": "api",
    "pagination": { "type": "range", "param": "index", "from": 1, "to": 114 },
    "requests": [
      { "id": "equran",  "url": "https://equran.id/api/v2/surat/{index}", "resultPath": "data" },
      { "id": "tajweed", "url": "https://api.alquran.cloud/v1/surah/{index}/quran-tajweed", "resultPath": "data" }
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
    {
      "from": "equran.ayat", "to": "_expand", "expand": true,
      "mapping": [
        { "from": "nomorAyat",     "to": "nomor_ayat" },
        { "from": "teksArab",      "to": "teks_arab" },
        { "from": "teksIndonesia", "to": "teks_indonesia" },
        { "from": "tajweed.ayahs[nomorAyat].text", "to": "teks_tajweed" }
      ]
    }
  ]
}
```

> Lihat lebih banyak contoh di folder [`pipelines/samples/`](pipelines/samples/).

---

## 📋 Template Siap Copas

Tinggal copy, ganti `___PLACEHOLDER___`, dan jalankan!

```
pipelines/templates/
├── template-json-to-postgres.json
├── template-json-to-sqlite.json
├── template-csv-to-postgres.json
├── template-csv-to-sqlite.json
├── template-api-range-to-postgres.json
├── template-api-range-to-sqlite.json
├── template-api-cursor-to-postgres.json
├── template-api-none-to-sqlite.json
└── template-api-multi-merge-expand.json
```

**Cara pakai:**

```bash
# 1. Copy template into a project folder
mkdir -p pipelines/my-project
cp pipelines/templates/template-csv-to-postgres.json pipelines/my-project/pipeline.json

# 2. Edit — replace all ___PLACEHOLDER___
#    IDE autocomplete is enabled due to $schema!

# 3. Run
bun run src/index.tsx --pipeline pipelines/my-project/pipeline.json
```

---

## 🎯 JSON Schema (Typesafe)

Semua file config punya `$schema` yang memberikan:

| Fitur | Keterangan |
|---|---|
| ✅ **Autocomplete** | Ketik `"` → muncul semua property yang valid |
| ✅ **Validasi tipe** | `"mode": "delete"` → langsung error |
| ✅ **Conditional required** | Pilih `upsert` → `conflictOn` wajib diisi |
| ✅ **Transform enum** | Autocomplete semua transform yang tersedia |
| ✅ **Deskripsi hover** | Hover di property → tooltip penjelasan |
| ✅ **No typo** | Property yang tidak dikenal langsung error |

Tambahkan `$schema` di baris pertama file config:

```json
{
  "$schema": "./pipeline.schema.json",
  ...
}
```

> Untuk file di subfolder, sesuaikan path: `"$schema": "./../pipeline.schema.json"`

---

## ⌨️ Keyboard Controls

Saat pipeline berjalan, gunakan keyboard untuk kontrol:

| Key | Status | Aksi |
|---|---|---|
| `p` | Running | ⏸ Pause pipeline |
| `p` | Paused | ▶ Resume pipeline |
| `c` | Running/Paused | ✗ Cancel pipeline |
| `r` | Done (ada gagal) | 🔁 Retry item yang gagal |
| `q` / `Esc` | Done | Keluar |

---

## 📁 Struktur Folder

```
data-pipe/
├── src/
│   ├── index.tsx                  ← entry point (Ink render)
│   ├── pipeline/
│   │   ├── engine.ts             ← orchestrator utama
│   │   ├── mapper.ts             ← field mapping + transform
│   │   ├── reader/
│   │   │   ├── index.ts          ← factory reader
│   │   │   ├── json.reader.ts
│   │   │   ├── csv.reader.ts
│   │   │   └── api.reader.ts
│   │   └── writer/
│   │       ├── index.ts          ← factory writer
│   │       ├── postgres.writer.ts
│   │       └── sqlite.writer.ts
│   ├── ui/
│   │   ├── App.tsx               ← root Ink component
│   │   ├── components/
│   │   │   ├── ProgressBar.tsx
│   │   │   ├── LogPanel.tsx
│   │   │   ├── StatusBadge.tsx
│   │   │   └── ResultSummary.tsx
│   │   └── hooks/
│   │       └── usePipeline.ts    ← state + engine bridge
│   └── shared/
│       └── types.ts              ← semua types
├── pipelines/
│   ├── pipeline.schema.json      ← JSON Schema
│   ├── products/                 ← products project
│   │   ├── pipeline.json         
│   │   ├── input/
│   │   │   └── products.csv
│   │   ├── output/
│   │   │   └── products.db
│   │   └── init-db.ts            ← SQLite DB initializer
│   ├── quran/                    ← quran postgres project
│   │   ├── init-db.ts            ← Postgres database & schema creator
│   │   └── pipeline.json         ← Seeding config for generic CLI
│   ├── samples/                  ← contoh siap pakai
│   └── templates/                ← template copas
├── package.json
└── tsconfig.json
```

---

## 🔌 Menambah Source / Writer Baru

### Menambah Source Type

1. Buat file baru di `src/pipeline/reader/`, implementasikan interface:

```ts
import type { Reader } from '../../shared/types';

export class MyReader implements Reader {
  async fetchAll(onProgress: (fetched: number, total: number) => void): Promise<unknown[]> {
    // fetch data...
    onProgress(items.length, items.length);
    return items;
  }
}
```

2. Daftarkan di `src/pipeline/reader/index.ts`:

```ts
import { MyReader } from './my.reader';

// di dalam switch:
case 'my-source': return new MyReader(config);
```

3. Update type di `src/shared/types.ts` — tambah union member baru di `SourceConfig`.

### Menambah DB Writer

1. Buat file baru di `src/pipeline/writer/`, implementasikan interface:

```ts
import type { Writer, OperationConfig } from '../../shared/types';

export class MyWriter implements Writer {
  async connect(): Promise<void> { /* ... */ }
  async disconnect(): Promise<void> { /* ... */ }
  async write(row: Record<string, unknown>, op: OperationConfig, table: string): Promise<void> {
    // write row to DB...
  }
}
```

2. Daftarkan di `src/pipeline/writer/index.ts`:

```ts
import { MyWriter } from './my.writer';

// di dalam switch:
case 'my-db': return new MyWriter(config);
```

3. Update type di `src/shared/types.ts` — tambah union member baru di `TargetConfig`.

---

## 🕌 Project: Quran Relational Database (PostgreSQL)

Project `pipelines/quran/` adalah seeder khusus untuk menarik data tafsir, surat, dan ayat dari API `equran.id` ke dalam database relasional ternormalisasi PostgreSQL `quran_pipe_data`.

### Langkah-langkah Menjalankan:

1. **Inisialisasi Database & Tabel**
   Command ini akan menghubungkan ke Postgres lokal dengan username `ma-sum` (tanpa password), membuat database `quran_pipe_data`, lalu membuat seluruh tabel, indeks, foreign keys, serta pre-seed 5 reciters:
   ```bash
   bun run pipelines/quran/init-db.ts
   ```

2. **Jalankan Seeder (Fetch & Insert)**
   Menarik seluruh data dari list surah, detail ayat, dan tafsir (114 surah) lalu memasukkannya ke database secara transaksional menggunakan generic CLI:
   ```bash
   bun run src/index.tsx --pipeline pipelines/quran/pipeline.json
   ```

---

## 📄 Lisensi

MIT
