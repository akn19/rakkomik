// Package mocking for the CommonJS main process under Vitest.
//
// `vi.mock` only intercepts `import`, but src/app pulls its dependencies in
// with `require()`. Node's module customization hooks (`module.registerHooks`)
// route a package specifier such as `electron` to a virtual CommonJS module
// whose export is the registered mock - only for modules that live inside
// src/app, so the test runner and third-party packages keep the real thing.
//
// Node builtins (`node:fs`, ...) never reach these hooks. Stub those on the
// shared export object instead, e.g. `vi.spyOn(require('node:fs'), 'existsSync')`:
// CommonJS builtins are per-process singletons, so the stub is visible to
// every module that required them.
const { registerHooks } = require('node:module');
const path = require('node:path');
const { fileURLToPath, pathToFileURL } = require('node:url');

const SCOPE = path.resolve(__dirname, '..', '..') + path.sep;
// Served by the load hook below; the file itself does not exist.
const VIRTUAL = pathToFileURL(path.join(__dirname, 'virtual-mock.cjs')).href;
const MOCKS = '__rakkomikMockModules';

const mocks = globalThis[MOCKS] ??= new Map();

function requiredFromScope(parentURL) {
    return typeof parentURL === 'string' && parentURL.startsWith('file:') && fileURLToPath(parentURL).startsWith(SCOPE);
}

registerHooks({
    resolve(specifier, context, nextResolve) {
        if (mocks.has(specifier) && requiredFromScope(context.parentURL)) {
            return { url: `${VIRTUAL}?name=${encodeURIComponent(specifier)}`, format: 'commonjs', shortCircuit: true };
        }
        return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
        if (url.startsWith(`${VIRTUAL}?`)) {
            const name = new URL(url).searchParams.get('name');
            return {
                format: 'commonjs',
                source: `module.exports = globalThis[${JSON.stringify(MOCKS)}].get(${JSON.stringify(name)});`,
                shortCircuit: true
            };
        }
        return nextLoad(url, context);
    }
});

/**
 * Register the exports that `require(name)` returns inside src/app.
 * Call it BEFORE requiring the module under test.
 */
function mockModule(name, factory) {
    const exportsOfMock = factory();
    mocks.set(name, exportsOfMock);
    return exportsOfMock;
}

module.exports = { mockModule };
