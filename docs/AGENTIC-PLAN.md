# Agentic Execution Plan — RakKomik Modernization

> Pasangan dari `MODERNIZATION-AUDIT.md` (baca itu dulu — dokumen ini mengatur CARA kerja, audit mengatur APA yang dikerjakan).
> Repo ini BUKAN hasil rewrite, melainkan titik awal (clone murni proyek upstream). Fase dikerjakan berurutan, satu fase per sesi tugas.
>
> ## Status fase (tag git `fase-*` = selesai; tabel ini = cermin)
>
> | Fase | Status | Penanda |
> |---|---|---|
> | 0 Persiapan | ✅ selesai | `fase-0` |
> | 0.5 Skope cut | ✅ selesai | `fase-0.5` |
> | 0.6 Distribusi | ✅ selesai | `fase-0.6` |
> | 0.7 Matriks build | ✅ selesai | `fase-0.7` |
> | 1 Runtime Electron 44 | ✅ kode + live (fetchUI, 1320 konektor, unduh 18 PNG); jaring lumpuh total sebelum HeaderSurgery | — |
> | 2 Lib → native | ✅ kode + smoke live: `crypto-js` → `engine/Crypto.mjs` (SHA-256 sinkron, HMAC, SHA-512, AES-CBC via WebCrypto, MD5/EVP untuk password). Pemakai crypto terverifikasi di situs live (lihat tabel di Fase 2); `LegacyCrypto` dan AES sinkron pure-JS dihapus (pemakai terakhir, MangaDig/CocoManHua, rusak). Menunggu tag `fase-2` dari user | — |
> | 3 Build Vite | ✅ `polymer-build`/`vinyl-fs`/`merge-stream` pensiun; `vite build --mode web` merakit bundle (plugin `vite.web-bundle.mjs`: salin statis + `VersionInfo.mjs` dari git, tanpa `git stash`) ke `build/web`; Jest → **Vitest 5** (154 tes setara + 12 baru); e2e → **Playwright**. Diverifikasi dengan menjalankan app dari `build/web`. Menunggu tag `fase-3` dari user | — |
> | 4 UI React | ✅ kode + live: paritas classic light+dark, dialog konektor, reader, indikator status; classic + polyfill + woff2 FA + `theme.html` terhapus; startup shell-first (UI ±0,9 dtk vs aplikasi upstream 6,0 dtk); 10.389 judul lancar; tanpa CDN. Menunggu tag `fase-4` dari user | — |
> | 5 Modernisasi Node 24 & dependensi | ✅ kode + tes: deprecated ditulis ulang (`url.parse`, `rcedit`, sisa `fs-extra`, shim Electron 8), API Node 24 (`fetch`, `node:sqlite`, `crypto.sign/verify`, `module.registerHooks`, `fs.cp`), paket tak terawat diganti (discord-rpc, jszip, sql.js, rcedit, win-7zip, pino 7). Belum teruji: jalur build Windows (bsdtar, Inno Setup), presence live. Menunggu tag `fase-5` dari user | — |
> | 5.1 Interstitial anti-bot | ✅ kode + tes: `engine/AntiScraping.mjs` (deteksi terbaca, blob terobfuskasi dibuang), `FetchWindowManager` mesin status dengan fallback jendela ke user, `fetch()` transparan (satu jendela per origin, kirim ulang sekali), UA Chromium asli konsisten (`HeaderGenerator` dihapus). e2e 3 skenario dengan server lokal. Belum teruji: situs live. Menunggu tag `fase-5.1` dari user | — |
> | 5.2 Optimalisasi Electron & Node 24 lanjutan | ✅ kode + tes: preload tanpa `sendSync` (`engine/Path.mjs` port `node:path`, data bootstrap via `additionalArguments`, `mkdir` async), Electron fuses di `build:app` (+ perbaikan paket: `app.asar` hasil build tidak bisa start karena symlink pnpm — `node-linker=hoisted`), `engines` (`packageManager` ikut ditambahkan di sini lalu dicabut di 5.3); compile cache diukur dan **dicabut** (tidak terukur). Belum teruji: build Windows. Menunggu tag `fase-5.2` dari user | — |
> | 5.3 pnpm 12, tanpa kunci toolchain/dependensi, Node ≥24 | ✅ kode + tes: pnpm 12.11.1 terpasang; pin `packageManager: pnpm@11.22.0` (dari 5.2) dicabut — melanggar keputusan tanpa-kunci-toolchain, membuat pnpm 12 berpindah ke 11.22.0 dan keempat workflow gagal (`Multiple versions of pnpm specified`); dependensi tidak lagi dipin (`^x.y.z`, lockfile tetap mengunci hasil resolusi); Node ≥24 di `engines` root + `src/app` dan semua workflow; `nodeLinker: hoisted` pindah ke `src/app/pnpm-workspace.yaml`, sisa pin mati dibuang. Diverifikasi di clone bersih (`--frozen-lockfile`, lint, deprecated, `build:web`, 368 tes) dan e2e 19. Belum teruji: workflow di GitHub Actions. Menunggu tag `fase-5.3` dari user | — |
> | 6 Rebrand RakKomik, ikon, git-cliff, AUR | ✅ kode + tes: merek RakKomik di semua sisi aplikasi (engine `src/web/mjs` tidak disentuh, 0 diff); ikon tumpukan buku (`assets/icon.svg` + `scripts/icons.js`), semua aset milik upstream dihapus; berkas tak terpakai dibuang; `cliff.toml` + job pratinjau di `ci-pr.yml`; `release.yml` (git-cliff → GitHub release → AUR) + `packaging/aur`; README Markdown dokumentatif yang menyatakan fork, dokumentasi teknis dipisah ke `docs/architecture.md`, `connectors.md`, `development.md`, `releasing.md`; ikon konektor `comixto` diambil dari situsnya. Diverifikasi: lint, 368 tes, knip, e2e 19, `makepkg` lokal + `namcap`, asar paket dijalankan, workflow lolos `action-validator`. Belum teruji: workflow di GitHub Actions, push AUR sungguhan. Menunggu tag `fase-6` dari user | — |

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
| pnpm | v12.11.1 terpasang (npm global di bawah asdf; Fase 5.3). Rentang dukungan: pnpm ≥12, Node ≥24 — dinyatakan sebagai batas bawah `engines` (penanda: pnpm tidak menegakkannya di proyek root). **Jangan kunci versi toolchain di file** — tanpa `packageManager` (pnpm 12 berpindah ke versi yang dikunci, dan `pnpm/action-setup` menolak pin yang berbeda dari `version: 12` di CI) / `.nvmrc` (dev memakai fnm/asdf di Linux/Windows). Pagar versi = CI matrix multi-OS: `node-version` major saja (lihat audit §2.5) |
| Manager saat ini | pnpm (`pnpm-lock.yaml`; `src/app` diinstal mandiri via `postinstall`) |
| Struktur | `src/app` (main), `src/web` (renderer: engine `mjs/`, konektor, UI React `ui/`), `build-*.js`, `deploy-web.js`, `.github/workflows` (pnpm) |
| Perintah validasi | `pnpm run lint` (app + web + tools), `pnpm run test` (Vitest: project `app` + `web`), `pnpm run test:e2e` (build + Playwright, UI hermetik), `pnpm run test:e2e:sites` (situs live, bisa gagal karena situs berubah), `pnpm run knip`, `pnpm run check:deprecated` (jaringan), `pnpm run build:web` |

