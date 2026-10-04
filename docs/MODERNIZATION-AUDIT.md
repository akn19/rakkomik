# Audit Modernisasi HakuNeko

> Tanggal: 2026-10-04 · Basis: Electron 8.3.4 (Chromium 80 / Node 14) → target Electron 44.x
> Status: **dokumen analisis, belum ada perubahan kode**.
> Keputusan final diskusi: **upgrade Electron dan rewrite UI hukumnya WAJIB**; skope dipangkas (hapus video, hapus paket privat); distribusi full-GitHub satu repo; build desktop-only. Semua ditandai **(WAJIB)** / **(diputuskan)** di bawah.

## 1. Ringkasan eksekutif

| Lapisan | Kondisi | Keputusan |
|---|---|---|
| Runtime Electron 8.3.4 | Usang 6 tahun, `electron.remote` sudah dihapus di versi baru — upgrade **pasti rusak** di 4+ titik | Wajib migrasi (M–L) |
| Build web (`polymer-build` 3.1.4) | Usang, transitifnya (`vinyl-fs`, `merge-stream`) rapuh di Node modern | Ganti Vite (**setelah/bersamaan** rewrite UI) |
| UI Polymer classic + HTML Imports (26 file, ±8200 baris) | Teknologi mati; polyfill `webcomponentsjs`/`shadycss` berisiko pecah di Chromium 140+ | **Diputuskan: rewrite ke React + Tailwind + TanStack + shadcn** — engine + 1340 konektor dipertahankan, lihat rencana §5 |
| Lib util (`crypto-js`, `oauth`, `exif`, `fs-extra`) | Ada padanan native | Migrasi bertahap (S–M) |
| Lib format | Sebagian ikut skope-cut §6.1 | `hls.js` + `ass` + `pdfkit` **dihapus** (video & PDF keluar skope); `jszip`/`protobufjs` tetap (tidak ada padanan native); `sql.js` audit pemakaian |
| Tooling (linter/formatter, `jest` 30) | `eslint` 8 EOL (merangkap formatter via `--fix`); `jest` sudah modern | Linter+formatter → **oxc** (`oxlint` + `oxfmt`, lihat §2.6); `jest` → `vitest` bila pindah ke Vite |
| Storage/cache | File JSON + file gambar (tanpa DB); tulis tak-atomik satu-satunya lubang | **Tetap file** — SQLite/RocksDB tidak perlu (§2.7); perbaiki tulis atomik |

**Prinsip urutan (final):** Skope dulu (§6, Fase 0.5 — kode yang dihapus tak perlu dimigrasi) → Runtime **(WAJIB)** → lib kecil → build/Vite → UI rewrite **(WAJIB)**, yang sekaligus membuka blokir Vite penuh. Jangan dibalik: Vite tidak bisa mem-bundle frontend Polymer (HTML Imports).

---

## 2. Inventarisasi aktual (hasil audit repo)

### 2.1 Runtime & main process (`src/app`)

| Paket (terpasang) | Status | Rekomendasi |
|---|---|---|
| `electron` 8.3.4 | Usang berat | → 44.x (lihat §3) |
| `discord-rpc` 3.2.0 (di `src/app`) vs 4.0.1 (di root) | **Versi ganda/tidak sinkron** | Samakan ke 4.0.1, kunci versi (hapus `"latest"`) |
| `fs-extra` 11.4.0 | Sehat, tapi sebagian besar sudah dicover `fs/promises` + `fs.cp` bawaan Node 20+ | Migrasi bertahap ke native, lalu lepas dependensi |
| `jszip` 3.10.1 | Sehat, tidak ada pengganti native | Tetap, kunci versi |
| `@logtrine/logtrine` 1.1.2 | Privat; harus hilang (keputusan §6.2) | → logger publik (`pino`/`winston`) |
| `@hakuneko/*-binaries` (ffmpeg/imagemagick/kindlegen) | Privat; skope-cut §6 menghapus pemakainya | **Hapus semua** (lihat §6.2) |

### 2.2 Renderer lib (`src/web/js`, dimuat via `<script>` di `index.html`)

| Lib (ukuran) | Dipakai oleh | Pengganti native | Aksi |
|---|---|---|---|
| `crypto-js` 48 KB | 20 konektor + `Connector.mjs` (`createConnectorURI`) | WebCrypto `crypto.subtle` (skema `hakuneko://` sudah `secure:true`, jadi tersedia) | Migrasi (M). **Jebakan:** `subtle` async vs pemakaian sinkron/`CryptoJS.mode` (ECB tidak didukung WebCrypto — cek 2 situs pemakaian `mode`) |
| `oauth-1.0a` 8 KB | (cek konsumen; kecil) | `subtle` HMAC-SHA1 | Migrasi (S) |
| `exif-js` 16 KB | Koreksi orientasi gambar | `createImageBitmap(..., {imageOrientation:'from-image'})` / CSS `image-orientation` | Migrasi (S) |
| `jszip` 96 KB | `EbookGenerator` (CBZ/EPUB) | Tidak ada | Tetap |
| `pdfkit` 2,5 MB | Ebook PDF — keluar skope §6.1 (hanya Folder/CBZ/EPUB-novel) | **Hapus** (kecuali PDF dinyatakan dibutuhkan eksplisit) |
| `sql.js` 1,6 MB | **Konsumen tidak jelas** (tidak ditemukan pemakaian langsung di `mjs/`) | — | Audit: bila tak dipakai → hapus (menang 1,6 MB gratis) |
| `hls.light` 176 KB | `templates/VRV.mjs` dkk (videostream anime) — keluar skope §6.1 | **Hapus** |
| `ass` 32 KB | Render subtitle (video-only) — keluar skope §6.1 | **Hapus** |
| `protobufjs` 72 KB | `fetchPROTO`, 4 konektor | Tidak ada | Tetap |
| `webcomponentsjs` + `shadycss` + `iron-*` + `polymer` (`src/web/lib`) | Seluruh UI | React + Tailwind + shadcn (§5) | Hapus saat rewrite UI (§5) |

### 2.3 Build, lint, test (root)

