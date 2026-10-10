const { mockModule } = require('./support/mockRequire');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

mockModule('electron', () => {
    return {
        ipcMain: {
            handle: vi.fn(),
            on: vi.fn()
        }
    };
});
const electron = require('electron');
const FsBridge = require('../FsBridge.js');

function handlers() {
    const map = {};
    for (const [channel, impl] of electron.ipcMain.handle.mock.calls) {
        map[channel] = impl;
    }
    return map;
}

describe('FsBridge', () => {
    let dir = null;

    beforeEach(() => {
        vi.clearAllMocks();
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fsbridge-'));
        new FsBridge({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }).register();
    });

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('should register mkdir, rename and unlink channels', () => {
        const map = handlers();
        expect(typeof map['rakkomik:fs:mkdir']).toBe('function');
        expect(typeof map['rakkomik:fs:rename']).toBe('function');
        expect(typeof map['rakkomik:fs:unlink']).toBe('function');
        // nothing synchronous is left: a sendSync round trip would block the renderer
        expect(electron.ipcMain.on).not.toHaveBeenCalled();
    });

    it('should create directory chains with mkdir and accept existing ones', async () => {
        const map = handlers();
        const nested = path.join(dir, 'a', 'b', 'c');
        await expect(map['rakkomik:fs:mkdir']({}, nested)).resolves.toBeUndefined();
        expect(fs.statSync(nested).isDirectory()).toBe(true);
        await expect(map['rakkomik:fs:mkdir']({}, nested)).resolves.toBeUndefined();
    });

    it('should move a file atomically via rename', async () => {
        const map = handlers();
        const source = path.join(dir, 'a.tmp-1');
        const target = path.join(dir, 'a');
        fs.writeFileSync(source, 'payload');
        await expect(map['rakkomik:fs:rename']({}, source, target)).resolves.toBeUndefined();
        expect(fs.existsSync(source)).toBe(false);
        expect(fs.readFileSync(target, 'utf8')).toBe('payload');
    });

    it('should reject rename when the source is missing', async () => {
        const map = handlers();
        await expect(map['rakkomik:fs:rename']({}, path.join(dir, 'ghost'), path.join(dir, 'x'))).rejects.toThrow();
    });

    it('should remove files via unlink', async () => {
        const map = handlers();
        const file = path.join(dir, 'stray.tmp-1');
        fs.writeFileSync(file, 'x');
        await expect(map['rakkomik:fs:unlink']({}, file)).resolves.toBeUndefined();
        expect(fs.existsSync(file)).toBe(false);
    });
});