## 2. Fase eksekusi (urut, satu per sesi)

### Fase 0 — Persiapan (S–M) · Audit §2.3, §2.5, §2.6
**Tujuan:** fondasi tooling hijau sebelum menyentuh runtime.
1. Baca: `package.json`, `src/app/package.json`, `.github/workflows/*.yml`, `.eslintrc.json`.
2. Migrasi npm → pnpm 12: tulis `pnpm-workspace.yaml` ATAU pertahankan nested (`pnpm --dir src/app install` — putuskan via uji packager, audit §2.5), deklarasikan `vinyl-fs` + `merge-stream` eksplisit, hapus `package-lock.json`, commit `pnpm-lock.yaml`. **Jangan tambah `packageManager`/`.nvmrc`/`engines`** (kebijakan tanpa-kunci-toolchain, audit §2.5).
3. Samakan `discord-rpc` 4.0.1 + pin SEMUA versi `"latest"` (pin eksak diganti rentang `^` di Fase 5.3). `asar` → `@electron/asar`.
4. oxlint + oxfmt (§2.6): `.oxlintrc.json` + `.oxfmtrc.json`, ganti skrip `lint:*`/`format:*` (nama skrip dipertahankan!), hapus `eslint`, JANGAN `--write` repo-wide.
5. Knip baseline: `knip.json` + skrip `knip`, triase hasil (validasi sisa §6.1/§6.2 + catat phantom deps).
6. Hapus `sql.js` bila triase Knip mengonfirmasi tak ada konsumen.
7. Tambah gate CI anti-deprecated: skrip yang menolak dependensi berstatus deprecated (cek field `deprecated` per paket, otomatis, hijau-sebelum-merge).
**Verify:** `pnpm install` bersih di clone segar · `pnpm run lint` hijau · `pnpm run test` hijau · `pnpm run build:web` sukses.
**Exit:** ketiga workflow CI dipatch ke pnpm dan hijau.

### Fase 0.5 — Skope cut (S–M) · Audit §6.1, §6.2
**Tujuan:** hapus video + paket privat.
1. Hapus: ±10 konektor anime/video (enumerasi final via `tags`), `mjs/videostreams/*`, `templates/VRV.mjs` + `templates/Crunchyroll.mjs`, `hls.light` + `ass` (+ tag script), `pdfkit` (+ opsi PDF di `Settings.chapterFormat`), jalur video `DownloadJob`/`Storage`/`Chapter`, hack PATH ffmpeg `App.js`.
2. Hapus paket biner privat `*-binaries` + 3 tahap `_bundleStaticBinary`; `@logtrine` → `pino` (bungkus kompatibel bila perlu).
3. Sesuaikan contoh teks `postChapterDownloadCommand` (tanpa `convert`).
**Verify:** `pnpm run lint` · `pnpm run test` · grep nol untuk `ffmpeg|m3u8|hls|Hls|videostream|kindlegen|-binaries|logtrine` di `src/` (kecuali dokumentasi) · smoke: download 1 chapter CBZ + 1 folder + 1 EPUB novel di Electron dev.
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
**Progres (2026-10-10):** referensi situs yang masih hidup: HaruNeko (`manga-download/haruneko`, penerus, `_e2e.ts` berisi manga uji yang valid) dan Keiyoushi (`extensions-source/src/en/comix`). Verifikasi live pemakai crypto (alur: manga → chapter → halaman → gambar ter-decode):

| Konektor | Crypto | Hasil live |
|---|---|---|
| WestManga | HMAC-SHA256 (tanda tangan API) | ✅ daftar, chapter, halaman |
| Bacami | SHA-256 sinkron (proof-of-work) | ✅ 10.415 judul, 52 halaman, gambar JPEG 750×422 |
| PixivComics | SHA-256 + descramble canvas | ✅ gambar JPEG 722×1024 valid |
| ComicFuz | AES-CBC (WebCrypto) | ✅ gambar JPEG 1300×2009 valid |
| MangaFox | helper crypto | ✅ 44 halaman, gambar JPEG 728×1173 |
| Mangatales (basis GManga) | AES-CBC + SHA-256 | ✅ 707 judul, chapter, halaman, gambar JPEG 900×1165 |
| Comico | SHA-256 (checksum header) | ✅ API menerima checksum (galat 303 "penjualan karya ini berakhir" pada manga uji HaruNeko, bukan masalah crypto) |
| mangaz | (AES dibuang) | ✅ diport: situs kini men-scramble gambar dengan crop (bukan AES); 55 halaman, JPEG 827×1170 |
| ComixTo | tidak lagi (situs memakai tanda tangan + respons terenkripsi yang berganti-ganti) | ✅ ditulis ulang: jendela fetch memanggil klien API situs sendiri (`list`, `chapters`, `http.get`) — tahan perubahan skema; dekripsi XOR + descramble gambar sendiri. Cocok dengan fixture HaruNeko (judul, ID chapter, halaman 1 = 254.320 byte `image/webp`); tanpa `Referer`/`Origin` (host gambar memblokirnya) |
| LunarAnimes | crypto | ⏳ timeout Cloudflare saat uji (manga dan chapter terdaftar OK) |
| CxC | SHA-512 + AES | ⏳ butuh akun (API hidup, menolak tanpa uuid/login) |
| MangaDig, CocoManHua, ComixTo(lama), GManga(situs) | `LegacyCrypto` | MangaDig dan CocoManHua dihapus (situs berubah, daftar kosong/`href` undefined); GManga dipertahankan hanya sebagai basis Mangatales (situs gmanga.me kini halaman lain) |

Tes: `ComixTo.test.js` (dekripsi XOR tiga varian, urutan scramble dibanding generator acuan independen), `Crypto.test.js` (vektor AES/SHA/HMAC/EVP), konektor live di `Connectors.e2e.mjs` (kasus Comix).
**Catatan algoritma:** LCG scramble Comix memakai aritmetika 32-bit eksak (seperti Keiyoushi); HaruNeko menyimpan state LCG sebagai double tanpa pemotongan sehingga hanya cocok pada langkah pertama (aman bagi mereka karena situs memakai algoritma `3`, xorshift). Jalur scramble belum teruji live (sampel chapter tidak memakai v3); hanya tes unit.

