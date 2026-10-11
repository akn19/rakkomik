// protobuf.js on demand: the library is injected as a classic script on first use and shared by everybody who asks
// while it loads; a failed load can be tried again.
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const { exactly } = require('./support/coreFakes.js');

let loadProtobuf = null;

beforeEach(async () => {
    // the module remembers the load that is running: every test starts with a fresh one
    vi.resetModules();
    ({ loadProtobuf } = await import('../mjs/engine/Protobuf.mjs'));
});

afterEach(() => {
    delete globalThis.protobuf;
    vi.unstubAllGlobals();
});

// A page that records the scripts that are added to it; a script is "loaded" by calling its `onload` or `onerror`
function pageWithoutLibrary() {
    const scripts = [];
    vi.stubGlobal('document', {
        createElement: vi.fn(tag => ({ tag, remove: vi.fn() })),
        head: { append: vi.fn(script => scripts.push(script)) }
    });
    return scripts;
}

describe('loadProtobuf', () => {
    it('should hand out the library that is there already, without loading anything', async () => {
        const library = { load: vi.fn() };
        globalThis.protobuf = library;
        const scripts = pageWithoutLibrary();
        await expect(loadProtobuf()).resolves.toBe(library);
        expect(scripts).toEqual([]);
    });

    it('should inject the vendored bundle as a script and resolve with the library the script defines', async () => {
        const scripts = pageWithoutLibrary();
        const loading = loadProtobuf();
        expect(scripts).toHaveLength(1);
        expect(scripts[0].tag).toBe('script');
        // src/web/js/protobuf.min.js is where scripts/vendor.js puts the bundle
        expect(path.resolve(fileURLToPath(scripts[0].src))).toBe(path.resolve(__dirname, '..', 'js', 'protobuf.min.js'));
        const library = { load: vi.fn() };
        globalThis.protobuf = library;
        scripts[0].onload();
        await expect(loading).resolves.toBe(library);
    });

    it('should load the script once for everybody who asks while it loads', async () => {
        const scripts = pageWithoutLibrary();
        const first = loadProtobuf();
        const second = loadProtobuf();
        expect(scripts).toHaveLength(1);
        globalThis.protobuf = { name: 'library' };
        scripts[0].onload();
        await expect(Promise.all([first, second])).resolves.toEqual([globalThis.protobuf, globalThis.protobuf]);
    });

    it('should not load the script again once the library is there', async () => {
        const scripts = pageWithoutLibrary();
        const first = loadProtobuf();
        globalThis.protobuf = { name: 'library' };
        scripts[0].onload();
        await first;
        await expect(loadProtobuf()).resolves.toBe(globalThis.protobuf);
        expect(scripts).toHaveLength(1);
    });

    it('should reject, and take the script away again, when the script cannot be loaded', async () => {
        const scripts = pageWithoutLibrary();
        const loading = loadProtobuf();
        scripts[0].onerror();
        await expect(loading).rejects.toThrow(exactly('Failed to load the protobuf library!'));
        expect(scripts[0].remove).toHaveBeenCalledTimes(1);
    });

    it('should reject everybody who waited for a load that failed', async () => {
        const scripts = pageWithoutLibrary();
        const waiting = [loadProtobuf(), loadProtobuf()];
        scripts[0].onerror();
        await expect(waiting[0]).rejects.toThrow(exactly('Failed to load the protobuf library!'));
        await expect(waiting[1]).rejects.toThrow(exactly('Failed to load the protobuf library!'));
    });

    it('should try again with a new script after a failed load', async () => {
        const scripts = pageWithoutLibrary();
        const failed = loadProtobuf();
        scripts[0].onerror();
        await expect(failed).rejects.toThrow();

        const retry = loadProtobuf();
        expect(scripts).toHaveLength(2);
        expect(scripts[1]).not.toBe(scripts[0]);
        globalThis.protobuf = { name: 'library' };
        scripts[1].onload();
        await expect(retry).resolves.toBe(globalThis.protobuf);
    });

    it('should reject when the script did not define the library', async () => {
        const scripts = pageWithoutLibrary();
        const loading = loadProtobuf();
        scripts[0].onload();
        await expect(loading).rejects.toThrow();
    });
});
