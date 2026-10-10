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
    vi.restoreAllMocks();
});

const directorySetting = { label: 'Manga Directory', input: 'directory', value: '/data/mangas' };

async function validate(error, silent) {
    globalThis.Engine = { Storage: { directoryExist: vi.fn(() => (error ? Promise.reject(error) : Promise.resolve())) } };
    globalThis.alert = vi.fn();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const value = Settings.prototype._getValidValue.call({}, 'General', directorySetting, silent);
    await new Promise(resolve => setTimeout(resolve, 0));
    return value;
}

describe('settings directory validation', () => {
    it('should keep the value and stay quiet for an existing directory', async () => {
        await expect(validate(null)).resolves.toBe('/data/mangas');
        expect(globalThis.alert).not.toHaveBeenCalled();
    });

    it('should not warn when the directory does not exist yet', async () => {
        const error = new Error("Error invoking remote method 'hakuneko:fs:stat': Error: ENOENT: no such file or directory, stat '/data/mangas'");
        await expect(validate(error)).resolves.toBe('/data/mangas');
        expect(globalThis.alert).not.toHaveBeenCalled();
        expect(console.warn).not.toHaveBeenCalled();
    });

    it('should still warn about other access problems', async () => {
        await validate(new Error('EACCES: permission denied, stat \'/data/mangas\''));
        expect(globalThis.alert).toHaveBeenCalledTimes(1);
        expect(globalThis.alert.mock.calls[0][0]).toContain('Cannot access the directory for "Manga Directory" from "General" settings!');
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
            late: { token: 'abc' }
        }
    };

    function engine(connectors) {
        globalThis.window = {
            hakuneko: { app: { getPath: () => '/docs' }, path: require('node:path'), env: {} }
        };
        globalThis.Engine = {
            Connectors: connectors,
            Storage: {
                loadConfig: vi.fn(async () => stored),
                saveConfig: vi.fn(async () => undefined)
            }
        };
    }

    afterEach(() => {
        delete globalThis.window;
    });

    it('should keep the stored settings of connectors that are not registered yet when saving', async () => {
        const west = { id: 'west', label: 'West', config: { username: { input: 'text', value: '' }, password: { input: 'text', value: '' } } };
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
