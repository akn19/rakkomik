// The settings of the engine on their own, with a stand-in for the storage: the defaults, the categories, what a value
// may be, the passwords, loading and saving. The settings as they reach the disk are in SettingsPersistence.test.js.
//
// Directory validation contract: a missing directory is created on the
// first write (Storage._createDirectoryChain), so it must not raise the
// blocking warning; real access problems still do.
let Settings = null;

beforeAll(async () => {
    Settings = (await import('../mjs/engine/Settings.mjs')).default;
});

afterEach(() => {
    delete globalThis.Engine;
    delete globalThis.alert;
    delete globalThis.window;
    vi.restoreAllMocks();
});

const directorySetting = { label: 'Manga Directory', input: 'directory', value: '/data/mangas' };

async function validate(error, silent) {
    globalThis.Engine = {
        Storage: {
            directoryExist: vi.fn(() => (error ? Promise.reject(error) : Promise.resolve())),
        },
    };
    globalThis.alert = vi.fn();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const value = Settings.prototype._getValidValue.call({}, 'General', directorySetting, silent);
    await new Promise((resolve) => setTimeout(resolve, 0));
    return value;
}

describe('settings directory validation', () => {
    it('should keep the value and stay quiet for an existing directory', async () => {
        await expect(validate(null)).resolves.toBe('/data/mangas');
        expect(globalThis.alert).not.toHaveBeenCalled();
    });

    it('should not warn when the directory does not exist yet', async () => {
        const error = new Error(
            "Error invoking remote method 'rakkomik:fs:stat': Error: ENOENT: no such file or directory, stat '/data/mangas'",
        );
        await expect(validate(error)).resolves.toBe('/data/mangas');
        expect(globalThis.alert).not.toHaveBeenCalled();
        expect(console.warn).not.toHaveBeenCalled();
    });

    it('should still warn about other access problems', async () => {
        await validate(new Error("EACCES: permission denied, stat '/data/mangas'"));
        expect(globalThis.alert).toHaveBeenCalledTimes(1);
        expect(globalThis.alert.mock.calls[0][0]).toContain(
            'Cannot access the directory for "Manga Directory" from "General" settings!',
        );
    });

    it('should only log silently validated problems', async () => {
        await validate(new Error('The given path "/data/mangas" is not a directory!'), true);
        expect(globalThis.alert).not.toHaveBeenCalled();
        expect(console.warn).toHaveBeenCalledTimes(1);
    });
});

describe('settings of background loaded connectors', () => {
    const stored = {
        connectors: {
            west: { username: 'user', password: 'secret' },
            late: { token: 'abc' },
        },
    };

    function engine(connectors) {
        globalThis.window = {
            hakuneko: { app: { getPath: () => '/docs' }, platform: 'linux', env: {} },
        };
        globalThis.Engine = {
            Connectors: connectors,
            Storage: {
                loadConfig: vi.fn(async () => stored),
                saveConfig: vi.fn(async () => undefined),
            },
        };
    }

    afterEach(() => {
        delete globalThis.window;
    });

    it('should keep the stored settings of connectors that are not registered yet when saving', async () => {
        const west = {
            id: 'west',
            label: 'West',
            config: {
                username: { input: 'text', value: '' },
                password: { input: 'text', value: '' },
            },
        };
        engine([west]);
        const settings = new Settings();
        await settings.load();
        expect(west.config.username.value).toBe('user');
        await settings.save();
        const saved = globalThis.Engine.Storage.saveConfig.mock.calls[0][1];
        expect(saved.connectors.west).toEqual({ username: 'user', password: 'secret' });
        expect(saved.connectors.late).toEqual({ token: 'abc' });
    });

    it('should apply the stored settings to connectors that register later', async () => {
        const late = { id: 'late', label: 'Late', config: { token: { input: 'text', value: '' } } };
        const connectors = [];
        engine(connectors);
        const settings = new Settings();
        await settings.load();
        connectors.push(late);
        await settings.load();
        expect(late.config.token.value).toBe('abc');
    });
});

