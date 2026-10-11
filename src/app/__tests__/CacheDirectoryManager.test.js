// Cache replacement contract: parsed before the old cache goes, so a broken
// archive keeps it; entries can never escape the cache directory.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { zipSync, strToU8 } = require('fflate');
const { FileLogger, ConsoleLogger } = require('../Logger');
const CacheDirectoryManager = require('../CacheDirectoryManager');

const logger = new FileLogger(__filename + '.log', FileLogger.LEVEL.All);
logger.clear();

let cache = null;

function seedCache() {
    fs.mkdirSync(path.join(cache, 'directory'), { recursive: true });
    fs.writeFileSync(path.join(cache, 'version'), '7ede91');
    fs.writeFileSync(path.join(cache, 'directory', 'file'), 'DUMMY');
}

beforeEach(() => {
    cache = fs.mkdtempSync(path.join(os.tmpdir(), 'rakkomik-cache-'));
});

afterEach(() => {
    fs.rmSync(cache, { recursive: true, force: true });
});

describe('CacheDirectoryManager', () => {

    describe('getCurrentVersion()', () => {
        it('should get version when file exists', async () => {
            fs.writeFileSync(path.join(cache, 'version'), 'xxx');
            await expect(new CacheDirectoryManager(cache, logger).getCurrentVersion()).resolves.toBe('xxx');
        });
        it('should get undefined when the file is missing', async () => {
            await expect(new CacheDirectoryManager(cache, logger).getCurrentVersion()).resolves.toBeUndefined();
        });
    });

    describe('applyUpdateArchive()', () => {
        it('should keep the existing cache when the archive is invalid', async () => {
            seedCache();
            const testee = new CacheDirectoryManager(cache, logger);
            await expect(testee.applyUpdateArchive('1.0.0', new Uint8Array([ 0x87, 0xfb, 0x74, 0x63 ]))).rejects.toThrow();
            expect(fs.readFileSync(path.join(cache, 'version'), 'utf8')).toBe('7ede91');
            expect(fs.readFileSync(path.join(cache, 'directory', 'file'), 'utf8')).toBe('DUMMY');
        });

        it('should replace the existing cache with the archive content and write the version', async () => {
            seedCache();
            const archive = zipSync({
                'index.html': strToU8('OK'),
                'js/': new Uint8Array(0),
                'js/app.js': strToU8('console.log(1);')
            });
            await new CacheDirectoryManager(cache, logger).applyUpdateArchive('111111', archive);
            expect(fs.readFileSync(path.join(cache, 'version'), 'utf8')).toBe('111111');
            expect(fs.readFileSync(path.join(cache, 'index.html'), 'utf8')).toBe('OK');
            expect(fs.readFileSync(path.join(cache, 'js', 'app.js'), 'utf8')).toBe('console.log(1);');
            expect(fs.existsSync(path.join(cache, 'directory'))).toBe(false);
        });

        it('should refuse entries that escape the cache directory', async () => {
            seedCache();
            const archive = zipSync({ '../escaped.txt': strToU8('nope') });
            await expect(new CacheDirectoryManager(cache, logger).applyUpdateArchive('1.0.0', archive)).rejects.toThrow(/outside of the cache directory/);
            expect(fs.existsSync(path.join(path.dirname(cache), 'escaped.txt'))).toBe(false);
            expect(fs.readFileSync(path.join(cache, 'version'), 'utf8')).toBe('7ede91');
        });
    });
    describe('with a cache directory that is no usable path', () => {
        it.each([
            ['undefined', undefined],
            ['null', null],
            ['a number', 42],
            ['an object', {}]
        ])('should find no version and refuse an update when the directory is %s', async (_, directory) => {
            const quiet = { verbose: vi.fn() };
            const before = fs.readdirSync(process.cwd()).sort();
            const testee = new CacheDirectoryManager(directory, quiet);
            await expect(testee.getCurrentVersion()).resolves.toBeUndefined();
            await expect(testee.applyUpdateArchive('1.0.0', zipSync({ 'index.html': strToU8('OK') }))).rejects.toThrow();
            await expect(testee.applyUpdateArchive('1.0.0', zipSync({}))).rejects.toThrow();
            // nothing was written into the working directory instead
            expect(fs.readdirSync(process.cwd()).sort()).toEqual(before);
        });

        it('should log through a console logger of its own when it is given none', () => {
            expect(new CacheDirectoryManager(cache)._logger).toBeInstanceOf(ConsoleLogger);
        });
    });

    describe('getCurrentVersion() when the file is no file', () => {
        it('should find no version when the version is a directory', async () => {
            fs.mkdirSync(path.join(cache, 'version'));
            await expect(new CacheDirectoryManager(cache, logger).getCurrentVersion()).resolves.toBeUndefined();
        });

        it('should find no version when the cache directory does not exist', async () => {
            await expect(new CacheDirectoryManager(path.join(cache, 'missing'), logger).getCurrentVersion()).resolves.toBeUndefined();
        });

        it('should answer the content of the file as it is', async () => {
            fs.writeFileSync(path.join(cache, 'version'), 'ABC123');
            await expect(new CacheDirectoryManager(cache, logger).getCurrentVersion()).resolves.toBe('ABC123');
        });

        it('should read the version of a cache directory that is given with a trailing separator and dot segments', async () => {
            fs.writeFileSync(path.join(cache, 'version'), 'xyz');
            const spelled = cache + path.sep + '.' + path.sep + 'sub' + path.sep + '..' + path.sep;
            await expect(new CacheDirectoryManager(spelled, logger).getCurrentVersion()).resolves.toBe('xyz');
        });
    });

    describe('applyUpdateArchive() with more archives', () => {
        const quiet = () => ({ verbose: vi.fn() });

        it('should create the cache directory, and the directories above it, when they are not there yet', async () => {
            const target = path.join(cache, 'a', 'b', 'cache');
            await new CacheDirectoryManager(target, quiet()).applyUpdateArchive('first', zipSync({ 'index.html': strToU8('OK') }));
            expect(fs.readFileSync(path.join(target, 'index.html'), 'utf8')).toBe('OK');
            expect(fs.readFileSync(path.join(target, 'version'), 'utf8')).toBe('first');
        });

        it('should write the files below directories that only the paths of the files imply', async () => {
            const archive = zipSync({ 'a/b/c/d/e/deep.txt': strToU8('deep'), 'a/other.txt': strToU8('other') });
            await new CacheDirectoryManager(cache, quiet()).applyUpdateArchive('1', archive);
            expect(fs.readFileSync(path.join(cache, 'a', 'b', 'c', 'd', 'e', 'deep.txt'), 'utf8')).toBe('deep');
            expect(fs.readFileSync(path.join(cache, 'a', 'other.txt'), 'utf8')).toBe('other');
        });

        it('should keep the bytes of every file, whatever they are', async () => {
            const bytes = new Uint8Array(256).map((_, index) => index);
            const large = new Uint8Array(1024 * 1024).map((_, index) => (index * 7) % 256);
            await new CacheDirectoryManager(cache, quiet()).applyUpdateArchive('1', zipSync({ 'all-bytes.bin': bytes, 'large.bin': large, 'empty.txt': new Uint8Array(0) }, { level: 0 }));
            expect(fs.readFileSync(path.join(cache, 'all-bytes.bin')).equals(Buffer.from(bytes))).toBe(true);
            expect(fs.readFileSync(path.join(cache, 'large.bin')).equals(Buffer.from(large))).toBe(true);
            expect(fs.statSync(path.join(cache, 'empty.txt')).size).toBe(0);
        });

        it('should write names in any writing system', async () => {
            const names = ['img/\u6f2b\u753b.png', 'caf\u00e9 au lait.txt', 'sub dir/\u00fcber.mjs'];
            await new CacheDirectoryManager(cache, quiet()).applyUpdateArchive('1', zipSync(Object.fromEntries(names.map(name => [name, strToU8(name)]))));
            for (const name of names) {
                expect(fs.readFileSync(path.join(cache, ...name.split('/')), 'utf8')).toBe(name);
            }
        });

        it('should write many files, which it does at the same time', async () => {
            const files = Object.fromEntries(Array.from({ length: 300 }, (_, index) => [`img/connectors/c${index}`, strToU8(`icon ${index}`)]));
            await new CacheDirectoryManager(cache, quiet()).applyUpdateArchive('1', zipSync(files));
            expect(fs.readdirSync(path.join(cache, 'img', 'connectors'))).toHaveLength(300);
            expect(fs.readFileSync(path.join(cache, 'img', 'connectors', 'c299'), 'utf8')).toBe('icon 299');
        });

        it('should write the version it is told, whatever the archive holds under that name', async () => {
            await new CacheDirectoryManager(cache, quiet()).applyUpdateArchive('REAL', zipSync({ version: strToU8('from the archive'), 'index.html': strToU8('OK') }));
            expect(fs.readFileSync(path.join(cache, 'version'), 'utf8')).toBe('REAL');
        });

        it('should remove what the update leaves out, every file and every directory', async () => {
            seedCache();
            fs.writeFileSync(path.join(cache, '.hidden'), 'x');
            await new CacheDirectoryManager(cache, quiet()).applyUpdateArchive('2', zipSync({ 'index.html': strToU8('OK') }));
            expect(fs.readdirSync(cache).sort()).toEqual(['index.html', 'version']);
        });

        it('should replace the files of an update by the files of the next one', async () => {
            const testee = new CacheDirectoryManager(cache, quiet());
            await testee.applyUpdateArchive('1', zipSync({ 'index.html': strToU8('first'), 'old.js': strToU8('old') }));
            await testee.applyUpdateArchive('2', zipSync({ 'index.html': strToU8('second') }));
            expect(fs.readFileSync(path.join(cache, 'index.html'), 'utf8')).toBe('second');
            expect(fs.existsSync(path.join(cache, 'old.js'))).toBe(false);
            await expect(testee.getCurrentVersion()).resolves.toBe('2');
        });

        it('should log what it extracts', async () => {
            const logger = quiet();
            await new CacheDirectoryManager(cache, logger).applyUpdateArchive('1', zipSync({ 'a.txt': strToU8('a'), 'b/c.txt': strToU8('c') }));
            expect(logger.verbose.mock.calls.map(([, file]) => file).sort()).toEqual([path.join(cache, 'a.txt'), path.join(cache, 'b', 'c.txt')].sort());
        });

        it.each([
            ['dot segments up', '../escaped.txt'],
            ['many dot segments up', '../../../../escaped.txt'],
            ['dot segments that come back below the directory first', 'a/../../escaped.txt'],
            ['a sibling of the directory that starts with its name', () => `../${path.basename(cache)}-evil/escaped.txt`],
            ['an absolute path', () => path.join(path.dirname(cache), 'escaped.txt')],
            ['a path that is the directory itself', '.'],
            ['a path with an empty first segment', '/escaped.txt']
        ])('should refuse an entry with %s, before it removes or writes anything', async (_, entry) => {
            seedCache();
            const name = typeof entry === 'function' ? entry() : entry;
            const archive = zipSync({ 'index.html': strToU8('would be fine'), [name]: strToU8('nope') });
            await expect(new CacheDirectoryManager(cache, quiet()).applyUpdateArchive('2', archive)).rejects.toThrow(/outside of the cache directory/);
            // the valid file of the same archive was not written either, and the cache is as it was
            expect(fs.readFileSync(path.join(cache, 'version'), 'utf8')).toBe('7ede91');
            expect(fs.readFileSync(path.join(cache, 'directory', 'file'), 'utf8')).toBe('DUMMY');
            expect(fs.existsSync(path.join(cache, 'index.html'))).toBe(false);
            for (const outside of [path.join(path.dirname(cache), 'escaped.txt'), `${cache}-evil`]) {
                expect(fs.existsSync(outside)).toBe(false);
            }
        });

        it('should not let a backslash take an entry out of the directory, on any system', async () => {
            const archive = zipSync({ '..\\escaped-by-backslash.txt': strToU8('nope') });
            // a file name with a backslash on Linux and macOS, a way up on Windows: the directory is the limit
            await new CacheDirectoryManager(cache, quiet()).applyUpdateArchive('1', archive).catch(() => undefined);
            expect(fs.existsSync(path.join(path.dirname(cache), 'escaped-by-backslash.txt'))).toBe(false);
        });

        it('should accept dot segments that stay inside the directory', async () => {
            await new CacheDirectoryManager(cache, quiet()).applyUpdateArchive('1', zipSync({ 'a/../b.txt': strToU8('b'), './c.txt': strToU8('c') }));
            expect(fs.readFileSync(path.join(cache, 'b.txt'), 'utf8')).toBe('b');
            expect(fs.readFileSync(path.join(cache, 'c.txt'), 'utf8')).toBe('c');
        });

        it.each([
            ['not an archive at all', new Uint8Array([1, 2, 3, 4, 5])],
            ['empty', new Uint8Array(0)],
            ['a text', new TextEncoder().encode('<html>404</html>')]
        ])('should keep the cache when the update is %s', async (_, data) => {
            seedCache();
            await expect(new CacheDirectoryManager(cache, quiet()).applyUpdateArchive('2', data)).rejects.toThrow();
            expect(fs.readFileSync(path.join(cache, 'version'), 'utf8')).toBe('7ede91');
            expect(fs.readFileSync(path.join(cache, 'directory', 'file'), 'utf8')).toBe('DUMMY');
        });

        it('should keep the cache when the archive is cut off', async () => {
            seedCache();
            const archive = zipSync({ 'index.html': strToU8('OK'.repeat(1000)) });
            await expect(new CacheDirectoryManager(cache, quiet()).applyUpdateArchive('2', archive.slice(0, archive.length - 10))).rejects.toThrow();
            expect(fs.readFileSync(path.join(cache, 'version'), 'utf8')).toBe('7ede91');
        });
    });
});