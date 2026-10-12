// Connector registry contract: system connectors register at once, website
// connectors load in the background (batched, concurrent imports) and every
// stage is observable (`registered` per batch, `ready` when done).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let Connectors = null;
let dir = null;

function connectorModule(file, source) {
    const target = path.join(dir, file);
    fs.writeFileSync(target, source);
    return pathToFileURL(target).href;
}

function simple(file, id, label) {
    return connectorModule(
        file,
        `export default class { constructor() { this.id = '${id}'; this.label = '${label}'; } }`,
    );
}

function registry() {
    return new Connectors({ listen: vi.fn() });
}

beforeAll(async () => {
    Connectors = (await import('../mjs/engine/Connectors.mjs')).default;
});

beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rk-connectors-'));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete globalThis.window;
});

describe('connector registry', () => {
    it('should register and sort connectors by label', async () => {
        const connectors = registry();
        await connectors.register([
            simple('b.mjs', 'b', 'Beta'),
            simple('a.mjs', 'a', 'alpha'),
            simple('c.mjs', 'c', 'Gamma'),
        ]);
        expect(connectors.list.map((connector) => connector.id)).toEqual(['a', 'b', 'c']);
    });

    it('should skip broken modules and constructors, and keep the first of duplicate IDs', async () => {
        const connectors = registry();
        await connectors.register([
            simple('one.mjs', 'x', 'First'),
            connectorModule('broken.mjs', 'export default class {'),
            connectorModule(
                'throws.mjs',
                'export default class { constructor() { throw new Error("boom"); } }',
            ),
            simple('two.mjs', 'x', 'Second'),
        ]);
        expect(connectors.list.map((connector) => connector.label)).toEqual(['First']);
        expect(console.warn).toHaveBeenCalledTimes(3);
    });

    it('should announce every batch with the sorted list', async () => {
        const connectors = registry();
        const seen = [];
        connectors.addEventListener('registered', (event) => seen.push(event.detail.length));
        const files = Array.from({ length: 130 }, (_, index) =>
            simple(`c${index}.mjs`, `id${index}`, `C${String(index).padStart(3, '0')}`),
        );
        await connectors.register(files);
        expect(seen).toEqual([128, 130]);
        expect(connectors.list[0].label).toBe('C000');
    });

    it('should load in the background, let user plugins win and announce ready once', async () => {
        const connectors = registry();
        const user = simple('user.mjs', 'dup', 'User Version');
        const internal = [
            simple('dup.mjs', 'dup', 'Internal Version'),
            simple('other.mjs', 'other', 'Other'),
        ];
        vi.spyOn(connectors, '_loadPlugins').mockImplementation(async (uri) =>
            uri.includes('plugins') ? [user] : internal,
        );
        const ready = vi.fn();
        connectors.addEventListener('ready', ready);
        expect(connectors.isReady).toBe(false);
        await connectors.load();
        expect(connectors.isReady).toBe(true);
        expect(ready).toHaveBeenCalledTimes(1);
        await expect(connectors.ready).resolves.toBe(connectors.list);
        expect(connectors.list.map((connector) => connector.label)).toEqual([
            'Other',
            'User Version',
        ]);
    });

    it('should hold connector:// requests until their connector is registered', async () => {
        const ipc = { listen: vi.fn() };
        const connectors = new Connectors(ipc);
        const handler = ipc.listen.mock.calls[0][1];
        const late = connectorModule(
            'late.mjs',
            `export default class { constructor() { this.id = 'late'; this.label = 'Late'; } handleConnectorURI(uri) { return 'handled ' + uri.pathname; } }`,
        );
        vi.spyOn(connectors, '_loadPlugins').mockImplementation(async (uri) =>
            uri.includes('plugins') ? [] : [late],
        );
        const pending = handler({ url: 'connector://late/image.png' });
        await connectors.load();
        await expect(pending).resolves.toBe('handled /image.png');
    });

    it('should answer unknown connector:// requests once everything is loaded', async () => {
        const ipc = { listen: vi.fn() };
        const connectors = new Connectors(ipc);
        vi.spyOn(connectors, '_loadPlugins').mockResolvedValue([]);
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        await connectors.load();
        await expect(
            ipc.listen.mock.calls[0][1]({ url: 'connector://nobody/x' }),
        ).resolves.toBeUndefined();
    });
});