### Fase 3 — Build Vite (M) · Audit §4
**Tujuan:** `polymer-build` pensiun. Prasyarat: Fase 4 (UI) minimal shell React berdiri.
**Verify:** `vite build` dev & prod · konektor tetap statis & ter-`import` dinamis · `createVersionInfo` jadi plugin · `vitest` opsional.
**Progres (2026-10-10):** ✅ `polymer-build` pensiun; ✅ `build-web.js`/`build-web.config` diganti plugin Vite (`vite.web-bundle.mjs`, `vite build --mode web`; `createVersionInfo` jadi bagian plugin); ✅ `start:build` menunjuk `./build/web`; ✅ konektor tetap statis (engine tidak dibundle: konektor mengimpor modul engine lewat URL dan berbagi satu instance kelas `Connector`); ✅ Jest → Vitest: `vitest.config.mjs` (project `app` + `web`), `jest`/`jest-junit` dihapus. Tes `src/app` (CJS) memakai shim `src/app/__tests__/support/mockRequire.js` karena `vi.mock` tidak mencegat `require()`; file tes `app` berjalan serial (server tes berbagi port 8080); `ConfigurationWindows.tests.js` → `.test.js`. ⏳ `vitest` browser mode tidak dipakai (tidak perlu).

### Fase 4 — UI React (XL, WAJIB) · Audit §5 (termasuk §5.7–§5.10)
**Tujuan:** paritas per view sesuai checklist §5.5, dipecah per sub-fase (shell+bridge → CRUD → list+virtual → reader → jobs/connectors → hapus classic).
**Verify per sub-fase:** typecheck + lint · benchmark virtualisasi (Bacami 10.389 judul) · tidak ada CDN (grep `http` di bundle UI kecuali icon/font lokal). (Pemilihan `frontend@react` berdampingan classic sudah tidak berlaku: classic dihapus.)
**Exit:** classic + polyfill terhapus, woff2 FA + `theme.html` terhapus.
**Arahan user (2026-10-10):** UX dan tampilan boleh diperbaiki selama tata letak fitur tidak jauh dari classic.
**Progres (2026-10-10):**
- ✅ Paritas classic light + dark ("Ken's Daedal Dark") untuk shell: titlebar + baris menu, panel Manga/Chapter (paste clipboard, filter classic, ikon status, regex, folder, penanda baca), bar download inline, Start, popup About + Settings (import/simpan/batal). Token tema classic di `ui/index.css`.
- ✅ Dialog konektor classic (`ui/connectors.jsx`): filter website/manga/tag, kartu virtual dengan login/donasi/situs/update per konektor. Menggantikan `<select>` dan rute `/connectors`.
- ✅ Reader (`views/Reader.jsx`) setara `pages.html`: thumbnail, mode baca, zoom/spasi menjaga posisi, magic scroll, toolbar pudar-sampai-hover. Perbaikan: tombol Back/ESC dulu menuju rute `/chapters` yang tidak ada; arah chapter berikutnya kini mengikuti classic (`chapterUp` = entri di atas pada daftar panel yang sudah difilter/diurutkan).
- ✅ Indikator status/loading per panel (`ui/status.jsx`, setara `status.html`).
- ✅ Classic dihapus: `src/web/lib/**` (Polymer, polyfill, `frontend@classic-*`), `src/web/css/**` (woff2 FA), loader classic dan menubar di `index.html`, pengaturan "Frontend" di `Settings.mjs` (kunci lama di file settings user diabaikan). Rute `/settings` diganti popup; baris "Views" di popup memuat rute React-only (Downloads, Bookmarks).
- ✅ Polesan UX: tema tersimpan (`localStorage`, default ikut OS), Esc menutup menu/dialog, role listbox/option, pesan kosong di daftar download.
- ✅ Benchmark virtualisasi 10.389 judul (CDP, `build/web`): muat ±0,6 dtk, filter 7 ms, 52 baris di DOM, scroll ke ujung 17 ms. Cek CDN: tidak ada request eksternal saat boot, menu, dan dialog; string `http` di bundle hanya namespace XML, tautan About, dan dokumentasi error React.
- 🐞 Bug yang ditemukan user dan diperbaiki: dialog modal "Cannot access the directory for Manga Directory" muncul tiap start bila folder belum ada (mis. instalasi baru), padahal `Storage` membuatnya saat simpan. `Settings._getValidValue` kini diam untuk `ENOENT` dan tetap memperingatkan masalah akses lain (test `Settings.test.js`).
- 🧱 e2e → Playwright (F-B2 selesai): `playwright.config.mjs` (project `ui` hermetik, project `sites` situs live), fixture Electron di `src/__tests__/support/electronApp.mjs` (profil terpisah, seed 10.389 judul, `_electron.launch`), `App.e2e.mjs` (12 tes: anggaran startup, dialog konektor, daftar 10k, chapter, reader, menu, tema, tanpa request eksternal) dan `Connectors.e2e.mjs` (situs live). `puppeteer-core` dihapus dari lockfile. Suite situs tidak hijau: situs berubah (MangaDex contoh manga kosong, ComicBrise/To-Corona-Ex/Comic Valkyrie data lain, Baozimh 403 Cloudflare, EpikManga 0 chapter, ReadM markup berubah); kasus yang tersisa perlu data uji baru, bukan perubahan app.
- ⚡ **Startup & performa (audit §5.7)**: `Connectors.initialize()` hanya mendaftarkan konektor sistem; `Connectors.load()` mengimpor konektor website per batch 128 secara paralel di background (event `registered` per batch, `ready` di akhir; `Engine.ConnectorsReady`), UI muncul lebih dulu (`index.html`: `performance.mark` `rk:main/engine/shell/connectors/settings`). `Settings.load()` dijalankan lagi setelah konektor siap dan `Settings.save()` menjaga pengaturan konektor yang belum terdaftar. UI memakai `useConnectors()`; deep link reader menunggu registri. Handler protokol `hakuneko://cache` tanpa `existsSync` sinkron. Dicoba dan **dibuang** (tanpa manfaat terukur): `codeCache`/`Last-Modified` pada skema, `--in-process-gpu`, `NetworkServiceInProcess2` (−12 MB, dalam noise), `--disable-gpu` (lebih besar).
- 📊 **Benchmark vs aplikasi upstream 6.1.7 terpasang** (profil identik, 10.389 judul, median 3 kali, `ps`/`smaps_rollup`, CDP mentah): UI tampil **877 ms vs 6.029 ms**; daftar konektor lengkap 1.906 vs 6.530 ms; render daftar 10k 142 vs 990 ms; filter 15 vs 94 ms; DOM 194 vs 24.619 node; heap JS 37 vs 95 MB; proses renderer 151 vs 271 MB. **Memori total (PSS) 496 vs 439 MB: lebih besar ±13%** — dasar Electron 44 (jendela kosong 274 MB; browser/GPU/NetworkService lebih besar dari Electron lama), bukan kode UI. Catatan jujur: sebagian keunggulan startup berasal dari konektor yang kini lebih sedikit (1.015 vs 1.343); sebelum pembersihan konektor angkanya 930 ms / 2.400 ms.
- 🧹 **Pembersihan konektor** (atas arahan user: konektor mati dihapus): 312 konektor dihapus dengan ikonnya. Aturan konservatif: host `url` tanpa record (NXDOMAIN/NODATA) di resolver 1.1.1.1 **dan** 8.8.8.8 (305; 1 ditahan karena dasar `MangaSee`: `MangaLife`), ditambah yang terbukti rusak: `Futekiya` (DNS mati), `ComicoNovel`, `ReadWebtoons`, `SoftKomik` (situs dan API mati), `ManyToon` (domain dibajak), `MangaPlanet` (markup berubah di domain baru `manga-planet.com`), `ReaperScansBR` (API kini HTML), `Comikey` (obfuscated 320 KB, `require is not defined` di renderer terisolasi). Tidak dihapus walau meragukan: `MangaLife` (basis `MangaSee`), `MangaCruzers` (hidup lewat situs saudara), konektor yang hanya gagal HTTP dari lingkungan uji (timeout/Cloudflare tidak dianggap mati). Konektor yang situsnya hidup tapi parsernya mungkin rusak tidak diperiksa satu per satu. Tes penjaga baru `ConnectorImports.test.js` menolak import relatif yang salah huruf (3 konektor sebelumnya tidak termuat di FS case-sensitive: `AzoraManga`, `IrisScanlator`, `Manhuaga`). Tambahan (Fase 2): `MangaDig` dan `CocoManHua` dihapus (rusak; `CocoManHua` mewarisi `MangaDig`); `ComixTo` sempat terhapus lalu dikembalikan dan ditulis ulang karena situsnya hidup (koreksi user).
- ⚠️ Catatan: dengan "Enable Reader" mati panel konten disembunyikan (perilaku classic), sehingga view React-only tidak tampil. `ui.css` ±780 KB karena gambar latar light+dark tertanam (lib mode).
- 🔎 Temuan di luar skope: 404 pada `mjs/connectors/AzoraWorld.mjs` (file `azoraworld.mjs` huruf kecil — kemungkinan beda kapitalisasi di FS case-sensitive) dan `mjs/connectors/templates/WordPressMangaStream.mjs` saat konektor dimuat.
- 🧪 Cara verifikasi live: `pnpm run test:e2e` (Playwright `_electron`, profil sementara, jendela muncul di display). Untuk uji manual: `electron . --cache-directory=./build/web --user-directory=<tmp>` (buat dulu folder `baseDirectory` di profil tmp; jangan `--ozone-platform=headless`: SIGTRAP). Jangan memakai `pkill -f` dengan pola yang juga cocok dengan perintahnya sendiri, dan jangan menjalankan aplikasi yang terpasang (`/usr/bin/rakkomik`, atau aplikasi upstream) tanpa `--user-directory`/`--cache-directory` terpisah (membuka profil asli user).

