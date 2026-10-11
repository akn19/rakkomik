const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert');
const { FileLogger, ConsoleLogger } = require('../Logger');
const UpdateServerManager = require('../UpdateServerManager');
const CacheDirectoryManager = require('../CacheDirectoryManager');
const Updater = require('../Updater');
var logger = new FileLogger(__filename + '.log', FileLogger.LEVEL.All);
logger.clear();

// A port nobody listens on at allocation time: the fixture binds it while a test
// needs the server and leaves it closed for the "cannot be reached" cases.
async function freePort() {
    const probe = net.createServer();
    await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
    const { port } = probe.address();
    await new Promise(resolve => probe.close(resolve));
    return port;
}

const publicKey =
`-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAzx5ZZjtNPDbf/iGqdjQj
FyCSIWF4dXDiRUWVga7yBBMJOOEidBDlHeAhQXj64f+IrXCxu+/ySNRgXTYp/1I7
S0HJsgcRz9AlzUVm6jeBZbFs42ggxVOxPA8RQDcEZFU/YDPQuYmz82euhI8VqDoZ
VlHmFOUICTgp7GvNNK94KDxx3H0qX9kv1U3tQEdxb9FFH5kzg4dR5/5WSriFFMNS
QDVrm5yAaEfty75u2Os1hobY9r5ACHpaoxitPBUNgqX7lORseb3t+dfoDVhowTXy
P0xJDQn8Kz3JTmVUjPnZO+JFcvVjtYU2x+i0ab/qfTDSB5W62HUFQZ40EUTXeNN3
owIDAQAB
-----END PUBLIC KEY-----`;

class TestFixture {

    constructor() {
        this._latest = undefined;
        this._archive = undefined;
        this._server = http.createServer(this._listener.bind(this));
        this.port = undefined; // assigned per run, see freePort()
        this.root = undefined; // a directory of its own, so that the tests do not depend on the working directory
    }

    get applicationCacheDirectory() {
        return path.join(this.root, 'cache');
    }

    get applicationUpdateURL() {
        return `http://127.0.0.1:${this.port}/latest`;
    }

    get version() {
        return {
            file: path.join(this.applicationCacheDirectory, 'version'),
            content: '7ede91'
        };
    }

    get dummy() {
        return {
            file: path.join(this.applicationCacheDirectory, 'directory', 'file'),
            content: 'DUMMY'
        };
    }

    get index() {
        return {
            file: path.join(this.applicationCacheDirectory, 'index.html'),
            content: 'CACHE'
        };
    }

    // signature matches and archive is valid ZIP
    get archiveMock() {
        return {
            signature: '111111.zip?signature=87627cda741492d3c947a0b119e11cb572236d59b46c610054dfd631697f53c6ccbeba615b8a772600755f524b8537b2ae9c7fb306b3b9057d10b2f3526d6e87a074a549af4375cbd6861267fa477303a50843ded86488400d0d62b3d2482146378eb3d278ce0ce17720823e6761793116bedb4f6771c05383c4324bb514436f4f0e3d6cabc1b627ae8af15119324d034588ad884179744eec8db24fcdbeb75a6d2490d535d909ec362e3cce74612167a8ae7e28daee599b3408d4ed192ae1a6484d84a34daafbd86b9c7b9c6776f10d0a9c352183d7c0a100309999cd541cc97412898e83df40e1d6aaf9b89c0c97f06fb7490bf191ac087fb339864fadc7f6',
            archive: Buffer.from('504b03040a0300000000168e4a4b2dd936d702000000020000000a000000696e6465782e68746d6c4f4b504b01023f030a0300000000168e4a4b2dd936d702000000020000000a0024000000000000002080a48100000000696e6465782e68746d6c0a002000000000000100180000568740df41d3010029563fdf41d30100568740df41d301504b050600000000010001005c0000002a0000000000', 'hex')
        };
    }

