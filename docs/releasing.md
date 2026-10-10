# Continuous integration and releases

## Workflows

| Workflow | Runs on | What it does |
|---|---|---|
| `ci-pr.yml` | pull requests | lint, deprecated dependency check, web build and unit tests on Windows, Linux and macOS; a [git-cliff](https://git-cliff.org) preview of the changes since the last release in the job summary |
| `build-app.yml` | pushes to `master` and `*.*.*` branches, by hand | builds the installers of the three platforms and uploads them as artifacts |
| `continuous-deployment.yml` | pushes to `master` and `*.*.*` branches | publishes the web part (`pnpm run deploy:web`) |
| `release.yml` | tags `vX.Y.Z`, by hand | release notes, GitHub release, AUR package |
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
4. publishes [the AUR package](#aur-package).

Start the workflow by hand with an existing tag to publish it again. Preview the notes locally with
`git cliff --unreleased` (what the next release will contain) or `git cliff --latest` (the newest tag); install
git-cliff from your distribution or run `pnpm dlx git-cliff`.

## Web part

`continuous-deployment.yml` runs `pnpm run deploy:web` on every push to `master` or to a `*.*.*` branch:

- the **channel** is the branch name (slashes become `-`); `CHANNEL=<name>` sets it for a manual run;
- `build/web` is zipped as `<TIMESTAMP>.zip`, the archive is signed with the private key and the meta file `latest`
  is written (`<archive>?signature=<signature>`);
- both files are uploaded to the rolling GitHub release `web-<channel>` (created on first use), so
  `https://github.com/<owner>/<repo>/releases/download/web-<channel>/latest` always names the newest archive. That
  URL is the default update URL of the application (`master` channel).

The private key must belong to the public key in `src/app/Configuration.js`; an archive that does not verify is
rejected by the application.

## AUR package

`packaging/aur` holds the package of the [AUR](https://aur.archlinux.org):

- `PKGBUILD` builds from the git tag (`git+https://github.com/akn19/rakkomik.git#tag=v$pkgver`). Only the shell
  `src/app` is packaged (`app.asar` in `/usr/lib/rakkomik`); the web part comes from the application's own updater.
  Icons and the desktop entry are installed too.
- The package runs on the system `electron` package and so follows Arch's Electron releases; no Electron version is
  pinned. Keep the application compatible with the current Electron.
- `rakkomik.sh` is the launcher (`/usr/bin/rakkomik`) and `rakkomik.desktop` the desktop entry.

`release.yml` sets `pkgver` from the tag, lets the deploy action fill in the checksums of the local files
(`updpkgsums`), build the package once in a clean Arch container (`makepkg --syncdeps`) and push the files and the
generated `.SRCINFO` to `ssh://aur@aur.archlinux.org/rakkomik.git`. The first push creates the package when the name
is free.

**Test the package locally** (needs `makepkg`, the makedepends `git`, `nodejs` and `pnpm`, and network access):

```shell
cd packaging/aur
# point the source at a clone that has the tag, for example: git+file:///path/to/rakkomik#tag=v1.0.0
makepkg --force --syncdeps
namcap PKGBUILD rakkomik-*.pkg.tar.zst   # "Dependency included, but may not be needed ('electron')" is expected
```

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
- _AUR job fails in `makepkg`_: reproduce it with the local test above; the log of the action shows the build output.
- _AUR push is rejected_: the key is not registered in the AUR account, or the package belongs to another account.