describe('settings of novels', () => {
    function settings() {
        globalThis.window = {
            hakuneko: { app: { getPath: () => '/docs' }, platform: 'linux', env: {} },
        };
        return new Settings();
    }

    afterEach(() => {
        delete globalThis.window;
    });

    it('should store novels as EPUB unless told otherwise, and offer EPUB and PDF', () => {
        const { novelFormat } = settings();
        expect(novelFormat.input).toBe('select');
        expect(novelFormat.value).toBe('.epub');
        expect(novelFormat.options.map((option) => option.value)).toEqual(['.epub', '.pdf']);
        expect(novelFormat.options.map((option) => option.name)).toEqual([
            'Ebook Reader (*.epub)',
            'Portable Document (*.pdf)',
        ]);
    });

    it('should keep the format of novels apart from the format of the chapters of comics', () => {
        const { chapterFormat, novelFormat } = settings();
        expect(chapterFormat.options.map((option) => option.value)).toEqual([
            'img',
            '.cbz',
            '.epub',
        ]);
        expect(novelFormat).not.toBe(chapterFormat);
    });

    it('should show the format of novels with the general settings', () => {
        globalThis.Engine = { Connectors: [] };
        const general = settings().getCategorizedSettings();
        expect(general[0].category).toBe('General');
        expect(general[0].settings.map((setting) => setting.label)).toContain('Novel File Format');
    });

    it('should not claim that the colours of the reader change the files of novels', () => {
        const { NovelColorProfiles } = settings();
        expect(NovelColorProfiles.description).not.toMatch(/image/i);
        expect(NovelColorProfiles.description).toContain('reader');
    });
});

// The settings as the engine creates them: the places that the main process reports decide the defaults.
function createSettings({
    platform = 'linux',
    env = {},
    paths = { documents: '/docs', userData: '/userdata' },
} = {}) {
    globalThis.window = {
        hakuneko: {
            platform,
            env,
            app: {
                getPath: (name) => {
                    if (!Object.hasOwn(paths, name)) {
                        throw new Error(`Failed to get '${name}' path`);
                    }
                    return paths[name];
                },
            },
        },
    };
    return new Settings();
}

function stubEngine({ connectors = [], stored, loadError, saveError } = {}) {
    const storage = {
        loadConfig: vi.fn(async () => {
            if (loadError) {
                throw loadError;
            }
            return stored;
        }),
        saveConfig: vi.fn(async () => {
            if (saveError) {
                throw saveError;
            }
        }),
        directoryExist: vi.fn(async () => undefined),
    };
    globalThis.Engine = { Connectors: connectors, Storage: storage };
    return storage;
}

const names = (settings) =>
    Object.keys(settings).filter((key) => settings[key] instanceof Object && settings[key].input);

