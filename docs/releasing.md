# Continuous integration and releases

## Workflows

| Workflow | Runs on | What it does |
|---|---|---|
| `ci.yml` | pushes to `main` and `*.*.*` branches, pull requests | lint, deprecated dependency check and web build once (on Linux) and the unit tests on Linux, Windows and macOS. A push then [publishes the web part](#web-part); a pull request gets a [git-cliff](https://git-cliff.org) preview of the changes since the last release in its job summary |
| `security.yml` | pushes to `main`, pull requests, every Monday | CodeQL for the JavaScript and for the workflows, and a Trivy scan of the dependencies and of the files for secrets. The results are in the Security tab |
| `release.yml` | tags `vX.Y.Z`, by hand | release notes, GitHub release, installers attached to it; the AUR package when that is switched on |
| `build-app.yml` | `release.yml`, by hand | builds the installers of Windows, macOS and Linux and the package of Arch Linux, runs the end-to-end tests on the package of each runner (`pnpm run test:package`), and uploads the packages as artifacts (only the `.deb`, `.rpm`, `.exe`, `.zip`, `.dmg` and `.pkg.tar.zst` files) |

A push builds the web part and nothing else: **installers are built for tags only** (or by hand from the Actions tab,
to try the packagers). Nothing runs twice. The checks that are the same on every system run once, and the web part is
built once, by `ci.yml`, and handed to the job that publishes it. A release does not check the code again, `ci.yml` did
that when the commit was pushed, so tag a commit whose run is green. Changes that only touch Markdown files or `docs/`
start neither `ci.yml` nor `security.yml`. A newer push to a pull request cancels the older run.

The workflows install pnpm 12 (`pnpm/action-setup`) and Node.js 24; no minor version is pinned.

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
4. builds the installers from the tag (it calls `build-app.yml`: a runner of each of Windows, Linux and macOS, and the
   official Arch Linux image) and, when all of them succeeded, attaches them to the release: `.exe` and `.zip` for
   Windows, `.deb` and `.rpm` for Linux and `.dmg` for macOS, each for x86-64 and ARM64, and one `.pkg.tar.zst` for
   Arch Linux (the same package for every architecture, it runs on the `electron` package of the system);
5. publishes [the AUR package](#aur-package), once that is switched on.

The installers carry the web part and do not depend on the [web part release](#web-part), so a release is complete
without it. They carry the version of `package.json` in their names and metadata, which equals the tag.

Start the workflow by hand with an existing tag to publish it again (the assets are replaced). Preview the notes locally with
`git cliff --unreleased` (what the next release will contain) or `git cliff --latest` (the newest tag); install
git-cliff from your distribution or run `pnpm dlx git-cliff`.

## Web part

The job `publish-web` of `ci.yml` runs `node deploy-web.js` on every push to `main` or to a `*.*.*` branch, once the
checks have passed. It publishes the `build/web` that the job `check` built (`pnpm run deploy:web` builds the web part
and publishes it from a checkout):

- the **channel** is the branch name (slashes become `-`); `CHANNEL=<name>` sets it for a manual run;
- `build/web` is zipped as `<TIMESTAMP>.zip`, the archive is signed with the private key and the meta file `latest`
  is written (`<archive>?signature=<signature>`);
- both files are uploaded to the rolling GitHub release `web-<channel>` (created on first use), so
  `https://github.com/<owner>/<repo>/releases/download/web-<channel>/latest` always names the newest archive. That
  URL is the default update URL of the application (`main` channel).

The private key must belong to the public key in `src/app/Configuration.js`; an archive that does not verify is
rejected by the application.

### Signing key

The application extracts an archive only when its signature verifies against the public key in
`src/app/Configuration.js`. Whoever holds the private key can publish code to every application that updates its web
part, so the private key never goes into the repository, not even encrypted (git ignores `*.pem`, which is a safety
net and not a place to keep it). It lives in the secrets of the repository (see [secrets](#secrets)) and in a safe
place of its own: without it no update can be signed. The public key is public by design.

Create the pair outside of the working tree; the first command asks for the passphrase:

```sh
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:4096 -aes-256-cbc -out ~/rakkomik-update-key.pem
openssl pkey -in ~/rakkomik-update-key.pem -pubout
```

Put the output of the second command into `publicKey` in `src/app/Configuration.js` and update the fingerprint that
`Configuration.test.js` pins on purpose. Put the contents of the `.pem` file and its passphrase into the secrets
`RAKKOMIK_PRIVATE_KEY` and `RAKKOMIK_PASSPHRASE`. An application trusts the key it was built with: after a replacement,
applications built before it reject the archives with the new signature until they are replaced by another way.

## AUR package

Publishing to the AUR is **switched off** for now: the job `aur` of `release.yml` only runs when the repository variable
`PUBLISH_AUR` is `true` (Settings, Secrets and variables, Actions, Variables) and the secret `AUR_SSH_PRIVATE_KEY` is
set. The package is kept up to date and can be built locally, and every release has it attached as a `.pkg.tar.zst`
(`sudo pacman -U`), so Arch users do not have to wait for the AUR.

`packaging/aur` holds the package of the [AUR](https://aur.archlinux.org):

- `PKGBUILD` builds from the git tag (`git+https://github.com/akn19/rakkomik.git#tag=v$pkgver`) and the package is
  self-contained: `app.asar` (the shell `src/app`, packed by `scripts/pack-app.js` like the installers pack it) and the
  web part (`build/web`, built from the same tag) are installed in `/usr/lib/rakkomik`, next to the icons and the
  desktop entry. The build needs network access (pnpm).
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

When it is switched on, `release.yml` sets `pkgver` from the tag, lets the deploy action fill in the checksums of the local files
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
| `RAKKOMIK_PRIVATE_KEY` | `ci.yml` (job `publish-web`) | PEM private key that signs the web part |
| `RAKKOMIK_PASSPHRASE` | `ci.yml` (job `publish-web`) | passphrase of that key |
| `AUR_SSH_PRIVATE_KEY` | `release.yml` (job `aur`, switched off) | private SSH key whose public half is added to the AUR account |

The repository variable `PUBLISH_AUR` (`true`) switches the job `aur` on; it is off while the variable is not set.

`GITHUB_TOKEN` is provided by the runner. The actions are used with the newest major version (`@v7`, `@v8`, ...). Two
have no tag for a major version and are used with an exact one: `aquasecurity/trivy-action` (its releases are
immutable) and `KSXGitHub/github-actions-deploy-aur`, which receives the AUR key and is pinned to a commit.

## When a release fails

- _version does not match the tag_: set `version` in `package.json` and `src/app/package.json`, move the tag
  (`git tag -f`, `git push -f origin vX.Y.Z`) or release the next number.
- _AUR job fails in `makepkg`_ (the job runs only when it is switched on): reproduce it with `pnpm run build:arch`; the
  log of the action shows the build output.
- _AUR push is rejected_: the key is not registered in the AUR account, or the package belongs to another account.
- _an installer job fails_: the log shows the packager; re-run the failed job, and _Attach the installers_ runs once
  all platforms succeeded. Reproduce a package locally with `pnpm run build:win`, `pnpm run build:mac` or
  `pnpm run build:app`, see [development](development.md#building-the-installers).