| Paket (terpasang) | Status | Rekomendasi |
|---|---|---|
| `polymer-build` 3.1.4 (+ transitif `vinyl-fs`, `merge-stream`) | Usang, rapuh di Node 20+ | → Vite (§4) |
| `eslint` 8.57.1 (+ `.eslintrc.json`) | v8 EOL; di repo ini merangkap **formatter** (skrip `format:*` = `eslint --fix`). Tidak ada prettier (tidak ada config/dependensi/rujukan CI) | → **oxc**: `oxlint` (lint) + `oxfmt` (format), lihat rencana §2.6 |
| `jest` 30.4.2 (+ `jest-junit`) | Sudah modern | Tetap **atau** → `vitest` bila pindah Vite (keselarasan tooling, bukan keharusan) |
| `puppeteer-core` 25.5.0 | Modern; hanya dipakai `src/__tests__/Connectors.e2e.js` | Tetap |
| `asar` 3.2.0 | **Deprecated** upstream | → `@electron/asar` (drop-in, S) |
| `rcedit` 5.0.2, `innosetup-compiler`, `win-7zip` | Tooling Windows installer | Tetap; uji ulang di Node modern |
| `electron` (root devDep, untuk `electron .`) | 8.3.4 | Ikut target 44.x |

### 2.5 Package manager pnpm 12 + Knip (diputuskan, belum diimplementasikan)

- **pnpm 12 (terkini 12.9.1) ganti npm.** Alasan: instalasi jauh lebih cepat/hemat (content-addressable store — relevan karena `package-lock.json` saat ini 814 KB dan `node_modules` ganda root + `src/app`), proteksi *phantom dependency* yang ketat, dan `pnpm-lock.yaml` tunggal sebagai sumber kebenaran.
- **Temuan konkret (hasil audit, bukan teori): `build-web.js` me-`require('vinyl-fs')` dan `require('merge-stream')`, tetapi keduanya TIDAK dideklarasikan di `package.json`** — selama ini lolos karena hoisting npm (transitif via `polymer-build`). Di pnpm yang strict, build langsung pecah. Aksi wajib saat migrasi: deklarasikan keduanya eksplisit (atau hapus bersama `polymer-build` bila Vite sudah jalan).
- **Opsi layout:** (a) `pnpm-workspace.yaml` (`src/app` jadi workspace — satu lockfile, satu install); (b) pertahankan nested install via `pnpm --dir src/app install` (skrip `postinstall` disesuaikan). Putuskan saat eksekusi dengan satu batasan: packager `build-app.js` mengemas `src/app` + `node_modules`-nya — **verifikasi ia tahan terhadap layout symlink pnpm**; bila tidak, pilih (b).
- **CI:** 3 workflow masih `actions/setup-node@v1` + `npm install` → ganti ke pnpm (`pnpm/action-setup`, hapus `package-lock.json`, commit `pnpm-lock.yaml`). `.gitignore` sudah mengabaikan `yarn.lock`; pastikan `pnpm-lock.yaml` TIDAK diabaikan.
- **Tanpa kunci toolchain di file (keputusan).** Dev memakai fnm di Linux/Windows (+ manager lain), sehingga: TANPA `packageManager` eksak, TANPA `.nvmrc`/`.node-version` eksak, TANPA `engines` strict di `package.json`. Yang dinyatakan hanya **rentang dukungan** (Node ≥20, pnpm ≥10; direkomendasikan Node LTS + pnpm 12) di dokumen ini. Reproduksibilitas dijamin lockfile untuk *dependensi*; pagar versi Node dipegang **CI matrix multi-OS** (pola `ci-pr` yang sudah ada: windows/ubuntu/macOS + `node-version` major saja — pertahankan pola itu, jangan kunci minor).
- **Knip (dead-code & dependency hygiene).** Menemukan file/export/dependency tak terpakai dan import tak terdaftar — tepat untuk repo ini: memvalidasi hasil §6.1/§6.2 (tidak ada sisa rujukan video/paket privat), menemukan kandidat seperti `sql.js`, dan **mendeteksi phantom deps sebelum migrasi pnpm**. Konfigurasi awal (`knip.json`): `entry` = `src/app/main.js`, `src/web/mjs/HakuNeko.mjs`, `build-*.js`, `deploy-web.js`; `project` = `src/**/*.{js,mjs}` (mencakup file vendor di `src/web/js` agar file tak terpakai ikut terdeteksi). Dijalankan via skrip `knip` dan (setelah baseline bersih) sebagai gate CI. Sinergi: oxlint = aturan per-file, Knip = dependensi antar-file.
- **Estimasi: S.** Sehari termasuk triase awal dan perbaikan CI.

### 2.6 Rencana migrasi linter/formatter ke oxc (belum diimplementasikan)

Pengganti 1:1 `eslint` di repo ini adalah dua biner Rust: `oxlint` (lint) + `oxfmt` (format, kompatibel-prettier).

- **Konfigurasi.** `.eslintrc.json` → `.oxlintrc.json` (format kompatibel ESLint v8): `env` (`es6`/`node`/`browser`/`jest`) dan 11 `globals` (`CryptoJS`, `Engine`, `HakuNeko`, …) dipindahkan apa adanya. Dari 9 rules lama, hanya aturan *correctness* yang didukung oxlint yang dipertahankan (`no-extra-parens`); 8 aturan *styling* (`indent`, `semi`, `brace-style`, `comma-spacing`, `semi-spacing`, `space-before-blocks`, `no-trailing-spaces`, `no-multiple-empty-lines`, `no-multi-spaces`) **pindah ke formatter** — itu desain oxc, bukan kehilangan cakupan. Gaya repo (indent 4 spasi, single-quote, semicolon) dituangkan di `.oxfmtrc.json`. Flag `--parser-options ecmaVersion:2020` di skrip lama tidak perlu diteruskan (oxlint mem-parse sintaks modern otomatis; `.mjs` terdeteksi ESM).
- **Skrip `package.json`.** Nama skrip dipertahankan agar 3 workflow CI (`ci-pr`, `continuous-integration`, `continuous-deployment` yang memanggil `npm run lint`) tidak tersentuh: `lint:app`/`lint:web` → `oxlint <dir> --ignore-path .gitignore`, `format:*` → `oxfmt --write`. Dependensi `eslint` dihapus, tambah `oxlint` + `oxfmt` versi pin.
- **Peringatan utama: JANGAN bulk-reformat.** `oxfmt --check` hampir pasti melaporkan divergensi pada baris-baris yang dulu tidak di-enforce eslint (mis. `printWidth`, `quotes` — aturan lama tidak mengaturnya). Menjalankan `oxfmt --write` repo-wide akan menyentuh 1300+ file konektor = diff noise raksasa. Kebijakan: tooling diganti + config disetarakan, `--write` hanya untuk file yang memang sedang diubah.
- **Estimasi: S.** Sehari kerja termasuk verifikasi `npm run lint` hijau di ketiga workflow.

