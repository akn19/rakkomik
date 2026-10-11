/**
 * Packs the shell of the application (`src/app`) into an `app.asar` that holds what the application loads at run time,
 * and nothing else: its own sources with `package.json`, and the runtime dependencies as the real `node_modules` tree
 * that `nodeLinker: hoisted` makes. Left out are the unit tests and their logs, the files of pnpm (lock, workspace,
 * `.bin`, `.pnpm`, `.modules.yaml`) and what the packages ship for their developers: typings, source maps, TypeScript
 * sources, documentation, tests, examples, benchmarks and the configuration of their tools. The licence files of the
 * packages stay, as their licences ask.
 *
 * build-app.js packs every installer with it, and the PKGBUILD of the Arch package runs it as a command:
 *   node scripts/pack-app.js <source> <app.asar>
 */
const fs = require('node:fs');
const path = require('node:path');
const asar = require('@electron/asar');

// the names of the directories of a package that only its developers need (anywhere below `node_modules`)
const DEVELOPMENT_DIRECTORIES = new Set([
    'test', 'tests', '__tests__', '__mocks__', 'spec', 'specs', 'example', 'examples', 'benchmark', 'benchmarks', 'doc', 'docs', 'coverage'
]);
// the files of a package that only its developers need: typings, source maps, TypeScript sources, documentation, tool
// configuration (a `tsconfig.json` or a `.yml` of CI); everything else, the JSON and WASM files of a package included, is kept
const DEVELOPMENT_FILES = [
    /\.d\.[cm]?ts$/i, /\.[cm]?ts$/i, /\.map$/i, /\.tsbuildinfo$/i, /\.(md|markdown)$/i, /\.ya?ml$/i, /\.log$/i,
    /^(README|CHANGELOG|CHANGES|HISTORY|CONTRIBUTING|CODE_OF_CONDUCT|SECURITY|GOVERNANCE)(\.|$)/i, /^tsconfig(\..*)?\.json$/i
];
const LICENSE_FILE = /^(LICEN[CS]E|COPYING|NOTICE)(\.|$)/i;

/**
 * Whether a file or a directory of the sources is loaded by the application.
 * @param {string} relative path below the sources, with `/`
 * @param {boolean} directory
 */
function isShipped(relative, directory) {
    const parts = relative.split('/');
    const name = parts[parts.length - 1];
    // nothing hidden is loaded: the files of pnpm in node_modules, `.github` and the tool configuration of a package
    if(name.startsWith('.')) {
        return false;
    }
    if(parts[0] === 'node_modules') {
        if(directory) {
            return !DEVELOPMENT_DIRECTORIES.has(name);
        }
        // the licence of a package stays, whatever its extension: its licence asks for it
        return LICENSE_FILE.test(name) || !DEVELOPMENT_FILES.some(pattern => pattern.test(name));
    }
    // the sources of the shell: its unit tests and their logs are not part of the application, nor are the files of pnpm
    if(directory) {
        return name !== '__tests__';
    }
    return !/\.log$/i.test(name) && name !== 'pnpm-lock.yaml' && name !== 'pnpm-workspace.yaml';
}

/**
 * The files and directories of the sources that the application loads, as paths that start with `source` and in the
 * order that asar expects (sorted, a directory before its content).
 * @param {string} source
 * @returns {{ shipped: string[], left: { count: number, bytes: number } }}
 */
function collect(source) {
    const shipped = [];
    const left = { count: 0, bytes: 0 };
    // walks a directory and returns how many of its files are shipped: a directory without any (a `src` of TypeScript
    // sources) is left out with its subdirectories
    const walk = (directory, relative) => {
        let files = 0;
        const entries = fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'));
        for(const entry of entries) {
            const file = path.join(directory, entry.name);
            const name = relative ? `${relative}/${entry.name}` : entry.name;
            const isDirectory = entry.isDirectory();
            if(!isShipped(name, isDirectory)) {
                if(!isDirectory) {
                    left.count++;
                    left.bytes += fs.lstatSync(file).size;
                } else {
                    for(const inner of fs.readdirSync(file, { recursive: true, withFileTypes: true })) {
                        if(inner.isFile()) {
                            left.count++;
                            left.bytes += fs.lstatSync(path.join(inner.parentPath, inner.name)).size;
                        }
                    }
                }
                continue;
            }
            const index = shipped.push(file);
            if(isDirectory) {
                const inner = walk(file, name);
                if(inner === 0) {
                    shipped.length = index - 1;
                }
                files += inner;
            } else {
                files++;
            }
        }
        return files;
    };
    walk(source, '');
    return { shipped, left };
}

/**
 * Pack the shell into an asar.
 * @param {string} source the directory of the shell (`src/app`), installed (`node_modules` present when it has dependencies)
 * @param {string} destination the `app.asar` to write
 * @returns {Promise<{ files: number, bytes: number, left: { count: number, bytes: number } }>} what was packed and what was left out
 */
async function packApp(source, destination) {
    const manifest = path.join(source, 'package.json');
    if(!fs.existsSync(manifest)) {
        throw new Error(`"${source}" is not the shell of the application, it has no package.json!`);
    }
    const dependencies = Object.keys(require(path.resolve(manifest)).dependencies || {});
    if(dependencies.length > 0 && !fs.existsSync(path.join(source, 'node_modules'))) {
        throw new Error(`The dependencies of "${source}" are not installed (no node_modules), run 'pnpm install' first!`);
    }
    const { shipped, left } = collect(source);
    await asar.createPackageFromFiles(source, destination, shipped);
    const files = shipped.filter(file => fs.lstatSync(file).isFile());
    const bytes = files.reduce((sum, file) => sum + fs.lstatSync(file).size, 0);
    return { files: files.length, bytes, left };
}

async function main(argv) {
    const [ source, destination ] = argv;
    if(!source || !destination) {
        throw new Error('Usage: node scripts/pack-app.js <source> <app.asar>');
    }
    const result = await packApp(source, destination);
    const kib = bytes => (bytes / 1024).toFixed(0);
    console.log(`Packed ${result.files} files (${kib(result.bytes)} KiB) of ${source} into ${destination}, left out ${result.left.count} files (${kib(result.left.bytes)} KiB) that the application does not load`);
}

module.exports = { packApp, isShipped };

if(require.main === module) {
    main(process.argv.slice(2)).catch(error => {
        console.error(error);
        process.exit(1);
    });
}