describe('the settings a user starts with', () => {
    const DEFAULTS = {
        readerEnabled: ['checkbox', true],
        baseDirectory: ['directory', '/docs/Mangas'],
        bookmarkDirectory: ['directory', '/userdata'],
        useSubdirectory: ['checkbox', false],
        ignoreErrorOnDownload: ['checkbox', false],
        chapterTitleFormat: ['text', ''],
        chapterFormat: ['select', 'img'],
        novelFormat: ['select', '.epub'],
        recompressionFormat: ['select', 'image/jpeg'],
        recompressionQuality: ['numeric', 90],
        useSequentialMediaDownloads: ['checkbox', false],
        proxyRules: ['text', ''],
        proxyAuth: ['password', ''],
        hCaptchaAccessibilityUUID: ['text', ''],
        downloadHistoryLogFormat: ['select', ''],
        postChapterDownloadCommand: ['text', ''],
        discordPresence: ['select', 'none'],
        NovelColorProfiles: ['select', 'Light'],
    };

    it.each(Object.entries(DEFAULTS))(
        'should start with %s as a %s of %j',
        (name, [input, value]) => {
            const settings = createSettings();
            expect(settings[name].input).toBe(input);
            expect(settings[name].value).toBe(value);
        },
    );

    it('should not miss a setting, and not have one more than is known here', () => {
        expect(names(createSettings()).sort()).toEqual(Object.keys(DEFAULTS).sort());
    });

    it('should describe every setting: a label of its own, and what it does', () => {
        const settings = createSettings();
        const labels = names(settings).map((name) => settings[name].label);
        expect(new Set(labels).size).toBe(labels.length);
        for (const name of names(settings)) {
            expect(settings[name].label, name).toMatch(/\S/);
            expect(settings[name].description, name).toMatch(/\S/);
        }
    });

    it('should offer a choice that holds the default, with names to show, for every select', () => {
        const settings = createSettings();
        for (const name of names(settings).filter((key) => settings[key].input === 'select')) {
            const { options, value } = settings[name];
            expect(options.length, name).toBeGreaterThan(0);
            expect(
                options.map((option) => option.value),
                name,
            ).toContain(value);
            expect(new Set(options.map((option) => option.value)).size, name).toBe(options.length);
            for (const option of options) {
                expect(option.name, name).toMatch(/\S/);
            }
        }
    });

    it('should have a default that is inside the limits of a number', () => {
        const { recompressionQuality } = createSettings();
        expect(recompressionQuality.min).toBe(50);
        expect(recompressionQuality.max).toBe(100);
        expect(recompressionQuality.value).toBeGreaterThanOrEqual(recompressionQuality.min);
        expect(recompressionQuality.value).toBeLessThanOrEqual(recompressionQuality.max);
    });

    it.each([
        [
            'linux',
            { documents: '/home/me/Documents', userData: '/home/me/.config/RakKomik' },
            '/home/me/Documents/Mangas',
        ],
        [
            'darwin',
            {
                documents: '/Users/me/Documents',
                userData: '/Users/me/Library/Application Support/RakKomik',
            },
            '/Users/me/Documents/Mangas',
        ],
        [
            'win32',
            {
                documents: 'C:\\Users\\me\\Documents',
                userData: 'C:\\Users\\me\\AppData\\Roaming\\RakKomik',
            },
            'C:\\Users\\me\\Documents\\Mangas',
        ],
    ])(
        'should keep the mangas in the documents of the user, and the bookmarks in the user data, on %s',
        (platform, paths, mangas) => {
            const settings = createSettings({ platform, paths });
            expect(settings.baseDirectory.value).toBe(mangas);
            expect(settings.bookmarkDirectory.value).toBe(paths.userData);
        },
    );

    it('should keep the mangas in the working directory when electron cannot find the documents', () => {
        const settings = createSettings({ paths: { userData: '/userdata' } });
        expect(settings.baseDirectory.value).toBe('Mangas');
        expect(settings.bookmarkDirectory.value).toBe('/userdata');
    });

    it('should not let the user choose the bookmark directory of a portable application', () => {
        expect(createSettings({ env: { HAKUNEKO_PORTABLE: '1' } }).bookmarkDirectory.input).toBe(
            'disabled',
        );
        expect(createSettings({ env: {} }).bookmarkDirectory.input).toBe('directory');
    });
});

describe('the settings by category', () => {
    const config = () => ({
        user: { input: 'text', value: '' },
        token: { input: 'password', value: '' },
    });

    it('should list the settings of the engine, and then those of each connector that has some, in the order of the connectors', () => {
        const west = { id: 'west', label: 'West', config: config() };
        const east = {
            id: 'east',
            label: 'East',
            config: { quality: { input: 'numeric', value: 1 } },
        };
        stubEngine({
            connectors: [
                west,
                { id: 'quiet', label: 'Quiet' },
                east,
                { id: 'none', label: 'None', config: null },
            ],
        });
        const settings = createSettings();
        const categories = settings.getCategorizedSettings();
        expect(categories.map((category) => category.category)).toEqual([
            'General',
            'West',
            'East',
        ]);
        expect(categories[0].settings).toEqual(names(settings).map((name) => settings[name]));
        // the settings are the ones of the connector, so that what the user changes reaches it
        expect(categories[1].settings[0]).toBe(west.config.user);
        expect(categories[1].settings[1]).toBe(west.config.token);
        expect(categories[2].settings).toEqual([east.config.quality]);
    });

    it('should list only the settings that have an input in the general category', () => {
        stubEngine();
        const settings = createSettings();
        const before = settings.getCategorizedSettings()[0].settings;
        settings.helper = { value: 1 };
        settings.note = 'text';
        const [general] = settings.getCategorizedSettings();
        expect(general.settings).toEqual(before);
        expect(general.settings).not.toContain(settings.helper);
    });

    it('should list a disabled setting too, so that it can be shown as such', () => {
        stubEngine();
        const settings = createSettings({ env: { HAKUNEKO_PORTABLE: '1' } });
        expect(settings.getCategorizedSettings()[0].settings).toContain(settings.bookmarkDirectory);
    });

    it('should iterate over the same settings', () => {
        stubEngine();
        const settings = createSettings();
        expect([...settings]).toEqual(names(settings).map((name) => settings[name]));
    });
});