### Fase 5 — Modernisasi Node 24 & dependensi (2026-10-10)
**Arahan user:** tulis ulang kode deprecated, optimalkan pemakaian API Node 24, ganti paket yang tidak terawat ke paket modern (biner Rust lebih disukai bila terawat).
**Fakta penentu:** Electron 44 menanam **Node 24.21** di proses utama (host Node 24.14) — `node:sqlite`, `module.registerHooks`, `fs.cp`, `fetch`, `crc32` semuanya tersedia tanpa flag.

**Deprecated yang ditulis ulang**
- `url.parse`/`url.resolve` (DEP0169) di `UpdateServerManager` → WHATWG `URL` + `URL.canParse`; transport `http/https` + redirect manual → `fetch` (`redirect: 'follow'`, `AbortSignal.timeout`), galat jaringan asli (`error.cause`) diteruskan agar pesan tetap `connect ECONNREFUSED …`.
- Paket `rcedit` (deprecated upstream, biner Windows) → `resedit` 3.1 + `pe-library` 2.0 (`scripts/pe-resources.mjs`, pure JS, lintas platform). Diverifikasi pada `electron.exe` v44.6.0 asli: string versi terganti, grup ikon id 1 berisi 8 frame `app.ico`, PE32+ tetap valid (±400 ms). Allowlist gate deprecated kini kosong.
- `fs.ensureDirSync` (sisa `fs-extra` yang sudah dicabut) di `build-app.js` membuat **`build:app` pecah di semua platform** → `fs.mkdirSync({ recursive })`.
- Shim kompatibilitas Electron 8↔44 di `IpcBridge` (`setProxy` callback-vs-promise, `showMessageBox` angka-vs-objek) dibuang; `app.on('ready')` → `await app.whenReady()`.
- `String.prototype.substr` (Annex B) → `slice` di engine (`Connector`, `Crypto`, `HeaderGenerator`) dan 7 konektor (`NewType`: `substr(0, idx)` dijaga semantiknya dengan `Math.max(0, idx)`); `FileReader` → `Blob.arrayBuffer()`.
- Sisa legacy yang **dibiarkan** (bukan deprecated, risiko > manfaat): `XMLHttpRequest` di 21 konektor, `.substring` di 4 konektor, `child_process.exec` untuk perintah pasca-unduh milik user (memang perintah shell) dan skrip build (`dpkg-deb`, `rpmbuild`, `hdiutil`, `tar`, `unzip`).

**API Node 24 yang dipakai**
`fetch` (updater, unduh Electron di `build-app.js` via `stream/promises.pipeline` + `Readable.fromWeb`, gate deprecated dengan metadata ringkas `application/vnd.npm.install-v1+json`), `crypto.verify`/`crypto.sign` satu-panggilan (verifikasi pembaruan; tanda tangan rilis di `deploy-web.js` tanpa `openssl` CLI — kunci privat tidak pernah ditulis ke disk), `node:sqlite` (`SqliteBridge`: impor bookmark FMD di proses utama), `module.registerHooks` (`__tests__/support/mockRequire.js`: mock paket CJS resmi menggantikan monkeypatch `Module._load`; builtin di-stub lewat `vi.spyOn` pada singleton), `fs.cp` (plugin bundle Vite), `readdir({ recursive, withFileTypes })` (ukuran paket deb tanpa `du`, daftar file rilis tanpa `zip` CLI), `crypto.randomUUID`, `Promise.withResolvers` (registri konektor), `URL.canParse`. Prefix `node:` diwajibkan oleh oxlint (`unicorn/prefer-node-protocol`, plus `unicorn/no-new-buffer`); skrip tooling kini ikut dilint (`lint:tools`).

