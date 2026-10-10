# Architecture

RakKomik is an Electron application in three layers: a small **main process** (`src/app`), a **preload bridge**,
and the **web part** (`src/web`) with the engine, the website connectors and the user interface. The web part is
not inside the installer: the application keeps it in a cache directory and updates it when it starts.

## Repository layout

```text
src/app                 Electron main process (CommonJS) and the preload bridge
src/web/index.html      starts the engine and mounts the user interface
src/web/mjs/engine      the engine: connector base class, requests, downloads, storage, settings, bookmarks
src/web/mjs/connectors  one module per website; templates/ for families of sites, system/ for built-in sources
src/web/ui              React user interface (bundled by Vite into ui/dist)
src/web/img             connector icons (img/connectors) and logos
src/__tests__           end-to-end tests (Playwright); unit tests live next to the code in __tests__ folders
redist                  packaging skeletons and installer images
packaging/aur           the AUR package
scripts                 icon generator, dependency gate, vendoring of browser builds, PE resources
assets/icon.svg         the logo; every icon is generated from it
```

## Main process (`src/app`)

`main.js` creates `App`, which runs this sequence:

1. read the options of the [command line](../README.md#command-line-options) (`CommandlineArgumentExtractor`);
2. pick the configuration: `Configuration` in portable mode, otherwise `ConfigurationLinux`, `ConfigurationDarwin`
   or `ConfigurationWindows` (directories, update URL, startup URL, public key of the updates);
3. `ElectronBootstrap.launch()`: register the URL schemes, align the user agent, install the header rules and open
   the window with a "Checking for Update" page;
4. `Updater.updateCache()`: fetch the update (`UpdateServerManager`), verify its signature and extract it into the
   cache directory (`CacheDirectoryManager`); an unusable update URL such as `DISABLED` turns this step off;
5. load the startup URL into the window.

| Module | Job |
|---|---|
| `ElectronBootstrap` | window, tray, local hotkeys, URL schemes, header rule hooks, renderer bootstrap values |
| `IpcBridge` | dialogs, shell, clipboard, window controls, cookies, proxy, post-download commands |
| `FsBridge` | file access of the engine: `mkdir`, `readFile`, `writeFile`, `rename`, `unlink`, `stat`, `readdir` |
| `FetchWindowManager` | hidden browser windows for pages that need a real browser, see [below](#requests-and-interstitials) |
| `HeaderSurgery` | request and response header rules, applied synchronously to every request |
| `SqliteBridge` | reads SQLite bookmark databases (imports of other downloaders) with `node:sqlite` |
| `DiscordBridge` | Discord activity over the local Discord client |
| `Logger` | file and console loggers |

The calls of the bridge are `ipcMain.handle` channels named `rakkomik:...`; nothing blocks the renderer.

## Preload bridge

`preload.js` runs sandboxed and exposes the modules above to the page as `window.hakuneko` (see
[names that come from the engine](#names-that-come-from-the-engine)). The values the page needs at start
(platform, portable flag, temp directory, application paths) are computed once by `ElectronBootstrap` and handed
over with the window through `additionalArguments`, so no call on the bridge is synchronous.

## URL schemes

- `hakuneko://cache/...` serves the cache directory (a folder answers with a JSON listing, the MIME type follows the
  file extension) and `hakuneko://plugins/...` the folder of the user's own connectors.
- `connector://<id>?payload=...` serves images that need a connector's own request settings: the main process asks
  the page, which resolves the link with `Connector.handleConnectorURI`.

## The web part

`src/web/index.html` creates the engine (`window.HakuNeko`, aliased as `Engine`), loads the settings and mounts the
React user interface. The website connectors load in the background afterwards, in parallel batches.

- **Engine** (`mjs/engine`): `Connector` (the base class every website extends), `Connectors` (discovery and
  registration), `Request` (all network access), `DownloadManager`/`DownloadJob`, `Storage`, `Settings`,
  `BookmarkManager`, `ChaptermarkManager`, `EbookGenerator` (CBZ and EPUB), `Path` (the path functions of
  `node:path`, computed in the page).
- **Connectors** (`mjs/connectors`): every `*.mjs` file of that folder is listed at runtime and imported
  individually, so connectors and engine share the same module instances by URL. Connectors in the user's plugin
  folder are registered first; when an ID is used twice the first one wins.
- **User interface** (`ui`): React with TanStack Router and Query, Tailwind, Lucide icons. It talks to the engine
  through `ui/engine.js` and reads its colours from the theme tokens in `ui/index.css`. During a manga list update it
  samples `Connector.updateProgress` (the requests the fetch helpers completed since the update started) twice a
  second and shows the count, the elapsed time and a bar in the status line and on the connector cards.
  The interface is one bundle (`ui/dist/ui.js` and `ui.css`) and its views are not lazy chunks. The files come from
  local disk, so splitting saves nothing, and a window that is already open must not need a file from `ui/dist`: the
  web part can be replaced under it by a rebuild or by the update of another running instance (the updater removes
  the whole cache directory and extracts the archive again, and nothing limits the application to one instance).
  Chunks have hashed names, so the open window would ask for files that are gone and its views would fail with
  "Failed to fetch dynamically imported module".

Writes are atomic: a file is written next to its target and renamed over it.

## Delivery and updates of the web part

- **Development:** `pnpm start` points the cache directory at `./src/web`; nothing is downloaded.
- **Release:** `pnpm run build:web` assembles `build/web` (a copy of the static tree, the built user interface and a
  generated `mjs/VersionInfo.mjs`). `deploy-web.js` zips it, signs the archive with the private key and uploads it
  to a rolling GitHub release per channel (see [releasing](releasing.md#web-part)).
- **Client:** the update URL points at the `latest` asset of that release. It names the archive and its signature;
  the application checks the signature against the public key in `src/app/Configuration.js` before it extracts the
  archive over the cache directory.
- **Packaged applications** (the Arch package and every installer) ship the web part in the folder `web` next to
  `app.asar` (`build:web` runs before the packagers do). When that folder has an `index.html`, the application uses it
  as its cache directory and leaves the update off (`Configuration.bundledWebDirectory`, applied in `App`); a
  `--cache-directory` or `--update-url` on the command line wins, each on its own. Development (`electron .`) has no
  `app.asar`, so it is not affected. Such an application does not depend on the web part release or its signing key;
  a new version of the package or installer is what updates the web part.

## Requests and interstitials

Connectors fetch with the global `fetch()`. The main process adjusts the requests (`HeaderSurgery`):

- request headers prefixed with `x-` (`x-host`, `x-user-agent`, `x-referer`, `x-origin`, `x-cookie`, `x-sec-fetch-*`,
  `x-sec-ch-ua`) become the real headers, which the browser would refuse to set from a page;
- DevTools headers are dropped, requests revalidate (`Cache-Control: no-cache`) and image URLs get an image `Accept`;
- `Set-Cookie` headers are rewritten to `SameSite=None`, so cookies set by a site are sent with cross-site requests
  from the page; `X-Redirect` becomes `Location`.

One user agent is used for everything (the page, the hidden windows, the header rules): Chromium's own, without the
Electron and application product tokens. Cookies that a site grants after a check belong to that user agent.

**Interstitials.** Some sites answer with a page that first checks the visitor (a Cloudflare or DDoS-Guard page, a
captcha gate). `engine/AntiScraping.mjs` recognizes such an answer (the `cf-mitigated` header, or server, status and
body together) and hands the origin to a hidden browser window (`Request.fetchUI`, `FetchWindowManager`). The site's
own script completes the check there, the cookies it grants are shared with the page, and the request is sent once
more. One window serves all concurrent requests to an origin. A detector that runs inside the page classifies what
the window shows:

| Page | The window |
|---|---|
| the content | the job's script runs and the window closes |
| a check that completes on its own | waits for the next load; shown to the user after `interactiveAfter` (15 s) |
| a check that needs a person (captcha) | shown at once; the user has `interactiveTimeout` (180 s) |
| a refusal (blocked, error page) | the request fails with a clear message |

A response that is still an interstitial afterwards makes `fetchDOM` throw "The anti-bot check ... could not be
completed". The three times are properties of `Engine.Request` (`interactiveAfter`, `interactiveTimeout`,
`challengeTimeout`). Nothing solves captchas automatically. In a shown window `F12` opens the developer tools,
`Shift+C` copies the URL and `Shift+V` loads the URL from the clipboard.

## Names that come from the engine

A few identifiers keep their historical name because the engine (`src/web/mjs`) uses them. Keep them when you work
on the code around them; they change together with the engine or not at all.

| Name | Where it appears | Why |
|---|---|---|
| `hakuneko://` URL scheme | `src/app/Configuration.js`, `ElectronBootstrap`, tests | `engine/Connectors.mjs` imports connectors and plugins over it |
| `window.hakuneko` | `src/app/preload.js`, `src/web/ui`, `index.html` | engine modules use the bridge under this name |
| `env.HAKUNEKO_PORTABLE` | `ElectronBootstrap._rendererBootstrap` | `engine/Settings.mjs` reads the portable flag from the bridge |
| `HakuNeko` global and `mjs/HakuNeko.mjs` | `index.html`, `.oxlintrc.json`, `knip.json` | entry point and global of the engine |
| `hakuneko.*` files, `hakuneko` temp folder | `engine/Storage.mjs`, end-to-end fixtures | names of the settings, bookmark and list files on disk |

## Security notes

- The main window has `contextIsolation` on and `nodeIntegration` off; the preload is sandboxed and exposes only the
  bridge. Hidden windows run without Node integration.
- The main window has `webSecurity` off: connectors fetch other sites directly from the page, which needs it.
- The Electron binaries of the Linux and Windows installers are hardened with fuses (see
  [development](development.md#building-the-installers)).
