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
packaging/arch          the Arch package that the releases have attached
packaging/aur-bin       the AUR package rakkomik-bin, which installs that package prebuilt
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
| `FsBridge` | file access of the engine: `mkdir`, `readFile`, `writeFile`, `rename`, `unlink`, `stat`, `readdir`, `access` (can a directory be read, entered and written into) |
| `FetchWindowManager` | hidden browser windows for pages that need a real browser, see [below](#requests-and-interstitials) |
| `HeaderSurgery` | request and response header rules, applied synchronously to every request |
| `SqliteBridge` | reads SQLite bookmark databases (imports of other downloaders) with `node:sqlite` |
| `PdfBridge` | prints the page of a novel chapter to a PDF document, in a window that can do nothing but show it (no scripts, no network) |
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
  `BookmarkManager`, `ChaptermarkManager`, `EbookGenerator` (CBZ, EPUB and the PDF of a novel), `Novel` (the text of
  a novel chapter), `Path` (the path functions of `node:path`, computed in the page).
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

## Downloads

`DownloadManager` keeps a queue per website and runs one job at a time for each of them (a worker looks at the queues
every 250 ms). A job leaves its queue when it starts, so the manager keeps the jobs that run as well (`jobs` lists both),
and the interface follows all of them through the `updated` events of the manager.

A download can be canceled: `cancel(job)` for one, `cancelChapter(chapter)` for the chapter that the user sees and
`cancelAll()` for every one (the jobs that wait go first, so that none of them starts when a job that runs gives its
place back). A job that waits is taken out of its queue; a job that runs stops the requests of its pages, which share
one `AbortSignal`, and gives its place back. The job gets the status `canceled`, which belongs to the job only: its
chapter goes back to what it was before (`available`, or `completed` when the files are already there), and the
interface drops the job from its lists. A job that is writing its pages cannot be canceled any more (`cancel` answers
`false`): the write cannot be stopped, and the chapter would show up on the disk although the job says that it was
canceled.

## Novels

A novel is text, so a chapter is never an image. A connector takes the text of a chapter from its page with
`Engine.Request.fetchNovel`: a hidden window loads the page, waits until the text stops changing and cleans it up
in the page (`serializeNovel` in `mjs/engine/Novel.mjs`). Paragraphs, headings, emphasis, quotes, lists and
illustrations stay; scripts, forms, advertisements, hidden text, links and every attribute go, so the result is
well-formed by construction. It is an XHTML fragment inside a `data:` URL, a *novel page*, which travels where a
page list holds image links: the download job fetches it like an image, and `Storage` stores it as an EPUB or a PDF
(setting *Novel File Format*), whatever the format of the chapters of comics is. The illustrations of the chapter
are downloaded with the request options of the connector; one that fails is left out and does not fail the chapter.

- **EPUB:** the text is `OEBPS/xhtml/chapter.xhtml`, the illustrations are in `OEBPS/img`. The reader finds a novel
  there and shows its text.
- **PDF:** the main process prints the chapter with Chromium (`printToPDF`): A5 pages, text that stays text, any writing
  system the fonts of the system cover. The illustrations are part of the page as `data:` URLs. The reader does not
  show a PDF yet.
- **Reader:** a novel page is shown as text in the colours of the setting *Light/Dark mode for Novels*; the zoom of the
  reader sets the size of the letters. The page is cleaned up once more before it is shown, because it can come from
  an EPUB of the user.
- **Files:** a novel has the extension of its own format, so a chapter counts as downloaded when the directory of the
  manga holds its file in the chapter format or in the novel format (`Chapter.file.novel`), and the files of a
  downloaded chapter are looked up the same way (`Storage._downloadedChapterPath`).

## Delivery and updates of the web part

- **Development:** `pnpm start` points the cache directory at `./src/web`; nothing is downloaded.
- **Release:** `pnpm run build:web` assembles `build/web` (a copy of the static tree, the built user interface and a
  generated `mjs/VersionInfo.mjs`). `deploy-web.js` zips it, signs the archive with the private key and uploads it
  to a rolling GitHub release per channel (see [releasing](releasing.md#web-part)).
- **Client:** the update URL points at the `latest` asset of that release. It names the archive and its signature;
  the application checks the signature against the public key in `src/app/Configuration.js` before it extracts the
  archive over the cache directory.
- **Packaged applications** (the Arch package and every installer) ship the web part in the folder `web` next to
  `app.asar` (`build:web` runs before the packagers do). It is only the first content of the cache: when the cache
  directory has no `index.html` yet, `App` copies the folder into it (`CacheDirectoryManager.seedFrom`, the folder is
  found by `Configuration.bundledWebDirectory`), so the first start works without a network. The cache is what the
  updates replace from then on, as for every other start. The copy has no `version`, so the first update that is
  found replaces it. A cache that has a web part is never overwritten by the folder, also not by that of a newer
  installer: the updates keep it up to date. Development (`electron .`) has no `app.asar` and no folder.

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

**A check that a connector runs itself.** Lunar makes a visitor pass a Cloudflare Turnstile widget before it hands out
the images of a chapter. The connector runs the widget with `Engine.Request.fetchBrowser` and the preferences
`{ webSecurity: true, images: true, show: true }`. The widget does not finish in a hidden window, nor with the images
or the web security of the window off, so `preferences.show` has `FetchWindowManager` show the window (`showInactive`:
the focus stays where it is) while the script runs. The window loads a plain document of the site, its
`manifest.json`, and not a page: the pages of that site take such a window for a browser with a blocked extension,
show a page of their own and close the window. For the same reason the connector does not load the home page to get
going (`_initializeConnector` does nothing).

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
- The main window has `webSecurity` off: connectors fetch other sites directly from the page, which needs it. The
  windows that load the pages of the sites (`FetchWindowManager`) have it on, as a browser does: the check of
  Cloudflare does not finish and some pages stay blank without it. A job turns it off with
  `preferences.webSecurity: false` (`Request.fetchUI`, 5th argument).
- The Electron binaries of the Linux and Windows installers are hardened with fuses (see
  [development](development.md#building-the-installers)).