**Paket diganti / dihapus**
| Sebelum | Sesudah | Catatan |
|---|---|---|
| `discord-rpc` 4.0.1 (kode 2021, dep git `register-scheme`) | `@xhayper/discord-rpc` 1.5.1 (2026-09) | API `client.user.setActivity/clearActivity`; registrasi skema `discord-<id>://` dibuang (hanya untuk join/spectate yang tidak pernah ditawarkan); override pnpm `register-scheme` dihapus |
| `jszip` (vendored 3.2.1 dari 2019 di renderer + dep main) | `fflate` 0.8.3 | renderer: ESM vendored (`src/web/js/fflate.mjs`) via **import map** di `index.html` sehingga engine memakai `import … from 'fflate'` (vitest me-resolve dari node_modules); main: `unzipSync` di `CacheDirectoryManager` (+ penolakan entri yang keluar dari direktori cache) |
| `sql.js` (vendored asm.js ±2014, 1,5 MB diparse tiap start) | `node:sqlite` (main) | renderer mengirim byte file via IPC `rakkomik:sqlite:query`; hasil baris berindeks nama kolom |
| `protobufjs` vendored 6.8.8 (2018, `<script>` blocking) | `protobufjs` 8.8.0, dimuat on-demand (`engine/Protobuf.mjs`) | hanya ComicFuz memakainya; diverifikasi live (105 chapter, gambar ter-decode) |
| `pino` 7.11 | `pino` 10.4 | API `pino.destination` tidak berubah |
| `win-7zip` 0.1.1 (2015, tidak pernah dipanggil) | dihapus | Windows memakai bsdtar bawaan (`tar -xf`, `tar -a -cf`); linux/darwin tetap `unzip` (simlink + mode unix arsip Electron harus utuh, fflate tidak mengembalikannya) |
| `zip` + `openssl` CLI (deploy) | `fflate` + `node:crypto` | `deploy-web.js` mengekspor `pack/readTree/resolveChannel`; `gh` dipanggil via `execFile` (tanpa shell) |
| `innosetup-compiler` 6.3.1 | tetap | satu-satunya pembungkus ISCC yang terawat; tidak ada alternatif Rust |

Rust: toolchain yang sudah Rust tetap (oxlint/oxfmt, Rolldown via Vite 8, Tailwind oxide). Untuk PE, zip, SQLite dan Discord RPC **tidak ada paket Rust di npm yang terawat** — dipilih pure-JS terawat atau API bawaan Node.

**Vendoring:** `scripts/vendor.js` (dijalankan `postinstall`, skrip `vendor`) menghasilkan `src/web/js/fflate.mjs` dan `protobuf.min.js` (gitignored) dari devDependencies root — versi mengikuti lockfile dan gate deprecated. File vendored lama (`jszip.min.js`, `sql.min.js`, `protobufjs.min.js`) dihapus dari git.

**Tes:** unit 181 (baru: `SqliteBridge`, `BookmarkImporter`, `Deploy` = pack→sign→verify→extract satu rantai dengan `UpdatePackageInfo` + `CacheDirectoryManager`; `CacheDirectoryManager` tanpa mock dengan zip sungguhan; fixture server memakai port bebas dinamis sehingga `fileParallelism: false` dihapus), e2e UI 15 (baru: roundtrip CBZ/EPUB di renderer — `mimetype` entri pertama tanpa kompresi — dan impor bookmark via `node:sqlite` di Electron). Pembaca CBZ kini hanya mengembalikan gambar (sebelumnya `ComicInfo.xml` ikut jadi "halaman").
**Belum teruji:** jalur `build:app` Windows (bsdtar, `innosetup-compiler`) dan macOS; rich presence live (butuh Discord berjalan). `node:sqlite` berstatus "Active development" di Node 24 (satu ExperimentalWarning di stderr proses utama).
**Ukuran (median 5 kali, profil benchmark 10.389 judul):** UI tampil 877 → **817 ms**, konektor siap 1906 → 1856 ms, heap renderer idle 37 → **24 MB** (1,7 MB JS vendored tidak lagi diparse saat start). Pelajaran: `@xhayper/discord-rpc` (menarik `@discordjs/rest`) dan `node:sqlite` harus di-`require` saat pertama dipakai — versi eager menaikkan waktu UI tampil ke 1027 ms.

### Fase 5.1 — Penanganan interstitial anti-bot (2026-10-10)
**Arahan user:** tulis ulang cara penanganan bypass Cloudflare.
**Prinsip:** tanpa trik. Jendela tersembunyi memuat halaman seperti browser biasa dan skrip pemeriksaan milik situs berjalan sendiri; bila butuh manusia — atau pemeriksaan otomatis tidak selesai dalam `interactiveAfter` — jendela ditampilkan ke user. Tidak ada penyelesaian captcha otomatis. Satu user agent (Chromium asli, tanpa token `Electron/x` dan `<app>/x`) dipakai di `fetch()`, jendela fetch, dan `navigator.userAgent`, karena cookie hasil pemeriksaan terikat ke UA yang mendapatkannya.

**Yang berubah**
- `engine/AntiScraping.mjs` (baru, 150 baris terbaca): `detectChallengeInPage` menggantikan skrip deteksi lama (blob terobfuskasi ±8 KB milik Crunchyscan + penanda Cloudflare 2019 `_jschl_`/`_captcha_`) dengan klasifikasi `none / automatic / interactive / error` (interstitial Cloudflare, halaman galat/blokir Cloudflare, DDoS-Guard ± captcha, gerbang ReadComicOnline/CloudTest/Crunchyscan, gerbang captcha generik, meta refresh); `isChallengeResponse` mengenali respons `fetch()` yang masih interstitial (`cf-mitigated: challenge`, atau server Cloudflare/DDoS-Guard + status 403/429/503 + HTML yang dikonfirmasi isinya); `installChallengeBypass` membungkus `window.fetch`: respons tertantang → satu jendela tersembunyi per origin (permintaan paralel berbagi), lalu permintaan dikirim ulang **sekali**; selain GET memuat origin; gagal → respons asli dikembalikan.
- `FetchWindowManager._load` ditulis ulang sebagai mesin status: `automatic` menunggu muatan berikutnya dan menampilkan jendela setelah `interactiveAfter` (15 dtk), `interactive` langsung menampilkan dan memberi anggaran `interactiveTimeout` (180 dtk), `error` menolak seketika, jendela ditutup user → tolak dengan pesan jelas; hasil string skrip deteksi lama tetap diterima.
- `Request.mjs`: `userAgent = navigator.userAgent` (bukan UA acak), skrip deteksi dari `AntiScraping`, tunable `interactiveAfter/interactiveTimeout/challengeTimeout` ikut job IPC.
- `ElectronBootstrap.launch`: `app.userAgentFallback` dibersihkan dari token Electron/app; `HeaderSurgery` menerima UA itu (sebelumnya UA Windows acak per peluncuran) dan bug warisan upstream `Cache-Control = requestHeaders['no-cache']` (selalu `undefined`) → `'no-cache'`.
- `Connector.fetchDOM`: respons yang masih interstitial setelah bypass → galat `The anti-bot check of "<origin>" could not be completed (status: N)`, bukan DOM interstitial yang diparse diam-diam.
- `HeaderGenerator.mjs` dihapus. MangaHub/ComicK/SushiScans tidak lagi memasang UA acak per permintaan (merusak ikatan cookie dan memalsukan versi Chrome), ScanManga tidak lagi memasang `accept-language` acak.

