<p align="center"><img src="assets/icon.svg" alt="RakKomik" width="96"></p>

# RakKomik

RakKomik is a cross-platform desktop downloader for manga and comics from various websites.
It was made to help users download media for circumstances that require offline usage.
The philosophy is ad-hoc consumption: get it when you are going to read it.
It is not meant to be a mass downloader to stock up thousands of chapters that will probably never be read.

> **RakKomik is a fork of [HakuNeko](https://github.com/manga-download/hakuneko).**
> See [About this fork](#about-this-fork).

## Contents

- [Features](#features)
- [Installation](#installation)
- [Usage](#usage)
- [Settings](#settings)
- [Command line options](#command-line-options)
- [Data locations](#data-locations)
- [Documentation](#documentation)
- [About this fork](#about-this-fork)
- [License](#license)

## Features

- Browse the manga lists of around a thousand website connectors and filter them by tag or language.
- Download chapters as a folder of images, a comic book archive (`.cbz`) or an ebook (`.epub`).
- Download queue, bookmarks and chapter marks, a built-in chapter preview and reader, light and dark theme.
- Add a manga by link: paste the link of a manga or chapter, or open a local folder as a source.
- Pages that sit behind an anti-bot check are loaded like in a browser: in a hidden window that is shown to you
  when the check needs your interaction or does not finish on its own.
- Optional proxy, a command that runs after every downloaded chapter and Discord activity.

## Installation

**Arch Linux:** every tagged release is published to the [AUR](https://aur.archlinux.org) as `rakkomik`
(`yay -S rakkomik`, or any other AUR helper). The package runs on the system `electron` package.

**Other platforms:** installers (`.deb`, `.rpm`, `.exe`, portable `.zip`, `.dmg`) are built by the
_Build Desktop Installers_ workflow and are available as artifacts of its runs. They can also be built locally,
see [Building the installers](docs/development.md#building-the-installers).

The application itself is small: it stores its web part (engine, connectors and user interface) in a cache
directory and updates it from the [update URL](#command-line-options) when it starts.

## Usage

1. Select a website (the _connector_); use the filters to narrow the list down.
2. Click the refresh button to load the manga list of the website. This can take a few minutes the first time;
   the list is kept for the next start.
3. Find a manga and select it, optionally filter its chapters by language.
4. Select the chapters and download them. The _Downloads_ page shows the queue and its progress,
   _Bookmarks_ keeps your favorites.

Websites that do not provide a manga list (the message says so) work with a link: copy the link of the manga or
chapter and paste it with the clipboard connector. The folder connector shows files that are already on your disk.

## Settings

The settings are in the menu. The most important ones:

| Setting | Meaning |
|---|---|
| Manga Directory | Where the downloaded chapters are stored |
| Bookmarks Directory | Where bookmarks and chapter marks are stored (not available in portable mode) |
| Use Sub-Directories | One sub-directory per website inside the manga directory |
| Chapter File Format | Folder with images, comic book archive (`.cbz`) or ebook (`.epub`) |
| Chapter Title Format | Name template of a chapter with the placeholders `%C%` `%M%` `%VOL%` `%CH%` `%T%` `%O%` |
| Ignore errors on download | Treat a chapter as downloaded even if some of its images failed |
| Disable Concurrent Downloads | Download media one after another instead of concurrently (slow connections, frequent failures) |
| Proxy Rules, Proxy Authentication | Route the requests through a proxy |
| Post Command | Command that runs after a chapter is downloaded, with the placeholders `%PATH%` `%C%` `%M%` `%O%` |
| Discord Presence | Show what you are reading as Discord activity |

## Command line options

```text
rakkomik [OPTIONS]

-u, --update-url=<URL>        URL that is checked for updates of the web part
                              (default: https://github.com/akn19/rakkomik/releases/download/web-master/latest;
                              an unusable value such as DISABLED turns the update off)
--startup-url=<URL>           entry point of the web part (default: hakuneko://cache/index.html)
-c, --cache-directory=<DIR>   directory where the web part is stored
--user-directory=<DIR>        directory where settings, bookmarks and lists are stored
```

## Data locations

| | Linux | macOS | Windows |
|---|---|---|---|
| Cache (web part) | `~/.cache/rakkomik` | `~/Library/Caches/rakkomik` | `%LOCALAPPDATA%\rakkomik\cache` |
| User data | `~/.config/rakkomik` | `~/Library/Application Support/rakkomik` | `%APPDATA%\rakkomik` |

**Portable mode:** a file named like the executable plus `.portable` next to it (for example
`rakkomik.exe.portable`) keeps everything next to the executable, in the folders `cache` and `userdata`.

**User connectors:** every connector module in `<user data>/rakkomik.plugins` is loaded before the bundled
ones and wins when an ID is used twice.

The settings, bookmarks, chapter marks and manga lists in the user data folder are the files `hakuneko.settings`,
`hakuneko.bookmarks`, `hakuneko.chaptermarks` and `hakuneko.mangas.<connector>`.

## Documentation

The technical documentation is in [`docs`](docs):

- [Architecture](docs/architecture.md): main process, preload bridge, web part, updates, requests and interstitials
- [Adding a website](docs/connectors.md): how a connector is written, tested and given an icon
- [Development](docs/development.md): setup, commands, tests, dependencies, icons and building the installers
- [Continuous integration and releases](docs/releasing.md): workflows, releases, the web part, the AUR package, secrets

## About this fork

RakKomik started from the public-domain source code of [HakuNeko](https://github.com/manga-download/hakuneko),
the manga and anime downloader of the manga-download community. The engine (`src/web/mjs/engine`) and the website
connectors (`src/web/mjs/connectors`) are derived from that project, and its authors and contributors deserve the
credit for them. This fork modernizes the application around them (Electron, Node.js, pnpm, Vite, a React user
interface) and carries its own name, icon and release channel.

RakKomik is not affiliated with, endorsed by or supported by the HakuNeko project.
Some identifiers of the engine keep their historical names on purpose, for example the `hakuneko://`
URL scheme, the `window.hakuneko` bridge and the `hakuneko.*` data files, because the engine is kept as it is.

**Moving over from HakuNeko:** the data files have the same format. Copy the `hakuneko.*` files from the user data
folder of HakuNeko into the [user data folder](#data-locations) of RakKomik (it is a different folder, nothing is
moved automatically) to keep your settings, bookmarks and manga lists.

## License

[Unlicense](UNLICENSE) (public domain).