    // signature matches, but archive is not valid ZIP
    get emptyMock() {
        return {
            signature: '000000.zip?signature=8345939337c46abdbc27fd3bffff0618af75fc5b90a9872a310a9cef7f9cd23a2354fee47d9a1a4cb0d65e26527bef56c16f218697f590238ab5a364860984c284a2a3745f8817ba15086e7227f34d4c311fa541de23a48a3d2a19396ac1a992c8a78fc8a8a315402181bc8d10e91919e42b7fb50613fedebe5160b28b5703ecc5597ca3e2aad9913df616bbc82835bd7a0927222773e42aebf8c0ee637d5aef99dad456561ff6267c33a8656efb4b5644a925e7c1b6db370af8e491528591d479b3f6c04c0914d7df7a4233cd615c6790b1f4df2f2fed5582b966fb269b9268599010addce427b3f2c1809ac96519056cc3d8bd51c440ee50a650b1968a2392',
            archive: Buffer.from('87fb74631726132b3df3387819f286d8a298fefb6c64287cb3bc7a1e92cd2e83', 'hex')
        };
    }

    deleteMockDirectory() {
        try {
            fs.rmSync(this.applicationCacheDirectory, { recursive: true, force: true });
        } catch(error) {
            logger.error('[TestFixture] Failed to delete (mock) cache directory!', error);
        }
    }

    createMockDirectory() {
        try {
            fs.mkdirSync(path.join(this.applicationCacheDirectory, 'directory'), { recursive: true });
            fs.writeFileSync(this.version.file, this.version.content);
            fs.writeFileSync(this.dummy.file, this.dummy.content);
        } catch(error) {
            logger.error('[TestFixture] Failed to create (mock) cache directory!', error);
        }
    }

    createTestee() {
        let serverManager = new UpdateServerManager(this.applicationUpdateURL, logger);
        let cacheManager = new CacheDirectoryManager(this.applicationCacheDirectory, logger);
        return new Updater(serverManager, cacheManager, logger);
    }

    /**
     *
     * @param {Request} request
     * @param {Response} response
     */
    _listener(request, response) {
        // No keep-alive: every test binds the same port, so a connection of the previous server that is still in the
        // client's pool would be reused and fail with ECONNRESET (seen on Windows, and with the tests in any other order).
        response.setHeader('Connection', 'close');
        if(request.url === '/latest') {
            response.setHeader('Content-Type', 'text/plain');
            response.statusCode = 200;
            return response.end(this._latest);
        }
        if(request.url.includes('.zip')) {
            response.setHeader('Content-Type', 'application/zip');
            response.statusCode = 200;
            return response.end(this._archive);
        }
        response.setHeader('Content-Type', 'text/plain');
        response.statusCode = 404;
        return response.end();
    }

    /**
     *
     * @param {string} latest
     * @param {Uint8Array | Buffer} archive
     */
    async serverStart(latest, archive) {
        this._latest = latest;
        this._archive = archive;
        await new Promise(resolve => this._server.listen(this.port, '127.0.0.1', resolve));
    }

    /**
     *
     */
    async serverStop() {
        if(!this._server.listening) {
            return;
        }
        // keep-alive sockets must not survive into the next test
        this._server.closeAllConnections();
        await new Promise(resolve => this._server.close(resolve));
    }
}

/**
 * MODULE TESTS
 */