**Tes:** unit `AntiScraping` (header, klasifikasi halaman, skrip mandiri tanpa `_0x…`, bungkus fetch: dedupe per origin, konfirmasi isi, gagal, tidak berulang) dan `FetchWindowManager` (jendela palsu + fake timers: konten, otomatis, interaktif, fallback waktu, anggaran user, jendela ditutup, galat, hasil legacy, gagal muat). e2e 3 skenario dengan server HTTP lokal yang meniru interstitial (`cf-mitigated`, cookie diberikan via `Set-Cookie` endpoint `/pass` → `SameSite=None` oleh HeaderSurgery, persis mekanisme situs sungguhan; cookie `document.cookie` tidak dikirim lintas situs): selesai sendiri → kirim ulang; butuh klik → jendela tampil, Playwright mengklik di jendela itu, jendela tertutup lagi; tak pernah selesai → galat jelas, jendela dibersihkan. Fixture e2e mengecualikan loopback dari daftar "host eksternal".
**Belum teruji:** situs live di balik Cloudflare/DDoS-Guard (e2e hermetik tanpa jaringan).

### Fase 5.2 — Optimalisasi Electron & Node 24 lanjutan (2026-10-10)
**Arahan user:** dari audit "apakah app ini sudah mengoptimalkan Electron dan Node 24?" kerjakan IPC sinkron, compile cache, fuses, dan `engines`.

**1. IPC sinkron dihapus dari preload.** 11 kanal `sendSync` (platform, env, tmpdir, `path.*`, `fs.existsSync/mkdirSync`, `app.getPath`) tidak ada lagi — `window.hakuneko` kini seluruhnya `invoke`, dan `IpcBridge`/`FsBridge` tidak punya `ipcMain.on` (dijaga `FsBridge.test`).
- Nilai yang dibutuhkan inline (platform, flag portable, tmpdir, direktori aplikasi) dikirim sekali lewat `webPreferences.additionalArguments` (`--rakkomik-bootstrap=<JSON>`, `ElectronBootstrap._rendererBootstrap`) dan dibaca preload dari `process.argv` (cara resmi Electron untuk preload *sandboxed*); `app.getPath(name)` menjadi lookup — nama tanpa direktori tetap melempar seperti Electron (Settings sudah menangani `documents`).
- Operasi path dihitung di renderer: `engine/Path.mjs` adalah port `path.posix`/`path.win32` Node (join/normalize/dirname/basename/extname/parse); `Path.test.js` membandingkan 152 kasus (UNC, drive, `/..`, sufiks) dengan implementasi Node sendiri.
- `_createDirectoryChain` (rekursi `existsSync`+`mkdirSync`, memblokir renderer *dan* main) → satu `fs.promises.mkdir({ recursive })`; `saveTempFile`/`_extractZipEntry` memastikan direktori temp sebelum menulis.
- e2e baru: data bootstrap sampai ke renderer (platform, `userData` = `--user-directory`, tmpdir, nama tak dikenal melempar).

**2. `module.enableCompileCache()` — dicoba, dicabut.** Diukur dengan Playwright, 9 peluncuran per mode, profil terisolasi, median: tanpa cache uptime proses utama saat launch 435 ms / UI siap 938 ms; dengan cache 443 ms / 1005 ms (49 berkas cache, 113 KB). Kode proses utama terlalu kecil untuk terasa — startup didominasi inisialisasi Chromium/Node — jadi tidak ada alasan menulis direktori cache saat runtime.

**3. Electron Fuses** (`@electron/fuses` 2.1.3, dipelihara tim Electron) di `build-app.js` untuk Linux dan Windows: `RunAsNode` off, `EnableNodeOptionsEnvironmentVariable` off, `EnableNodeCliInspectArguments` off, `OnlyLoadAppFromAsar` on; hasil dibaca kembali (`getCurrentFuseWire`) dan build gagal bila tidak sesuai. Dibiarkan: `EnableCookieEncryption` (butuh keyring di Linux), `EnableEmbeddedAsarIntegrityValidation` (butuh resource integritas yang tidak ditanam packager). Diverifikasi pada salinan biner Electron 44.6.0: wire berubah, `ELECTRON_RUN_AS_NODE=1 … -e` tidak lagi dieksekusi sebagai Node, aplikasi start dari `app.asar`.
- **Bug lama ditemukan dan diperbaiki:** `app.asar` hasil `build:app` tidak bisa start sejak migrasi ke pnpm — `src/app/node_modules/pino` adalah symlink ke store `.pnpm`, dan Electron gagal `require` melalui link di dalam asar (`ENOENT, node_modules/.pnpm/pino@10.4.0/node_modules/pino not found in app.asar`). `src/app` kini dipasang sebagai pohon fisik (0 symlink): di Fase 5.2 lewat flag `--config.node-linker=hoisted` di `postinstall`; sejak Fase 5.3 lewat `nodeLinker: hoisted` di `src/app/pnpm-workspace.yaml`. (Penjelasan awal bahwa root `pnpm-workspace.yaml` "menentukan proyeknya" keliru: `src/app` punya berkas workspace sendiri; `.npmrc` tidak terbaca karena pnpm 11+ hanya membaca pengaturan autentikasi darinya.) Niat Fase 0 ("agar app.asar berisi file fisik") baru terpenuhi sekarang.

**4. `engines.node >= 24`** di `package.json`. (`packageManager: pnpm@11.22.0` ikut ditambahkan di sini dan **dicabut di Fase 5.3** — melanggar keputusan tanpa-kunci-toolchain.)

**Belum teruji:** build Windows (fuses pada `.exe` + resedit) dan paket .deb/.rpm (butuh dpkg/rpm/lintian) — hanya bundel Linux yang diverifikasi berjalan.

