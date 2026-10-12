/**
 * Writes the version of a release into `package.json` and `src/app/package.json`, the two files that the application
 * takes its version from: the installers carry the first in their names and metadata, and the shell in app.asar the
 * second. The version of a release is its tag, so it is not typed twice: the workflows run this on the checkout of a
 * tag before they build, and the PKGBUILD of the AUR package does the same.
 *
 *   node scripts/set-version.js v1.2.3      (the tag, or just 1.2.3)
 *   node scripts/set-version.js --if-newer v1.2.3
 *
 * `--if-newer` leaves the files alone when their version is the number of the tag or a greater one. release.yml uses it
 * to bring the files in the repository up to the release, which must not take them back when an old tag is published
 * again. The files in the repository keep the version of the last release: it is what a build without a tag (a local
 * one, or a run from the Actions tab on a branch) carries.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const FILES = ['package.json', path.join('src', 'app', 'package.json')];
// the number of a release, as release.yml accepts it for a tag: no suffix, it also becomes the AUR `pkgver`
const RELEASE = /^v?(\d+\.\d+\.\d+)$/;
const NUMBER = /^(\d+)\.(\d+)\.(\d+)$/;
// The member of the file itself. What is nested lies deeper, so it is the first line with this indentation. Only the
// number is replaced: the rest of the file, its line breaks included, stays as it is.
const VERSION = /^( {2}"version"\s*:\s*")[^"]*(")/m;

// whether the number `version` is greater than the number `current`: 1.10.0 is greater than 1.9.0
function isNewer(version, current) {
    const [wanted, existing] = [version, current].map((number) =>
        NUMBER.exec(number).slice(1).map(Number),
    );
    const differing = wanted.findIndex((part, index) => part !== existing[index]);
    return differing >= 0 && wanted[differing] > existing[differing];
}

/**
 * @param {string} tag the tag of a release (`v1.2.3`), or the number alone
 * @param {object} [options]
 * @param {string} [options.root] the project
 * @param {boolean} [options.ifNewer] leave the files as they are when their version is not older than the tag (a
 *   version that is no number of the form X.Y.Z is older than any)
 * @returns {string|null} the version that the files have now, or null when they were left alone
 */
function setVersion(tag, { root = ROOT, ifNewer = false } = {}) {
    const match = RELEASE.exec(tag);
    if (!match) {
        throw new Error(`"${tag}" is not the tag of a release, which is of the form vX.Y.Z!`);
    }
    const version = match[1];
    if (ifNewer) {
        const { version: current } = JSON.parse(fs.readFileSync(path.join(root, FILES[0]), 'utf8'));
        if (NUMBER.test(current) && !isNewer(version, current)) {
            return null;
        }
    }
    // everything is read and checked before anything is written, so that a file that cannot be changed leaves both as they were
    const changes = FILES.map((file) => {
        const target = path.join(root, file);
        const text = fs.readFileSync(target, 'utf8');
        if (!VERSION.test(text)) {
            throw new Error(`"${file}" has no "version" to set!`);
        }
        const changed = text.replace(VERSION, (member, before, after) => before + version + after);
        if (JSON.parse(changed).version !== version) {
            throw new Error(`The version of "${file}" could not be set to ${version}!`);
        }
        return { file, target, changed };
    });
    for (const { target, changed } of changes) {
        fs.writeFileSync(target, changed);
    }
    return version;
}

function main(args = process.argv.slice(2)) {
    const ifNewer = args.includes('--if-newer');
    const tags = args.filter((arg) => arg !== '--if-newer');
    if (tags.length !== 1) {
        throw new Error('Usage: node scripts/set-version.js [--if-newer] <tag>, e.g. v1.2.3');
    }
    const version = setVersion(tags[0], { ifNewer });
    console.log(
        version === null
            ? `The version stays as it is: ${tags[0]} is not newer than the version of ${FILES[0]}.`
            : `Set the version to ${version} in ${FILES.join(' and ')}.`,
    );
}

module.exports = { setVersion, main };

if (require.main === module) {
    try {
        main();
    } catch (error) {
        console.error(error.message);
        process.exit(1);
    }
}
