// Every relative import of the engine and the connectors must point at an
// existing file with exactly that spelling: connectors load as individual
// modules, and a wrong case works on Windows/macOS but fails on Linux (404 =>
// "Failed to fetch dynamically imported module", the connector is silently lost).
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', 'mjs');

function walk(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const full = path.join(directory, entry.name);
        return entry.isDirectory() ? walk(full) : full.endsWith('.mjs') ? [full] : [];
    });
}

// path exists with the exact case of every segment (the file system may ignore case)
function existsExactly(file) {
    let current = path.parse(file).root;
    for (const segment of path.relative(current, file).split(path.sep)) {
        if (!fs.readdirSync(current).includes(segment)) {
            return false;
        }
        current = path.join(current, segment);
    }
    return true;
}

describe('connector and engine imports', () => {
    it('should resolve every relative import with its exact spelling', () => {
        const broken = [];
        // `@Samples.mjs` is a copy-and-paste template: its imports are relative to the connectors folder it is copied to
        for (const file of walk(root).filter(entry => path.basename(entry) !== '@Samples.mjs')) {
            const source = fs.readFileSync(file, 'utf8');
            for (const match of source.matchAll(/^\s*import\s[^;]*?from\s+['"](\.[^'"]+)['"]/gm)) {
                const target = path.resolve(path.dirname(file), match[1]);
                if (!existsExactly(target)) {
                    broken.push(`${path.relative(root, file)} -> ${match[1]}`);
                }
            }
        }
        expect(broken).toEqual([]);
    });
});
