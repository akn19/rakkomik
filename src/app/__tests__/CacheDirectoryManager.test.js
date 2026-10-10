// Cache replacement contract: parsed before the old cache goes, so a broken
// archive keeps it; entries can never escape the cache directory.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { zipSync, strToU8 } = require('fflate');
const { FileLogger } = require('../Logger');
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
});
