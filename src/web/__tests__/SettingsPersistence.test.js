// The settings as they reach the disk and come back in the next session: the real Settings and the real Storage on a
// real folder (see support/storageHarness.js). The tests of the single parts are in Settings.test.js and Storage*.test.js.
const fs = require('node:fs');
const path = require('node:path');
const { createEnvironment } = require('./support/storageHarness.js');

let Settings = null;
let Storage = null;
let env = null;

beforeAll(async () => {
    Settings = (await import('../mjs/engine/Settings.mjs')).default;
    Storage = (await import('../mjs/engine/Storage.mjs')).default;
});

afterEach(() => {
    if (env) {
        env.dispose();
        env = null;
    }
    delete globalThis.alert;
    vi.restoreAllMocks();
});

/** the first session of the application on a new device: its settings, the connectors it has registered */
function start(options = {}) {
    env = createEnvironment(Storage, options);
    globalThis.Engine.Connectors = options.connectors || [];
    return session();
}

/** another start of the application on the same device: new settings that read what the earlier session wrote */
function session(connectors) {
    const settings = new Settings();
    globalThis.Engine.Settings = settings;
    if (connectors) {
        globalThis.Engine.Connectors = connectors;
    }
    return settings;
}

const names = settings => Object.keys(settings).filter(key => settings[key] instanceof Object && settings[key].input);
const file = () => path.join(env.userData, 'hakuneko.settings');
const stored = () => JSON.parse(fs.readFileSync(file(), 'utf8'));
const temporaryFiles = () => fs.readdirSync(env.userData).filter(name => name.includes('.tmp-'));

describe('the settings that the user changed', () => {
    const library = () => path.join(env.root, 'library');
    const CHANGES = {
        readerEnabled: () => false,
        baseDirectory: library,
        bookmarkDirectory: () => path.join(env.root, 'bookmarks'),
        useSubdirectory: () => true,
        ignoreErrorOnDownload: () => true,
        chapterTitleFormat: () => '%VOL% %CH% - %T%',
        chapterFormat: () => '.cbz',
        novelFormat: () => '.pdf',
        recompressionFormat: () => 'image/webp',
        recompressionQuality: () => 70,
        useSequentialMediaDownloads: () => true,
        proxyRules: () => 'http=127.0.0.1:8080;https=127.0.0.1:8080',
        proxyAuth: () => 'user:p@ss wörd 日本 😀',
        hCaptchaAccessibilityUUID: () => '68e89cc3-4c2d-4539-b80b-49ba4bec76c4',
        postChapterDownloadCommand: () => 'echo "%C% | %M% | %O%" > "%PATH%.txt"',
        discordPresence: () => 'hentai',
        NovelColorProfiles: () => 'Dark'
    };

    it.each(Object.entries(CHANGES))('should be there in the next session: %s', async (name, change) => {
        const settings = start();
        fs.mkdirSync(library());
        fs.mkdirSync(path.join(env.root, 'bookmarks'));
        settings[name].value = change();
        await settings.save();
        const next = session();
        await next.load();
        expect(next[name].value).toBe(change());
        // and nothing else changed
        for (const other of Object.keys(CHANGES).filter(key => key !== name)) {
            expect(next[other].value, other).toBe(settings[other].value);
        }
    });

    it('should all be there in the next session when they are changed together', async () => {
        const settings = start();
        fs.mkdirSync(library());
        fs.mkdirSync(path.join(env.root, 'bookmarks'));
        for (const [name, change] of Object.entries(CHANGES)) {
            settings[name].value = change();
        }
        await settings.save();
        const next = session();
        await next.load();
        for (const [name, change] of Object.entries(CHANGES)) {
            expect(next[name].value, name).toBe(change());
        }
    });

    it('should be there in the next session when they were saved silently, and tell nobody on the way', async () => {
        const settings = start();
        const listener = vi.fn();
        settings.addEventListener('saved', listener);
        settings.NovelColorProfiles.value = 'Dark';
        await settings.save({ silent: true });
        expect(stored().NovelColorProfiles).toBe('Dark');
        expect(listener).not.toHaveBeenCalled();
        const next = session();
        await next.load();
        expect(next.NovelColorProfiles.value).toBe('Dark');
    });

    it('should be written in a file that a person can read and edit', async () => {
        const settings = start();
        settings.chapterFormat.value = '.cbz';
        settings.proxyAuth.value = 'user:p@ss';
        await settings.save();
        const text = fs.readFileSync(file(), 'utf8');
        expect(text.startsWith('{\n  "readerEnabled": true,\n')).toBe(true);
        expect(text).toContain('\n  "chapterFormat": ".cbz",\n');
        expect(Object.keys(JSON.parse(text))).toEqual([...names(settings), 'connectors']);
        expect(fs.readdirSync(env.userData)).toEqual(['hakuneko.settings']);
    });

    it('should keep the password out of the file', async () => {
        const settings = start();
        settings.proxyAuth.value = 'user:p@ss-word';
        await settings.save();
        const text = fs.readFileSync(file(), 'utf8');
        expect(text).not.toContain('p@ss-word');
        expect(stored().proxyAuth).toMatch(/^U2FsdGVkX1/);
    });
});

