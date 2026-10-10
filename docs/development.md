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
| `pnpm run watch:ui` | rebuild the React user interface into `src/web/ui/dist` when a file changes |
| `pnpm run start:build` | build the web part and run the application against `build/web` |
| `pnpm run lint` | oxlint over the application, the engine, the user interface, the scripts and the end-to-end tests |
| `pnpm run test` | unit tests (Vitest: the projects `app` and `web`) |
| `pnpm run test:e2e` | build the web part and run the tests of the real application (Playwright, project `ui`) |
| `pnpm run test:e2e:sites` | connectors against their real websites, see [adding a website](connectors.md#testing) |
| `pnpm run knip` | unused files, exports and dependencies |
| `pnpm run check:deprecated` | fails when a dependency (at its installed version) is deprecated; needs network |
| `pnpm run build:web` | the web part in `build/web` |
| `pnpm run build:app` | the installers of the current platform, see [below](#building-the-installers) |
| `pnpm run deploy:web` | publish the web part (CI only), see [releasing](releasing.md#web-part) |
| `pnpm run icons` | regenerate every icon from `assets/icon.svg` |

Run a subset with `pnpm exec vitest run <file name part>` or
`pnpm exec playwright test --project=ui -g "<test title>"`. Pull request CI runs the lint, the deprecated gate, the
web build and the unit tests; the end-to-end tests are run locally.

## Running safely

Never start an installed copy against your real profile while you test. Use separate directories:

```shell
pnpm exec electron . --update-url=DISABLED --cache-directory=./build/web --user-directory=/tmp/rakkomik-profile
```

`F12` opens the developer tools.

## Tests

- **Unit tests** are in `__tests__` folders next to the code. The `app` project tests the main process; Electron is
  replaced with `mockModule('electron', factory)` (`src/app/__tests__/support/mockRequire.js`). The `web` project
  imports engine modules as ES modules with a fake `window.hakuneko` bridge.
- **End-to-end tests** (`src/__tests__/App.e2e.mjs`) start the real application with Playwright's `_electron` in an
  isolated profile that is seeded with the manga list of one connector. `src/__tests__/support/electronApp.mjs` holds
  the fixture (one application per worker; `E2E_WEB` selects another web directory than `build/web`) and fails a test
  when the page contacts an external host. The interstitial tests use a local HTTP server that behaves like a gate
  (a check that completes on its own, one that needs a click, one that never completes).
- **Site tests** need network access and can fail when a website changes; they are not part of CI.

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

`assets/icon.svg` (a stack of books) is the only source. `pnpm run icons` renders it with Electron and writes the
hicolor PNGs of the deb and rpm skeletons, `redist/iss` (`app.ico`, wizard bitmaps), `redist/macos` (`icon.icns`,
DMG background), the logos of the user interface and the tray icons. Commit the generated files: the packagers use
them as they are.

## Building the installers

`pnpm run build:app` builds the installers of the platform it runs on, from the Electron version that is installed:

| Platform | Output | Needs |
|---|---|---|
| Linux | `.deb`, `.rpm` | `fakeroot`, `dpkg`, `lintian`, `rpm`, `unzip` |
| Windows | Inno Setup installer, portable `.zip` | `innosetup-compiler`, `tar` |
| macOS | `.dmg` | `hdiutil` |

`app.asar` contains `src/app` with its runtime dependencies. On Linux and Windows the Electron binary is hardened
with fuses before it is packaged (no `ELECTRON_RUN_AS_NODE`, no `NODE_OPTIONS`, no inspector arguments; the
application only loads from `app.asar`) and the result is read back. The _Build Desktop Installers_ workflow builds
all three platforms.

## Generated and ignored files

`src/web/js/fflate.mjs` and `protobuf.min.js` (vendored), `src/web/ui/dist` (user interface bundle), `build/` (web
part and installers), `test-results/`, `playwright-report/`, `junit*.xml` and the `*.log` files of the logger tests.
