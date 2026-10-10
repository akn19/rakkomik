# Continuous integration and releases

## Workflows

| Workflow | Runs on | What it does |
|---|---|---|
| `ci-pr.yml` | pull requests | lint, deprecated dependency check, web build and unit tests on Windows, Linux and macOS; a [git-cliff](https://git-cliff.org) preview of the changes since the last release in the job summary |
| `build-app.yml` | pushes to `main` and `*.*.*` branches, by hand, and `release.yml` | builds the web part and the installers of the three platforms and uploads them as artifacts (only the `.deb`, `.rpm`, `.exe`, `.zip` and `.dmg` files) |
| `continuous-deployment.yml` | pushes to `main` and `*.*.*` branches | publishes the web part (`pnpm run deploy:web`) |
| `release.yml` | tags `vX.Y.Z`, by hand | release notes, GitHub release, AUR package, installers attached to the release |
| `continuous-integration.yml` | nothing (switched off with `branches: DISABLED`) | an older push-triggered copy of the pull request checks |

CI installs pnpm 12 (`pnpm/action-setup`) and Node.js 24; no minor version is pinned.

## Releases

A release is a tag `vX.Y.Z` (no suffix: the number becomes the AUR `pkgver`) whose number equals the `version` of
`package.json` **and** `src/app/package.json`. To release:

1. set both versions, commit, and push the commit;
2. tag it (`git tag vX.Y.Z && git push origin vX.Y.Z`).

`release.yml` then

1. checks the tag against both versions;
2. writes the release notes with git-cliff from the conventional commit messages since the previous `v` tag
   (`cliff.toml`; groups: features, bug fixes, performance, refactoring, documentation, build/CI/tests, maintenance;
   commits that are not conventional are left out);
3. creates the GitHub release with those notes (or updates it) and marks it as the latest release, which the rolling
   `web-<channel>` releases of the web part must not take over;
4. publishes [the AUR package](#aur-package);
5. builds the installers of Windows, Linux and macOS from the tag (it calls `build-app.yml`, so the matrix of three
   runners is that workflow's) and, when all three succeeded, attaches them to the release: `.exe` and `.zip` for
   Windows, `.deb` and `.rpm` for Linux, `.dmg` for macOS, each for x86-64 and ARM64.

The installers carry the web part and do not depend on the [web part release](#web-part), so a release is complete
without it. They carry the version of `package.json` in their names and metadata, which equals the tag.

Start the workflow by hand with an existing tag to publish it again (the assets are replaced). Preview the notes locally with
`git cliff --unreleased` (what the next release will contain) or `git cliff --latest` (the newest tag); install
git-cliff from your distribution or run `pnpm dlx git-cliff`.

## Web part

`continuous-deployment.yml` runs `pnpm run deploy:web` on every push to `main` or to a `*.*.*` branch:

- the **channel** is the branch name (slashes become `-`); `CHANNEL=<name>` sets it for a manual run;
- `build/web` is zipped as `<TIMESTAMP>.zip`, the archive is signed with the private key and the meta file `latest`
  is written (`<archive>?signature=<signature>`);
- both files are uploaded to the rolling GitHub release `web-<channel>` (created on first use), so
  `https://github.com/<owner>/<repo>/releases/download/web-<channel>/latest` always names the newest archive. That
  URL is the default update URL of the application (`main` channel).

The private key must belong to the public key in `src/app/Configuration.js`; an archive that does not verify is
rejected by the application.

## AUR package

`packaging/aur` holds the package of the [AUR](https://aur.archlinux.org):

- `PKGBUILD` builds from the git tag (`git+https://github.com/akn19/rakkomik.git#tag=v$pkgver`) and the package is
  self-contained: `app.asar` (the shell `src/app`) and the web part (`build/web`, built from the same tag) are
  installed in `/usr/lib/rakkomik`, next to the icons and the desktop entry. The build needs network access (pnpm).
- `rakkomik.sh` is the launcher (`/usr/bin/rakkomik`); it starts the system Electron with `app.asar`. The application
  finds the `web` folder next to it, uses it as its cache directory and does not update it (see
  [architecture](architecture.md#delivery-and-updates-of-the-web-part)), so a new version of the package is what
  updates the web part. The AUR package therefore does not depend on the web part release or on its signing key.
- The package runs on the system `electron` package and so follows Arch's Electron releases; no Electron version is
  pinned. Keep the application compatible with the current Electron.
- `rakkomik.desktop` is the desktop entry.
- Three environment variables serve local builds and leave the release alone: `RAKKOMIK_SOURCE` replaces the git
  source, `RAKKOMIK_BRANCH` the branch name that the About dialog shows (`v$pkgver` otherwise) and
  `RAKKOMIK_PNPM_STORE` the store of pnpm.

`release.yml` sets `pkgver` from the tag, lets the deploy action fill in the checksums of the local files
(`updpkgsums`), build the package once in a clean Arch container (`makepkg --syncdeps`) and push the files and the
generated `.SRCINFO` to `ssh://aur@aur.archlinux.org/rakkomik.git`. The first push creates the package when the name
is free.

**Build the package locally** with `pnpm run build:arch`, see [development](development.md#building-the-arch-package).
It runs this `PKGBUILD` on a copy of the working tree. Check the result with `namcap build/rakkomik-*.pkg.tar.zst`:
"Dependency included, but may not be needed ('electron')" is the only warning to expect.

## Secrets

Repository settings, _Secrets and variables_, _Actions_:

| Secret | Used by | Content |
|---|---|---|
| `RAKKOMIK_PRIVATE_KEY` | `continuous-deployment.yml` | PEM private key that signs the web part |
| `RAKKOMIK_PASSPHRASE` | `continuous-deployment.yml` | passphrase of that key |
| `AUR_SSH_PRIVATE_KEY` | `release.yml` | private SSH key whose public half is added to the AUR account |

`GITHUB_TOKEN` is provided by the runner. Third-party actions are used with their major version (`@v4`);
`KSXGitHub/github-actions-deploy-aur` receives the AUR key, so pin it to a commit if you want that stricter.

## When a release fails

- _version does not match the tag_: set `version` in `package.json` and `src/app/package.json`, move the tag
  (`git tag -f`, `git push -f origin vX.Y.Z`) or release the next number.
- _AUR job fails in `makepkg`_: reproduce it with `pnpm run build:arch`; the log of the action shows the build output.
- _AUR push is rejected_: the key is not registered in the AUR account, or the package belongs to another account.
- _an installer job fails_: the log shows the packager; re-run the failed job, and _Attach the installers_ runs once
  all three platforms succeeded. Reproduce a package locally with `pnpm run build:win`, `pnpm run build:mac` or
  `pnpm run build:app`, see [development](development.md#building-the-installers).