describe('the first start, and files that are not as expected', () => {
    it('should start with the defaults when there is no file, and report it', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const settings = start();
        const listener = vi.fn();
        settings.addEventListener('loaded', listener);
        await settings.load();
        expect(settings.chapterFormat.value).toBe('img');
        expect(console.error).toHaveBeenCalledTimes(1);
        expect(console.error.mock.calls[0][0]).toBe('Failed to load HakuNeko settings!');
        expect(console.error.mock.calls[0][1]).toMatchObject({ code: 'ENOENT' });
        expect(listener).not.toHaveBeenCalled();
        // nothing is written until the user saves
        expect(fs.existsSync(file())).toBe(false);
        await settings.save();
        expect(stored().chapterFormat).toBe('img');
    });

    it('should start with the defaults when the file is damaged, and not write over it before the user saves', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const settings = start();
        fs.writeFileSync(file(), '{"readerEnabled": false, "chapterF');
        await settings.load();
        expect(settings.readerEnabled.value).toBe(true);
        expect(console.error.mock.calls[0][1]).toBeInstanceOf(SyntaxError);
        expect(fs.readFileSync(file(), 'utf8')).toBe('{"readerEnabled": false, "chapterF');
        await settings.save();
        expect(stored().readerEnabled).toBe(true);
    });

    it('should apply what an older version wrote, and keep the defaults for the settings it did not know', async () => {
        const settings = start();
        fs.writeFileSync(file(), JSON.stringify({ readerEnabled: false, chapterFormat: '.cbz', baseDirectory: path.join(env.root, 'old') }));
        const listener = vi.fn();
        settings.addEventListener('loaded', listener);
        await settings.load();
        expect(settings.readerEnabled.value).toBe(false);
        expect(settings.chapterFormat.value).toBe('.cbz');
        expect(settings.baseDirectory.value).toBe(path.join(env.root, 'old'));
        expect(settings.novelFormat.value).toBe('.epub');
        expect(settings.discordPresence.value).toBe('none');
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it('should drop what a later version wrote about settings it does not have, but keep the connectors', async () => {
        const settings = start();
        fs.writeFileSync(file(), JSON.stringify({ theme: 'dark', newSetting: { input: 'text', value: 'x' }, connectors: { late: { token: 'abc' } } }));
        await settings.load();
        await settings.save();
        const data = stored();
        expect(data).not.toHaveProperty('theme');
        expect(data).not.toHaveProperty('newSetting');
        expect(data.connectors).toEqual({ late: { token: 'abc' } });
    });

    it.each([
        [10, 50],
        [49.9, 50],
        [500, 100],
        [100.1, 100]
    ])('should bring the number %j that was written by hand to %j', async (written, expected) => {
        const settings = start();
        fs.writeFileSync(file(), JSON.stringify({ recompressionQuality: written }));
        await settings.load();
        expect(settings.recompressionQuality.value).toBe(expected);
    });

    it('should not take the bookmark directory from the file when the application is portable', async () => {
        const settings = start({ env: { HAKUNEKO_PORTABLE: '1' } });
        fs.writeFileSync(file(), JSON.stringify({ bookmarkDirectory: path.join(env.root, 'elsewhere') }));
        await settings.load();
        expect(settings.bookmarkDirectory.value).toBe(env.userData);
        await settings.save();
        expect(stored()).not.toHaveProperty('bookmarkDirectory');
    });

    it('should not take a chapter format that is not offered any more', async () => {
        const settings = start();
        fs.writeFileSync(file(), JSON.stringify({ chapterFormat: '.pdf' }));
        await settings.load();
        expect(settings.chapterFormat.options.map(option => option.value)).toContain(settings.chapterFormat.value);
    });
});

