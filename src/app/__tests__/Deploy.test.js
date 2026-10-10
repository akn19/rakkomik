// Release pipeline contract: what deploy-web.js packs and signs with
// node:crypto is exactly what the client's updater verifies and extracts.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { pack, readTree, resolveChannel } = require('../../../deploy-web.js');
const UpdatePackageInfo = require('../UpdatePackageInfo');
const CacheDirectoryManager = require('../CacheDirectoryManager');

const PASSPHRASE = 'release-key-passphrase';

let build = null;
let cache = null;
let keys = null;

beforeAll(() => {
    keys = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: PASSPHRASE }
    });
});

beforeEach(() => {
    build = fs.mkdtempSync(path.join(os.tmpdir(), 'rakkomik-build-'));
    cache = fs.mkdtempSync(path.join(os.tmpdir(), 'rakkomik-cache-'));
    fs.mkdirSync(path.join(build, 'js'));
    fs.writeFileSync(path.join(build, 'index.html'), '<html>CACHE</html>');
    fs.writeFileSync(path.join(build, 'js', 'app.js'), 'console.log("app");');
    process.env.RAKKOMIK_PRIVATE_KEY = keys.privateKey;
    process.env.RAKKOMIK_PASSPHRASE = PASSPHRASE;
});

afterEach(() => {
    fs.rmSync(build, { recursive: true, force: true });
    fs.rmSync(cache, { recursive: true, force: true });
    delete process.env.RAKKOMIK_PRIVATE_KEY;
    delete process.env.RAKKOMIK_PASSPHRASE;
    delete process.env.CHANNEL;
    delete process.env.GITHUB_REF;
});

describe('deploy-web', () => {
    it('should list the bundle files with posix entry names', async () => {
        const files = await readTree(build);
        expect(Object.keys(files).sort()).toEqual([ 'index.html', 'js/app.js' ]);
        expect(new TextDecoder().decode(files['js/app.js'])).toBe('console.log("app");');
    });

    it('should produce an archive the updater verifies, rejects when tampered, and extracts', async () => {
        const [ archive, meta ] = await pack(build, 'ABC123.zip', 'latest');
        expect(path.dirname(archive)).toBe(build);
        const link = new URL(fs.readFileSync(meta, 'utf8'), 'http://update.server/latest');
        expect(link.pathname).toBe('/ABC123.zip');
        const info = new UpdatePackageInfo('ABC123', link.searchParams.get('signature'), link.href);
        const data = new Uint8Array(fs.readFileSync(archive));

        await expect(info.validate(data, keys.publicKey)).resolves.toBe(data);
        const tampered = data.slice();
        tampered[tampered.length - 20] ^= 0xff;
        await expect(info.validate(tampered, keys.publicKey)).rejects.toThrow(/Integrity check/);

        await new CacheDirectoryManager(cache).applyUpdateArchive('ABC123', data);
        expect(fs.readFileSync(path.join(cache, 'index.html'), 'utf8')).toBe('<html>CACHE</html>');
        expect(fs.readFileSync(path.join(cache, 'js', 'app.js'), 'utf8')).toBe('console.log("app");');
        expect(fs.readFileSync(path.join(cache, 'version'), 'utf8')).toBe('ABC123');
        // the archive and its meta file are not part of the packed content
        expect(fs.existsSync(path.join(cache, 'ABC123.zip'))).toBe(false);
        expect(fs.existsSync(path.join(cache, 'latest'))).toBe(false);
    });

    it('should derive the channel from the branch ref or the CHANNEL variable', () => {
        process.env.GITHUB_REF = 'refs/heads/feature/x';
        expect(resolveChannel()).toBe('feature-x');
        delete process.env.GITHUB_REF;
        expect(() => resolveChannel()).toThrow(/Cannot derive deployment channel/);
    });
});
