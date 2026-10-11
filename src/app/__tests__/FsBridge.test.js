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
    it('should register every channel of the preload bridge, and no synchronous one', () => {
        expect(Object.keys(handlers()).sort()).toEqual([
            'rakkomik:fs:mkdir',
            'rakkomik:fs:readFile',
            'rakkomik:fs:readdir',
            'rakkomik:fs:rename',
            'rakkomik:fs:stat',
            'rakkomik:fs:unlink',
            'rakkomik:fs:writeFile'
        ]);
    });

    it('should fail mkdir when the path is a file', async () => {
        const file = path.join(dir, 'file');
        fs.writeFileSync(file, 'x');
        await expect(handlers()['rakkomik:fs:mkdir']({}, file)).rejects.toMatchObject({ code: 'EEXIST' });
        await expect(handlers()['rakkomik:fs:mkdir']({}, path.join(file, 'below'))).rejects.toThrow();
    });

    it('should create a directory named in any writing system', async () => {
        const target = path.join(dir, '\u6f2b\u753b', 'Zo\u00eb \u2013 caf\u00e9');
        await handlers()['rakkomik:fs:mkdir']({}, target);
        expect(fs.statSync(target).isDirectory()).toBe(true);
    });

    describe('rakkomik:fs:writeFile', () => {
        it('should write a text and answer nothing', async () => {
            const file = path.join(dir, 'text.json');
            await expect(handlers()['rakkomik:fs:writeFile']({}, file, '{"a":1}\n')).resolves.toBeUndefined();
            expect(fs.readFileSync(file, 'utf8')).toBe('{"a":1}\n');
        });

        it('should write a text in the encoding it is told', async () => {
            const file = path.join(dir, 'latin1.txt');
            await handlers()['rakkomik:fs:writeFile']({}, file, 'caf\u00e9', 'latin1');
            expect([...fs.readFileSync(file)]).toEqual([0x63, 0x61, 0x66, 0xe9]);
            await handlers()['rakkomik:fs:writeFile']({}, file, 'AQID', 'base64');
            expect([...fs.readFileSync(file)]).toEqual([1, 2, 3]);
        });

        it('should write text as UTF-8 when no encoding is given', async () => {
            const file = path.join(dir, 'utf8.txt');
            await handlers()['rakkomik:fs:writeFile']({}, file, '\u6f2b\u753b \ud83d\ude42');
            expect(fs.readFileSync(file, 'utf8')).toBe('\u6f2b\u753b \ud83d\ude42');
        });

        it.each([
            ['a Uint8Array', () => new Uint8Array([0, 1, 254, 255])],
            ['a Buffer', () => Buffer.from([0, 1, 254, 255])],
            ['an ArrayBuffer', () => new Uint8Array([0, 1, 254, 255]).buffer],
            ['a list of numbers', () => [0, 1, 254, 255]]
        ])('should write the bytes of %s as they are, whatever the encoding says', async (_, make) => {
            const file = path.join(dir, 'binary.bin');
            await handlers()['rakkomik:fs:writeFile']({}, file, make(), 'utf8');
            expect([...fs.readFileSync(file)]).toEqual([0, 1, 254, 255]);
        });

        it('should write a large file in one piece', async () => {
            const file = path.join(dir, 'large.bin');
            const bytes = new Uint8Array(1024 * 1024).map((_, index) => index % 251);
            await handlers()['rakkomik:fs:writeFile']({}, file, bytes);
            expect(fs.readFileSync(file).equals(Buffer.from(bytes))).toBe(true);
        });

        it('should replace the content of a file that exists', async () => {
            const file = path.join(dir, 'replaced.txt');
            fs.writeFileSync(file, 'a much longer old content');
            await handlers()['rakkomik:fs:writeFile']({}, file, 'new');
            expect(fs.readFileSync(file, 'utf8')).toBe('new');
        });

        it('should write an empty file for an empty text and for no bytes', async () => {
            await handlers()['rakkomik:fs:writeFile']({}, path.join(dir, 'empty-text'), '');
            await handlers()['rakkomik:fs:writeFile']({}, path.join(dir, 'empty-bytes'), new Uint8Array(0));
            expect(fs.statSync(path.join(dir, 'empty-text')).size).toBe(0);
            expect(fs.statSync(path.join(dir, 'empty-bytes')).size).toBe(0);
        });

        it('should fail when the directory of the file does not exist, and not create it', async () => {
            const file = path.join(dir, 'missing', 'file.txt');
            await expect(handlers()['rakkomik:fs:writeFile']({}, file, 'x')).rejects.toMatchObject({ code: 'ENOENT' });
            expect(fs.existsSync(path.join(dir, 'missing'))).toBe(false);
        });

        it.each([
            ['nothing', undefined],
            ['null', null],
            ['a number', 42]
        ])('should fail when it is given %s to write', async (_, data) => {
            await expect((async () => handlers()['rakkomik:fs:writeFile']({}, path.join(dir, 'x'), data))()).rejects.toThrow(TypeError);
            expect(fs.existsSync(path.join(dir, 'x'))).toBe(false);
        });

        it('should write many files at the same time', async () => {
            const names = Array.from({ length: 25 }, (_, index) => `chapter-${index}.txt`);
            await Promise.all(names.map(name => handlers()['rakkomik:fs:writeFile']({}, path.join(dir, name), name)));
            expect(fs.readdirSync(dir).sort()).toEqual([...names].sort());
            for (const name of names) {
                expect(fs.readFileSync(path.join(dir, name), 'utf8')).toBe(name);
            }
        });
    });

    describe('rakkomik:fs:readFile', () => {
        it('should answer the bytes as a Uint8Array, which survives the transfer to the renderer, when no encoding is given', async () => {
            const file = path.join(dir, 'bytes.bin');
            const bytes = Buffer.from(Array.from({ length: 256 }, (_, index) => index));
            fs.writeFileSync(file, bytes);
            const read = await handlers()['rakkomik:fs:readFile']({}, file);
            expect(read.constructor).toBe(Uint8Array);
            expect(Buffer.isBuffer(read)).toBe(false);
            expect(Buffer.from(read).equals(bytes)).toBe(true);
            // not a window on a larger, shared buffer
            expect(read.byteOffset).toBe(0);
            expect(read.buffer.byteLength).toBe(256);
        });

        it.each([undefined, null, ''])('should answer bytes when the encoding is %p', async encoding => {
            const file = path.join(dir, 'text.txt');
            fs.writeFileSync(file, 'text');
            const read = await handlers()['rakkomik:fs:readFile']({}, file, encoding);
            expect(typeof read).toBe('object');
            expect(Buffer.from(read).toString()).toBe('text');
        });

        it('should answer a text when an encoding is given', async () => {
            const file = path.join(dir, 'text.txt');
            fs.writeFileSync(file, 'caf\u00e9 \u6f2b\u753b', 'utf8');
            await expect(handlers()['rakkomik:fs:readFile']({}, file, 'utf8')).resolves.toBe('caf\u00e9 \u6f2b\u753b');
            fs.writeFileSync(file, Buffer.from([0x63, 0x61, 0x66, 0xe9]));
            await expect(handlers()['rakkomik:fs:readFile']({}, file, 'latin1')).resolves.toBe('caf\u00e9');
        });

        it('should answer an empty file as no bytes and as an empty text', async () => {
            const file = path.join(dir, 'empty');
            fs.writeFileSync(file, '');
            expect((await handlers()['rakkomik:fs:readFile']({}, file)).length).toBe(0);
            await expect(handlers()['rakkomik:fs:readFile']({}, file, 'utf8')).resolves.toBe('');
        });

        it('should fail for a file that does not exist', async () => {
            await expect(handlers()['rakkomik:fs:readFile']({}, path.join(dir, 'ghost'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
        });

        it('should fail for a directory', async () => {
            await expect(handlers()['rakkomik:fs:readFile']({}, dir)).rejects.toMatchObject({ code: 'EISDIR' });
        });

        it('should give back what writeFile wrote, bytes and text alike', async () => {
            const file = path.join(dir, 'roundtrip.bin');
            const bytes = new Uint8Array([9, 8, 7, 0, 255]);
            await handlers()['rakkomik:fs:writeFile']({}, file, bytes);
            expect([...(await handlers()['rakkomik:fs:readFile']({}, file))]).toEqual([...bytes]);
            await handlers()['rakkomik:fs:writeFile']({}, file, 'text \u00e4', 'utf8');
            await expect(handlers()['rakkomik:fs:readFile']({}, file, 'utf8')).resolves.toBe('text \u00e4');
        });
    });

    describe('rakkomik:fs:stat', () => {
        it('should describe a file', async () => {
            const file = path.join(dir, 'file.txt');
            fs.writeFileSync(file, 'twelve bytes');
            await expect(handlers()['rakkomik:fs:stat']({}, file)).resolves.toEqual({ isDirectory: false, isFile: true, size: 12 });
        });

        it('should describe a directory', async () => {
            const result = await handlers()['rakkomik:fs:stat']({}, dir);
            expect(result.isDirectory).toBe(true);
            expect(result.isFile).toBe(false);
            expect(typeof result.size).toBe('number');
        });

        it('should answer plain values only, so that they can cross the process boundary', async () => {
            const result = await handlers()['rakkomik:fs:stat']({}, dir);
            expect(Object.keys(result).sort()).toEqual(['isDirectory', 'isFile', 'size']);
            expect(structuredClone(result)).toEqual(result);
        });

        it('should fail for a path that does not exist', async () => {
            await expect(handlers()['rakkomik:fs:stat']({}, path.join(dir, 'ghost'))).rejects.toMatchObject({ code: 'ENOENT' });
        });
    });

    describe('rakkomik:fs:readdir', () => {
        it('should list the names in a directory', async () => {
            fs.writeFileSync(path.join(dir, 'b.txt'), '');
            fs.writeFileSync(path.join(dir, 'a.txt'), '');
            fs.writeFileSync(path.join(dir, '.hidden'), '');
            fs.mkdirSync(path.join(dir, 'sub'));
            expect((await handlers()['rakkomik:fs:readdir']({}, dir)).sort()).toEqual(['.hidden', 'a.txt', 'b.txt', 'sub']);
        });

        it('should list an empty directory as an empty array', async () => {
            await expect(handlers()['rakkomik:fs:readdir']({}, dir)).resolves.toEqual([]);
        });

        it('should fail for a path that does not exist and for a file', async () => {
            const file = path.join(dir, 'file');
            fs.writeFileSync(file, '');
            await expect(handlers()['rakkomik:fs:readdir']({}, path.join(dir, 'ghost'))).rejects.toMatchObject({ code: 'ENOENT' });
            await expect(handlers()['rakkomik:fs:readdir']({}, file)).rejects.toMatchObject({ code: 'ENOTDIR' });
        });
    });

    describe('rakkomik:fs:rename and rakkomik:fs:unlink', () => {
        it('should replace a file that is there already, as writing a file in one piece needs', async () => {
            const source = path.join(dir, 'chapter.json.tmp');
            const target = path.join(dir, 'chapter.json');
            fs.writeFileSync(target, 'old');
            fs.writeFileSync(source, 'new');
            await handlers()['rakkomik:fs:rename']({}, source, target);
            expect(fs.readFileSync(target, 'utf8')).toBe('new');
            expect(fs.existsSync(source)).toBe(false);
        });

        it('should fail to rename into a directory that does not exist, and keep the source', async () => {
            const source = path.join(dir, 'source');
            fs.writeFileSync(source, 'kept');
            await expect(handlers()['rakkomik:fs:rename']({}, source, path.join(dir, 'missing', 'target'))).rejects.toMatchObject({ code: 'ENOENT' });
            expect(fs.readFileSync(source, 'utf8')).toBe('kept');
        });

        it('should fail to remove a file that does not exist', async () => {
            await expect(handlers()['rakkomik:fs:unlink']({}, path.join(dir, 'ghost'))).rejects.toMatchObject({ code: 'ENOENT' });
        });

        it('should not remove a directory', async () => {
            const sub = path.join(dir, 'sub');
            fs.mkdirSync(sub);
            await expect(handlers()['rakkomik:fs:unlink']({}, sub)).rejects.toThrow();
            expect(fs.statSync(sub).isDirectory()).toBe(true);
        });
    });
});