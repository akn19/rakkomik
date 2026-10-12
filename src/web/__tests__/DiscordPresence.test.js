// What the user is doing, as the activity of Discord: the UI events of the engine (select a connector, a manga, a chapter) become
// the text of the status, the setting `discordPresence` says whether and for which content it is shown, and the transport
// (the DiscordBridge of the main process) is reached through `window.hakuneko.presence`, one call at a time.
let DiscordPresence = null;
let Enums = null;

beforeAll(async () => {
    DiscordPresence = (await import('../mjs/engine/DiscordPresence.mjs')).default;
    Enums = (await import('../mjs/engine/Enums.mjs')).default;
});

const START = new Date('2026-03-01T12:00:00.000Z');

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete globalThis.document;
    delete globalThis.EventListener;
    delete globalThis.window;
});

const tick = (ms) => vi.advanceTimersByTimeAsync(ms);

// the delay for Discord to be receptive, and the interval of the updates (the limit of the API)
const DELAY = 2000;
const INTERVAL = 15200;
const RETRY = 120000;

function setup({ mode = 'none', presence = {} } = {}) {
    const document = new EventTarget();
    globalThis.document = document;
    globalThis.EventListener = Enums.EventListener;
    // the status crosses the IPC as a copy, so what was sent is not changed by the selections that follow
    const sent = [];
    const results = [];
    const bridge = {
        sent,
        results,
        ensureStarted: vi.fn(async () => true),
        setActivity: vi.fn(async (status) => {
            sent.push(structuredClone(status));
            return results.length ? results.shift() : true;
        }),
        clearAndDestroy: vi.fn(async () => true),
        ...presence,
    };
    globalThis.window = { hakuneko: { presence: bridge } };
    const settings = Object.assign(new EventTarget(), { discordPresence: { value: mode } });
    return { discord: new DiscordPresence(settings), settings, bridge, document };
}

async function change(settings, value, type = 'saved') {
    settings.discordPresence.value = value;
    settings.dispatchEvent(new CustomEvent(type));
    await tick(0);
}

function connector(label, tags = []) {
    return { id: label.toLowerCase(), label, tags };
}

const select = {
    connector: (document, detail) =>
        document.dispatchEvent(new CustomEvent('onSelectConnector', { detail })),
    manga: (document, detail) =>
        document.dispatchEvent(new CustomEvent('onSelectManga', { detail })),
    chapter: (document, detail) =>
        document.dispatchEvent(new CustomEvent('onSelectChapter', { detail })),
};

describe('a new presence', () => {
    it('should start with the status of the application and nothing shown', async () => {
        const { discord, bridge, document } = setup();
        expect(discord.status).toEqual({
            largeImageKey: 'logo',
            largeImageText: 'Manga & Anime Downloader for Linux, Windows & MacOS',
        });
        expect(discord.enabled).toBe(false);
        expect(discord.enabledHentai).toBe(false);
        expect(discord.updater).toBeNull();
        select.connector(document, connector('MangaDex'));
        await tick(RETRY);
        expect(bridge.ensureStarted).not.toHaveBeenCalled();
        expect(bridge.setActivity).not.toHaveBeenCalled();
        expect(bridge.clearAndDestroy).not.toHaveBeenCalled();
    });
});