describe('the plugin directories', () => {
    const listing = (answer) =>
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => answer),
        );

    it('should be read for the connectors in them, which are the modules that are not hidden', async () => {
        listing(
            Response.json([
                'a.mjs',
                '.hidden.mjs',
                'b.js',
                'c.mjs',
                'README.md',
                'd.mjs.bak',
                'e.MJS',
                'sub.mjs.d',
            ]),
        );
        await expect(registry()._loadPlugins('hakuneko://plugins/')).resolves.toEqual([
            'hakuneko://plugins/a.mjs',
            'hakuneko://plugins/c.mjs',
        ]);
        expect(fetch).toHaveBeenCalledExactlyOnceWith('hakuneko://plugins/');
    });

    it('should find no connectors in an empty directory', async () => {
        listing(Response.json([]));
        await expect(registry()._loadPlugins('hakuneko://plugins/')).resolves.toEqual([]);
    });

    it.each([
        [
            'cannot be asked',
            () => {
                vi.stubGlobal(
                    'fetch',
                    vi.fn(async () => {
                        throw new TypeError('Failed to fetch');
                    }),
                );
            },
        ],
        [
            'answers with no JSON',
            () => listing(new Response('<html>not found</html>', { status: 404 })),
        ],
        ['answers with JSON that is no list', () => listing(Response.json({ files: ['a.mjs'] }))],
    ])('should find no connectors when the directory %s, and not fail', async (name, arrange) => {
        arrange();
        await expect(registry()._loadPlugins('hakuneko://plugins/')).resolves.toEqual([]);
    });

    it('should load the plugins of the user and the connectors of the application, and be ready when they are all tried', async () => {
        const answers = {
            'hakuneko://plugins/': ['mine.mjs'],
            'hakuneko://cache/mjs/connectors/': ['one.mjs', 'two.mjs'],
        };
        vi.stubGlobal(
            'fetch',
            vi.fn(async (uri) => Response.json(answers[uri])),
        );
        const connectors = registry();
        const ready = vi.fn();
        connectors.addEventListener('ready', ready);
        await connectors.load();
        // none of the addresses can be imported here: each is reported, and none stops the others
        expect(fetch.mock.calls.map((call) => call[0]).sort()).toEqual([
            'hakuneko://cache/mjs/connectors/',
            'hakuneko://plugins/',
        ]);
        expect(console.warn.mock.calls.map((call) => call[0]).sort()).toEqual([
            'Failed to load connector "hakuneko://cache/mjs/connectors/one.mjs"',
            'Failed to load connector "hakuneko://cache/mjs/connectors/two.mjs"',
            'Failed to load connector "hakuneko://plugins/mine.mjs"',
        ]);
        expect(connectors.list).toEqual([]);
        expect(ready).toHaveBeenCalledTimes(1);
        expect(connectors.isReady).toBe(true);
    });

    it('should be ready without any plugin', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => {
                throw new Error('offline');
            }),
        );
        const connectors = registry();
        await connectors.load();
        expect(connectors.isReady).toBe(true);
        await expect(connectors.ready).resolves.toEqual([]);
    });

    it('should not register a connector twice when it is loaded again', async () => {
        const connectors = registry();
        const file = simple('a.mjs', 'a', 'Alpha');
        vi.spyOn(connectors, '_loadPlugins').mockImplementation(async (uri) =>
            uri.includes('plugins') ? [] : [file],
        );
        await connectors.load();
        await connectors.load();
        expect(connectors.list.map((connector) => connector.id)).toEqual(['a']);
        expect(console.warn).toHaveBeenCalledTimes(1);
        expect(console.warn.mock.calls[0][0]).toBe(
            'The connector "Alpha" with ID "a" is already registered',
        );
    });
});

