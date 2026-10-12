// The small parts of the engine: the names of the UI events (Enums), the answers to the main process
// (InterProcessCommunication) and the entry of the bookmark list (Bookmark).
const fs = require('node:fs');
const path = require('node:path');

let Enums = null;
let InterProcessCommunication = null;
let Bookmark = null;
let bridge = null;

beforeAll(async () => {
    Enums = (await import('../mjs/engine/Enums.mjs')).default;
    InterProcessCommunication = (await import('../mjs/engine/InterProcessCommunication.mjs'))
        .default;
    Bookmark = (await import('../mjs/engine/Bookmark.mjs')).default;
    bridge = await import('../ui/engine.js');
});

afterEach(() => {
    delete globalThis.window;
    delete globalThis.document;
    vi.restoreAllMocks();
});

const webRoot = path.resolve(__dirname, '..');

function sources(directory, extensions) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            return ['dist', '__tests__', 'node_modules'].includes(entry.name)
                ? []
                : sources(full, extensions);
        }
        return extensions.some((extension) => entry.name.endsWith(extension)) ? [full] : [];
    });
}

describe('Enums.EventListener', () => {
    it('should name the events of the user interface, each with its own name as the value', () => {
        expect(Enums.EventListener).toEqual({
            onMangaStatusChanged: 'onMangaStatusChanged',
            onChapterStatusChanged: 'onChapterStatusChanged',
            onSelectChapter: 'onSelectChapter',
            onSelectConnector: 'onSelectConnector',
            onSelectManga: 'onSelectManga',
        });
    });

    it('should give every caller an object of its own', () => {
        const first = Enums.EventListener;
        first.onSelectManga = 'changed';
        delete first.onSelectChapter;
        expect(Enums.EventListener).not.toBe(first);
        expect(Enums.EventListener.onSelectManga).toBe('onSelectManga');
        expect(Enums.EventListener.onSelectChapter).toBe('onSelectChapter');
    });

    it('should be the name under which the user interface listens for the status of a chapter', () => {
        globalThis.document = new EventTarget();
        const listener = vi.fn();
        const unsubscribe = bridge.subscribeChapterStatus(listener);
        const chapter = { title: 'Chapter 1' };
        document.dispatchEvent(
            new CustomEvent(Enums.EventListener.onChapterStatusChanged, { detail: chapter }),
        );
        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener.mock.calls[0][0].detail).toBe(chapter);
        document.dispatchEvent(
            new CustomEvent(Enums.EventListener.onMangaStatusChanged, { detail: chapter }),
        );
        expect(listener).toHaveBeenCalledTimes(1);
        unsubscribe();
        document.dispatchEvent(
            new CustomEvent(Enums.EventListener.onChapterStatusChanged, { detail: chapter }),
        );
        expect(listener).toHaveBeenCalledTimes(1);
    });
});

describe('the dispatchers of the events', () => {
    const dispatching = [
        path.join(webRoot, 'mjs', 'engine'),
        path.join(webRoot, 'mjs', 'connectors', 'system'),
        path.join(webRoot, 'ui'),
    ]
        .flatMap((directory) => sources(directory, ['.mjs', '.js', '.jsx']))
        .filter((file) => !/(?:Enums|DiscordPresence)\.mjs$/.test(file))
        .map((file) => fs.readFileSync(file, 'utf8'));

    function isDispatched(name) {
        const dispatch = new RegExp(`dispatchEvent\\([^;]*\\b${name}\\b`);
        return dispatching.some((source) => dispatch.test(source));
    }

    it.each(['onMangaStatusChanged', 'onChapterStatusChanged', 'onSelectChapter'])(
        'should dispatch %s somewhere',
        (name) => {
            expect(isDispatched(name)).toBe(true);
        },
    );

    // BUG: nothing dispatches onSelectConnector and onSelectManga since the React UI replaced the pages that did, so the
    // presence of Discord never shows "Browsing <connector>" and "Looking at <manga>" (DiscordPresence.mjs:22-23, Enums.mjs:11-12)
    for (const name of ['onSelectConnector', 'onSelectManga']) {
        it(`should dispatch ${name} somewhere, as DiscordPresence listens for it`, () => {
            expect(isDispatched(name)).toBe(true);
        });
    }
});

