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
| `pnpm run lint` | oxlint over the application, the engine, the user interface, the scripts and the end-to-end tests |
| `pnpm run test` | unit tests (Vitest: the projects `app` and `web`) |
| `pnpm run test:e2e` | build the web part and run the tests of the real application (Playwright, project `ui`) |
| `pnpm run test:e2e:sites` | connectors against their real websites, see [adding a website](connectors.md#testing) |
| `pnpm run knip` | unused files, exports and dependencies |
| `pnpm run check:deprecated` | fails when a dependency (at its installed version) is deprecated; needs network |
| `pnpm run build:web` | the web part in `build/web` |
| `pnpm run build:app` | the web part, then the installers of the current platform, see [below](#building-the-installers) |
| `pnpm run build:win` | the web part, then the Windows packages (on Linux and macOS only the portable `.zip`) |
| `pnpm run build:mac` | the web part, then the macOS `.dmg` files (macOS only) |
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
  (a check that completes on its own, one that needs a click, one that never completes). A test that changes files
  under a running window uses the `isolatedApp` fixture: an application of its own on its own copy of the web
  directory (see the test _replaced web part_).
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

`pnpm run build:app` builds the web part and then the installers of the platform it runs on, from the Electron version
that is installed. `pnpm run build:win` and `pnpm run build:mac` name the platform instead, and
`node build-app.js <windows|linux|macos>` does the same without building the web part. Every output is x86-64 and
ARM64, named with the version of `package.json`:

| Platform | Output | Needs | Built on |
|---|---|---|---|
| Linux | `.deb`, `.rpm` | `fakeroot`, `dpkg`, `lintian`, `rpm`, `unzip` | Linux |
| Windows | Inno Setup installer, portable `.zip` | `innosetup-compiler` (installer), `bsdtar` or `tar` (zip) | the installer on Windows, the zip on any host with `bsdtar` |
| macOS | `.dmg` | `hdiutil`, `codesign` | macOS |

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

## Building the Arch package

`pnpm run build:arch` builds `build/rakkomik-<version>-1-any.pkg.tar.zst`. Install it with
`sudo pacman -U build/rakkomik-*.pkg.tar.zst` and remove it with `sudo pacman -R rakkomik`. It needs `makepkg`
(`base-devel`), `git`, `node` and `pnpm` on the `PATH`; the last two do not have to be pacman packages.

`scripts/build-arch.sh` copies the working tree, uncommitted changes included, into a throwaway git checkout and runs
the `PKGBUILD` of the AUR package (`packaging/aur`) on it, with `RAKKOMIK_SOURCE` in place of the release tag. So the
package built here is the package the AUR delivers. It reuses the pnpm store of the project, which makes a build take
about half a minute once the dependencies have been downloaded. The package holds the Electron shell and the web part
and runs on the system `electron`, see [releasing](releasing.md#aur-package).

## Generated and ignored files

`src/web/js/fflate.mjs` and `protobuf.min.js` (vendored), `src/web/ui/dist` (user interface bundle), `build/` (web
part, installers and the Arch package), `test-results/`, `playwright-report/`, `junit*.xml` and the `*.log` files of the logger tests.