describe('the system connectors', () => {
    it('should be registered first, in the order of their labels, and the registry is not ready for it', async () => {
        globalThis.window = { hakuneko: { clipboard: { readText: vi.fn() } } };
        const connectors = registry();
        const registered = vi.fn();
        connectors.addEventListener('registered', registered);
        await connectors.initialize();
        expect(connectors.list.map((connector) => connector.id)).toEqual([
            'bookmarks',
            'clipboard',
            'folder',
        ]);
        expect(registered).toHaveBeenCalledTimes(1);
        expect(registered.mock.calls[0][0].detail).toBe(connectors.list);
        expect(connectors.isReady).toBe(false);
        expect(console.warn).not.toHaveBeenCalled();
    });

    it('should not be replaced by a plugin with the same ID', async () => {
        globalThis.window = { hakuneko: { clipboard: { readText: vi.fn() } } };
        const connectors = registry();
        await connectors.initialize();
        await connectors.register([simple('mine.mjs', 'folder', 'My Folder')]);
        expect(connectors.list.map((connector) => connector.label)).toEqual([
            ' 【Bookmarks】',
            ' 【Clipboard】',
            ' 【Folder Viewer】',
        ]);
        expect(console.warn).toHaveBeenCalledWith(
            'The connector "My Folder" with ID "folder" is already registered',
        );
    });

    it('should be listed before the connectors of the websites', async () => {
        globalThis.window = { hakuneko: { clipboard: { readText: vi.fn() } } };
        const connectors = registry();
        await connectors.initialize();
        await connectors.register([simple('a.mjs', 'aaa', 'AAA'), simple('z.mjs', 'zzz', 'Zzz')]);
        expect(connectors.list.map((connector) => connector.id)).toEqual([
            'bookmarks',
            'clipboard',
            'folder',
            'aaa',
            'zzz',
        ]);
    });

    it('should leave out the one that cannot be created, and register the others', async () => {
        // no clipboard bridge: the clipboard connector cannot be created
        globalThis.window = {};
        const connectors = registry();
        await connectors.initialize();
        expect(connectors.list.map((connector) => connector.id)).toEqual(['bookmarks', 'folder']);
        expect(console.warn).toHaveBeenCalledTimes(1);
        expect(console.warn.mock.calls[0][0]).toBe(
            'Failed to load connector "../connectors/system/ClipboardConnector.mjs"',
        );
    });
});

