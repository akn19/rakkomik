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
    jest.restoreAllMocks();
});

const directorySetting = { label: 'Manga Directory', input: 'directory', value: '/data/mangas' };

async function validate(error, silent) {
    globalThis.Engine = { Storage: { directoryExist: jest.fn(() => (error ? Promise.reject(error) : Promise.resolve())) } };
    globalThis.alert = jest.fn();
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
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
