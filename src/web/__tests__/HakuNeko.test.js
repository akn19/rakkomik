// The bootstrap of the engine (index.html makes `new HakuNeko(window)` and calls it `Engine`): it creates the parts, hands them
// to each other and exposes them to the UI. The parts that reach out to the main process or the disk (Settings, Storage, Request,
// Connectors) are replaced by stand-ins that record how they were created, the light parts are the real ones.
const state = vi.hoisted(() => ({ created: [], failOn: null, atSettings: null }));

vi.mock('../mjs/engine/Settings.mjs', () => ({
    default: class Settings extends EventTarget {
        constructor(...args) {
            super();
            if (state.failOn === 'Settings') {
                throw new Error('Settings failed');
            }
            state.atSettings = {
                EventListener: typeof globalThis.EventListener,
                Connector: typeof globalThis.Connector,
            };
            this.args = args;
            this.discordPresence = { value: 'none' };
            state.created.push(['Settings', this]);
        }
    },
}));

vi.mock('../mjs/engine/Storage.mjs', () => ({
    default: class Storage {
        constructor(...args) {
            if (state.failOn === 'Storage') {
                throw new Error('Storage failed');
            }
            this.args = args;
            this.saveBookmarks = vi.fn(async () => undefined);
            state.created.push(['Storage', this]);
        }
    },
}));

vi.mock('../mjs/engine/Request.mjs', () => ({
    default: class Request {
        constructor(ipc, settings) {
            if (state.failOn === 'Request') {
                throw new Error('Request failed');
            }
            this.ipc = ipc;
            this.settings = settings;
            state.created.push(['Request', this]);
        }
    },
}));

vi.mock('../mjs/engine/Connectors.mjs', () => ({
    default: class Connectors {
        constructor(ipc) {
            if (state.failOn === 'Connectors') {
                throw new Error('Connectors failed');
            }
            this.ipc = ipc;
            this.list = [];
            this.isReady = false;
            this.ready = Promise.resolve(this.list);
            this.initialize = vi.fn(async () => undefined);
            this.load = vi.fn(async () => undefined);
            state.created.push(['Connectors', this]);
        }
    },
}));

let HakuNeko = null;
let parts = null;

beforeAll(async () => {
    HakuNeko = (await import('../mjs/HakuNeko.mjs')).default;
    parts = {
        Blacklist: (await import('../mjs/engine/Blacklist.mjs')).default,
        BookmarkImporter: (await import('../mjs/engine/BookmarkImporter.mjs')).default,
        BookmarkManager: (await import('../mjs/engine/BookmarkManager.mjs')).default,
        ChaptermarkManager: (await import('../mjs/engine/ChaptermarkManager.mjs')).default,
        ComicInfoGenerator: (await import('../mjs/engine/ComicInfoGenerator.mjs')).default,
        Connector: (await import('../mjs/engine/Connector.mjs')).default,
        DiscordPresence: (await import('../mjs/engine/DiscordPresence.mjs')).default,
        DownloadManager: (await import('../mjs/engine/DownloadManager.mjs')).default,
        Enums: (await import('../mjs/engine/Enums.mjs')).default,
        InterProcessCommunication: (await import('../mjs/engine/InterProcessCommunication.mjs'))
            .default,
        Version: (await import('../mjs/VersionInfo.mjs')).default,
    };
});

beforeEach(() => {
    vi.useFakeTimers();
    state.created = [];
    state.failOn = null;
    state.atSettings = null;
    // the page: DiscordPresence listens to its document
    globalThis.document = new EventTarget();
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete globalThis.document;
    delete globalThis.EventListener;
    delete globalThis.Connector;
    delete globalThis.Engine;
    delete globalThis.window;
});

// the real page hands over its window, which is its global object as well: DiscordPresence reads the global EventListener
function boot() {
    return new HakuNeko(globalThis);
}

function created(name) {
    return state.created.filter(([part]) => part === name).map(([, instance]) => instance);
}