### 2.7 Skema cache & storage (diputuskan: tetap file, tanpa SQLite/RocksDB)

Hasil bedah `Storage.mjs` + manajer terkait — seluruhnya **file biasa**, tanpa database:

| Data | Bentuk | Pola akses |
|---|---|---|
| Daftar manga per konektor (`mangas.<id>`) | Satu JSON per konektor di dir config | Tulis-baca utuh tiap update |
| `bookmarks`, `chaptermarks`, settings | JSON kecil di dir config | Tulis-baca utuh |
| Hasil download | Folder/CBZ/EPUB langsung di dir user | Scan direktori untuk deteksi eksisting |
| Bundle web + `version` | Dir cache (`hakuneko://cache`) | Timpa utuh oleh updater |
| Gambar | File (disajikan via protokol `connector://`/`hakuneko://`) | — |

**Keputusan: TIDAK perlu SQLite/RocksDB.** Alasannya terukur, bukan preferensi:

- **Skala tidak membutuhkan.** List terbesar (±10.389 judul Bacami) ≈ 1 MB JSON — parse/tulis ms-level. Total "database" app ini satuan MB dengan pola tulis-baca utuh; tidak ada query kompleks, tidak ada tulis konkuren (satu instance), tidak ada 100k+ baris berindeks. DB menyelesaikan masalah yang tidak dimiliki app ini.
- **RocksDB eksplisit DITOLAK.** Ia modul **native** (kompilasi/prebuild per OS×arch) — bertentangan langsung dengan matriks x86_64/arm64/RISC-V-kondisional (§6.4) dan prinsip paket-publik-tanpa-biner-privat (§6.2). RocksDB dirancang untuk beban tulis server berat; untuk app desktop single-user read-heavy ini murni overkill.
- **SQLite hanya kondisional.** Satu-satunya lubang robustness nyata adalah **tulis JSON tidak atomik** (`fs.writeFile` langsung — crash di tengah = file korup), dan itu sembuh dengan **tulis-tmp + rename (S)**, bukan dengan DB. SQLite dipertimbangkan **hanya bila** kebutuhan query muncul (mis. indeks pencarian lintas-konektor, histori download terquery) — dan bila ya, pilih build **WASM** (`@sqlite.org/sqlite-wasm` + persistensi OPFS, 100% paket publik) bukan `better-sqlite3` (native → masalah arch lagi). Catatan: `sql.min.js` (sql.js 1,6 MB) sudah ikut terbundle TANPA konsumen jelas — bila SQLite-WASM diambil, ia penggantinya; bila tidak, hapus (lihat §2.3).
- Gambar tetap file (blob di DB justru lebih lambat + menggembungkan backup user).

### 2.8 Pola kode yang pecah saat upgrade Electron

Sudah dikonfirmasi via grep (bukan dugaan):

- `electron.remote` di **renderer**: `Request.mjs` (baris 9), `Settings.mjs` (40), `Storage.mjs` (25–32, termasuk `remote.require('child_process')` dan `remote.dialog/shell/app`), plus inline `index.html` (baris 18, 94: `remote.dialog`, `remote.getCurrentWindow()`).
- `require('electron')` di renderer: `InterProcessCommunication.mjs`, `Request.mjs` (= `nodeIntegration: true`).
- Custom scheme istimewa di `ElectronBootstrap.js` + (kemungkinan) `registerBufferProtocol` untuk `hakuneko://` dan `connector://`.
- Window tersembunyi `fetchUI` (`webRequest.onBeforeRequest`) — API masih ada di v44, penyesuaian kecil.

---

## 3. Upgrade Electron 8 → 44: daftar breaking

1. **`remote` dihapus → IPC eksplisit (L).** Setiap pemakaian (`dialog`, `shell`, `app.getPath`, `getCurrentWindow`, `child_process.exec`) jadi pasangan `ipcMain.handle` / `ipcRenderer.invoke` + satu file `preload.js` + `contextBridge`. Menyentuh `ElectronBootstrap`, `Storage`, `Settings`, `Request`, `InterProcessCommunication`, dan inline script `index.html`.
2. **`require('electron')` di renderer → `contextBridge` (M).** Alternatif cepat (tetap `nodeIntegration: true`, `contextIsolation: false`) masih jalan di v44 tapi deprecated dan menonaktifkan sandbox — tidak direkomendasikan; anggap ini utang baru.
3. **Custom protocol → `protocol.handle()` (M).** Pengganti `registerBufferProtocol`/`registerFileProtocol`. Inti cara kerja konektor (`connector://payload`) dan penyajian cache (`hakuneko://cache/...`) — uji petik ke 1340 konektor wajib karena perilaku fetch/CORS skema kustom berubah di Chromium baru.
4. **Default `webPreferences`** (`contextIsolation`, `sandbox`, `webSecurity`) berubah sejak v8 (S–M). Window `fetchUI` perlu opsi eksplisit.
5. **Kunci semua versi `"latest"`** di kedua `package.json` (S). Instalasi ulang hari ini bisa menarik major baru yang pecah di Node 22.

---

## 4. Migrasi ke Vite: layak, dengan satu syarat arsitektural

### 4.1 Temuan arsitektur penentu

- **Konektor dimuat dinamis saat runtime**: `Connectors.mjs` me-`list` direktori `hakuneko://cache/mjs/connectors/*.mjs` lalu `await import(file)`. Artinya **1340 konektor + `img/connectors/*` adalah aset statis, bukan modul bundle** — di Vite mereka masuk `public/` (atau disalin via plugin) dan **tidak boleh dibundle/di-tree-shake**.
- Yang **boleh** dibundle Vite: `index.html` + `mjs/engine/*` (+ UI baru nanti).
- **Penjebak:** `build-web.js` saat ini mem-bundle **frontend Polymer via HTML Imports** (`lib/hakuneko/.../app.html` sebagai fragments). **Vite/Rollup tidak memproses HTML Imports** — jadi migrasi Vite penuh **terblokir sampai UI Polymer diganti React (§5, WAJIB)**.

### 4.2 Bentuk target yang direkomendasikan