describe('Updater', function () {

    let fixture = new TestFixture();

    beforeAll(async () => {
        fixture.port = await freePort();
        fixture.root = fs.mkdtempSync(path.join(os.tmpdir(), 'rk-updater-'));
    });

    afterAll(() => {
        fs.rmSync(fixture.root, { recursive: true, force: true });
    });

    describe('updateCache()', function () {

        it('should not ask the server when the update is disabled', async () => {
            fixture.createMockDirectory();
            let serverManager = new UpdateServerManager('DISABLED', logger);
            let getUpdateInfo = vi.spyOn(serverManager, 'getUpdateInfo');
            let testee = new Updater(serverManager, new CacheDirectoryManager(fixture.applicationCacheDirectory, logger), logger);
            await testee.updateCache(publicKey);
            assert.equal(getUpdateInfo.mock.calls.length, 0);
            assert.equal(fs.readFileSync(fixture.dummy.file, 'utf8'), fixture.dummy.content);
            fixture.deleteMockDirectory();
        });

        it('should update cache when when cache is non-empty and server is newer and archive is valid', async () => {
            fixture.createMockDirectory();
            await fixture.serverStart(fixture.archiveMock.signature, fixture.archiveMock.archive);
            let testee = fixture.createTestee();
            await testee.updateCache(publicKey);
            await fixture.serverStop();
            assert.equal(fs.readFileSync(fixture.version.file, 'utf8'), "111111");
            assert.equal(fs.readFileSync(fixture.index.file, 'utf8'), "OK");
            assert.equal(fs.existsSync(fixture.dummy.file), false);
            fixture.deleteMockDirectory();
        });

        it('should keep cache when cache is non-empty and server is newer and archive is invalid', async () => {
            fixture.createMockDirectory();
            await fixture.serverStart(fixture.emptyMock.signature, fixture.emptyMock.archive);
            let testee = fixture.createTestee();
            await testee.updateCache(publicKey);
            await fixture.serverStop();
            assert.equal(fs.readFileSync(fixture.version.file, 'utf8'), fixture.version.content);
            assert.equal(fs.readFileSync(fixture.dummy.file, 'utf8'), fixture.dummy.content);
            assert.equal(fs.existsSync(fixture.index.file), false);
            fixture.deleteMockDirectory();
        });

        it('should keep cache when cache is non-empty and server is newer and archive is valid and signature mismatch', async () => {
            fixture.createMockDirectory();
            await fixture.serverStart(fixture.emptyMock.signature, fixture.archiveMock.archive);
            let testee = fixture.createTestee();
            await testee.updateCache(publicKey);
            await fixture.serverStop();
            assert.equal(fs.readFileSync(fixture.version.file, 'utf8'), fixture.version.content);
            assert.equal(fs.readFileSync(fixture.dummy.file, 'utf8'), fixture.dummy.content);
            assert.equal(fs.existsSync(fixture.index.file), false);
            fixture.deleteMockDirectory();
        });

        it('should keep cache when cache is non-empty and server is same and archive is valid', async () => {
            fixture.createMockDirectory();
            fs.writeFileSync(fixture.version.file, '111111');
            await fixture.serverStart(fixture.archiveMock.signature, fixture.archiveMock.archive);
            let testee = fixture.createTestee();
            await testee.updateCache(publicKey);
            await fixture.serverStop();
            assert.equal(fs.readFileSync(fixture.version.file, 'utf8'), '111111');
            assert.equal(fs.readFileSync(fixture.dummy.file, 'utf8'), fixture.dummy.content);
            assert.equal(fs.existsSync(fixture.index.file), false);
            fixture.deleteMockDirectory();
        });

        it('should keep cache when cache is non-empty and server is same and archive is invalid', async () => {
            fixture.createMockDirectory();
            fs.writeFileSync(fixture.version.file, '000000');
            await fixture.serverStart(fixture.emptyMock.signature, fixture.emptyMock.archive);
            let testee = fixture.createTestee();
            await testee.updateCache(publicKey);
            await fixture.serverStop();
            assert.equal(fs.readFileSync(fixture.version.file, 'utf8'), '000000');
            assert.equal(fs.readFileSync(fixture.dummy.file, 'utf8'), fixture.dummy.content);
            assert.equal(fs.existsSync(fixture.index.file), false);
            fixture.deleteMockDirectory();
        });

        it('should keep cache when cache is non-empty and server has error', async () => {
            fixture.createMockDirectory();
            await fixture.serverStop();
            let testee = fixture.createTestee();
            await testee.updateCache(publicKey);
            assert.equal(fs.readFileSync(fixture.version.file, 'utf8'), fixture.version.content);
            assert.equal(fs.readFileSync(fixture.dummy.file, 'utf8'), fixture.dummy.content);
            assert.equal(fs.existsSync(fixture.index.file), false);
            fixture.deleteMockDirectory();
        });

        it('should update cache when cache is empty and server is newer and archive is valid', async () => {
            fixture.deleteMockDirectory();
            await fixture.serverStart(fixture.archiveMock.signature, fixture.archiveMock.archive);
            let testee = fixture.createTestee();
            await testee.updateCache(publicKey);
            await fixture.serverStop();
            assert.equal(fs.readFileSync(fixture.version.file, 'utf8'), "111111");
            assert.equal(fs.readFileSync(fixture.index.file, 'utf8'), "OK");
            assert.equal(fs.existsSync(fixture.dummy.file), false);
            fixture.deleteMockDirectory();
        });

        it('should keep (empty) cache when cache is empty and server is newer and archive is invalid', async () => {
            fixture.deleteMockDirectory();
            await fixture.serverStart(fixture.emptyMock.signature, fixture.emptyMock.archive);
            let testee = fixture.createTestee();
            await testee.updateCache(publicKey);
            await fixture.serverStop();
            assert.equal(fs.existsSync(fixture.version.file), false);
            assert.equal(fs.existsSync(fixture.index.file), false);
            assert.equal(fs.existsSync(fixture.dummy.file), false);
            fixture.deleteMockDirectory();
        });

        it('should keep (empty) when cache is empty and server has error', async () => {
            fixture.deleteMockDirectory();
            await fixture.serverStop();
            let testee = fixture.createTestee();
            await testee.updateCache(publicKey);
            assert.equal(fs.existsSync(fixture.version.file), false);
            assert.equal(fs.existsSync(fixture.index.file), false);
            assert.equal(fs.existsSync(fixture.dummy.file), false);
            fixture.deleteMockDirectory();
        });
    });
});