describe('the registration of connectors', () => {
    it('should keep the list that it handed out, so that what holds it sees the new connectors', async () => {
        const connectors = registry();
        const list = connectors.list;
        await connectors.register([simple('b.mjs', 'b', 'Beta')]);
        await connectors.register([simple('a.mjs', 'a', 'Alpha')]);
        expect(connectors.list).toBe(list);
        expect(list.map((connector) => connector.id)).toEqual(['a', 'b']);
    });

    it('should announce nothing when there is nothing to register', async () => {
        const connectors = registry();
        const registered = vi.fn();
        connectors.addEventListener('registered', registered);
        await connectors.register([]);
        expect(registered).not.toHaveBeenCalled();
        expect(connectors.list).toEqual([]);
    });

    it('should announce a batch in which no connector could be registered', async () => {
        const connectors = registry();
        const registered = vi.fn();
        connectors.addEventListener('registered', registered);
        await connectors.register([connectorModule('broken.mjs', 'export default class {')]);
        expect(registered).toHaveBeenCalledTimes(1);
        expect(registered.mock.calls[0][0].detail).toEqual([]);
    });

    it('should report a module that holds no connector, and not stop', async () => {
        const connectors = registry();
        await connectors.register([
            connectorModule('none.mjs', 'export const x = 1;'),
            simple('a.mjs', 'a', 'Alpha'),
        ]);
        expect(connectors.list.map((connector) => connector.id)).toEqual(['a']);
        expect(console.warn).toHaveBeenCalledTimes(1);
        expect(console.warn.mock.calls[0][0]).toMatch(/^Failed to load connector ".*none\.mjs"$/);
        expect(console.warn.mock.calls[0][1]).toBeInstanceOf(TypeError);
    });

    it('should report a list that is no list, and not fail', async () => {
        const connectors = registry();
        await expect(connectors.register(undefined)).resolves.toBeUndefined();
        expect(console.warn).toHaveBeenCalledTimes(1);
        expect(console.warn.mock.calls[0][0]).toBe('Failed to load connector');
        expect(connectors.list).toEqual([]);
    });

    it('should keep the connectors that have the same label, and sort the rest around them', async () => {
        const connectors = registry();
        await connectors.register([
            simple('1.mjs', 'one', 'Same'),
            simple('2.mjs', 'two', 'same'),
            simple('0.mjs', 'zero', 'Aaa'),
            simple('9.mjs', 'nine', 'Zzz'),
        ]);
        const ids = connectors.list.map((connector) => connector.id);
        expect(ids[0]).toBe('zero');
        expect(ids[3]).toBe('nine');
        expect(ids.slice(1, 3).sort()).toEqual(['one', 'two']);
    });

    it('should sort the labels without regard to the case', async () => {
        const connectors = registry();
        await connectors.register([
            simple('1.mjs', 'c', 'cherry'),
            simple('2.mjs', 'b', 'Banana'),
            simple('3.mjs', 'a', 'APPLE'),
            simple('4.mjs', 'd', 'Date'),
        ]);
        expect(connectors.list.map((connector) => connector.label)).toEqual([
            'APPLE',
            'Banana',
            'cherry',
            'Date',
        ]);
    });

    it('should let the first of several batches that holds an ID win, whatever comes after', async () => {
        const connectors = registry();
        const files = Array.from({ length: 129 }, (_, index) =>
            simple(
                `c${index}.mjs`,
                index === 128 ? 'id0' : `id${index}`,
                index === 128 ? 'Late copy' : `C${String(index).padStart(3, '0')}`,
            ),
        );
        await connectors.register(files);
        expect(connectors.list).toHaveLength(128);
        expect(connectors.list.some((connector) => connector.label === 'Late copy')).toBe(false);
    });

    it('should register the connectors of the next batch when one of them has no label', async () => {
        const connectors = registry();
        const files = [
            connectorModule(
                'nolabel.mjs',
                'export default class { constructor() { this.id = "nolabel"; } }',
            ),
        ];
        for (let index = 0; index < 128; index++) {
            files.push(simple(`c${index}.mjs`, `id${index}`, `C${String(index).padStart(3, '0')}`));
        }
        await connectors.register(files);
        expect(connectors.list.some((connector) => connector.id === 'id127')).toBe(true);
    });
});

