# Agentic Execution Plan — RakKomik Modernization

> Pasangan dari `MODERNIZATION-AUDIT.md` (baca itu dulu — dokumen ini mengatur CARA kerja, audit mengatur APA yang dikerjakan).
> Repo ini BUKAN hasil rewrite, melainkan titik awal (clone murni HakuNeko). Fase dikerjakan berurutan, satu fase per sesi tugas.
>
> ## Status fase (tag git `fase-*` = selesai; tabel ini = cermin)
>
> | Fase | Status | Penanda |
> |---|---|---|
> | 0 Persiapan | ✅ selesai | `fase-0` |
> | 0.5 Skope cut | ✅ selesai | `fase-0.5` |
> | 0.6 Distribusi | ✅ selesai | `fase-0.6` |
> | 0.7 Matriks build | ✅ selesai | `fase-0.7` |
> | 1 Runtime Electron 44 | 🔶 kode selesai, verifikasi situs-live tertunda (sandbox) | — |
> | 2 Lib → native | 🔶 kode selesai (crypto-js → `engine/Crypto.mjs` + `LegacyCrypto`; sisa tag exif mati dibersihkan), smoke situs-live tertunda (sandbox) | — |
> | 3 Build Vite | 🔶 perkakas berdiri (`vite build` → `ui/dist`, dibawa `build:web`); pensiun `polymer-build` menunggu UI selesai | — |
> | 4 UI React | 🔶 slice 1–5 selesai (shell, CRUD, list, reader, jobs); hapus classic menyusul | — |

## 0. Aturan operasi global (tidak bisa ditawar)

1. **Siklus: Recon → Implement → Validate → Review.** Jangan menulis kode sebelum membaca file yang disentuh + tetangganya.
2. **Diff kecil dan terarah.** Satu fase = satu tujuan. Dilarang refactor oportunistik, reformat massal, atau menyentuh file di luar cakupan fase.
3. **Validasi setiap selesai fase**, dengan perintah di bawah. Merah = berhenti, laporkan, jangan lanjut.
4. **Jaga pekerjaan user.** Repo ini **belum git** (`git init` + commit awal adalah tugas user sebelum eksekusi, atau minta izin dulu bila agen yang diminta melakukannya). Tanpa git, gandakan kewaspadaan: baca ulang diff-like (file sebelum/sesudah) secara manual.
5. **DILARANG `git commit`** kecuali user eksplisit meminta (“commit …”).
6. **Keputusan terbuka tetap terbuka.** Yang bertanda “diputuskan” di audit = final. Yang bertanda opsi/pertanyaan = tanyakan dulu, jangan diasumsikan.
7. **Lapor selesai per fase** dengan: file diubah, perintah validasi + hasilnya, dan sisa risiko. Jujur bila ada validasi yang tidak bisa dijalankan di sandbox (mis. butuh display Electron / runner macOS).
8. **Kode deprecated dilarang.** Jangan memakai API/dependensi berstatus deprecated dalam kode baru maupun yang diubah. Bila menemukannya dalam skope fase, migrasikan saat itu juga; bila di luar skope, catat sebagai temuan di laporan (jangan dilewati diam-diam). Dependensi deprecated dilarang masuk tanpa pengecualian tercatat.

## 1. Lingkungan & keadaan repo

| Item | Keadaan saat plan ditulis |
|---|---|
| Node | v24 (asdf). Electron target butuh Node modern — OK |
| pnpm | v11.22.0 terpasang, target v12 (rentang dukungan: pnpm ≥10; direkomendasikan 12). **Jangan kunci versi toolchain di file** — tanpa `packageManager` eksak / `.nvmrc` / `engines` strict (dev memakai fnm di Linux/Windows). Pagar versi = CI matrix multi-OS (lihat audit §2.5) |
| Manager saat ini | npm (`package-lock.json` TIDAK ikut tercopy ke repo ini — instalasi segar memakai pnpm dari Fase 0) |
| Struktur | `src/app` (main), `src/web` (renderer), `build-*.js`, `deploy-web.js`, `.github/workflows` (3 file, masih `npm install`) |
| Perintah validasi pra-Fase-0 | `npm run lint` (eslint), `npx jest src/web`, `node --check <file>` |

## 2. Fase eksekusi (urut, satu per sesi)

