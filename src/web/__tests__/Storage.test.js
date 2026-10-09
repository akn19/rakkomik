// Atomic-write contract tests: Storage must publish via temp+rename,
// never with a direct write to the target.
const path = require('node:path');
const os = require('node:os');

let Storage = null;

function fakeHakuneko(fs) {
    globalThis.window = {
        hakuneko: {
            dialog: {},
            platform: 'linux',
            shell: {},
            fs,
            path,
            app: { getPath: () => '/tmp/rakkomik-test-userdata' },
            os: { tmpdir: os.tmpdir() }
        }
    };
}

beforeAll(async () => {
    Storage = (await import('../mjs/engine/Storage.mjs')).default;
});

afterEach(() => {
    delete globalThis.window;
});

function recordingFs(behavior) {
    const calls = [];
    return {
        calls,
        existsSync: jest.fn(() => true),
        mkdirSync: jest.fn(),
        writeFile: jest.fn((p, data) => {
            calls.push(['writeFile', p]);
            return behavior && behavior.writeFile ? behavior.writeFile(p, data) : Promise.resolve();
        }),
        rename: jest.fn((from, to) => {
            calls.push(['rename', from, to]);
            return behavior && behavior.rename ? behavior.rename(from, to) : Promise.resolve();
        }),
        unlink: jest.fn(p => {
            calls.push(['unlink', p]);
            return Promise.resolve();
        })
    };
}

function storageWith(fs) {
    fakeHakuneko(fs);
    const storage = new Storage();
    storage.config = '/cfg/hakuneko.';
    storage._bookmarkOutputPath = undefined;
    Object.defineProperty(storage, '_bookmarkOutputPath', { get: () => '/bm/hakuneko.' });
    return storage;
}

describe('Storage atomic writes', () => {
    it('should save configs via temp file plus rename', async () => {
        const fs = recordingFs();
        const storage = storageWith(fs);
        await storage.saveConfig('settings', { a: 1 }, 2);
        expect(fs.writeFile).toHaveBeenCalledTimes(1);
        const temp = fs.writeFile.mock.calls[0][0];
        expect(temp.startsWith('/cfg/hakuneko.settings.tmp-')).toBe(true);
        expect(fs.rename).toHaveBeenCalledTimes(1);
        expect(fs.rename.mock.calls[0]).toEqual([temp, '/cfg/hakuneko.settings']);
        // the target itself is never written directly
        expect(fs.calls.some(call => call[0] === 'writeFile' && call[1] === '/cfg/hakuneko.settings')).toBe(false);
    });

    it('should save bookmarks via temp file plus rename', async () => {
        const fs = recordingFs();
        const storage = storageWith(fs);
        await storage.saveBookmarks('bookmarks', [], 2);
        const temp = fs.writeFile.mock.calls[0][0];
        expect(temp.startsWith('/bm/hakuneko.bookmarks.tmp-')).toBe(true);
        expect(fs.rename.mock.calls[0]).toEqual([temp, '/bm/hakuneko.bookmarks']);
    });

    it('should clean the temp file up when rename fails', async () => {
        const fs = recordingFs({ rename: () => Promise.reject(new Error('EXDEV')) });
        const storage = storageWith(fs);
        await expect(storage.saveConfig('settings', {}, 2)).rejects.toThrow('EXDEV');
        const temp = fs.writeFile.mock.calls[0][0];
        expect(fs.unlink).toHaveBeenCalledWith(temp);
    });

    it('should clean the temp file up when the write fails', async () => {
        const fs = recordingFs({ writeFile: () => Promise.reject(new Error('ENOSPC')) });
        const storage = storageWith(fs);
        await expect(storage.saveConfig('settings', {}, 2)).rejects.toThrow('ENOSPC');
        expect(fs.rename).not.toHaveBeenCalled();
    });

    it('should write downloads atomically and resolve with the path', async () => {
        const fs = recordingFs();
        const storage = storageWith(fs);
        await expect(storage._writeFile('/dl/page.jpg', new Uint8Array([1]))).resolves.toBe('/dl/page.jpg');
        expect(fs.rename).toHaveBeenCalledTimes(1);
    });
});