describe('the colours of novels', () => {
    it.each([
        ['Light', { background: 'white', text: 'black' }],
        ['Dark', { background: 'black', text: 'white' }],
        ['dark', { background: 'black', text: 'white' }],
        ['LIGHT', { background: 'white', text: 'black' }],
    ])('should be the colours of %s', (value, colors) => {
        const settings = createSettings();
        settings.NovelColorProfiles.value = value;
        expect(settings.NovelColorProfile()).toEqual(colors);
    });

    // NOTE: a profile that does not exist (a settings file of another version) is no colour scheme: the caller has to
    // handle the TypeError, which the reader does (see novelColors in ui/novel.js)
    it('should not exist for a profile the engine does not know', () => {
        const settings = createSettings();
        settings.NovelColorProfiles.value = 'Sepia';
        expect(() => settings.NovelColorProfile()).toThrow(TypeError);
    });
});

describe('what a value may be', () => {
    const numeric = (overrides) => ({
        label: 'Quality',
        input: 'numeric',
        value: 75,
        min: 50,
        max: 100,
        ...overrides,
    });
    const valid = (setting, silent) => createSettings()._getValidValue('General', setting, silent);

    it.each([
        [49, 50],
        [50, 50],
        [51, 51],
        [75, 75],
        [99.5, 99.5],
        [100, 100],
        [101, 100],
        [-1, 50],
        [0, 50],
        [1e9, 100],
        [-Infinity, 50],
        [Infinity, 100],
        // a number that was typed in is a text for a moment
        ['45', 50],
        ['101', 100],
    ])(
        'should bring the number %j to %j when it has to stay between 50 and 100',
        (value, expected) => {
            expect(valid(numeric({ value }))).toBe(expected);
        },
    );

    // NOTE: a number in a text that is inside the limits stays a text; the users of the setting parse it (parseFloat)
    it('should keep a text that is a number inside the limits as it is', () => {
        expect(valid(numeric({ value: '75' }))).toBe('75');
    });

    it('should check the limit that there is, and no other', () => {
        expect(valid({ input: 'numeric', value: 5 })).toBe(5);
        expect(valid({ input: 'numeric', value: 5, min: 10 })).toBe(10);
        expect(valid({ input: 'numeric', value: 5, max: 3 })).toBe(3);
        expect(valid({ input: 'numeric', value: -1, min: 0 })).toBe(0);
        expect(valid({ input: 'numeric', value: 1000000, min: 0 })).toBe(1000000);
    });

    it.each([
        ['text', 'anything'],
        ['text', ''],
        ['password', 'user:secret'],
        ['checkbox', false],
        ['select', 'not an option'],
        ['file', '/some/where'],
        ['disabled', 'x'],
    ])('should leave a value of the type %s alone: %j', (input, value) => {
        expect(valid({ label: 'x', input, value })).toBe(value);
    });

    it('should ask for a directory to be checked without waiting for the answer', () => {
        const storage = stubEngine();
        expect(valid({ label: 'Folder', input: 'directory', value: '/library' })).toBe('/library');
        expect(storage.directoryExist).toHaveBeenCalledWith('/library');
    });
});