describe('the engine', () => {
    it('should give the parts of the engine to the UI', () => {
        const engine = boot();
        const [settings] = created('Settings');
        const [storage] = created('Storage');
        const [request] = created('Request');
        const [connectors] = created('Connectors');

        expect(engine.Blacklist).toBeInstanceOf(parts.Blacklist);
        expect(engine.BookmarkManager).toBeInstanceOf(parts.BookmarkManager);
        expect(engine.ChaptermarkManager).toBeInstanceOf(parts.ChaptermarkManager);
        expect(engine.ComicInfoGenerator).toBeInstanceOf(parts.ComicInfoGenerator);
        expect(engine.DownloadManager).toBeInstanceOf(parts.DownloadManager);
        expect(engine.Enums).toBe(parts.Enums);
        expect(engine.Version).toBe(parts.Version);
        expect(engine.Settings).toBe(settings);
        expect(engine.Storage).toBe(storage);
        expect(engine.Request).toBe(request);
        expect(engine.ConnectorRegistry).toBe(connectors);
        expect(engine.Connectors).toBe(connectors.list);
        expect(engine.ConnectorsReady).toBe(connectors.ready);
    });

    it('should give every part once, and the same part every time it is asked for', () => {
        const engine = boot();
        for (const name of ['Settings', 'Storage', 'Request', 'Connectors']) {
            expect(created(name)).toHaveLength(1);
        }
        for (const name of [
            'Blacklist',
            'BookmarkManager',
            'ChaptermarkManager',
            'ComicInfoGenerator',
            'DownloadManager',
            'Settings',
            'Storage',
            'Request',
            'ConnectorRegistry',
            'Connectors',
            'ConnectorsReady',
        ]) {
            expect(engine[name]).toBe(engine[name]);
        }
    });

    it('should show the connectors as they register: the list is the one of the registry, not a copy', () => {
        const engine = boot();
        const registry = engine.ConnectorRegistry;
        registry.list.push({ id: 'site' });
        expect(engine.Connectors).toEqual([{ id: 'site' }]);
        expect(engine.Connectors).toBe(registry.list);
    });

    it('should not share anything between two engines', () => {
        const first = boot();
        const second = boot();
        expect(second.Blacklist).not.toBe(first.Blacklist);
        expect(second.DownloadManager).not.toBe(first.DownloadManager);
        expect(second.BookmarkManager).not.toBe(first.BookmarkManager);
        expect(second.Settings).not.toBe(first.Settings);
    });

    it('should start the download queue with the engine', () => {
        const engine = boot();
        expect(engine.DownloadManager.worker).toBeDefined();
        expect(vi.getTimerCount()).toBe(1);
    });
});

describe('the globals of the page', () => {
    it('should set them before any part is created, because the parts read them while they are created', () => {
        boot();
        expect(state.atSettings).toEqual({ EventListener: 'object', Connector: 'function' });
    });

    it('should expose the names of the UI events and the base class of the connectors, and nothing else', () => {
        const context = {};
        HakuNeko.prototype._initializeGlobals.call({}, context);
        expect(Object.keys(context).sort()).toEqual(['Connector', 'EventListener']);
        expect(context.EventListener).toEqual(parts.Enums.EventListener);
        expect(context.Connector).toBe(parts.Connector);
    });

    it('should be what DiscordPresence listens with', () => {
        const added = vi.spyOn(globalThis.document, 'addEventListener');
        boot();
        expect(added.mock.calls.map((call) => call[0]).sort()).toEqual([
            'onSelectChapter',
            'onSelectConnector',
            'onSelectManga',
        ]);
    });
});