### Fase 5.3 — pnpm 12, tanpa kunci toolchain/dependensi, Node ≥24 (2026-10-10)
**Arahan user (berurutan):** (1) "update ke pnpm12, jangan lock package supaya lebih mudah di maintenance"; (2) "node package juga jangan di pin"; (3) "minimal menggunakan node 24 di semua proyek termasuk ci".
**Tafsiran:** `packageManager: pnpm@11.22.0` (Fase 5.2) melanggar keputusan tanpa-kunci-toolchain (audit §2.5, plan §1, Fase 0 langkah 2) — dicabut. Versi dependensi tidak lagi dipin eksak di `package.json` (rentang `^`). `pnpm-lock.yaml` tetap ada dan tetap mengunci hasil resolusi (reproduksibilitas dependensi — keputusan terpisah dari pin); perawatan = `pnpm update` (dalam rentang) atau `pnpm update --latest` (naik rentang).

**Temuan (diuji, bukan asumsi)**
- Pin `packageManager` membatalkan upgrade: dengan pnpm 12.11.1 terpasang, `pnpm --version` di dalam proyek mencetak **11.22.0** (pnpm 12 berpindah ke versi yang dikunci); tanpa pin mencetak 12.11.1.
- Pin yang sama merusak CI: `pnpm/action-setup@v4` melempar `Multiple versions of pnpm specified` bila `packageManager` ≠ input `version` (diperiksa di sumber action); keempat workflow memakai `version: 12`.
- CI masih `node-version: 20`, padahal kode butuh Node 24 (`engines`; tes memakai `module.registerHooks` yang baru ada di Node 22.15/23.5, jadi langkah `test` di Node 20 tidak mungkin lulus — dari riwayat API Node, tidak dijalankan: tidak ada Node 20 di mesin ini).
- `build-app.config` memakai `devDependencies.electron` sebagai versi biner yang diunduh packager — itu butuh string eksak; dengan `^44.6.0` URL unduhan akan rusak.
- Sisa pin mati: `src/app/pnpm-workspace.yaml` masih memuat `overrides: register-scheme: 0.0.2` + `allowBuilds` (tidak ada paket yang memakainya sejak discord-rpc diganti; hanya tampil di baris override itu) dan komentar "pino 7.11.0 untuk Node 12/Electron 8" (pino kini 10.4.0); root memuat `minimumReleaseAgeExclude: electron@44.6.0` (rilis berumur 3,7 hari, lolos kebijakan bawaan tanpa pengecualian — diuji) dan catatan pin knip.
- Koreksi atas Fase 5.2: `src/app` adalah proyek workspace mandiri (berkas `pnpm-workspace.yaml` sendiri), bukan anggota workspace root — jadi tempat `nodeLinker` yang benar adalah berkas itu, bukan flag CLI.

**Yang berubah**
- pnpm **12.11.1** (npm global di bawah asdf, menggantikan 11.22.0). Bukan 12.11.2: baru 22 jam saat dipasang — ambang umur rilis 1 hari yang dipakai pnpm 11 untuk dependensi (catatan knip) saya terapkan juga ke alatnya; ini kehati-hatian, bukan keharusan (pnpm 12 sendiri me-resolve 12.11.2 tanpa keberatan pada konfigurasi bawaan). Selisihnya hanya perbaikan `--workspace-concurrency=Infinity`, filter hook `updateConfig`, dan `enable-modules-dir=false`, yang tidak dipakai di sini. CI (`version: 12`) mengambil 12.x terbaru.
- Tanpa pin toolchain: `packageManager` dihapus; `engines.pnpm: ">=12"` di samping `node`. pnpm 12.11 **tidak menegakkan** `engines` pada proyek root (diuji dengan `>=99`, dengan dan tanpa dependensi) — penanda untuk manusia/alat, bukan kunci.
- Tanpa pin dependensi: 23 spesifier di `package.json` root dan 3 di `src/app/package.json` dari `x.y.z` menjadi `^x.y.z`. Lockfile disinkronkan dengan `pnpm install --lockfile-only`: hanya baris `specifier` yang berubah (23 + 3) dan `overrides` mati di `src/app`; tak satu versi terselesaikan bergeser (electron 44.6.0, knip 6.39.0, … tetap). Catatan semver: `^0.x` (oxfmt) hanya mengizinkan patch — naik minor lewat `pnpm update --latest`. `build-app.config` kini memakai versi Electron yang **terpasang** (`require('electron/package.json').version` = yang diuji).
- Node ≥24 di semua proyek: `engines.node >=24.0.0` di `package.json` root dan (baru) `src/app/package.json`; keempat workflow `node-version: 24` (major saja, sesuai pola tanpa-kunci-minor); `version: 12` untuk pnpm tetap. Batas bawah dinyatakan sebagai rentang, bukan pin.
- `src/app/pnpm-workspace.yaml`: `nodeLinker: hoisted` (menggantikan flag CLI di `postinstall`, sehingga `pnpm install` manual di `src/app` pun menghasilkan pohon fisik); `overrides`/`allowBuilds` `register-scheme` dan komentar pino dibuang. `pnpm-workspace.yaml` root: `minimumReleaseAgeExclude` dan catatan pin knip dibuang, komentar layout dikoreksi.
- Perilaku pnpm 12 yang relevan di repo ini: kunci tak dikenal di `pnpm-workspace.yaml` kini galat (semua kunci kita dikenal: `packages`, `allowBuilds`, `nodeLinker`); lockfile v9 dibaca apa adanya; pnpm 12 memverifikasi lockfile terhadap kebijakan rantai pasok ("Lockfile passes supply-chain policies", lulus tanpa pengecualian); store tetap `v11`.

**Validasi:** clone bersih (`git clone` + perubahan kerja) dengan `CI=true pnpm install --frozen-lockfile` (lockfile baru konsisten dengan rentang `^`; `src/app` hoisted, 0 symlink, hanya dari berkas workspace-nya), lalu langkah `ci-pr.yml`: lint, `check:deprecated`, `build:web`, `test` (368 lulus); di pohon kerja: lint (0 galat, 270 peringatan lama), knip, deprecated, `build:web`, e2e UI 19 lulus; `app.asar` dari instalasi pnpm 12 yang bersih start dengan fuses aktif (`ELECTRON_RUN_AS_NODE` diabaikan).
**Risiko tercatat:** gate `check:deprecated` bergantung pada registry npm dan sesekali kena timeout 20 dtk (terlihat beberapa kali di sesi ini, termasuk sekali di clone bersih; lulus saat diulang) — di CI ia bisa gagal acak.
**Belum teruji:** workflow di GitHub Actions itu sendiri (tidak bisa dijalankan lokal); `pnpm/action-setup@v4` tetap dipakai (tag terbaru v6, tidak diubah karena tidak diminta).