describe('connector:// requests', () => {
    function arrange() {
        const ipc = { listen: vi.fn() };
        const connectors = new Connectors(ipc);
        return { connectors, handler: ipc.listen.mock.calls[0][1], ipc };
    }

    const handling = (id, body) =>
        connectorModule(
            `${id}.mjs`,
            `export default class { constructor() { this.id = '${id}'; this.label = '${id}'; } handleConnectorURI(uri) { ${body} } }`,
        );

    it('should be answered by the registry, on the channel of the main process, and only there', () => {
        const { ipc } = arrange();
        expect(ipc.listen).toHaveBeenCalledTimes(1);
        expect(ipc.listen.mock.calls[0][0]).toBe('on-connector-protocol-handler');
        expect(ipc.listen.mock.calls[0][1]).toBeInstanceOf(Function);
    });

    it('should be handed to the connector that its host names, as an address, with the answer given back', async () => {
        const { connectors, handler } = arrange();
        await connectors.register([
            handling(
                'west',
                'return { seen: uri.href, self: this.id, payload: uri.searchParams.get("payload") };',
            ),
        ]);
        await expect(
            handler({ url: 'connector://west/path/page.png?payload=abc%3D' }),
        ).resolves.toEqual({
            seen: 'connector://west/path/page.png?payload=abc%3D',
            self: 'west',
            payload: 'abc=',
        });
    });

    it('should be handed to the connector of the same ID, not to one of a similar one', async () => {
        const { connectors, handler } = arrange();
        await connectors.register([
            handling('west', 'return "west";'),
            handling('westside', 'return "westside";'),
            handling('East', 'return "East";'),
        ]);
        vi.spyOn(connectors, '_loadPlugins').mockResolvedValue([]);
        await connectors.load();
        await expect(handler({ url: 'connector://westside/x' })).resolves.toBe('westside');
        await expect(handler({ url: 'connector://west/x' })).resolves.toBe('west');
        await expect(handler({ url: 'connector://East/x' })).resolves.toBe('East');
        // the ID has to be the same, case and all
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        await expect(handler({ url: 'connector://east/x' })).resolves.toBeUndefined();
    });

    it('should be answered without an address, and say so, when it has none that can be read', async () => {
        const { connectors, handler } = arrange();
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        vi.spyOn(connectors, '_loadPlugins').mockResolvedValue([]);
        await connectors.load();
        await expect(handler({ url: 'not an address' })).resolves.toBeUndefined();
        expect(error).toHaveBeenCalledTimes(1);
        expect(error.mock.calls[0][0]).toBeInstanceOf(TypeError);
    });

    it('should be answered without an answer, and say so, when the connector fails', async () => {
        const { connectors, handler } = arrange();
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        await connectors.register([handling('west', 'throw new Error("no luck");')]);
        await expect(handler({ url: 'connector://west/x' })).resolves.toBeUndefined();
        expect(error).toHaveBeenCalledTimes(1);
        expect(error.mock.calls[0][0].message).toBe('no luck');
    });

    // NOTE: a connector that answers with a promise that rejects is not caught here (the promise is returned, not
    // awaited): the caller gets the rejection; the wrapper of the main process answers undefined for it
    // (see InterProcessCommunication.listen)
    it('should hand the failure of a connector that answers late to the caller', async () => {
        const { connectors, handler } = arrange();
        await connectors.register([
            handling('west', 'return Promise.reject(new Error("late failure"));'),
        ]);
        await expect(handler({ url: 'connector://west/x' })).rejects.toThrow('late failure');
    });

    it('should wait for the connectors that are on their way, and then fail for a host that is none of them', async () => {
        const { connectors, handler } = arrange();
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        vi.spyOn(connectors, '_loadPlugins').mockImplementation(async (uri) =>
            uri.includes('plugins') ? [] : [handling('west', 'return "west";')],
        );
        const pending = [
            handler({ url: 'connector://west/x' }),
            handler({ url: 'connector://nobody/x' }),
        ];
        const settled = vi.fn();
        pending[1].then(settled);
        await Promise.resolve();
        expect(settled).not.toHaveBeenCalled();
        await connectors.load();
        await expect(pending[0]).resolves.toBe('west');
        await expect(pending[1]).resolves.toBeUndefined();
        expect(error).toHaveBeenCalledTimes(1);
    });

    it('should be answered at once by a connector that is registered, even before the others are loaded', async () => {
        const { connectors, handler } = arrange();
        await connectors.register([handling('west', 'return "west";')]);
        expect(connectors.isReady).toBe(false);
        await expect(handler({ url: 'connector://west/x' })).resolves.toBe('west');
    });
});