describe('the settings that are passwords', () => {
    // made by `openssl enc -aes-256-cbc -md md5 -base64 -A -pass pass:HakuNeko!`, the way the earlier versions stored them
    const SALTED = 'U2FsdGVkX1+exQaGScmKu9RKDqjRZ/ewDVn74q5/V0Q=';
    const UNSALTED = 'yzhSapl8pONmD2SeYUvo4w==';
    const SALTED_UNICODE = 'U2FsdGVkX182OgsH+C9Rg58LfDcgPrOYBBImIXOl0HcoojS1y5fmKgbOJmV6U1yp';

    it('should be stored as an envelope that does not show the password, and give it back', async () => {
        const settings = createSettings();
        const stored = await settings._getEncryptedValue('password', 'user:secret');
        // "Salted__" in base64
        expect(stored).toMatch(/^U2FsdGVkX1[A-Za-z0-9+/]{20,}={0,2}$/);
        expect(stored).not.toContain('secret');
        await expect(settings._getDecryptedValue('password', stored)).resolves.toBe('user:secret');
    });

    it('should not be the same text twice', async () => {
        const settings = createSettings();
        const [first, second] = await Promise.all([
            settings._getEncryptedValue('password', 'same'),
            settings._getEncryptedValue('password', 'same'),
        ]);
        expect(first).not.toBe(second);
        await expect(settings._getDecryptedValue('password', first)).resolves.toBe('same');
        await expect(settings._getDecryptedValue('password', second)).resolves.toBe('same');
    });

    it.each(['p', 'user:p@ss wörd 日本 😀', 'x'.repeat(5000)])(
        'should give back %j',
        async (password) => {
            const settings = createSettings();
            await expect(
                settings._getDecryptedValue(
                    'password',
                    await settings._getEncryptedValue('password', password),
                ),
            ).resolves.toBe(password);
        },
    );

    it('should read what earlier versions stored', async () => {
        const settings = createSettings();
        await expect(settings._getDecryptedValue('password', SALTED)).resolves.toBe('user:secret');
        await expect(settings._getDecryptedValue('password', UNSALTED)).resolves.toBe(
            'user:secret',
        );
        await expect(settings._getDecryptedValue('password', SALTED_UNICODE)).resolves.toBe(
            'p@ss wörd 日本',
        );
    });

    it.each([
        ['text', 'user:secret'],
        ['numeric', 75],
        ['checkbox', true],
        ['select', 'img'],
        ['directory', '/x'],
        ['file', '/x'],
        ['disabled', 'x'],
    ])('should leave a %s as it is when it is written and read', async (input, value) => {
        const settings = createSettings();
        await expect(settings._getEncryptedValue(input, value)).resolves.toBe(value);
        await expect(settings._getDecryptedValue(input, value)).resolves.toBe(value);
    });

    it.each(['', undefined, null])(
        'should leave an empty password (%j) as it is',
        async (value) => {
            const settings = createSettings();
            await expect(settings._getEncryptedValue('password', value)).resolves.toBe(value);
            await expect(settings._getDecryptedValue('password', value)).resolves.toBe(value);
        },
    );

    it.each([
        ['text that is no envelope', 'user:secret'],
        ['a cut off envelope', SALTED.slice(0, 20)],
        ['an envelope with a damaged body', `${SALTED.slice(0, 16)}AAAA${SALTED.slice(20)}`],
    ])('should read %s as no password, and tell', async (name, value) => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        await expect(createSettings()._getDecryptedValue('password', value)).resolves.toBe('');
        expect(console.warn).toHaveBeenCalledTimes(1);
        expect(console.warn.mock.calls[0][0]).toBe(
            'Failed to decrypt settings value, falling back to empty!',
        );
    });
});