### Fase 0 — Persiapan (S–M) · Audit §2.3, §2.5, §2.6
**Tujuan:** fondasi tooling hijau sebelum menyentuh runtime.
1. Baca: `package.json`, `src/app/package.json`, `.github/workflows/*.yml`, `.eslintrc.json`.
2. Migrasi npm → pnpm 12: tulis `pnpm-workspace.yaml` ATAU pertahankan nested (`pnpm --dir src/app install` — putuskan via uji packager, audit §2.5), deklarasikan `vinyl-fs` + `merge-stream` eksplisit, hapus `package-lock.json`, commit `pnpm-lock.yaml`. **Jangan tambah `packageManager`/`.nvmrc`/`engines`** (kebijakan tanpa-kunci-toolchain, audit §2.5).
3. Samakan `discord-rpc` 4.0.1 + pin SEMUA versi `"latest"`. `asar` → `@electron/asar`.
4. oxlint + oxfmt (§2.6): `.oxlintrc.json` + `.oxfmtrc.json`, ganti skrip `lint:*`/`format:*` (nama skrip dipertahankan!), hapus `eslint`, JANGAN `--write` repo-wide.
5. Knip baseline: `knip.json` + skrip `knip`, triase hasil (validasi sisa §6.1/§6.2 + catat phantom deps).
6. Hapus `sql.js` bila triase Knip mengonfirmasi tak ada konsumen.
7. Tambah gate CI anti-deprecated: skrip yang menolak dependensi berstatus deprecated (cek field `deprecated` per paket, otomatis, hijau-sebelum-merge).
**Verify:** `pnpm install` bersih di clone segar · `pnpm run lint` hijau · `pnpm run test` hijau · `pnpm run build:web` sukses.
**Exit:** ketiga workflow CI dipatch ke pnpm dan hijau.

### Fase 0.5 — Skope cut (S–M) · Audit §6.1, §6.2
**Tujuan:** hapus video + paket privat.
1. Hapus: ±10 konektor anime/video (enumerasi final via `tags`), `mjs/videostreams/*`, `templates/VRV.mjs` + `templates/Crunchyroll.mjs`, `hls.light` + `ass` (+ tag script), `pdfkit` (+ opsi PDF di `Settings.chapterFormat`), jalur video `DownloadJob`/`Storage`/`Chapter`, hack PATH ffmpeg `App.js`.
2. Hapus paket `@hakuneko/*-binaries` + 3 tahap `_bundleStaticBinary`; `@logtrine` → `pino` (bungkus kompatibel bila perlu).
3. Sesuaikan contoh teks `postChapterDownloadCommand` (tanpa `convert`).
**Verify:** `pnpm run lint` · `pnpm run test` · grep nol untuk `ffmpeg|m3u8|hls|Hls|videostream|kindlegen|@hakuneko|logtrine` di `src/` (kecuali dokumentasi) · smoke: download 1 chapter CBZ + 1 folder + 1 EPUB novel di Electron dev.
**Exit:** tidak ada sisa rujukan + installer menyusut.

### Fase 0.6 — Distribusi (S) · Audit §6.3
**Tujuan:** penerbitan update full-GitHub satu repo.
1. Pilih opsi (a) `gh-pages` (nol perubahan) atau (b) Releases assets (direkomendasikan). Default: (b) kecuali user membatalkan.
2. `key.pem` → GitHub Actions secret; pubkey embed tetap. URL aset statis (tanpa REST API).
3. Pertahankan format meta `<versi>.zip?signature=` — kode app untouched.
**Verify:** simulasi rilis: unduh meta + zip via URL publik · verifikasi signature manual dengan openssl · `Updater.updateCache` melawan URL staging (bila memungkinkan) atau minimal review kode jalur `_request` redirect.
**Exit:** rilis uji coba terbit + terverifikasi.

### Fase 0.7 — Matriks build (S–M) · Audit §6.4
**Tujuan:** tabel `architectures` desktop-only (x64 + arm64, drop i386/armv7l).
1. Edit matriks per OS di `build-app.js`; tambah dmg arm64 macOS.
2. Catat minimum versi macOS + keputusan notarization (opsi, bukan prasyarat).
**Verify:** build sukses per target yang runner-nya tersedia (Linux x64 di sini); sisanya via CI matrix.
**Exit:** artefak per OS×arch terbit dari CI.

### Fase 1 — Runtime Electron 8→44 (L, WAJIB) · Audit §3, §2.7
**Tujuan:** app menyala di Electron 44.
1. Naik bertahap 8 → ~14 → ~25 → 44 (baca migration notes tiap checkpoint, JANGAN sekali lompat).
2. Migrasi `remote` → `preload.js` + `contextBridge` + `ipcMain.handle` (file: `ElectronBootstrap`, `Storage`, `Settings`, `Request`, `InterProcessCommunication`, inline `index.html`).
3. Protokol kustom → `protocol.handle()`; sesuaikan `webPreferences`/`fetchUI`.
**Verify:** app boot ke shell · `fetchUI` lolos 1 situs Cloudflare · uji petik konektor per region (ID diutamakan) · suite `test` hijau.
**Exit:** semua pemakaian `electron.remote` = nol (grep verifikasi).

### Fase 2 — Lib → native (S–M) · Audit §2.2
**Tujuan:** `fs-extra`, `oauth`, `exif`, lalu `crypto-js` (pola async; audit ECB dulu).
**Verify:** per-lib: `pnpm run lint` + smoke fitur pemakai + Knip (pastikan impor lama hilang).