```
src/web/                  # tetap sumber dev
  index.html              # entry Vite
  mjs/engine/*            # dibundle Vite (kecuali connectors/)
  mjs/connectors/*  ─┐
  img/connectors/*   ─┤→  public/ (disalin apa adanya, dinamis-import saat runtime)
  lib/polymer/*      ─┘→  HAPUS saat rewrite UI
vite.config.js            # build.mode 'development' → target cache-directory (ganti build-web.js)
                          # build.mode 'production' → build/latest (ganti deploy-web.js)
vitest.config             # ganti jest bila diinginkan (opsional)
```

- Alur dev baru: `vite build --watch` (atau `vite dev` + proxy skema kustom) → `electron . --cache-directory=./dist-dev`. Skrip `start:dev/start:build` diperbarui.
- `build-web.js` (`polymerBuild` + `git stash` + `createVersionInfo`) pensiun; `createVersionInfo` jadi plugin Vite kecil (tulis `mjs/VersionInfo.mjs` saat build).
- `build-app.js` (packager kustom asar + installer): tetap bisa dipakai, ganti `asar` → `@electron/asar`; **atau** evaluasi `electron-builder` (auto-update bawaan via `electron-updater` bisa menggantikan `UpdateServerManager` kustom — keputusan terpisah, bukan prasyarat).

### 4.3 Urutan yang aman

Vite **untuk engine/shell bisa jalan sebelum UI selesai** (bundle `mjs/engine`, konektor tetap statis), tetapi selama `index.html` masih me-load `app.html` via HTML Imports, build produksi tetap butuh jalur lama. Praktisnya: **rewrite UI React dulu, Vite menyusul** (paralel hanya untuk engine/shell). Keputusan rewrite UI ke React (§5, WAJIB) membuat Vite menjadi pasangannya yang natural (`@vitejs/plugin-react` + `@tailwindcss/vite`); setelah UI baru jadi, tidak ada lagi alasan mempertahankan `polymer-build`.

---

## 5. Rewrite UI: React + Tailwind + TanStack + shadcn (diputuskan)

Keputusan: **hanya engine + konektor yang dipertahankan; seluruh UI diganti**. Ini sekaligus membuka blokir migrasi Vite (§4.3) karena Vite tidak bisa mem-bundle HTML Imports — dengan UI baru, tidak ada lagi yang perlu dibundle selain shell + engine.

### 5.1 Batas rewrite (jangan disentuh vs diganti)

| Dipertahankan (engine) | Diganti total (UI) |
|---|---|
| `mjs/engine/*`, `mjs/connectors/*` (1340 konektor), `mjs/VersionInfo.mjs` | `index.html` (shell + inline script), `lib/hakuneko/*` (26 file), `lib/polymer`, `lib/iron-*`, `lib/webcomponentsjs`, `lib/shadycss` |
| Protokol `hakuneko://` + `connector://`, `fetchUI`, EbookGenerator | `theme.html` ×2, `replaceDialogs()`, window controls inline |
| Urutan muat: engine expose `window.Engine` **sebelum** UI mount (konektor bergantung pada global ini) | Duplikasi tema light/dark → satu codebase |

### 5.2 Peran tiap stack

- **React 19** — model komponen pengganti `dom-module`; hooks pengganti observer/`notifyPath`; `StrictMode` saat dev.
- **Tailwind v4** (via `@tailwindcss/vite`) — pengganti `theme.html` + style per-file; dark mode berbasis class (`dark:`) menghapus duplikasi light/dark; tidak ada CSS runtime/CDN (aman offline).
- **TanStack Query** — *server-state*: daftar manga/chapter/pages, caching, background refetch, retry. Menggantikan rantai callback + pola `HistoryWorker`; cocok karena API engine (`_getMangas/_getChapters/_getPages`, `updateMangas`) memang async.
- **TanStack Virtual** — pengganti langsung `iron-list` (dipakai di 10 view!). Wajib benar untuk list 10.000+ judul (kasus Bacami) dan 1000+ chapter.
- **TanStack Table** — tabel antrean download (`jobs.html`) dan status; sorting/filter bawaan menggantikan kode manual.
- **TanStack Router** — navigasi antar view pengganti `pages.html`/`menu.html`; pakai *hash history* (app berjalan di skema kustom, bukan http).
- **shadcn** — primitif UI (Dialog, DropdownMenu, Tabs, Toast/Sonner, Tooltip, ScrollArea, Progress, Select/Checkbox untuk settings). Model copy-paste = kode milik sendiri, bertema via CSS variables (selaras dark mode), tanpa dependensi runtime baru.
- **Zustand (tipis)** — *client-state* (manga terpilih, posisi reader, preferensi tampilan). TanStack tidak mengcover ini; jaga tetap kecil, jangan jadi store raksasa.
- **TypeScript (disarankan)** — minimal untuk lapisan bridge (§5.3); engine boleh tetap JS.

### 5.3 Bridge engine ↔ React (kunci keberhasilan)

Engine memancarkan **DOM events** (`DownloadManager.dispatchEvent(new CustomEvent('updated'))`, job `addEventListener('updated', …)` — pola yang dipakai UI lama di `jobs.html:131`), jadi bridge tidak perlu polling:

- Satu modul adapter (`ui/src/lib/engine.ts`): hooks bertipe `useMangas()`, `useChapters(manga)`, `useConnectors()`, `useDownloadJobs()` (subscribe `updated` dalam `useEffect`, cleanup saat unmount).
- Aturan: **React tidak boleh mengimpor engine via bundler sebagai modul biasa bila itu merusak global** — engine tetap dimuat sebagai chunk/script yang men-set `window.Engine` sebelum React mount; adapter hanya membaca global tersebut (konektor yang di-`import()` dinamis oleh engine tidak tersentuh).
- API callback lama (`getMangas(cb)`, `updateMangas(cb)`) dibungkus jadi Promise/Query — logika engine tidak diubah, hanya dibungkus.

### 5.4 Koeksistensi tanpa mengganggu (strangler)

Aplikasi sudah punya pemilih frontend (`Engine.Settings.frontend`: `frontend@classic-light/dark`). UI baru didaftarkan sebagai **`frontend@react`** — user/QA bisa bolak-balik classic ↔ react sampai paritas tercapai, baru classic dihapus. Nol downtime pengembangan.

### 5.5 Checklist paritas per view