describe('the setting', () => {
    it.each([
        ['none', false, false],
        ['nohentai', true, false],
        ['hentai', true, true],
    ])('should show %s: enabled %s, hentai %s', async (value, enabled, enabledHentai) => {
        const { discord, settings } = setup();
        await change(settings, value);
        expect(discord.enabled).toBe(enabled);
        expect(discord.enabledHentai).toBe(enabledHentai);
    });

    it.each(['loaded', 'saved'])('should look at the setting when it is %s', async (type) => {
        const { discord, settings, bridge } = setup();
        await change(settings, 'nohentai', type);
        expect(discord.enabled).toBe(true);
        expect(bridge.ensureStarted).toHaveBeenCalledTimes(1);
        await change(settings, 'none', type);
        expect(discord.enabled).toBe(false);
        expect(bridge.clearAndDestroy).toHaveBeenCalledTimes(1);
    });

    it('should not connect to Discord while it is off, whatever the user selects', async () => {
        const { settings, bridge, document } = setup();
        await change(settings, 'none');
        bridge.clearAndDestroy.mockClear();
        select.connector(document, connector('MangaDex'));
        select.manga(document, { title: 'One Piece', connector: connector('MangaDex') });
        select.chapter(document, {
            title: 'Chapter 1',
            manga: { title: 'One Piece', connector: connector('MangaDex') },
        });
        await tick(RETRY);
        expect(bridge.ensureStarted).not.toHaveBeenCalled();
        expect(bridge.setActivity).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('should connect, and show what the user selects after the delay for Discord to be receptive', async () => {
        const { settings, bridge, document } = setup();
        await change(settings, 'nohentai');
        expect(bridge.ensureStarted).toHaveBeenCalledTimes(1);
        select.connector(document, connector('MangaDex'));
        await tick(DELAY - 1);
        expect(bridge.setActivity).not.toHaveBeenCalled();
        await tick(1);
        expect(bridge.setActivity).toHaveBeenCalledTimes(1);
    });

    it('should stop when it is switched off: clear the activity, stop the updates and show nothing more', async () => {
        const { discord, settings, bridge, document } = setup();
        await change(settings, 'nohentai');
        await tick(DELAY);
        expect(discord.updater).not.toBeNull();
        bridge.setActivity.mockClear();

        await change(settings, 'none');

        expect(bridge.clearAndDestroy).toHaveBeenCalledTimes(1);
        expect(discord.updater).toBeNull();
        expect(discord.statusNew).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
        select.chapter(document, {
            title: 'Chapter 1',
            manga: { title: 'One Piece', connector: connector('MangaDex') },
        });
        await tick(RETRY);
        expect(bridge.setActivity).not.toHaveBeenCalled();
    });

    it('should not show what was selected a moment before it was switched off', async () => {
        const { settings, bridge, document } = setup();
        await change(settings, 'nohentai');
        select.chapter(document, {
            title: 'Chapter 1',
            manga: { title: 'One Piece', connector: connector('MangaDex') },
        });
        await change(settings, 'none');
        await tick(RETRY);
        expect(bridge.setActivity).not.toHaveBeenCalled();
    });
});

describe('the text of the status', () => {
    const mangadex = connector('MangaDex');
    const onePiece = { title: 'One Piece', connector: mangadex };

    async function shown(select_, detail) {
        const context = setup({ mode: 'nohentai' });
        await change(context.settings, 'nohentai');
        select_(context.document, detail);
        await tick(DELAY);
        expect(context.bridge.setActivity).toHaveBeenCalledTimes(1);
        return context.bridge.sent[0];
    }

    it('should say that the user browses a connector', async () => {
        const status = await shown(select.connector, mangadex);
        expect(status).toEqual({
            largeImageKey: 'logo',
            largeImageText: 'Manga & Anime Downloader for Linux, Windows & MacOS',
            details: 'Browsing MangaDex',
            startTimestamp: START.getTime(),
        });
        expect('state' in status).toBe(false);
    });

    it('should say which manga the user looks at', async () => {
        const status = await shown(select.manga, onePiece);
        expect(status.details).toBe('Browsing MangaDex');
        expect(status.state).toBe('Looking at One Piece');
        expect(status.largeImageKey).toBe('logo');
    });

    it('should say which chapter the user views', async () => {
        const status = await shown(select.chapter, {
            title: 'Chapter 1: The Beginning',
            manga: onePiece,
        });
        expect(status.details).toBe('Viewing One Piece');
        expect(status.state).toBe('Chapter 1: The Beginning');
    });

    it.each([
        ['one character', 'A', 'A '],
        ['nothing', '', '  '],
        ['two characters', 'AB', 'AB'],
        ['a number', '7', '7 '],
        ['a long text', 'Chapter 1 '.repeat(5), 'Chapter 1 '.repeat(5)],
    ])(
        'should give the state a length of at least two characters, for a chapter that is called %s',
        async (name, title, state) => {
            const status = await shown(select.chapter, { title, manga: onePiece });
            expect(status.state).toBe(state);
        },
    );

    it('should show titles in any script', async () => {
        const status = await shown(select.chapter, {
            title: '第1話 😀',
            manga: { title: '進撃の巨人', connector: connector('日本語') },
        });
        expect(status.details).toBe('Viewing 進撃の巨人');
        expect(status.state).toBe('第1話 😀');
    });

    it('should drop the state of the manga when the user goes back to browsing a connector', async () => {
        const { settings, bridge, document } = setup();
        await change(settings, 'nohentai');
        select.manga(document, onePiece);
        await tick(DELAY);
        expect(bridge.sent[0].state).toBe('Looking at One Piece');
        select.connector(document, connector('MangaDex'));
        await tick(DELAY);
        expect(bridge.setActivity).toHaveBeenCalledTimes(2);
        expect('state' in bridge.sent[1]).toBe(false);
        expect(bridge.sent[1].details).toBe('Browsing MangaDex');
    });

    it('should count the time from the selection', async () => {
        const { settings, bridge, document } = setup();
        await change(settings, 'nohentai');
        await tick(60 * 1000);
        select.connector(document, mangadex);
        await tick(DELAY);
        expect(bridge.sent.at(-1).startTimestamp).toBe(START.getTime() + 60 * 1000);
    });

    it('should show the status of the application when the presence is switched on before anything was selected', async () => {
        const { settings, bridge } = setup();
        await change(settings, 'nohentai');
        await tick(DELAY);
        expect(bridge.sent).toEqual([
            {
                largeImageKey: 'logo',
                largeImageText: 'Manga & Anime Downloader for Linux, Windows & MacOS',
                startTimestamp: START.getTime(),
            },
        ]);
    });

    it('should keep the details and the state within the 128 characters that Discord accepts', async () => {
        const status = await shown(select.chapter, {
            title: 'C'.repeat(300),
            manga: { title: 'M'.repeat(300), connector: mangadex },
        });
        expect(status.details.length).toBeLessThanOrEqual(128);
        expect(status.state.length).toBeLessThanOrEqual(128);
    });
});

describe('what is shown while hentai is hidden', () => {
    const manga = (tags) => ({ title: 'Some Manga', connector: connector('Site', tags) });

    const SELECTIONS = {
        connector: (document, tags) => select.connector(document, connector('Site', tags)),
        manga: (document, tags) => select.manga(document, manga(tags)),
        chapter: (document, tags) =>
            select.chapter(document, { title: 'Chapter 1', manga: manga(tags) }),
    };

    it.each([
        ['hold back', ['hentai'], 'nohentai'],
        ['hold back', ['Hentai'], 'nohentai'],
        ['hold back', ['PORN'], 'nohentai'],
        ['hold back', ['manga', 'HeNtAi', 'english'], 'nohentai'],
        ['hold back', ['porn', 'manga'], 'nohentai'],
        ['show', ['manga'], 'nohentai'],
        ['show', [], 'nohentai'],
        ['show', ['hentai-free', 'pornography'], 'nohentai'],
        ['show', ['hentai'], 'hentai'],
        ['show', ['PORN'], 'hentai'],
        ['show', ['manga'], 'hentai'],
    ])(
        'should %s what is selected on a connector with the tags %j when the mode is %s',
        async (action, tags, mode) => {
            for (const [kind, selectKind] of Object.entries(SELECTIONS)) {
                const { settings, bridge, document } = setup();
                await change(settings, mode);
                selectKind(document, tags);
                await tick(DELAY + INTERVAL);
                expect(
                    bridge.setActivity,
                    `the ${kind} of a connector with the tags ${tags}`,
                ).toHaveBeenCalledTimes(action === 'show' ? 1 : 0);
            }
        },
    );

    it('should drop what it holds back, so it is not sent later either', async () => {
        const { discord, settings, bridge, document } = setup();
        await change(settings, 'nohentai');
        select.connector(document, connector('Site', ['hentai']));
        await tick(DELAY);
        expect(discord.statusNew).toBe(false);
        await tick(10 * INTERVAL);
        expect(bridge.setActivity).not.toHaveBeenCalled();
    });

    it('should show the next selection when it is no hentai', async () => {
        const { settings, bridge, document } = setup();
        await change(settings, 'nohentai');
        select.connector(document, connector('Adult', ['hentai']));
        await tick(DELAY);
        select.connector(document, connector('Family', ['manga']));
        await tick(DELAY);
        expect(bridge.setActivity).toHaveBeenCalledTimes(1);
        expect(bridge.sent[0].details).toBe('Browsing Family');
    });

    it('should show hentai after the user allowed it, and hold it back again after the user forbade it', async () => {
        const { settings, bridge, document } = setup();
        await change(settings, 'nohentai');
        select.connector(document, connector('Adult', ['hentai']));
        await tick(DELAY);
        expect(bridge.setActivity).not.toHaveBeenCalled();

        await change(settings, 'hentai');
        select.connector(document, connector('Adult', ['hentai']));
        await tick(DELAY);
        expect(bridge.setActivity).toHaveBeenCalledTimes(1);

        await change(settings, 'nohentai');
        select.connector(document, connector('Adult 2', ['hentai']));
        await tick(DELAY + INTERVAL);
        expect(bridge.setActivity).toHaveBeenCalledTimes(1);
    });

    it('should read the tags without changing them', () => {
        const { discord } = setup();
        const tags = ['Hentai', 'Manga'];
        discord.isThisHentai(tags);
        expect(discord.hentai).toBe(true);
        expect(tags).toEqual(['Hentai', 'Manga']);
        discord.isThisHentai(['manga']);
        expect(discord.hentai).toBe(false);
    });
});

describe('the updates', () => {
    const chapter = {
        title: 'Chapter 1',
        manga: { title: 'One Piece', connector: connector('MangaDex') },
    };

    it('should send the last selection once, when the user selects several things within the delay', async () => {
        const { settings, bridge, document } = setup();
        await change(settings, 'nohentai');
        select.connector(document, connector('MangaDex'));
        await tick(500);
        select.manga(document, { title: 'One Piece', connector: connector('MangaDex') });
        await tick(500);
        select.chapter(document, chapter);
        await tick(10 * 1000);
        expect(bridge.setActivity).toHaveBeenCalledTimes(1);
        expect(bridge.sent[0].state).toBe('Chapter 1');
    });

    it('should send nothing more while nothing new was selected', async () => {
        const { discord, settings, bridge, document } = setup();
        await change(settings, 'nohentai');
        select.chapter(document, chapter);
        await tick(DELAY);
        expect(discord.statusNew).toBe(false);
        await tick(10 * INTERVAL);
        expect(bridge.setActivity).toHaveBeenCalledTimes(1);
    });

    it('should keep one timer for the updates, however often it is started', async () => {
        const { discord, settings, bridge, document } = setup();
        await change(settings, 'nohentai');
        for (let index = 0; index < 5; index++) {
            select.chapter(document, { ...chapter, title: `Chapter ${index}` });
            await change(settings, 'nohentai', 'saved');
        }
        await tick(RETRY / 4);
        expect(vi.getTimerCount()).toBe(1);
        expect(discord.updater).not.toBeNull();
        expect(bridge.ensureStarted.mock.calls.length).toBeGreaterThan(5);
    });

    it('should try again with the next update when Discord did not take the activity, until it does', async () => {
        const { discord, settings, bridge, document } = setup();
        bridge.results.push(false, false);
        select.chapter(document, chapter);
        await change(settings, 'nohentai');

        await tick(DELAY);
        expect(bridge.setActivity).toHaveBeenCalledTimes(1);
        expect(discord.statusNew).toBe(true);

        await tick(INTERVAL - DELAY);
        expect(bridge.setActivity).toHaveBeenCalledTimes(2);
        expect(discord.statusNew).toBe(true);

        await tick(INTERVAL);
        expect(bridge.setActivity).toHaveBeenCalledTimes(3);
        expect(discord.statusNew).toBe(false);

        await tick(5 * INTERVAL);
        expect(bridge.setActivity).toHaveBeenCalledTimes(3);
        expect(bridge.sent.map((status) => status.state)).toEqual([
            'Chapter 1',
            'Chapter 1',
            'Chapter 1',
        ]);
    });

    // NOTE: only the timer of the interval keeps to the 15 seconds that the code names as the limit of the API: a new selection is
    // sent two seconds later, however recent the last activity was
    it('should send a selection two seconds after it, even when the last activity is only a few seconds old', async () => {
        const { settings, bridge, document } = setup();
        await change(settings, 'nohentai');
        select.chapter(document, { ...chapter, title: 'Chapter 1' });
        await tick(DELAY);
        select.chapter(document, { ...chapter, title: 'Chapter 2' });
        await tick(DELAY);
        expect(bridge.sent.map((status) => status.state)).toEqual(['Chapter 1', 'Chapter 2']);
    });
});

describe('when Discord is not running', () => {
    const chapter = {
        title: 'Chapter 1',
        manga: { title: 'One Piece', connector: connector('MangaDex') },
    };

    it('should send nothing, and ask for the connection again after two minutes', async () => {
        const { settings, bridge, document } = setup({
            presence: { ensureStarted: vi.fn(async () => false) },
        });
        await change(settings, 'nohentai');
        select.chapter(document, chapter);
        await tick(0);
        const asked = bridge.ensureStarted.mock.calls.length;
        await tick(RETRY - 1);
        expect(bridge.ensureStarted).toHaveBeenCalledTimes(asked);
        expect(bridge.setActivity).not.toHaveBeenCalled();
        await tick(1);
        expect(bridge.ensureStarted.mock.calls.length).toBeGreaterThan(asked);
        expect(bridge.setActivity).not.toHaveBeenCalled();
    });

    it('should show what the user selected meanwhile as soon as Discord is there', async () => {
        const { settings, bridge, document } = setup();
        bridge.ensureStarted.mockResolvedValue(false);
        await change(settings, 'nohentai');
        select.chapter(document, chapter);
        await tick(RETRY / 2);
        bridge.ensureStarted.mockResolvedValue(true);

        await tick(RETRY / 2 + DELAY);

        expect(bridge.setActivity).toHaveBeenCalledTimes(1);
        expect(bridge.sent[0].state).toBe('Chapter 1');
    });

    it('should stop asking when the user switches the setting off meanwhile', async () => {
        const { settings, bridge } = setup({
            presence: { ensureStarted: vi.fn(async () => false) },
        });
        await change(settings, 'nohentai');
        await change(settings, 'none');
        bridge.ensureStarted.mockClear();
        await tick(10 * RETRY);
        expect(bridge.ensureStarted).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('should have one request for the connection pending, not one for each selection', async () => {
        const { settings, bridge, document } = setup({
            presence: { ensureStarted: vi.fn(async () => false) },
        });
        await change(settings, 'nohentai');
        for (const title of ['Chapter 1', 'Chapter 2', 'Chapter 3']) {
            select.chapter(document, { ...chapter, title });
        }
        await tick(0);
        const asked = bridge.ensureStarted.mock.calls.length;
        await tick(RETRY);
        expect(bridge.ensureStarted.mock.calls.length - asked).toBe(1);
    });
});

describe('when the bridge fails', () => {
    // NOTE: the calls of the bridge are not caught anywhere, so a failure of the bridge (an error of the IPC) rejects the call, and the
    // timers and event handlers that make the calls leave an unhandled rejection; the main side answers false instead of failing
    it('should keep what was not sent, so the next update sends it', async () => {
        const { discord, settings, bridge, document } = setup();
        await change(settings, 'nohentai');
        select.chapter(document, {
            title: 'Chapter 1',
            manga: { title: 'One Piece', connector: connector('MangaDex') },
        });
        await tick(DELAY - 1);
        bridge.setActivity.mockRejectedValueOnce(new Error('IPC failed'));

        await expect(discord.updateStatus()).rejects.toThrow('IPC failed');
        expect(discord.statusNew).toBe(true);

        await discord.updateStatus();
        expect(bridge.setActivity).toHaveBeenCalledTimes(2);
        expect(discord.statusNew).toBe(false);
    });

    it('should reject the start when the bridge cannot be asked, and not leave timers behind', async () => {
        const { discord, bridge } = setup();
        bridge.ensureStarted.mockRejectedValue(new Error('IPC failed'));
        await expect(discord.startDiscordPresence()).rejects.toThrow('IPC failed');
        expect(vi.getTimerCount()).toBe(0);
        expect(discord.updater).toBeNull();
    });

    it('should have stopped its updates before it asks the bridge to clear the activity', async () => {
        const { discord, settings, bridge } = setup();
        await change(settings, 'nohentai');
        await tick(DELAY);
        bridge.clearAndDestroy.mockRejectedValue(new Error('IPC failed'));
        await expect(discord.stopDiscordPresence()).rejects.toThrow('IPC failed');
        expect(discord.updater).toBeNull();
        expect(discord.statusNew).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('should not send anything while it is disabled or has nothing new', async () => {
        const { discord, bridge } = setup();
        await discord.updateStatus();
        discord.enabled = true;
        discord.statusNew = false;
        await discord.updateStatus();
        expect(bridge.setActivity).not.toHaveBeenCalled();
    });
});
