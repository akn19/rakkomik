// CommonJS module mocking for Vitest.
//
// `vi.mock` only intercepts `import`, but the Electron main process (src/app)
// is CommonJS and pulls its dependencies in with `require()`. This hook gives
// the app tests what `jest.mock(name[, factory])` used to: register the mocks
// BEFORE requiring the module under test; only modules inside `src/app` see
// them (third-party packages keep the real `fs`, `electron`, ...).
const Module = require('module');
const path = require('path');

const SCOPE = path.resolve(__dirname, '..', '..');
const mocks = new Map();
const originalLoad = Module._load;

function normalize(name) {
    return name.startsWith('node:') ? name.slice('node:'.length) : name;
}

Module._load = function (request, parent) {
    const name = normalize(request);
    if (mocks.has(name) && parent && typeof parent.filename === 'string' && parent.filename.startsWith(SCOPE)) {
        return mocks.get(name);
    }
    return originalLoad.apply(this, arguments);
};

/**
 * Jest-style automock: every function becomes `vi.fn()` (statics and nested
 * objects included), plain values are kept.
 */
function automock(actual, seen = new Map()) {
    if (actual === null || (typeof actual !== 'object' && typeof actual !== 'function')) {
        return actual;
    }
    if (seen.has(actual)) {
        return seen.get(actual);
    }
    const mock = typeof actual === 'function' ? vi.fn() : {};
    seen.set(actual, mock);
    for (const key of Object.keys(actual)) {
        let value;
        try {
            value = actual[key];
        } catch {
            continue;
        }
        mock[key] = automock(value, seen);
    }
    return mock;
}

/**
 * Register a mock for `name`; without a factory the real module is automocked.
 */
function mockModule(name, factory) {
    const exportsOfMock = factory ? factory() : automock(originalLoad.call(Module, name, module, false));
    mocks.set(normalize(name), exportsOfMock);
    return exportsOfMock;
}

module.exports = { mockModule };