| View lama (±baris) | Rute/komponen baru | Fitur kunci |
|---|---|---|
| `app.html` (212) shell | `App` + layout + `ThemeProvider` | Titlebar kustom (`-webkit-app-region: drag`), mount order engine→React |
| `menu.html` (315) | Sidebar + TanStack Router | Navigasi, indikator update |
| `mangas.html` (347) | `MangaGrid` + search/filter | **Virtual** (grid virtual), Query cache per konektor |
| `chapters.html` (604) | `ChapterList` | **Virtual**, badge read/unread, multi-select download |
| `pages.html` (636) reader | `Reader` (paling kompleks) | Mode baca, keyboard nav, preload tetangga, sinkron `connector://` image pipeline engine |
| `connectors.html` (444) | `ConnectorList` + update | Progress `updateMangas`, error per konektor |
| `jobs.html` (247) | `DownloadQueue` | **Table** + subscribe event `updated`, progress bar (shadcn Progress) |
| `bookmarks.html` (133), `quotes.html` (508), `start.html` (112), `status.html` (111), `input.html` (163) | Komponen CRUD/form biasa | Dialog/toast shadcn, form settings |
| `theme.html` (258×2) | **HAPUS** | `dark:` variant + CSS vars |

### 5.6 Window controls & dialogs (terkait Fase 1)

Titlebar kustom (`minimize/maximize/close`) dan `remote.dialog` inline di `index.html` lama **tidak boleh** dibawa mentah (bergantung `electron.remote` yang mati). Jalur benar: preload + `contextBridge` dari Fase 1, UI memanggil `window.hakuneko.window.minimize()` dkk; `replaceDialogs()` → shadcn `Dialog`; file picker tetap lewat IPC `Storage` (engine tidak berubah).

### 5.7 Startup & lazy-loading (persyaratan, bukan opsional)

Aplikasi sekarang lambat start terutama karena **`Connectors.initialize()` me-`import()` 1340+ modul konektor secara SEQUENTIAL** (`for…of` + `await` di `Connectors.register`) dan hasilnya di-`await` sebelum UI boleh tampil (`await Engine.initialize()` → `loadFrontend`). UI baru wajib tidak mengulang pola ini:

- **Konektor lazy + background.** Registrasi cukup metadata dulu; `import()` modul konektor dikerjakan (a) on-demand saat konektor dibuka, dan (b) sisanya dicicil background dalam batch saat idle (`requestIdleCallback`/`setTimeout`) — JANGAN sequential-await di critical path. `connector://` protocol handler (§4) diberi fallback import-on-demand untuk request yang datang sebelum batch-nya tiba.
- **Engine init di luar critical path.** Shell + skeleton langsung mount; `Settings.load()`, `BookmarkManager.loadProfile()`, `ChaptermarkManager`, `DiscordPresence` jalan background dengan status loading di UI (sekarang semuanya blocking sebelum paint).
- **Route-based splitting.** `React.lazy` + `Suspense` per rute: paket awal hanya shell + daftar manga; Reader (`pages.html` setara), Jobs, Connectors menyusul saat dibuka.
- **Lib berat dinamis.** `JSZip` (CBZ/EPUB saat download) dan sisa lib format hanya di-`import()` saat fitur download dipakai — tidak ikut paket awal.
- **Anggaran startup.** Pasang `performance.mark` dari `main()` sampai first-paint dan list konektor tampil; jadikan angka acuan regresi (target: shell interaktif < 1 dtk, list konektor lengkap background < ~5 dtk di HDD).

### 5.8 Ikon: Font Awesome → Lucide (diputuskan)

Kondisi kini (hasil inventarisasi): UI classic memakai **Font Awesome self-hosted** — 4 file woff2 di `src/web/css/` (±240 KB) + definisi `@font-face`/kelas di `theme.html`. Tidak ada brand icon (`fab`) di view-view. Favicon konektor (`img/connectors/*`) dan aset logo/tray/background adalah **gambar situs/OS, bukan icon-font — tidak diganti**.

- **Stack: `lucide-react`** (paket publik, tree-shaken — hanya ikon terpakai yang ikut bundle; selaras prinsip offline-safe §5.7). Tidak ada retrofit Lucide ke UI Polymer lama (kerja terbuang) — FA hidup sampai classic dihapus, UI baru Lucide sejak hari pertama.
- **Pemetaan FA → Lucide hampir 1:1** (`bars`→Menu, `home`→House, `search`→Search, `download`→Download, `bookmark`→Bookmark, `sync`→RefreshCw, `bug`→Bug, `book`→Book, `image`→Image, `folder-open`→FolderOpen, `plug`→Plug, `language`→Languages, `paste`→ClipboardPaste, `info-circle`→Info, kontrol window `window-minimize/maximize/close`→Minus/Square/X). Tidak ada masalah brand-icon yang dideprecate Lucide (tidak dipakai). Satu-satunya yang tidak 1:1: `street-view` → ganti `PersonStanding`/`Accessibility`.
- **Perubahan visual yang disadari:** FA punya dua bobot (solid/regular), Lucide satu bobot outline berbasis stroke (diatur via `stroke-width`) — ini bagian dari tujuan "modern", bukan regresi. Kelas ukuran `fa-2x`/`fa-fw` diganti utilitas Tailwind (`size-*`, `shrink-0`).
- Bungkus satu komponen `<Icon name size title>` agar pemakaian konsisten; bobot pengerjaan **S**, dikerjakan di dalam checklist paritas per view (§5.5) — bukan fase tersendiri. Saat classic dihapus, hapus juga 4 woff2 + CSS FA di `theme.html`.

### 5.9 Font: Fontsource (diputuskan)

Kondisi kini: UI classic hanya memakai font sistem (Arial/Helvetica) + font ikon FA — tidak ada font teks yang perlu dimigrasi. Untuk UI baru, font teks diambil dari **Fontsource** (paket npm publik, self-hosted):

- **Rekomendasi: Inter variable** (`@fontsource-variable/inter`) — satu file untuk semua bobot, subset `latin` (+ `latin-ext` bila perlu; judul manga Eropa/Indonesia tercover). Diimpor sebagai modul di entry Vite (`import '@fontsource-variable/inter'`) sehingga ikut terbundle — **offline-safe, tanpa CDN Google Fonts**, selaras prinsip §5.7.
- **Fallback CJK wajib.** Judul manga Jepang tidak tercover font Latin mana pun dan font CJK terlalu besar untuk dibundle — rantai fallback: `Inter, system-ui, "Hiragino Sans", "Noto Sans JP/CJK", "Segoe UI", sans-serif` (andalkan font OS untuk CJK). Dituang sebagai `font-sans` Tailwind.
- Keluarga final tetap bisa diganti belakangan (satu import + satu token Tailwind) — yang diputuskan di sini adalah **mekanismenya** (Fontsource, bukan CDN/sistem), bukan rupa spesifiknya. Effort S, bagian dari setup tema.

