# Development

## Requirements

- Node.js 24 or newer and pnpm 12 or newer (`engines` in `package.json`; pnpm does not enforce them for the root
  project). No toolchain version is pinned in the repository: there is no `packageManager` field and no `.nvmrc`.
- The end-to-end tests and the icon generator open Electron windows and need a display (`xvfb-run` on a headless
  machine).

## Setup

`pnpm install` does three things after the dependencies are installed (`postinstall`):

1. downloads the Electron binary;
2. installs `src/app` as a project of its own, as a plain `node_modules` tree (`nodeLinker: hoisted` in
   `src/app/pnpm-workspace.yaml`): an `app.asar` cannot follow the symlinks of pnpm's default layout;
3. vendors the browser builds of `fflate` and `protobufjs` into `src/web/js` (`pnpm run vendor`; generated, not
   committed).

## Commands

| Command | |
|---|---|
| `pnpm start` | run the application against `./src/web` (no update, no cache download) |
| `pnpm run watch:ui` | rebuild the React user interface into `src/web/ui/dist` when a file changes; an open window keeps the build it loaded, so restart the application to see the change |
| `pnpm run start:build` | build the web part and run the application against `build/web` |
| `pnpm run build:arch` | build the Arch Linux package of the working tree into `build/`, see [below](#building-the-arch-package) |
| `pnpm run lint` | oxlint over the application, the engine, the user interface, the scripts and the end-to-end tests; the user interface also gets the `jsx-a11y` rules, see [accessibility](accessibility.md) |
| `pnpm run test` | unit tests (Vitest: the projects `app`, `web` and `ui`) |
| `pnpm run test:coverage` | the unit tests with a coverage report: a summary in the terminal, the details in `coverage/index.html` |
| `pnpm run test:e2e` | build the web part and run the tests of the real application (Playwright, project `ui`), the accessibility checks of axe-core among them |
| `pnpm run test:e2e:sites` | connectors against their real websites, see [adding a website](connectors.md#testing) |
| `pnpm run test:package` | the tests of the real application on a package that `build:app` made, see [building the installers](#building-the-installers) |
| `pnpm run knip` | unused files, exports and dependencies |
| `pnpm run check:deprecated` | fails when a dependency (at its installed version) is deprecated; needs network |
| `pnpm run build:web` | the web part in `build/web` |
| `pnpm run build:app` | the web part, then the installers of the current platform, see [below](#building-the-installers) |
| `pnpm run build:win` | the web part, then the Windows packages (on Linux and macOS only the portable `.zip`) |
| `pnpm run build:mac` | the web part, then the macOS `.dmg` files (macOS only) |
| `pnpm run deploy:web` | publish the web part (CI only), see [releasing](releasing.md#web-part) |
| `pnpm run icons` | regenerate every icon from `assets/icon.svg` |

Run a subset with `pnpm exec vitest run <file name part>` or
`pnpm exec playwright test --project=ui -g "<test title>"`. CI ([releasing](releasing.md#workflows)) runs the lint, the
deprecated gate, the web build and the unit tests (on Linux, Windows and macOS) for every push and pull request; the
end-to-end tests are run locally.

## Running safely

Never start an installed copy against your real profile while you test. Use separate directories:

```shell
pnpm exec electron . --update-url=DISABLED --cache-directory=./build/web --user-directory=/tmp/rakkomik-profile
```

`F12` opens the developer tools.

## Tests

- **Unit tests** are in `__tests__` folders next to the code, in three Vitest projects (`vitest.config.mjs`):
  - `app`: the main process (`src/app`) and the scripts that build, sign and publish (`build-app.js`, `deploy-web.js`,
    `scripts/`). Electron is replaced with `mockModule('electron', factory)`
    (`src/app/__tests__/support/mockRequire.js`).
  - `web`: the engine, which is loaded as ES modules in plain Node with fake globals (`window.Engine`, the
    `window.hakuneko` bridge). A file that needs a DOM starts with `// @vitest-environment happy-dom`.
  - `ui`: the React components (`src/web/ui/__tests__/*.test.jsx`), in happy-dom with React Testing Library.
    `support/fakeEngine.js` stands in for the engine (`window.Engine`, `window.hakuneko`), `support/render.jsx` renders
    with the providers of the application or inside a real in-memory router, and `support/layout.js` gives the elements
    a size, which a virtual list needs.

  The connectors of the websites have no unit tests, they are run against the sites (see below); the built-in sources in
  `src/web/mjs/connectors/system` are tested like the rest of the engine. `pnpm run test:coverage` shows what the unit
  tests do not reach.
- **`it.fails` marks a known bug.** The test says what is right and the `// BUG:` comment above it says what is wrong and
  where. It passes while the bug is there and starts to fail when somebody fixes it: then change `it.fails` to `it`.
  `rg "it\.fails" src` lists them.
- **The unit tests run on Linux, Windows and macOS** in CI, so a test must not depend on the platform. What has gone
  wrong before: `process.env.HOME` does not exist on Windows (use `os.homedir()`); `path.resolve('/opt/x')` gets a drive
  letter there, so compare with `path.resolve`, not with `path.join`; Windows has no file modes (skip those assertions
  with `it.skipIf(process.platform === 'win32')`); `os.EOL` is `\r\n` there; the temporary directory of macOS is a
  symlink; a test server that is reused must answer with `Connection: close`.
- **End-to-end tests** (`src/__tests__/App.e2e.mjs`) start the real application with Playwright's `_electron` in an
  isolated profile that is seeded with the manga list of one connector. `src/__tests__/support/electronApp.mjs` holds
  the fixture (one application per worker; `E2E_WEB` selects another web directory than `build/web`, `E2E_ELECTRON`
  the executable of a packaged application instead of the Electron of `node_modules`) and fails a test when the page
  contacts an external host. The interstitial tests use a local HTTP server that behaves like a gate
  (a check that completes on its own, one that needs a click, one that never completes). A test that changes files
  under a running window uses the `isolatedApp` fixture: an application of its own on its own copy of the web
  directory (see the test _replaced web part_).
- **Site tests** need network access and can fail when a website changes; they are not part of CI.
- **Accessibility** has a unit test for the contrast of the colours and an end-to-end test that runs axe-core over the
  application, see [accessibility](accessibility.md).

## Code style

- Lint with `pnpm run lint`. Format only the files you change (`pnpm exec oxfmt --write <file>`); `pnpm run format` over
  the whole tree would rewrite about a thousand connectors.
- New and changed code does not use deprecated APIs or dependencies; `check:deprecated` is the gate.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org) (`feat`, `fix`, `perf`,
  `refactor`, `docs`, `test`, `build`, `ci`, `chore`, with an optional scope), because the release notes are
  generated from them.

## Dependencies

Dependencies are declared as ranges (`^x.y.z`) in `package.json` and `src/app/package.json`; the two lockfiles record
what is installed, and CI installs exactly that. Update with `pnpm update` (inside the ranges) or
`pnpm update --latest` (to the newest versions), in the root and in `src/app`. Nothing reads a version from a range:
the packager takes the Electron version from the installed package.

`pnpm-workspace.yaml` lists the packages whose install scripts may run (`allowBuilds`); `src/app` is not a member
of that workspace, it has its own `pnpm-workspace.yaml`.

## Icons

`assets/icon.svg` (a bookcase with manga and light novels) is the only source. `pnpm run icons` renders it with
Electron and writes the hicolor PNGs of the deb and rpm skeletons, `redist/iss` (`app.ico`, wizard bitmaps),
`redist/macos` (`icon.icns`, DMG background), the logos of the user interface and the tray icons. Commit the generated
files: the packagers use them as they are.

The characters on the spines (マンガ, ラノベ and the kanji 本) are outlines of Noto Sans CJK JP Bold (SIL Open Font
License 1.1), not text: the icon looks the same on every machine, and neither the generator nor a viewer needs a font.

## Building the installers

`pnpm run build:app` builds the web part and then the installers of the platform it runs on, from the Electron version
that is installed. `pnpm run build:win` and `pnpm run build:mac` name the platform instead, and
`node build-app.js <windows|linux|macos>` does the same without building the web part. Every output is x86-64 and
ARM64 (the Arch package is one for both), named with the version of `package.json`:

| Platform | Output | Needs | Built on |
|---|---|---|---|
| Linux | `.deb`, `.rpm` | `fakeroot`, `dpkg`, `lintian`, `rpm`, `unzip` | Linux |
| Windows | Inno Setup installer, portable `.zip` | `innosetup-compiler` (installer), `bsdtar` or `tar` (zip) | the installer on Windows, the zip on any host with `bsdtar` |
| macOS | `.dmg` | `hdiutil`, `codesign` | macOS |
| Arch Linux | `.pkg.tar.zst` | `makepkg`, `git`, `node`, `npm` (`pnpm run build:arch`, see [below](#building-the-arch-package)) | Arch Linux, or its official container image |

The portable `.zip` of Windows is the one package that can be built from another platform: on Linux install `bsdtar`
(libarchive), because GNU tar cannot write a ZIP, and `unzip`. Everything else needs the tools of its own platform;
the _Build Desktop Installers_ workflow builds all of them (start it by hand from the Actions tab), and a release does
it for you, see [releasing](releasing.md#releases).

`app.asar` contains `src/app` with its runtime dependencies, and the web part from `build/web` sits next to it in the
folder `web`, so the application runs without the web part release (see [architecture](architecture.md#delivery-and-updates-of-the-web-part)).
On Linux and Windows the Electron binary is hardened with fuses before it is packaged (no `ELECTRON_RUN_AS_NODE`, no
`NODE_OPTIONS`, no inspector arguments; the application only loads from `app.asar`) and the result is read back. On
macOS the application is signed ad hoc, because Apple Silicon refuses code whose signature does not match its files
after the bundle was renamed; the Info.plist of Electron keeps its keys and only the keys that name the application
change. Neither platform has a certificate, so Windows SmartScreen and macOS Gatekeeper warn the user once.

### What the packages leave out

The packages hold what the application loads, and are as small as that allows:

- `app.asar` is packed by `scripts/pack-app.js` (the Arch package uses it too): the sources of `src/app` without the
  unit tests and their logs, `package.json`, and the runtime dependencies as a real `node_modules` tree without the
  files of pnpm and without what the packages ship for their developers (typings, source maps, TypeScript sources,
  documentation, tests, examples, tool configuration). The licence files of the packages stay. The archive is a third
  of the size that packing `src/app` as it is would give.
- Of the Electron archive, the licence texts and its `version` file are dropped on every platform, and so are the
  parts that the application never loads: `chrome_crashpad_handler` on Linux (the application does not start the
  crash reporter, so the handler process is never spawned) and `dxcompiler.dll` with `dxil.dll` on Windows (the
  DirectX shader compiler of WebGPU, 27 MB; neither the interface nor a connector uses WebGPU, and a page that asks
  for it gets the compiler of the system instead). The table `NOT_SHIPPED` in `build-app.js` lists them. What stays
  on purpose: `ffmpeg` (Chromium links it), SwiftShader and Vulkan (the WebGL of a machine without a usable GPU, which
  the anti-bot checks of websites look at), `d3dcompiler_47.dll` (ANGLE compiles its shaders with it), and the locale
  files (`locales/*.pak`): without the file of the system language, Chromium falls back to `en-US` for its own strings,
  for `navigator.language` and for the `Accept-Language` header that every request carries, which some websites
  answer differently.
- The compression of the packages is the strongest their tools unpack everywhere: the DEB uses xz at its highest
  level, the RPM xz instead of the gzip that `rpmbuild` falls back to, and the Inno Setup installer one solid LZMA2
  stream at the highest level (the thousand connectors and icons compress together).

`pnpm run test:package` runs the end-to-end tests of the interface on the package of the platform and the architecture
of the machine (`scripts/test-package.js`): a copy of the package gets the inspector fuse back, which Playwright needs
to drive the application, and the tests start its executable, which loads its own `app.asar` and the web part next to
it. The _Build Desktop Installers_ workflow does the same on every runner before it keeps the packages.

## Building the Arch package

`pnpm run build:arch` builds `build/rakkomik-<version>-1-any.pkg.tar.zst`. Install it with
`sudo pacman -U build/rakkomik-*.pkg.tar.zst` and remove it with `sudo pacman -R rakkomik`. It needs `makepkg`
(`base-devel`), `git`, `node` and `npm` on the `PATH`; the last two do not have to be pacman packages. The `PKGBUILD`
installs pnpm 12 from npm itself, because the package of Arch has reported an older version than the one it ships,
which the project (`engines`) refuses.

`scripts/build-arch.sh` copies the working tree, uncommitted changes included, into a throwaway git checkout and runs
the `PKGBUILD` of the AUR package (`packaging/aur`) on it, with `RAKKOMIK_SOURCE` in place of the release tag. So the
package built here is the package the AUR gets once publishing is switched on. It reuses the pnpm store of the project, which makes a build take
about half a minute once the dependencies have been downloaded. The package holds the Electron shell and the web part
and runs on the system `electron`, see [releasing](releasing.md#aur-package).

## Generated and ignored files

`src/web/js/fflate.mjs` and `protobuf.min.js` (vendored), `src/web/ui/dist` (user interface bundle), `build/` (web
part, installers and the Arch package), `test-results/`, `playwright-report/`, `junit*.xml` and the `*.log` files of the logger tests.