describe('what the folders of the settings need', () => {
    it('should stay quiet about a folder that is not there yet, and warn about one that is a file', async () => {
        globalThis.alert = vi.fn();
        const settings = start();
        fs.writeFileSync(path.join(env.root, 'a file'), 'x');
        fs.writeFileSync(file(), JSON.stringify({ baseDirectory: path.join(env.root, 'not yet'), bookmarkDirectory: path.join(env.root, 'a file') }));
        await settings.load();
        await env.idle();
        expect(globalThis.alert).toHaveBeenCalledTimes(1);
        expect(globalThis.alert.mock.calls[0][0]).toContain('Cannot access the directory for "Bookmarks Directory" from "General" settings!');
        expect(globalThis.alert.mock.calls[0][0]).toContain('is not a directory!');
    });
});

describe('the settings of the connectors on disk', () => {
    const connector = id => ({
        id,
        label: id.toUpperCase(),
        config: {
            username: { label: 'User', input: 'text', value: '' },
            password: { label: 'Password', input: 'password', value: '' },
            quality: { label: 'Quality', input: 'numeric', min: 1, max: 5, value: 3 }
        }
    });

    it('should be there in the next session, with the password as an envelope', async () => {
        const west = connector('west');
        const settings = start({ connectors: [west] });
        west.config.username.value = 'me';
        west.config.password.value = 's3cret ü';
        west.config.quality.value = 5;
        await settings.save();
        expect(fs.readFileSync(file(), 'utf8')).not.toContain('s3cret');
        expect(stored().connectors.west.password).toMatch(/^U2FsdGVkX1/);
        const next = connector('west');
        await session([next]).load();
        expect(next.config.username.value).toBe('me');
        expect(next.config.password.value).toBe('s3cret ü');
        expect(next.config.quality.value).toBe(5);
    });

    it('should stay on disk for a connector that is not registered in this session', async () => {
        const west = connector('west');
        const first = start({ connectors: [west] });
        west.config.username.value = 'me';
        await first.save();
        // a session in which the connector of the user plugin is missing
        const second = session([]);
        await second.load();
        await second.save();
        expect(stored().connectors.west.username).toBe('me');
        const back = connector('west');
        await session([back]).load();
        expect(back.config.username.value).toBe('me');
    });

    it('should apply to a connector that registers while the application runs', async () => {
        const west = connector('west');
        const first = start({ connectors: [west] });
        west.config.username.value = 'me';
        await first.save();
        const connectors = [];
        const second = session(connectors);
        await second.load();
        const late = connector('west');
        connectors.push(late);
        await second.load();
        expect(late.config.username.value).toBe('me');
    });
});

describe('the settings as listeners see them', () => {
    it('should reach the listeners after they were written, as the files of the settings say', async () => {
        const settings = start();
        const seen = [];
        settings.addEventListener('saved', event => seen.push(fs.existsSync(file()) && stored().proxyRules === event.detail.proxyRules.value));
        settings.proxyRules.value = 'http=proxy.web:80';
        await settings.save();
        expect(seen).toEqual([true]);
    });

    it('should reach the listeners after they were read', async () => {
        const settings = start();
        fs.writeFileSync(file(), JSON.stringify({ proxyRules: 'http=proxy.web:80' }));
        const seen = [];
        settings.addEventListener('loaded', event => seen.push(event.detail.proxyRules.value));
        await settings.load();
        expect(seen).toEqual(['http=proxy.web:80']);
    });
});

describe('saving that goes wrong or overlaps', () => {
    it('should keep the settings that were saved before, and leave nothing behind, when the new ones cannot be published', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const settings = start();
        settings.chapterFormat.value = '.cbz';
        await settings.save();
        settings.chapterFormat.value = '.epub';
        const listener = vi.fn();
        settings.addEventListener('saved', listener);
        env.hakuneko.fs.rename = vi.fn(() => Promise.reject(new Error('EBUSY: resource busy or locked')));
        await expect(settings.save()).resolves.toBeUndefined();
        expect(console.error.mock.calls[0][0]).toBe('Failed to save HakuNeko settings!');
        expect(listener).not.toHaveBeenCalled();
        expect(stored().chapterFormat).toBe('.cbz');
        expect(temporaryFiles()).toEqual([]);
    });

    // Windows cannot rename two files onto the same target at the same moment (EPERM), which write-file-atomic works
    // around with a queue; it was not tried there
    it.skipIf(process.platform === 'win32')('should leave a file that is complete when several saves overlap', async () => {
        const settings = start();
        settings.proxyRules.value = 'x'.repeat(30000);
        const saves = Array.from({ length: 12 }, () => settings.save());
        await Promise.all(saves);
        const data = stored();
        expect(data.proxyRules).toBe('x'.repeat(30000));
        expect(Object.keys(data)).toEqual([...names(settings), 'connectors']);
        expect(temporaryFiles()).toEqual([]);
    });
});