### 5.10 Estimasi & risiko

Tetap **XL**, dengan urutan: shell + bridge + tema (M) → views CRUD (M) → manga/chapter list + virtualisasi (M, validasi performa 10k baris) → reader (L, paling kompleks) → jobs/connectors/status (S–M) → hapus classic + polyfill (S). Risiko utama: (a) reader — perilaku baca harus identik (mode, caching gambar via `connector://` tetap milik engine ✓); (b) regresi virtualisasi (scroll jump, ukuran item dinamis) — uji dengan konektor Bacami (10.389 judul) sebagai benchmark; (c) semua styling harus offline-safe (Tailwind/shadcn dibundle — ✓ tidak ada CDN).

## 6. Penyempitan skope (diputuskan): hapus video, hapus paket privat

Dua keputusan ini **disarankan dikerjakan paling awal** — keduanya memperkecil permukaan kode yang harus dimigrasi pada Fase 1–4.

### 6.1 Hapus fitur video (pertahankan: komik CBZ/folder + novel)

Inventarisasi hasil grep (bukan perkiraan):

| Area | Yang dihapus | Catatan |
|---|---|---|
| Konektor anime/video (±10) | `AnimePahe`, `AnimeParadise`, `AnimeUnity`, `CrunchyAnime`, `MuchoHentai`, `TenshiMoe`, `VRVCrunchyroll`, `VRVHiDive`, `Allanimesite2`, `NineAnime` (+ varian `Allanimesite` bila bertag video) | Daftar final dipastikan saat eksekusi via `tags` |
| Helper videostream (13 file) | Seluruh `mjs/videostreams/*` (`Dood`, `Fembed`, `FileMoon`, `HydraX`, `Kwik`, `MP4Upload`, `MyCloud`, `PrettyFast`, `StreamSB`, `Streamtape`, `VideoVard`, `Vidstream`, `YourUpload`) | Tidak dipakai konektor manga |
| Template video | `templates/VRV.mjs`, `templates/Crunchyroll.mjs` (keduanya video-only) | `templates/MangaToon.mjs` dkk tetap (manga) |
| Lib web | `js/hls.light.min.js` (176 KB), `js/ass.min.js` (32 KB, subtitle = video-only) | Hapus tag `<script>` di `index.html` |
| `DownloadJob.mjs` | Seluruh jalur video: cabang `data.video`, unduh chunked mp4, playlist m3u8, unduh subtitle, perakitan perintah `ffmpeg` (±150 baris) | Jalur gambar (`_getPages` → ZIP/folder) tidak tersentuh |
| `Storage.mjs` | `_loadEpisodeM3U8/_loadEpisodeMP4`, entri ekstensi `m3u8`/`mp4`, filter terkait | |
| `Chapter.mjs` | Cabang payload video | Konektor manga tidak mengembalikan `video` |
| `App.js` | Hack `PATH` untuk ffmpeg di Windows | Ikut hapus bersama binernya (§6.2) |
| UI lama & baru | Entri menu/filter bertag anime-video, badge video di reader/jobs | Di UI baru (§5) tidak perlu dibangun |

Dampak format download (`Settings.chapterFormat`): yang dipertahankan = **Folder, CBZ, EPUB (novel)**. Opsi **PDF ikut dihapus** (tidak disebut dalam skope) — konsekuensinya `pdfkit.standalone.js` (2,5 MB, lib terbesar!) bisa ikut dibuang. Bila ternyata PDF masih dibutuhkan, pertahankan sebagai pengecualian eksplisit.

### 6.2 Hapus paket privat → paket umum

| Paket privat | Dipakai oleh | Pengganti / aksi |
|---|---|---|
| `@hakuneko/ffmpeg-binaries` | Jalur video `DownloadJob` + hack `PATH` `App.js` + tahap `_bundleStaticBinary` di `build-app.js` | **Hapus total** (paket + 3 pemakaian). Tidak ada pengganti — fitur videonya dihapus (§6.1) |
| `@hakuneko/imagemagick-binaries` | Tidak ada pemakaian otomatis di kode (satu-satunya rujukan harfiah `convert` hanyalah **contoh teks** di setting `postChapterDownloadCommand` milik user) | **Hapus** paket + tahap bundle. Fitur post-command generik tetap; contoh teks disesuaikan (user yang butuh pasang ImageMagick sistem sendiri) |
| `@hakuneko/kindlegen-binaries` | **Nol rujukan** di seluruh `src/` — dead weight yang ikut dibundle | **Hapus** paket + tahap bundle |
| `@logtrine/logtrine` | `ConsoleLogger` di 6 file `src/app` + `FileLogger` di 4 file test | Ganti logger **publik**: rekomendasi `pino` (cepat, API kecil) atau `winston`. Effort S–M (bungkus kompatibilitas `ConsoleLogger`/`FileLogger(level)` bila ingin minim diff) |

Setelah §6.2, `build-app.js` kehilangan 3 pemanggilan `_bundleStaticBinary` (+ helper-nya bila tak dipakai lagi) dan ukuran installer menyusut signifikan (3 set biner × 3 platform hilang). Tidak ada lagi dependensi pada registry/scope privat — instalasi full dari npm publik.

### 6.3 Distribusi & patch konektor dinamis tetap jalan murni via GitHub

Hasil penelusuran mekanisme yang ada (`UpdateServerManager` → `Updater` → `CacheDirectoryManager`, rilis via `deploy-web.js`):