/**
 * The flow of an update, step by step, with the server and the cache replaced by doubles that record what happens.
 */
describe('Updater with doubles', function () {

    const PUBLIC_KEY = 'the public key';
    let steps = null;
    let own = null;

    function update(overrides = {}) {
        let info = {
            version: 'NEW',
            validate: vi.fn(async (archive, key) => {
                steps.push([ 'validate', archive, key ]);
                return archive;
            }),
            ...overrides.info
        };
        let archive = new Uint8Array([ 1, 2, 3 ]);
        let serverManager = {
            isDisabled: false,
            getUpdateInfo: vi.fn(async () => {
                steps.push([ 'getUpdateInfo' ]);
                return info;
            }),
            getUpdateArchive: vi.fn(async given => {
                steps.push([ 'getUpdateArchive', given ]);
                return archive;
            }),
            ...overrides.server
        };
        let cacheManager = {
            getCurrentVersion: vi.fn(async () => {
                steps.push([ 'getCurrentVersion' ]);
                return 'OLD';
            }),
            applyUpdateArchive: vi.fn(async (version, data) => {
                steps.push([ 'applyUpdateArchive', version, data ]);
            }),
            ...overrides.cache
        };
        return { info, archive, serverManager, cacheManager, testee: new Updater(serverManager, cacheManager, own) };
    }

    beforeEach(() => {
        steps = [];
        own = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };
    });

    it('should log through a console logger of its own when it is given none', function () {
        assert.ok(new Updater({}, {})._logger instanceof ConsoleLogger);
    });

    it('should leave the server and the cache alone when the update is switched off', async function () {
        let { testee, serverManager, cacheManager } = update({ server: { isDisabled: true } });
        await testee.updateCache(PUBLIC_KEY);
        expect(serverManager.getUpdateInfo).not.toHaveBeenCalled();
        expect(cacheManager.getCurrentVersion).not.toHaveBeenCalled();
        expect(cacheManager.applyUpdateArchive).not.toHaveBeenCalled();
        expect(own.info).toHaveBeenCalledWith('Update is disabled');
    });

    it('should check, download, verify and apply, in this order, with the key it is given', async function () {
        let { testee, info, archive } = update();
        await testee.updateCache(PUBLIC_KEY);
        expect(steps).toEqual([
            [ 'getUpdateInfo' ],
            [ 'getCurrentVersion' ],
            [ 'getUpdateArchive', info ],
            [ 'validate', archive, PUBLIC_KEY ],
            [ 'applyUpdateArchive', 'NEW', archive ]
        ]);
        expect(own.error).not.toHaveBeenCalled();
        expect(own.info).toHaveBeenLastCalledWith('Update Complete');
    });

    it('should not download anything when the cache has the version of the server', async function () {
        let { testee } = update({ info: { version: 'OLD' } });
        await testee.updateCache(PUBLIC_KEY);
        expect(steps.map(([ step ]) => step)).toEqual([ 'getUpdateInfo', 'getCurrentVersion' ]);
        expect(own.info).toHaveBeenLastCalledWith('Update Check Complete');
    });

    it('should update a cache that has no version', async function () {
        let { testee } = update({ cache: { getCurrentVersion: vi.fn(async () => undefined) } });
        await testee.updateCache(PUBLIC_KEY);
        expect(steps.map(([ step ]) => step)).toContain('applyUpdateArchive');
    });

    it.each([
        ['an older version', 'OLD0'],
        ['a version that only differs in case', 'old'],
        ['a version with a space', 'OLD ']
    ])('should take %s for another version and update', async function (_, remote) {
        let { testee } = update({ info: { version: remote } });
        await testee.updateCache(PUBLIC_KEY);
        expect(steps.map(([ step ]) => step)).toContain('applyUpdateArchive');
    });

    it('should never apply an archive that does not pass the verification', async function () {
        let failure = new Error('Integrity check of update failed! The signature does not match the update package.');
        let { testee, cacheManager } = update({ info: { validate: vi.fn(async () => { throw failure; }) } });
        await expect(testee.updateCache(PUBLIC_KEY)).resolves.toBeUndefined();
        expect(cacheManager.applyUpdateArchive).not.toHaveBeenCalled();
        expect(own.error).toHaveBeenCalledWith('Update Failed!', failure);
        expect(own.info).not.toHaveBeenCalledWith('Update Complete');
    });

    it.each([
        ['the update information cannot be got', { server: { getUpdateInfo: vi.fn(async () => { throw new Error('Status: 404'); }) } }, 'Status: 404'],
        ['the version of the cache cannot be read', { cache: { getCurrentVersion: vi.fn(async () => { throw new Error('EIO'); }) } }, 'EIO'],
        ['the archive cannot be downloaded', { server: { getUpdateArchive: vi.fn(async () => { throw new Error('connect ECONNREFUSED'); }) } }, 'connect ECONNREFUSED'],
        ['the archive cannot be applied', { cache: { applyUpdateArchive: vi.fn(async () => { throw new Error('ENOSPC'); }) } }, 'ENOSPC']
    ])('should log the failure and go on without an update when %s', async function (_, overrides, message) {
        let { testee } = update(overrides);
        await expect(testee.updateCache(PUBLIC_KEY)).resolves.toBeUndefined();
        expect(own.error).toHaveBeenCalledTimes(1);
        expect(own.error.mock.calls[0][0]).toBe('Update Failed!');
        expect(own.error.mock.calls[0][1].message).toBe(message);
    });

    it('should not fail when a part throws instead of rejecting', async function () {
        let { testee } = update({ server: { getUpdateInfo: vi.fn(() => { throw new TypeError('not a promise'); }) } });
        await expect(testee.updateCache(PUBLIC_KEY)).resolves.toBeUndefined();
        expect(own.error).toHaveBeenCalledTimes(1);
    });

    it('should not download when the cache cannot be read, because it could not tell whether to', async function () {
        let { testee, serverManager } = update({ cache: { getCurrentVersion: vi.fn(async () => { throw new Error('EIO'); }) } });
        await testee.updateCache(PUBLIC_KEY);
        expect(serverManager.getUpdateArchive).not.toHaveBeenCalled();
    });

    it('should apply the version of the update information, not another one', async function () {
        let { testee, cacheManager } = update({ info: { version: 'FROM-THE-SERVER' } });
        await testee.updateCache(PUBLIC_KEY);
        expect(cacheManager.applyUpdateArchive.mock.calls[0][0]).toBe('FROM-THE-SERVER');
    });

    it('should apply the very archive it downloaded and verified', async function () {
        let { testee, serverManager, info, cacheManager } = update();
        await testee.updateCache(PUBLIC_KEY);
        let downloaded = await serverManager.getUpdateArchive.mock.results[0].value;
        expect(info.validate.mock.calls[0][0]).toBe(downloaded);
        expect(cacheManager.applyUpdateArchive.mock.calls[0][1]).toBe(downloaded);
    });
});