describe('InterProcessCommunication', () => {
    function mainProcess() {
        const listeners = new Map();
        const sent = [];
        globalThis.window = {
            hakuneko: {
                on: vi.fn((channel, listener) => {
                    listeners.set(channel, listener);
                }),
                send: vi.fn((channel, data) => {
                    sent.push([channel, data]);
                }),
            },
        };
        // what the main process does (ElectronBootstrap._ipcSend): a request carries the channel of its answer
        return {
            sent,
            request: (channel, responseChannel, payload) =>
                listeners.get(channel)(responseChannel, payload),
        };
    }

    function deferred() {
        let resolve = null;
        const promise = new Promise((done) => {
            resolve = done;
        });
        return { promise, resolve };
    }

    it('should not subscribe to anything before somebody listens', () => {
        mainProcess();
        new InterProcessCommunication();
        expect(window.hakuneko.on).not.toHaveBeenCalled();
    });

    it('should subscribe to the channel through the bridge of the preload', () => {
        mainProcess();
        expect(new InterProcessCommunication().listen('login', () => undefined)).toBeUndefined();
        expect(window.hakuneko.on).toHaveBeenCalledTimes(1);
        expect(window.hakuneko.on.mock.calls[0][0]).toBe('login');
    });

    it('should hand the payload to the handler and answer on the channel that the request names', async () => {
        const { sent, request } = mainProcess();
        const handler = vi.fn((payload) => ({ echo: payload }));
        new InterProcessCommunication().listen('login', handler);
        await request('login', 'answer-1', { user: 'me' });
        expect(handler.mock.calls).toEqual([[{ user: 'me' }]]);
        expect(sent).toEqual([['answer-1', { echo: { user: 'me' } }]]);
    });

    it('should wait for a handler that answers later', async () => {
        const { sent, request } = mainProcess();
        const later = deferred();
        new InterProcessCommunication().listen('login', () => later.promise);
        const pending = request('login', 'answer-1', undefined);
        await Promise.resolve();
        expect(sent).toEqual([]);
        later.resolve('done');
        await pending;
        expect(sent).toEqual([['answer-1', 'done']]);
    });

    it.each([
        ['nothing', undefined],
        ['null', null],
        ['false', false],
        ['an empty string', ''],
        ['zero', 0],
    ])('should answer with %s as it is', async (name, value) => {
        const { sent, request } = mainProcess();
        new InterProcessCommunication().listen('login', () => value);
        await request('login', 'answer-1', {});
        expect(sent).toEqual([['answer-1', value]]);
    });

    it.each([
        [
            'throws',
            () => {
                throw new Error('handler failed');
            },
        ],
        ['rejects', () => Promise.reject(new Error('handler failed'))],
    ])(
        'should log a handler that %s and still answer with nothing, or the main process waits for ever',
        async (name, handler) => {
            const { sent, request } = mainProcess();
            const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
            new InterProcessCommunication().listen('login', handler);
            await request('login', 'answer-1', {});
            expect(sent).toEqual([['answer-1', undefined]]);
            expect(log).toHaveBeenCalledTimes(1);
            expect(log.mock.calls[0][0]).toBeInstanceOf(Error);
            expect(log.mock.calls[0][0].message).toBe('handler failed');
        },
    );

    it('should answer with nothing when the result cannot be sent, instead of leaving the request open', async () => {
        const { sent, request } = mainProcess();
        const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const failure = new Error('An object could not be cloned.');
        window.hakuneko.send.mockImplementationOnce(() => {
            throw failure;
        });
        new InterProcessCommunication().listen('login', () => ({ callback: () => undefined }));
        await request('login', 'answer-1', {});
        expect(window.hakuneko.send).toHaveBeenCalledTimes(2);
        expect(sent).toEqual([['answer-1', undefined]]);
        expect(log).toHaveBeenCalledWith(failure);
    });

    it('should keep concurrent requests apart: each answer goes to its own channel with its own result', async () => {
        const { sent, request } = mainProcess();
        const slow = deferred();
        new InterProcessCommunication().listen('login', (payload) =>
            payload === 'slow' ? slow.promise : `fast:${payload}`,
        );
        const first = request('login', 'answer-1', 'slow');
        const second = request('login', 'answer-2', 'quick');
        await second;
        expect(sent).toEqual([['answer-2', 'fast:quick']]);
        slow.resolve('slow:done');
        await first;
        expect(sent).toEqual([
            ['answer-2', 'fast:quick'],
            ['answer-1', 'slow:done'],
        ]);
    });

    it('should keep the handlers of two channels apart', async () => {
        const { sent, request } = mainProcess();
        const ipc = new InterProcessCommunication();
        const login = vi.fn(() => 'credentials');
        const protocol = vi.fn(() => 'connector');
        ipc.listen('login', login);
        ipc.listen('on-connector-protocol-handler', protocol);
        await request('on-connector-protocol-handler', 'answer-1', { url: 'hakuneko://site/x' });
        expect(login).not.toHaveBeenCalled();
        expect(protocol.mock.calls).toEqual([[{ url: 'hakuneko://site/x' }]]);
        expect(sent).toEqual([['answer-1', 'connector']]);
    });

    it('should let the preload refuse a channel: the error reaches the one that listens', () => {
        globalThis.window = {
            hakuneko: {
                on: () => {
                    throw new Error('IPC channel "nope" is not allowed!');
                },
            },
        };
        expect(() => new InterProcessCommunication().listen('nope', () => undefined)).toThrow(
            'not allowed',
        );
    });

    it('should only listen on channels that the preload lets the renderer subscribe to', () => {
        const preload = fs.readFileSync(path.join(webRoot, '..', 'app', 'preload.js'), 'utf8');
        const allowed = [
            ...preload.match(/const allowed = \[([^\]]*)\]/)[1].matchAll(/'([^']+)'/g),
        ].map((match) => match[1]);
        const engine = [
            path.join(webRoot, 'mjs', 'HakuNeko.mjs'),
            ...sources(path.join(webRoot, 'mjs', 'engine'), ['.mjs']),
        ];
        const used = engine.flatMap((file) =>
            [...fs.readFileSync(file, 'utf8').matchAll(/\.listen\(\s*'([^']+)'/g)].map(
                (match) => match[1],
            ),
        );
        // the channels that the engine has always listened to (Request and Connectors), so the scan is known to find them
        expect(used).toEqual(expect.arrayContaining(['login', 'on-connector-protocol-handler']));
        expect(used.filter((channel) => !allowed.includes(channel))).toEqual([]);
    });
});