- **Protokolnya sudah host-agnostik.** `GET applicationUpdateURL` → badan respons = teks satu baris `<versi>.zip?signature=<hex>` → app unduh zip → verifikasi **RSA-SHA256 lokal** dengan public key yang di-embed di `Configuration.js` → timpa direktori cache → tulis file `version`. Tidak ada logika yang mengharuskan server privat.
- **Default URL-nya BAHKAN sudah GitHub** (`https://manga-download.github.io/hakuneko/master/latest`). Penandatanganan terjadi saat rilis (CI, openssl + `key.pem` ber-passphrase), bukan di server.
- **Tidak perlu repo sendiri — repo utama cukup (bahkan sudah begitu).** Fakta: `deploy-web.js` + `deploy-web.config` saat ini mem-publish ke **branch `gh-pages` di repo yang sama**, folder per channel (`master/`, `6.1.7/` …), dan URL update menunjuk ke sana. Dua opsi satu-repo:
  - **(a) Pertahankan `gh-pages` (perubahan ~nol).** Alur `deploy-web.js` (fetch → checkout branch → `git rm` versi lama → commit → push → trigger pages build) tetap jalan apa adanya; kode app tidak berubah. Kekurangan: histori branch tumbuh ±10–15 MB per deploy (zip bundel saat ini ≈33 MB source), dan butuh workaround trigger pages-build via API.
  - **(b, direkomendasikan) GitHub Releases assets di repo utama.** `latest` (meta) + `<versi>.zip` sebagai aset rilis; update-URL → `…/releases/latest/download/latest`. Untung: tanpa branch kedua, tanpa git-bloat sama sekali (aset ≠ objek git), rollback = pilih rilis lama, changelog gratis, CI lebih sederhana (`gh release upload`, hapus logika git-stash/checkout/push + trigger pages). Redirect 302 berantai sudah ditangani `_request` (rekursif). Hindari opsi ketiga (zip di-commit ke branch reguler / `raw.githubusercontent`) — itu yang menggelembungkan histori git.
  Estimasi migrasi (a)→(b): S (ubah `deploy-web.js` + workflow, tanpa sentuh kode app).
- **Kunci privat & API.** `key.pem` (private key terproteksi passphrase) dipindah dari repo ke GitHub Actions secret — yang tertinggal hanya pubkey embed (sudah begitu). Hindari GitHub REST API agar bebas rate-limit 60 req/jam — pakai URL aset statis. Selama format teks meta dipertahankan (`versi` = segmen sebelum titik pertama), **kode app tidak berubah satu baris pun**.
- **Batasan bawaan (bukan dari GitHub):** granularitasnya **satu bundle utuh** (engine + semua konektor), bukan delta per konektor — tiap patch konektor = unduh ulang ±seluruh zip (yang justru mengecil setelah §6.1/§6.2). Delta per-konektor butuh manifest + merge (pengganti logika wipe di `applyUpdateArchive`) — dicatat sebagai opsi masa depan, bukan prasyarat.
- Mode dev (`--update-url=DISABLED` + `--cache-directory=./src/web`) tidak tersentuh update mechanism sama sekali. Channel (`master` vs `6.1.7`) tetap didukung di kedua opsi — via folder (a) atau via rilis prerelease/stable terpisah (b).

### 6.4 Matriks build: desktop saja (x86_64 + arm64, RISC-V kondisional)

Keputusan: artefak rilis yang dibagikan ke user **hanya installer desktop** untuk macOS/Windows/Linux. Arch utama **x86_64**; **arm64** ditambahkan di mana Electron target menyediakannya; **RISC-V kondisional** bila upstream tersedia.

Status kini (`build-app.js`): Linux i386/amd64/armv7l/armhf/arm64 (deb/rpm), Windows i386/amd64 (setup+portable), macOS **amd64 saja** (dmg) — Apple Silicon belum ada.

| OS | Tetap | Tambah | Hapus |
|---|---|---|---|
| Windows | setup + portable x64 | arm64 (Electron sudah ship `win-arm64` sejak lama) | i386 (upstream deprecated) |
| Linux | x64 deb/rpm/portable | arm64 | i386/armv7l/armhf (upstream tidak ship lagi) |
| macOS | dmg x64 (Intel Mac) | **dmg arm64 (wajib — Mac modern Apple Silicon)**; opsi single-dmg universal sebagai penyederhanaan (ukuran ~2×) | — (minimum versi macOS ikut naik mengikuti Chromium — catat di release notes) |
| RISC-V | — | **Kondisional: hanya bila upstream Electron merilis build riscv64** (sampai audit ini ditulis belum ada; port Chromium riscv masih in-progress/komunitas) | — |

Catatan:
- Penghapusan biner pihak ketiga (§6.2) justru **menghilangkan penghambat terbesar RISC-V**: tidak perlu berburu build riscv ffmpeg/ImageMagick/kindlegen. Setelah §6.2, yang perlu tersedia per arch hanyalah dist Electron itu sendiri (+ tanpa modul NAPI — `discord-rpc` murni JS ✓).
- Bundle web (§6.3) tetap diproduksi sebagai **intermediate updater** (publish ke Releases), bukan artefak unduhan user. Tidak ada versi web-hosted.
- Implikasi CI: matrix 3 OS × arch di GitHub Actions (runner `macos-14+` = arm64; build x64 di atasnya bisa karena tanpa kompilasi native). Signing: `rcedit` (metadata exe) tetap; **notarisasi macOS** butuh akun Apple Developer (berbayar) — tanpa itu user macOS bypass Gatekeeper manual; catat sebagai opsi, bukan prasyarat.
- Estimasi: S–M (ubah tabel `architectures` + uji instalasi per artefak).

### 6.5 Urutan disarankan

Kerjakan §6 **sebelum** Fase 1 (Electron): kode yang dihapus tidak perlu dimigrasi (`remote`/`protocol`/Vite), dan UI baru (§5) langsung dibangun tanpa view video. Estimasi: S–M (mayoritas penghapusan mekanis + uji `npm run lint` + smoke download CBZ/folder/EPUB novel).

## 7. Estimasi & roadmap

Skala: S (<2 hari) · M (2–5 hari) · L (1–3 minggu) · XL (>1 bulan), untuk 1 dev yang paham codebase. Bukan janji, hanya ordo.

