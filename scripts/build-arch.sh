#!/usr/bin/env bash
# Builds the Arch Linux package of the working tree, uncommitted changes included:
#
#   pnpm run build:arch                           ->  build/rakkomik-<version>-1-any.pkg.tar.zst
#   sudo pacman -U build/rakkomik-*.pkg.tar.zst   ->  installs it
#
# It runs the PKGBUILD of the AUR package (packaging/aur) on a snapshot of the working tree instead of the release
# tag, so the package built here is the package the AUR delivers. node and pnpm come from the PATH (they need not be
# pacman packages) and the pnpm store of the project is reused, so only the first build downloads the dependencies.
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$root"

for tool in makepkg git node pnpm; do
    if ! command -v "$tool" > /dev/null; then
        echo "build-arch: '$tool' is needed and was not found on the PATH." >&2
        exit 1
    fi
done

version=$(node -p "require('./package.json').version")
mkdir -p build
work=$(mktemp -d "$root/build/arch.XXXXXX")
trap 'rm -rf "$work"' EXIT

# The snapshot is a git checkout, because makepkg takes the source from a repository and the build of the web part
# reads the revision from it: the last commit, with the changes since then copied over it.
echo "build-arch: copying the working tree"
git clone --quiet "$root" "$work/source"
changed="$work/changed.list"
{
    git diff HEAD --no-renames --name-only --diff-filter=d -z
    git ls-files --others --exclude-standard -z
} > "$changed"
if [ -s "$changed" ]; then
    tar --null --files-from="$changed" --create --file=- | tar --directory="$work/source" --extract --file=-
fi
git diff HEAD --no-renames --name-only --diff-filter=D -z | while IFS= read -r -d '' file; do
    rm -f -- "$work/source/$file"
done
git -C "$work/source" add --all
if ! git -C "$work/source" diff --cached --quiet; then
    git -C "$work/source" -c user.name=rakkomik -c user.email=rakkomik@localhost -c commit.gpgSign=false \
        commit --quiet --message 'Uncommitted changes of the working tree'
    echo "build-arch: the package includes the uncommitted changes of the working tree"
fi
commit=$(git -C "$work/source" rev-parse HEAD)

package="$work/package"
mkdir "$package"
cp packaging/aur/PKGBUILD packaging/aur/rakkomik.sh packaging/aur/rakkomik.desktop "$package/"
sed -i "s/^pkgver=.*/pkgver=$version/" "$package/PKGBUILD"

# --nodeps: the makedepends (git, nodejs and pnpm) are checked above as commands, not as pacman packages
echo "build-arch: running makepkg"
export RAKKOMIK_SOURCE="git+file://$work/source#commit=$commit"
RAKKOMIK_BRANCH=$(git branch --show-current)
export RAKKOMIK_BRANCH="${RAKKOMIK_BRANCH:-HEAD}"
RAKKOMIK_PNPM_STORE=$(pnpm store path 2> /dev/null || true)
export RAKKOMIK_PNPM_STORE
export PKGDEST="$root/build" BUILDDIR="$work/build" SRCDEST="$work/sources"
cd "$package"
makepkg --force --nodeps --noconfirm

echo
echo "build-arch: built $(makepkg --packagelist)"
echo "build-arch: install it with: sudo pacman -U $(makepkg --packagelist)"