### Fase 6 — Bersih-bersih, rebrand RakKomik, ikon, git-cliff, AUR (2026-10-11)
**Arahan user:** bersihkan file tak terpakai (+ `SECURITY.md`); git-cliff di CI; rebrand dan hapus semua referensi upstream **tanpa mengubah engine**; ikon aplikasi = tumpukan buku; hapus semua aset milik upstream; publikasi AUR di CI; README Markdown (bukan AsciiDoc) yang menyatakan bahwa ini fork, tanpa rujukan ke dokumen rencana, dengan isi teknis dipisah ke dokumen teknis di `docs/`; ikon konektor ComixTo dari `comix.to`; paket AUR tanpa versi Electron eksplisit.

**Keputusan**
- Merek **RakKomik** (`rakkomik`), repo `github.com/akn19/rakkomik`. "Engine" = seluruh `src/web/mjs/**` (engine, konektor, `HakuNeko.mjs`, `VersionInfo.mjs`): `git diff` di pohon itu kosong.
- Akibat dari engine yang tidak disentuh: identifier berikut **harus tetap** (engine meng-hardcode-nya) — skema `hakuneko://` (`Connectors.mjs` memuat `hakuneko://plugins/` dan `hakuneko://cache/mjs/connectors/`), global `window.hakuneko` (preload), kunci `HAKUNEKO_PORTABLE` di objek `env` bridge, global `HakuNeko` + berkas `HakuNeko.mjs` (index.html, `.oxlintrc.json`, `knip.json`), awalan berkas data `hakuneko.*` dan direktori temp `hakuneko`, kata sandi enkripsi pengaturan lama. Sisa teks di engine/konektor (±60 berkas) juga tetap; dua konektor bergantung pada layanan milik upstream (`MangaDex.mjs` → `websites.hakuneko.download`, `WebtoonHatti.mjs` → `smtp.hakuneko.workers.dev`), dan presence Discord memakai ID aplikasi + kunci gambar upstream (`DiscordBridge.js`, `DiscordPresence.mjs`).
- Direktori data pengguna mengikuti nama aplikasi (`hakuneko-desktop` → `rakkomik`): **tanpa kode migrasi** (akan menyimpan nama lama); pemindahan manual didokumentasikan di README.
- README menyebut upstream hanya sebagai atribusi fork (pengecualian yang disengaja).
- AUR: dependensi `electron` generik (bukan `electronNN`), sejalan dengan kebijakan tanpa-pin; paket dibangun dari tag git, hanya cangkang `src/app` (bagian web diunduh oleh updater aplikasi).

**Dihapus** — `SECURITY.md`, `.azure/` (CI lama), `.eslintrc.json` (diganti oxlint), `.github/ISSUE_TEMPLATE/` (proses dukungan upstream), `res/` dan `assets/` (maskot, logo, tangkapan layar, sumber XCF), ikon dan XPM lama di `redist`, `redist/deb/DEBIAN/postinst|postrm` (selalu ditimpa generator `build-app.js`), `_createMenuEntry` (tak pernah dipanggil), gambar tema classic (ilustrasi maskot + chevron; diganti warna polos dan SVG inline di CSS), banner `#notification` di `index.html` (`display: none` selamanya), tautan Discord/Maintainers/Artwork di menu, 17 ikon konektor yatim (4 ikon yang salah huruf besar diganti nama jadi huruf kecil sehingga tampil di Linux).

**Rebrand** — `package.json` ×2, `build-app.config`, kanal IPC `hakuneko:*` → `rakkomik:*`, `--rakkomik-bootstrap`, env `RAKKOMIK_PORTABLE` (dipetakan ke kunci engine di `ElectronBootstrap`), prefiks berkas temp, `rakkomik.plugins`, judul/tooltip, string dan tautan UI, VersionInfo di `vite.web-bundle.mjs`, secret deploy `HAKUNEKO_*` → `RAKKOMIK_*` (`deploy-web.js`, `continuous-deployment.yml`, tes), tes terkait.

**Ikon** — `assets/icon.svg` (tiga buku bertumpuk di ubin biru tua, penanda halaman) adalah satu-satunya sumber; `pnpm run icons` (`scripts/icons.js`, Electron merender SVG, encoder ICO/ICNS/BMP sendiri) menghasilkan PNG hicolor deb/rpm, `app.ico`, bitmap wizard Inno, `icon.icns` + latar DMG di `redist/macos`, logo UI dan ikon tray. Struktur ICO/ICNS/BMP diverifikasi dengan membaca ulang; ikon dilihat pada 16–512 px.

**CI** — `cliff.toml` (commit konvensional, tipe tidak peka huruf besar); `ci-pr.yml`: job pratinjau perubahan sejak rilis terakhir di ringkasan job; `release.yml` pada tag `vX.Y.Z` (harus sama dengan `version` kedua `package.json`): git-cliff → release GitHub → `packaging/aur` ke AUR (`makepkg` diuji sebelum push). `KSXGitHub/github-actions-deploy-aur@v4` memegang kunci AUR dan sengaja memakai tag mayor yang mengambang; kalau ingin dipin ke SHA, ganti di `release.yml`.

**Tindakan manual yang tersisa**
1. Ganti nama secret repo `HAKUNEKO_PRIVATE_KEY`/`HAKUNEKO_PASSPHRASE` → `RAKKOMIK_PRIVATE_KEY`/`RAKKOMIK_PASSPHRASE` (deploy web berhenti sampai itu dilakukan).
2. Untuk AUR: akun AUR, kunci SSH publik di akun, kunci privat sebagai secret `AUR_SSH_PRIVATE_KEY`.
3. Pindahkan data lama bila perlu (`hakuneko.*` dari folder data aplikasi lama ke `~/.config/rakkomik`).
4. Presence Discord masih tampil sebagai aplikasi upstream sampai aplikasi Discord baru dibuat dan ID/gambarnya diganti.

**Temuan, tidak diubah (di dalam engine):** 6 template konektor tanpa pemakai (`BloggerManga`, `Ciayo`, `NineManga`, `@Samples`, `TakeShobo`, `WordPressJarida`); paket deb/rpm/asar hasil `build-app.js` masih memuat `__tests__` (hanya paket AUR yang membuangnya).
**Validasi:** lint (0 galat, 270 peringatan lama), 368 tes unit, knip, `build:web`, e2e UI 19, `check:deprecated`; tangkapan layar aplikasi (terang dan gelap); `makepkg` lokal dari repo sementara + `namcap`; `app.asar` dari paket dijalankan dengan Electron; `cliff.toml` diuji pada riwayat repo; ketiga workflow baru/diubah lolos `action-validator`.
**Belum teruji:** workflow di GitHub Actions, push AUR sungguhan, build installer Windows/macOS dengan ikon baru.

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

### F-B2 — E2E `puppeteer-core` → Playwright (✅ selesai 2026-10-10, lihat Fase 4)
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