| Fase | Isi | Ukuran |
|---|---|---|
| 0. Persiapan | Migrasi npm → **pnpm 12** (deklarasikan `vinyl-fs`/`merge-stream`, workspace-vs-nested, CI, `pnpm-lock.yaml`) + **Knip** baseline (§2.5); kunci **dependensi** (`"latest"` → pin via lockfile), sinkronkan `discord-rpc`, `asar` → `@electron/asar`, hapus `sql.js` bila terbukti tak dipakai, linter/formatter → oxc (§2.6). **Tanpa mengunci toolchain** (Node/pnpm bebas dalam rentang dukungan — lihat §2.5) | S–M |
| 0.5 Skope (§6) | Hapus video + paket privat (mendahului semua migrasi agar permukaan kode menyusut) | S–M |
| 0.6 Distribusi (§6.3) | Pindahkan penerbitan update ke GitHub (Pages/Releases) + private key ke Actions secret; kode app tetap | S |
| 0.7 Matriks build (§6.4) | Desktop-only; tambah arm64 (terutama dmg Apple Silicon), drop i386/armv7l; RISC-V kondisional upstream | S–M |
| 1. Runtime **(WAJIB)** | Electron bertahap (8 → ~14 → ~25 → 44, jangan sekali lompat), migrasi `remote` → preload/IPC, `protocol.handle()`, sesuaikan `webPreferences`/`fetchUI`, uji petik konektor | L |
| 2. Lib → native | `fs-extra`, `oauth`, `exif`, lalu `crypto-js` (dengan pola async + audit ECB) | S–M |
| 3. Build | Vite untuk engine/shell + aset konektor statis; pensiunkan `polymer-build`; `vitest` opsional | M (setelah fase UI diputuskan) |
| 4. UI **(WAJIB)** | Rewrite ke React + Tailwind + TanStack + shadcn (§5); engine + konektor dipertahankan, koeksistensi via `frontend@react` | **XL** (item termahal, dipecah per view) |

**Risiko utama:** (a) perilaku fetch/CORS skema kustom di Chromium baru → mitigasi: uji petik konektor populer per region; (b) Cloudflare pada `fetchUI` di Chromium baru → mitigasi: `fetchUI` adalah window sungguhan, peluang lolos besar, tapi siapkan fallback UA; (c) kasus `crypto-js` ECB tanpa padanan WebCrypto → mitigasi: isolasi per konektor, biarkan shim mikro.

---

## 8. Rebrand — DIPUTUSKAN: **RakKomik** (biner: `rakkomik`)

Ketersediaan terverifikasi 2026-10-04: npm `rakkomik` ✅, `rakkomik-desktop` ✅, GitHub `rakkomik/rakkomik` ✅ (semua 404 = tersedia). Pengecekan merek dagang formal tetap disarankan sebelum rilis publik.

Shortlist yang dipertimbangkan (arsip keputusan):

Skope baru (komik + novel, tanpa video/anime) membuat nama lama berbau anime kurang pas. Kriteria: pendek, mudah diketik/diingat, bebas tabrakan merek besar, netral dari video, werken sebagai nama biner/ID app.

Shortlist (urutan preferensi penulis audit):

1. **Jilid** — istilah Indonesia untuk "dijilid jadi volume"; tematik sempurna untuk downloader/pengarsip (chapter → volume). Pendek, unik, mudah dicari. Biner: `jilid`.
2. **RakKomik** — "rak" = shelf; app ini membangun rak koleksi. Deskriptif Indonesia. Biner: `rakkomik`.
3. **KomikNeko** — menjaga lineage (neko) + menegaskan komik; campuran ID-JP sesuai konten & audiens. Biner: `komikneko`.
4. **Pustaka** — "perpustakaan"; elegan tapi generik (susah SEO/disambiguasi).
5. **Komet** — pendek & brandable (plesetan komik), tapi generik dan tak berkaitan makna.

Ditolak eksplisit: `Jilid`/`KomikNeko`/`Pustaka`/`Komet` (kalah preferensi), `Ngomik`, `Komiku`, `BacaKomik` (sudah dipakai situs/konektor yang ada = tabrakan + membingungkan), apa pun berunsur otaku/anime (keluar skope §6.1).

Sebelum final, verifikasi: ketersediaan org/repo GitHub, nama paket npm (bila perlu scope), domain (opsional), pencarian merek dagang sekilas, dan keunikan scheme protokol baru.

**Dampak teknis rename (wajib ikut saat eksekusi, dipecah dari keputusan nama):**

- **JANGAN rename global `Engine`/`HakuNeko` di kode.** 1340 konektor memanggil global `Engine` — rename itu = menyentuh semua konektor tanpa manfaat user-visible. Internal boleh tetap `Engine` selamanya (tak terlihat user).
- **Skema protokol kustom** (`hakuneko://` cache, `connector://`): didaftarkan app itu sendiri, jadi aman diganti — TAPI bareng dengan versi mayor + reset cache (updater menimpa cache dir utuh, kompatibel alami). Jangan diganti di tengah versi minor.
- **Direktori data user** (file `hakuneko.*`, folder download): pertahankan nama lama ATAU migrasi copy-on-first-run — putuskan eksplisit; yang terlarang hanya diam-diam orphaning library user.
- Selebihnya mekanis: `package.json` (name/biner), nama installer (`.exe`/`.deb`/`.dmg`), `appUserModelId` (taskbar Windows), `CFBundleIdentifier` (mac), tray tooltip, judul window, URL update (§6.3), string UI, dan identitas signing/notarization.

## 9. Quick wins (bisa dikerjakan tanpa upgrade Electron)

1. Samakan `discord-rpc` 3.2.0 → 4.0.1 + pin versi.
2. `asar` → `@electron/asar`.
3. Audit & kemungkinan hapus `sql.js` (1,6 MB).
4. Linter/formatter → oxc (`oxlint` + `oxfmt`, rencana §2.6) — kecil, de-risiko dari critical path.
5. Audit 2 pemakaian `CryptoJS.mode` untuk memastikan bukan ECB sebelum merencanakan migrasi WebCrypto.
7. **Knip baseline:** tambah `knip.json` + skrip `knip`, triase unused (validasi sisa §6.1/§6.2 + temukan phantom deps untuk migrasi pnpm) — prasyarat sebelum ganti package manager (S).
8. **Tulis atomik storage:** `saveConfig` → tulis-tmp + rename agar crash tidak mengkorupsi `mangas.*`/`bookmarks` (S, tanpa DB).
9. **Startup app saat ini (tanpa rewrite):** (a) paralelkan `import()` konektor di `Connectors.register` (ubah sequential-await menjadi batched `Promise.all`, S, dampak besar); (b) pindahkan `BookmarkManager.loadProfile` + `ChaptermarkManager.loadChaptermarks` ke background setelah first paint (S); (c) tambah `performance.mark` di `main()` → first paint sebagai baseline sebelum klaim perbaikan (S).