describe('what the parts are given', () => {
    it('should give the same settings to every part that reads them', () => {
        const engine = boot();
        const [settings] = created('Settings');
        expect(created('Request')[0].settings).toBe(settings);
        expect(engine.Settings).toBe(settings);
    });

    it('should create the settings before the parts that need them', () => {
        boot();
        const order = state.created.map(([name]) => name);
        expect(order.indexOf('Settings')).toBeGreaterThanOrEqual(0);
        expect(order.indexOf('Settings')).toBeLessThan(order.indexOf('Request'));
    });

    it('should give one IPC to the request and to the connectors, so both reach the main process the same way', () => {
        boot();
        const [request] = created('Request');
        const [connectors] = created('Connectors');
        expect(request.ipc).toBeInstanceOf(parts.InterProcessCommunication);
        expect(connectors.ipc).toBe(request.ipc);
    });

    it('should let the managers of the bookmarks and the chaptermarks, and the presence, follow the settings of the engine', async () => {
        const engine = boot();
        globalThis.Engine = engine;
        const presence = { clearAndDestroy: vi.fn(async () => true) };
        globalThis.window = { hakuneko: { presence } };

        engine.Settings.dispatchEvent(new CustomEvent('saved'));
        await vi.advanceTimersByTimeAsync(0);

        const saved = engine.Storage.saveBookmarks.mock.calls.map((call) => call[0]).sort();
        expect(saved).toEqual(['bookmarks', 'chaptermarks']);
        expect(presence.clearAndDestroy).toHaveBeenCalledTimes(1);
    });

    it('should let the bookmarks be imported from a file of FMD', async () => {
        const engine = boot();
        globalThis.Engine = engine;
        const query = vi.fn(async () => [
            { link: 'unknown-site', manga: '/m/1', connectorTitle: 'Unknown', mangaTitle: 'Lost' },
        ]);
        globalThis.window = { hakuneko: { sqlite: { query } }, open: vi.fn() };

        await engine.BookmarkManager.importBookmarks(
            new File([new Uint8Array([1, 2, 3])], 'favorites.db'),
        );

        expect(query).toHaveBeenCalledTimes(1);
        expect(window.open).toHaveBeenCalledTimes(1);
        expect(decodeURIComponent(window.open.mock.calls[0][0])).toContain('Lost');
    });
});

describe('initialize', () => {
    it('should register the system connectors and be done when they are', async () => {
        const engine = boot();
        const [connectors] = created('Connectors');
        let finished = false;
        let finish = null;
        connectors.initialize.mockImplementation(
            () =>
                new Promise((resolve) => {
                    finish = resolve;
                }),
        );

        const initializing = engine.initialize().then(() => {
            finished = true;
        });
        await vi.advanceTimersByTimeAsync(0);
        expect(connectors.initialize).toHaveBeenCalledTimes(1);
        expect(finished).toBe(false);

        finish();
        await initializing;
        expect(finished).toBe(true);
        expect(connectors.load).not.toHaveBeenCalled();
    });

    it('should fail when the system connectors cannot be registered, the engine cannot start without them', async () => {
        const engine = boot();
        created('Connectors')[0].initialize.mockRejectedValue(new Error('no system connectors'));
        await expect(engine.initialize()).rejects.toThrow('no system connectors');
    });
});

describe('loadConnectors', () => {
    it('should load the website connectors and hand over the promise of the registry', async () => {
        const engine = boot();
        const [connectors] = created('Connectors');
        const result = { loaded: true };
        connectors.load.mockResolvedValue(result);
        await expect(engine.loadConnectors()).resolves.toBe(result);
        expect(connectors.load).toHaveBeenCalledTimes(1);
        expect(connectors.initialize).not.toHaveBeenCalled();
    });

    it('should not hide a failure of the registry from the page, which logs it', async () => {
        const engine = boot();
        created('Connectors')[0].load.mockRejectedValue(new Error('registry failed'));
        await expect(engine.loadConnectors()).rejects.toThrow('registry failed');
    });
});

describe('a part that cannot be created', () => {
    // NOTE: the page does not catch it (loadEngine of index.html), so the engine is not started and the UI is not mounted
    it.each(['Settings', 'Request', 'Connectors', 'Storage'])(
        'should stop the start of the engine with the error of %s',
        (name) => {
            state.failOn = name;
            expect(() => boot()).toThrow(`${name} failed`);
        },
    );

    it('should not create the parts that follow a part that failed', () => {
        state.failOn = 'Settings';
        expect(() => boot()).toThrow('Settings failed');
        expect(state.created).toEqual([]);

        state.failOn = 'Connectors';
        state.created = [];
        expect(() => boot()).toThrow('Connectors failed');
        expect(state.created.map(([name]) => name)).not.toContain('Storage');
    });
});