describe('loading the settings', () => {
    it('should apply what is stored, and keep the default of the rest', async () => {
        stubEngine({
            stored: {
                readerEnabled: false,
                chapterFormat: '.cbz',
                recompressionQuality: 70,
                chapterTitleFormat: '%CH%',
            },
        });
        const settings = createSettings();
        await settings.load();
        expect(settings.readerEnabled.value).toBe(false);
        expect(settings.chapterFormat.value).toBe('.cbz');
        expect(settings.recompressionQuality.value).toBe(70);
        expect(settings.chapterTitleFormat.value).toBe('%CH%');
        expect(settings.useSubdirectory.value).toBe(false);
        expect(settings.novelFormat.value).toBe('.epub');
        expect(settings.baseDirectory.value).toBe('/docs/Mangas');
    });

    it('should read the file of the settings by its key', async () => {
        const storage = stubEngine({ stored: {} });
        await createSettings().load();
        expect(storage.loadConfig).toHaveBeenCalledExactlyOnceWith('settings');
    });

    it('should keep a stored false and an empty text: only what is not there keeps the default', async () => {
        stubEngine({
            stored: {
                readerEnabled: false,
                postChapterDownloadCommand: '',
                useSequentialMediaDownloads: true,
            },
        });
        const settings = createSettings();
        await settings.load();
        expect(settings.readerEnabled.value).toBe(false);
        expect(settings.postChapterDownloadCommand.value).toBe('');
        expect(settings.useSequentialMediaDownloads.value).toBe(true);
    });

    it('should keep the default for a choice that the setting does not offer, an empty text included', async () => {
        stubEngine({ stored: { discordPresence: '', chapterFormat: '.pdf' } });
        const settings = createSettings();
        const defaults = {
            discordPresence: settings.discordPresence.value,
            chapterFormat: settings.chapterFormat.value,
        };
        await settings.load();
        expect(settings.discordPresence.value).toBe(defaults.discordPresence);
        expect(settings.chapterFormat.value).toBe(defaults.chapterFormat);
    });

    it('should take a number between the limits that the setting has', async () => {
        for (const [stored, expected] of [
            [10, 50],
            [500, 100],
            [50, 50],
            [100, 100],
        ]) {
            stubEngine({ stored: { recompressionQuality: stored } });
            const settings = createSettings();
            await settings.load();
            expect(settings.recompressionQuality.value).toBe(expected);
        }
    });

    it('should decrypt a stored password', async () => {
        stubEngine({ stored: { proxyAuth: 'U2FsdGVkX1+exQaGScmKu9RKDqjRZ/ewDVn74q5/V0Q=' } });
        const settings = createSettings();
        await settings.load();
        expect(settings.proxyAuth.value).toBe('user:secret');
    });

    it('should not take a value for a setting that is disabled', async () => {
        stubEngine({ stored: { bookmarkDirectory: '/elsewhere' } });
        const settings = createSettings({ env: { HAKUNEKO_PORTABLE: '1' } });
        await settings.load();
        expect(settings.bookmarkDirectory.value).toBe('/userdata');
    });

    it('should not invent a setting from what is stored', async () => {
        stubEngine({
            stored: {
                theme: 'dark',
                helper: { input: 'text', value: 'x' },
                connectors: {},
                constructor: 'x',
                toString: 1,
            },
        });
        const settings = createSettings();
        const before = Object.keys(settings).sort();
        await settings.load();
        expect(Object.keys(settings).sort()).toEqual(before);
        expect(settings.theme).toBeUndefined();
        expect(typeof settings.toString).toBe('function');
    });

    it('should tell the listeners, once, with the settings', async () => {
        stubEngine({ stored: { readerEnabled: false } });
        const settings = createSettings();
        const listener = vi.fn((event) => event.detail.readerEnabled.value);
        settings.addEventListener('loaded', listener);
        await settings.load();
        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener.mock.calls[0][0].detail).toBe(settings);
        expect(listener.mock.results[0].value).toBe(false);
    });

    it.each([
        ['nothing', null],
        ['no settings', undefined],
        ['a list', []],
        ['a number', 5],
        ['a text', 'readerEnabled'],
    ])(
        'should keep the defaults, and tell the listeners, for a file that holds %s',
        async (name, stored) => {
            stubEngine({ stored });
            const settings = createSettings();
            const listener = vi.fn();
            settings.addEventListener('loaded', listener);
            await settings.load();
            expect(settings.readerEnabled.value).toBe(true);
            expect(listener).toHaveBeenCalledTimes(1);
        },
    );

    // NOTE: a file that cannot be read (the first start has none) is reported as an error and ends the loading
    // without the 'loaded' event: the listeners (proxy, hCaptcha, presence) only hear about the settings when they
    // were read or written
    it('should keep the defaults, report the error, and not tell the listeners when the file cannot be read', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const failure = Object.assign(new Error('ENOENT: no such file or directory'), {
            code: 'ENOENT',
        });
        stubEngine({ loadError: failure });
        const settings = createSettings();
        const listener = vi.fn();
        settings.addEventListener('loaded', listener);
        await expect(settings.load()).resolves.toBeUndefined();
        expect(console.error).toHaveBeenCalledWith('Failed to load HakuNeko settings!', failure);
        expect(listener).not.toHaveBeenCalled();
        expect(settings.chapterFormat.value).toBe('img');
    });

    describe('of the connectors', () => {
        const westConfig = () => ({
            user: { input: 'text', value: 'default' },
            token: { input: 'password', value: '' },
            quality: { input: 'numeric', min: 1, max: 5, value: 3 },
        });

        it('should apply the stored settings to the connector with the ID, and to no other', async () => {
            const west = { id: 'west', label: 'West', config: westConfig() };
            const east = { id: 'east', label: 'East', config: westConfig() };
            stubEngine({
                connectors: [west, east],
                stored: {
                    connectors: {
                        west: {
                            user: 'me',
                            token: 'U2FsdGVkX1+exQaGScmKu9RKDqjRZ/ewDVn74q5/V0Q=',
                            quality: 9,
                            unknown: 'x',
                        },
                        nobody: { user: 'x' },
                    },
                },
            });
            await createSettings().load();
            expect(west.config.user.value).toBe('me');
            expect(west.config.token.value).toBe('user:secret');
            expect(west.config.quality.value).toBe(5);
            expect(east.config.user.value).toBe('default');
            expect(west.config.unknown).toBeUndefined();
        });

        it('should apply nothing to a connector that has no settings', async () => {
            const bookmarks = { id: 'bookmarks', label: 'Bookmarks', config: undefined };
            stubEngine({
                connectors: [bookmarks, { id: 'plain', label: 'Plain' }],
                stored: { connectors: { bookmarks: { x: 1 }, plain: { y: 2 } } },
            });
            await expect(createSettings().load()).resolves.toBeUndefined();
            expect(bookmarks.config).toBeUndefined();
        });

        it('should only warn about a directory of a connector that cannot be read, and not ask', async () => {
            vi.spyOn(console, 'warn').mockImplementation(() => undefined);
            globalThis.alert = vi.fn();
            const folder = {
                id: 'folder',
                label: 'Folder',
                config: { path: { label: 'Manga Folder', input: 'directory', value: '' } },
            };
            const storage = stubEngine({
                connectors: [folder],
                stored: { connectors: { folder: { path: '/library' } } },
            });
            storage.directoryExist.mockRejectedValue(new Error('EACCES: permission denied'));
            await createSettings().load();
            await new Promise((resolve) => setTimeout(resolve, 0));
            expect(folder.config.path.value).toBe('/library');
            expect(globalThis.alert).not.toHaveBeenCalled();
            expect(console.warn).toHaveBeenCalledTimes(1);
            expect(console.warn.mock.calls[0][0]).toContain(
                'Cannot access the directory for "Manga Folder" from "Folder" settings!',
            );
        });
    });
});