### Fase 3 — Build Vite (M) · Audit §4
**Tujuan:** `polymer-build` pensiun. Prasyarat: Fase 4 (UI) minimal shell React berdiri.
**Verify:** `vite build` dev & prod · konektor tetap statis & ter-`import` dinamis · `createVersionInfo` jadi plugin · `vitest` opsional.

### Fase 4 — UI React (XL, WAJIB) · Audit §5 (termasuk §5.7–§5.10)
**Tujuan:** paritas per view sesuai checklist §5.5, dipecah per sub-fase (shell+bridge → CRUD → list+virtual → reader → jobs/connectors → hapus classic).
**Verify per sub-fase:** typecheck + lint + daftar `frontend@react` bisa dipilih berdampingan classic · benchmark virtualisasi (Bacami 10.389 judul) · tidak ada CDN (grep `http` di bundle UI kecuali icon/font lokal).
**Exit:** classic + polyfill terhapus, woff2 FA + `theme.html` terhapus.

## 3. Backlog fitur (di luar modernisasi, dikerjakan kapan saja)

### F-B1 — Novel wajib teks: Markdown + EPUB-teks (diputuskan, audit §6.1)
**Tujuan:** novel tidak boleh keluar sebagai gambar. Opsi `chapterFormat` Markdown (`.md`) + EPUB novel dibangun ulang sebagai teks.
1. Baca: `Storage.saveChapterPages` (+ `_saveChapterPagesEPUB` sebagai pola), `Settings.chapterFormat`, `templates/WordPressMadaraNovel._getPagesNovel`, `DownloadJob._downloadPages*`.
2. Tambah opsi format + cabang simpan `.md` (satu file per chapter + frontmatter YAML); ilustrasi diunduh + direferensikan relatif, bukan sebagai halaman.
3. Sediakan jalur teks: pilihan (a) `_getPagesText` per konektor novel, atau (b) fallback generik re-fetch + ekstraksi; putuskan saat eksekusi (dilarang CDN runtime; konverter: `turndown` atau hand-rolled). Pensiunkan jalur screenshot `html2canvas` untuk output.
4. EPUB-teks untuk novel: `EbookGenerator` + `_saveChapterPagesEPUB` mendukung halaman XHTML teks (bukan screenshot). Manga tidak berubah.
5. Fallback otomatis: format image-based + konten novel → simpan sebagai teks (Markdown default; EPUB-teks bila EPUB dipilih). Mekanisme deteksi novel diputuskan saat eksekusi.
**Verify:** `pnpm run lint` · unduh 1 chapter novel sebagai `.md` (frontmatter + body terbaca, tanpa tag HTML bocor; ilustrasi berupa file + referensi, bukan screenshot) · unduh 1 chapter novel sebagai EPUB-teks (terbuka di reader, teks terseleksi) · unduh novel dengan format folder/CBZ terpilih → jatuh ke teks otomatis · unduh 1 chapter manga CBZ tetap identik.
**Exit:** aturan novel-wajib-teks berlaku untuk semua format + semua smoke hijau.

### F-B2 — E2E `puppeteer-core` → Playwright (diputuskan, audit §2.3)
**Tujuan:** harness e2e konektor tanpa puppeteer.
1. Baca: `src/__tests__/Connectors.e2e.js` (spawn Electron + `puppeteer.connect(browserURL :9200`) + workflow CI (langkah Xvfb sudah ada).
2. Rekomendasi: paket `playwright-core` + `chromium.connectOverCDP` (drop-in terkecil) ATAU `@playwright/test` + `_electron.launch({ executablePath })` (hapus plumbing spawn/remote-debugging-port; lebih modern, diff harness lebih besar) — putuskan saat eksekusi.
3. Tulis ulang asersi yang memakai internal puppeteer (`_remoteObject.className` tidak ada di Playwright — ganti `evaluate` biasa); `evaluate`/`evaluateHandle`/`waitForSelector` praktis identik. Sinkronkan dengan keputusan jest-vs-vitest (e2e ikut framework yang dipilih).
4. Tanpa unduh browser tambahan bila memakai Electron bawaan app (manfaatkan langkah Xvfb CI yang ada untuk headless Linux).
**Verify:** `pnpm run test:e2e` (atau skrip penggantinya) hijau untuk ≥1 konektor sampel · `puppeteer-core` hilang dari lockfile.
**Exit:** e2e jalan di Playwright, dependensi lama terhapus.

## 4. Larangan fase (definisi selesai yang ditolak)

- Me-rename global `Engine` (audit §8).
- Bulk `--write` formatter / rename massal / upgrade versi di luar cakupan fase.
- Menambah dependensi native (NAPI) dalam bentuk apa pun — melanggar matriks arch.
- Menambah CDN runtime ke UI (melanggar offline-safe).