describe('Bookmark', () => {
    const connector = { id: 'mangadex', label: 'MangaDex' };

    it('should keep the labels to show and the keys to find the manga again', () => {
        const bookmark = new Bookmark({ id: '/title/42', title: 'One Piece', connector });
        expect(bookmark).toEqual({
            title: { connector: 'MangaDex', manga: 'One Piece' },
            key: { connector: 'mangadex', manga: '/title/42' },
        });
    });

    it('should be saved in the form that the bookmark files have always had', () => {
        const bookmark = new Bookmark({ id: '/m/1', title: 'Title', connector });
        expect(JSON.stringify([bookmark])).toBe(
            '[{"title":{"connector":"MangaDex","manga":"Title"},"key":{"connector":"mangadex","manga":"/m/1"}}]',
        );
        expect(Object.keys(bookmark)).toEqual(['title', 'key']);
    });

    it('should be a copy: a later change of the manga does not change the bookmark', () => {
        const manga = { id: '/m/1', title: 'Old', connector: { ...connector } };
        const bookmark = new Bookmark(manga);
        manga.title = 'New';
        manga.id = '/m/2';
        manga.connector.label = 'Renamed';
        manga.connector.id = 'renamed';
        expect(bookmark.title).toEqual({ connector: 'MangaDex', manga: 'Old' });
        expect(bookmark.key).toEqual({ connector: 'mangadex', manga: '/m/1' });
    });

    it('should keep unicode titles as they are', () => {
        const bookmark = new Bookmark({ id: '/m/1', title: '進撃の巨人 😀', connector });
        expect(JSON.parse(JSON.stringify(bookmark)).title.manga).toBe('進撃の巨人 😀');
    });

    // NOTE: BookmarkManager.addBookmark refuses a manga without a connector, the bookmark itself does not
    it('should need the connector of the manga', () => {
        expect(() => new Bookmark({ id: '/m/1', title: 'Title' })).toThrow(TypeError);
    });
});