describe('saving the settings', () => {
    it('should write every setting by its name, and the settings of the connectors by their IDs, in a file that a person can read', async () => {
        const west = {
            id: 'west',
            label: 'West',
            config: { user: { input: 'text', value: 'me' }, level: { input: 'numeric', value: 4 } },
        };
        const storage = stubEngine({ connectors: [west, { id: 'plain', label: 'Plain' }] });
        const settings = createSettings();
        settings.chapterFormat.value = '.cbz';
        await settings.save();
        expect(storage.saveConfig).toHaveBeenCalledTimes(1);
        const [key, data, indentation] = storage.saveConfig.mock.calls[0];
        expect(key).toBe('settings');
        expect(indentation).toBe(2);
        expect(Object.keys(data).sort()).toEqual([...names(settings), 'connectors'].sort());
        expect(data.chapterFormat).toBe('.cbz');
        expect(data.recompressionQuality).toBe(90);
        expect(data.connectors.west).toEqual({ user: 'me', level: 4 });
    });

    it('should write a password as the envelope, and no other value changed', async () => {
        const storage = stubEngine({
            connectors: [
                {
                    id: 'west',
                    label: 'West',
                    config: {
                        token: { input: 'password', value: 'tok-123' },
                        open: { input: 'text', value: 'plain-456' },
                    },
                },
            ],
        });
        const settings = createSettings();
        settings.proxyAuth.value = 'user:secret';
        settings.proxyRules.value = 'user:secret';
        await settings.save();
        const data = storage.saveConfig.mock.calls[0][1];
        expect(data.proxyAuth).toMatch(/^U2FsdGVkX1/);
        expect(data.proxyRules).toBe('user:secret');
        expect(data.connectors.west.token).toMatch(/^U2FsdGVkX1/);
        expect(data.connectors.west.open).toBe('plain-456');
        // the password is in no other form than the envelope
        expect(JSON.stringify(data)).not.toContain('tok-123');
        expect(JSON.stringify(data).split('user:secret')).toHaveLength(2);
    });

    it('should leave a disabled setting out', async () => {
        const storage = stubEngine();
        await createSettings({ env: { HAKUNEKO_PORTABLE: '1' } }).save();
        expect(storage.saveConfig.mock.calls[0][1]).not.toHaveProperty('bookmarkDirectory');
    });

    it('should write the values as they are when it is called', async () => {
        const storage = stubEngine();
        const settings = createSettings();
        await settings.save();
        settings.useSubdirectory.value = true;
        settings.postChapterDownloadCommand.value = 'echo "%PATH%"';
        await settings.save();
        expect(storage.saveConfig.mock.calls[0][1].useSubdirectory).toBe(false);
        expect(storage.saveConfig.mock.calls[1][1].useSubdirectory).toBe(true);
        expect(storage.saveConfig.mock.calls[1][1].postChapterDownloadCommand).toBe(
            'echo "%PATH%"',
        );
    });

    it('should tell the listeners, once, with the settings, after the file is written', async () => {
        const storage = stubEngine();
        let finish;
        storage.saveConfig.mockImplementation(
            () =>
                new Promise((resolve) => {
                    finish = resolve;
                }),
        );
        const settings = createSettings();
        const listener = vi.fn();
        settings.addEventListener('saved', listener);
        const saving = settings.save();
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(listener).not.toHaveBeenCalled();
        finish();
        await saving;
        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener.mock.calls[0][0].detail).toBe(settings);
    });

    // NOTE: a failed save is logged, but the promise is not rejected: the caller (the settings dialog of the UI) cannot
    // tell it from a save that worked; the listeners are not told
    it('should report the error, keep quiet for the listeners, and not reject when the file cannot be written', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const failure = new Error('EACCES: permission denied');
        stubEngine({ saveError: failure });
        const settings = createSettings();
        const listener = vi.fn();
        settings.addEventListener('saved', listener);
        await expect(settings.save()).resolves.toBeUndefined();
        expect(console.error).toHaveBeenCalledWith('Failed to save HakuNeko settings!', failure);
        expect(listener).not.toHaveBeenCalled();
    });
});

describe('the settings of a connector that is registered later', () => {
    it('should keep what is stored for a connector that was never registered, and replace what is stored for one that is', async () => {
        const west = { id: 'west', label: 'West', config: { user: { input: 'text', value: '' } } };
        const storage = stubEngine({
            connectors: [west],
            stored: { connectors: { west: { user: 'old', gone: 'x' }, late: { token: 'abc' } } },
        });
        const settings = createSettings();
        await settings.load();
        west.config.user.value = 'new';
        await settings.save();
        const { connectors } = storage.saveConfig.mock.calls[0][1];
        expect(connectors.west).toEqual({ user: 'new' });
        expect(connectors.late).toEqual({ token: 'abc' });
    });
});
