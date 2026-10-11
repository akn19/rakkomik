// Helpers for the tests of the tooling scripts (`build-app.js`, `deploy-web.js`, `scripts/*.js`): files that do something
// as soon as they are loaded and export little or nothing, so a test has to decide what such a script sees.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const util = require('node:util');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { setImmediate: nextTurn } = require('node:timers');
const { pathToFileURL } = require('node:url');

/**
 * Run a CommonJS script in a function scope of its own, the way Node's loader does, but with what the test decides:
 * what `require(id)` answers for a module, the globals the script reads (`process`, `console`, `fetch`, ...), its
 * `__dirname`, whether it is the entry point (`require.main === module`) and which of its private bindings come back
 * to the test. The file on disk is never changed; `expose` only extends the source in memory (and `import()` is routed
 * to a loader, see below). The function is named after the URL of the real file, so the coverage of a run counts for
 * that file.
 * @param {string} file absolute path of the script
 * @param {object} [options]
 * @param {Record<string, any>} [options.modules] what `require(id)` returns instead of the real module
 * @param {Record<string, string>} [options.resolve] what `require.resolve(id)` returns instead of the real path
 * @param {Record<string, any>} [options.globals] a global that the script sees instead of the real one
 * @param {string} [options.dirname] the `__dirname` of the script
 * @param {boolean} [options.entry] `require.main === module`
 * @param {(module: object) => void} [options.onEntry] called when the script reads `require.main` as the entry point
 * @param {string[]} [options.expose] names of top-level bindings of the script that `exposed` returns
 * @returns {{ module: { exports: any }, exposed: any }}
 */
function loadToolScript(file, { modules = {}, resolve = {}, globals = {}, dirname = path.dirname(file), entry = false, onEntry, expose = [] } = {}) {
    const realRequire = createRequire(file);
    const module = { exports: {}, filename: file, id: file, loaded: false, children: [], paths: [] };
    const fakeRequire = id => Object.hasOwn(modules, id) ? modules[id] : realRequire(id);
    fakeRequire.resolve = (id, options) => Object.hasOwn(resolve, id) ? resolve[id] : realRequire.resolve(id, options);
    Object.defineProperty(fakeRequire, 'main', {
        get() {
            if (entry && onEntry) {
                onEntry(module);
            }
            return entry ? module : undefined;
        }
    });
    const scope = { ...globals };
    let source = fs.readFileSync(file, 'utf8');
    // (`import(?:` is the start of a group in a regular expression, not a call)
    if (/\bimport\((?!\?)/.test(source)) {
        // A function that is compiled by hand cannot call `import()` without an experimental flag of Node. The script
        // calls a loader of its own instead, under a name of the same length, so that the offsets of the coverage stay
        // those of the file. Relative specifiers are relative to the script.
        source = source.replace(/\bimport\((?!\?)/g, '__load(');
        scope.__load = specifier => import(/^\.{1,2}\//.test(specifier) ? new URL(specifier, pathToFileURL(file)).href : specifier);
    }
    source += expose.length > 0 ? `\n;return { ${expose.join(', ')} };` : '';
    const names = Object.keys(scope);
    const script = vm.compileFunction(source, [ 'exports', 'require', 'module', '__filename', '__dirname', ...names ], {
        filename: pathToFileURL(file).href
    });
    const exposed = script.call(module.exports, module.exports, fakeRequire, module, file, dirname, ...names.map(name => scope[name]));
    module.loaded = true;
    return { module, exposed };
}

/**
 * Import an ES module by its path, with the loader of Node itself (a test file goes through Vite, which has no business
 * with a file that a test has just written to a temporary folder).
 * @param {string} file
 * @returns {Promise<object>} the namespace of the module
 */
function importFile(file) {
    return import(pathToFileURL(file).href);
}

/**
 * A console that records what a script prints instead of printing it.
 */
function createConsole() {
    const entries = [];
    const record = stream => (...args) => {
        entries.push({ stream, text: args.map(arg => typeof arg === 'string' ? arg : util.inspect(arg)).join(' ') });
    };
    return {
        log: record('log'),
        info: record('info'),
        warn: record('warn'),
        error: record('error'),
        entries,
        /** the printed lines of one stream (all of them without an argument) */
        lines: stream => entries.filter(entry => !stream || entry.stream === stream).map(entry => entry.text)
    };
}

/**
 * Let everything that is queued run: all promise callbacks, and the callbacks that wait for the next turn of the event
 * loop. Fake timers do not touch it.
 */
function settle() {
    return new Promise(resolve => nextTurn(resolve));
}

/**
 * Work in an empty temporary directory that is the working directory for the length of each test: the tooling writes
 * to relative paths (`build/`, `redist/`), which must never reach the checkout. Call it in a `describe`, or at the top
 * of a file, and write to relative paths in the tests.
 */
function useTemporaryWorkingDirectory() {
    let previous = '';
    let directory = '';
    beforeEach(() => {
        previous = process.cwd();
        // the real path: on macOS the temporary folder is behind a link, and on Windows it can have a short name
        directory = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'rk-tools-')));
        process.chdir(directory);
    });
    afterEach(() => {
        process.chdir(previous);
        fs.rmSync(directory, { recursive: true, force: true });
    });
}

module.exports = { loadToolScript, importFile, createConsole, settle, useTemporaryWorkingDirectory };
