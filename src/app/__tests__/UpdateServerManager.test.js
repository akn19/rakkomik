const http = require('node:http');
const net = require('node:net');
const assert = require('node:assert');
const { FileLogger, ConsoleLogger } = require('../Logger');
const UpdateServerManager = require('../UpdateServerManager');
const UpdatePackageInfo = require('../UpdatePackageInfo');
var logger = new FileLogger(__filename + '.log', FileLogger.LEVEL.All);
logger.clear();

// A port nobody listens on at allocation time: the fixture binds it while a test
// needs the server and leaves it closed for the "cannot be reached" cases.
async function freePort() {
    const probe = net.createServer();
    await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
    const { port } = probe.address();
    await new Promise((resolve) => probe.close(resolve));
    return port;
}

class TestFixture {
    constructor() {
        this._latest = undefined;
        this._archive = undefined;
        this._server = http.createServer(this._listener.bind(this));
        this.port = undefined; // assigned per run, see freePort()
    }

    /**
     *
     */
    get applicationUpdateURL() {
        return `http://127.0.0.1:${this.port}/latest`;
    }

    // signature matches and archive is valid ZIP
    get archiveMock() {
        return {
            signature:
                '111111.zip?signature=87627cda741492d3c947a0b119e11cb572236d59b46c610054dfd631697f53c6ccbeba615b8a772600755f524b8537b2ae9c7fb306b3b9057d10b2f3526d6e87a074a549af4375cbd6861267fa477303a50843ded86488400d0d62b3d2482146378eb3d278ce0ce17720823e6761793116bedb4f6771c05383c4324bb514436f4f0e3d6cabc1b627ae8af15119324d034588ad884179744eec8db24fcdbeb75a6d2490d535d909ec362e3cce74612167a8ae7e28daee599b3408d4ed192ae1a6484d84a34daafbd86b9c7b9c6776f10d0a9c352183d7c0a100309999cd541cc97412898e83df40e1d6aaf9b89c0c97f06fb7490bf191ac087fb339864fadc7f6',
            archive: Buffer.from(
                '504b03040a0300000000168e4a4b2dd936d702000000020000000a000000696e6465782e68746d6c4f4b504b01023f030a0300000000168e4a4b2dd936d702000000020000000a0024000000000000002080a48100000000696e6465782e68746d6c0a002000000000000100180000568740df41d3010029563fdf41d30100568740df41d301504b050600000000010001005c0000002a0000000000',
                'hex',
            ),
        };
    }

    // signature matches, but archive is not valid ZIP
    get emptyMock() {
        return {
            signature:
                '000000.zip?signature=8345939337c46abdbc27fd3bffff0618af75fc5b90a9872a310a9cef7f9cd23a2354fee47d9a1a4cb0d65e26527bef56c16f218697f590238ab5a364860984c284a2a3745f8817ba15086e7227f34d4c311fa541de23a48a3d2a19396ac1a992c8a78fc8a8a315402181bc8d10e91919e42b7fb50613fedebe5160b28b5703ecc5597ca3e2aad9913df616bbc82835bd7a0927222773e42aebf8c0ee637d5aef99dad456561ff6267c33a8656efb4b5644a925e7c1b6db370af8e491528591d479b3f6c04c0914d7df7a4233cd615c6790b1f4df2f2fed5582b966fb269b9268599010addce427b3f2c1809ac96519056cc3d8bd51c440ee50a650b1968a2392',
            archive: Buffer.from(
                '87fb74631726132b3df3387819f286d8a298fefb6c64287cb3bc7a1e92cd2e83',
                'hex',
            ),
        };
    }

    /**
     *
     */
    createTestee() {
        return new UpdateServerManager(this.applicationUpdateURL, logger);
    }

    /**
     *
     * @param {Request} request
     * @param {Response} response
     */
    _listener(request, response) {
        // No keep-alive: every test binds the same port, so a connection of the previous server that is still in the
        // client's pool would be reused and fail with ECONNRESET (seen on Windows).
        response.setHeader('Connection', 'close');
        if (request.url === '/latest') {
            response.setHeader('Content-Type', 'text/plain');
            response.statusCode = 200;
            return response.end(this._latest);
        }
        if (request.url.includes('.zip')) {
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
        await new Promise((resolve) => this._server.listen(this.port, '127.0.0.1', resolve));
    }

    /**
     *
     */
    async serverStop() {
        if (!this._server.listening) {
            return;
        }
        // keep-alive sockets must not survive into the next test
        this._server.closeAllConnections();
        await new Promise((resolve) => this._server.close(resolve));
    }
}

/**
 * MODULE TESTS
 */
describe('UpdateServerManager', function () {
    let fixture = new TestFixture();

    beforeAll(async () => {
        fixture.port = await freePort();
    });

    describe('constructor()', function () {
        it('should use URL when URL is valid', async () => {
            let testee = new UpdateServerManager('https://localhost', logger);
            assert.equal(testee._applicationUpdateURL, 'https://localhost');
        });

        it('should use default when URL is invalid', async () => {
            let testee = new UpdateServerManager('null', logger);
            assert.equal(testee._applicationUpdateURL, undefined);
        });

        it('should use default when URL is undefined', async () => {
            let testee = new UpdateServerManager(undefined, logger);
            assert.equal(testee._applicationUpdateURL, undefined);
        });

        it('should use default when URL has wrong type', async () => {
            let testee = new UpdateServerManager(123, logger);
            assert.equal(testee._applicationUpdateURL, undefined);
        });
    });

    describe('isDisabled', function () {
        afterEach(() => {
            vi.restoreAllMocks();
        });

        it('should be false when URL is valid', async () => {
            let testee = new UpdateServerManager('https://localhost', logger);
            assert.equal(testee.isDisabled, false);
        });

        it('should be true without a warning when the update is disabled on purpose', async () => {
            let warn = vi.spyOn(logger, 'warn');
            let testee = new UpdateServerManager('DISABLED', logger);
            assert.equal(testee.isDisabled, true);
            assert.equal(warn.mock.calls.length, 0);
        });

        it('should be true with a warning when URL is invalid', async () => {
            let warn = vi.spyOn(logger, 'warn');
            let testee = new UpdateServerManager('null', logger);
            assert.equal(testee.isDisabled, true);
            assert.equal(warn.mock.calls.length, 1);
        });
    });

    describe('getUpdateInfo()', function () {
        it('should get valid result when URL is valid', async () => {
            await fixture.serverStart(fixture.archiveMock.signature, fixture.archiveMock.archive);
            let testee = fixture.createTestee();
            let info = await testee.getUpdateInfo();
            await fixture.serverStop();
            assert.equal(info.version.length, 6);
            assert.equal(/[a-f0-9]+/.test(info.version), true);
            assert.equal(info.signature.length, 512);
            assert.equal(/[a-f0-9]+/.test(info.signature), true);
            let expected = fixture.applicationUpdateURL.replace(
                'latest',
                info.version + '.zip?signature=' + info.signature,
            );
            assert.equal(info.link, expected);
        });

        it('should throw error when URL does not exist', async () => {
            let testee = new UpdateServerManager(fixture.applicationUpdateURL + '/invalid', logger);
            await fixture.serverStart(fixture.archiveMock.signature, fixture.archiveMock.archive);
            try {
                await testee.getUpdateInfo();
                assert.fail('Expected error not thrown!');
            } catch (error) {
                assert.equal(error.message, 'Status: 404');
            } finally {
                await fixture.serverStop();
            }
        });

        it('should throw error when host cannot be reached', async () => {
            let testee = fixture.createTestee();
            try {
                await testee.getUpdateInfo();
                assert.fail('Expected error not thrown!');
            } catch (error) {
                assert.equal(error.message, `connect ECONNREFUSED 127.0.0.1:${fixture.port}`);
            }
        });

        it('should throw error when URL is invalid', async () => {
            let testee = new UpdateServerManager('null', logger);
            try {
                await testee.getUpdateInfo();
                assert.fail('Expected error not thrown!');
            } catch (error) {
                assert.equal(error.message, 'Invalid request for connection to the update server!');
            }
        });

        it('should throw error when URL is undefined', async () => {
            let testee = new UpdateServerManager(undefined, logger);
            try {
                await testee.getUpdateInfo();
                assert.fail('Expected error not thrown!');
            } catch (error) {
                assert.equal(error.message, 'Invalid request for connection to the update server!');
            }
        });
    });

    describe('getUpdateArchive()', function () {
        it('should get valid result when URL is valid', async () => {
            await fixture.serverStart(fixture.archiveMock.signature, fixture.archiveMock.archive);
            let testee = fixture.createTestee();
            let info = await testee.getUpdateInfo();
            let archive = await testee.getUpdateArchive(info);
            await fixture.serverStop();
            assert.equal(archive.length, fixture.archiveMock.archive.length);
        });

        it('should throw error when URL does not exist', async () => {
            let testee = fixture.createTestee();
            await fixture.serverStart(fixture.archiveMock.signature, fixture.archiveMock.archive);
            try {
                await testee.getUpdateArchive({ link: fixture.applicationUpdateURL + '/invalid' });
                assert.fail('Expected error not thrown!');
            } catch (error) {
                assert.equal(error.message, 'Status: 404');
            } finally {
                await fixture.serverStop();
            }
        });

        it('should throw error when host cannot be reached', async () => {
            let testee = fixture.createTestee();
            try {
                await testee.getUpdateArchive({ link: fixture.applicationUpdateURL + '.zip' });
                assert.fail('Expected error not thrown!');
            } catch (error) {
                assert.equal(error.message, `connect ECONNREFUSED 127.0.0.1:${fixture.port}`);
            }
        });

        it('should throw error when URL is invalid', async () => {
            let testee = fixture.createTestee();
            try {
                await testee.getUpdateArchive({ link: 'foobar' });
                assert.fail('Expected error not thrown!');
            } catch (error) {
                assert.equal(error.message, 'Invalid URL');
            }
        });

        it('should throw error when URL is undefined', async () => {
            let testee = fixture.createTestee();
            try {
                await testee.getUpdateArchive({ link: undefined });
                assert.fail('Expected error not thrown!');
            } catch (error) {
                assert.equal(error.message, 'Invalid request for connection to the update server!');
            }
        });
    });
});

/**
 * The same, without a network: `fetch` is a double, and a local server answers where redirects have to be followed.
 */
describe('UpdateServerManager with doubles', function () {
    const UPDATE_URL = 'https://updates.example.org/channel/latest';
    let own = null;

    function answer(status, body = '') {
        // a response without content has no body
        return new Response([204, 205, 304].includes(status) ? null : body, { status });
    }

    function managerAnswering(response) {
        let fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => response);
        return { fetch, manager: new UpdateServerManager(UPDATE_URL, own) };
    }

    beforeEach(() => {
        own = { warn: vi.fn() };
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('constructor()', function () {
        it('should log through a console logger of its own when it is given none', function () {
            assert.ok(new UpdateServerManager('DISABLED')._logger instanceof ConsoleLogger);
        });

        it.each([
            ['a secure URL', 'https://updates.example.org/latest'],
            ['a plain one', 'http://127.0.0.1:8080/latest'],
            ['a URL with a query', 'https://updates.example.org/latest?channel=beta'],
        ])('should be enabled by %s, without a warning', function (_, url) {
            let manager = new UpdateServerManager(url, own);
            expect(manager.isDisabled).toBe(false);
            expect(own.warn).not.toHaveBeenCalled();
        });

        it('should be switched off on purpose by DISABLED, and be quiet about it', function () {
            expect(new UpdateServerManager('DISABLED', own).isDisabled).toBe(true);
            expect(own.warn).not.toHaveBeenCalled();
        });

        it.each([
            ['a text that is no URL', 'null'],
            ['a relative URL', '/channel/latest'],
            ['an empty text', ''],
            ['a lower case disabled', 'disabled'],
            ['undefined', undefined],
            ['a number', 123],
            ['an object', {}],
        ])('should be disabled, with a warning that names the URL, by %s', function (_, url) {
            let manager = new UpdateServerManager(url, own);
            expect(manager.isDisabled).toBe(true);
            expect(own.warn).toHaveBeenCalledTimes(1);
            expect(own.warn.mock.calls[0][0]).toBe(
                'Initialization of "UpdateServerManager" failed!',
            );
            expect(own.warn.mock.calls[0][1].message).toBe(`Invalid update URL: ${url}`);
        });

        it('should not ask a server that is disabled', async function () {
            let fetch = vi.spyOn(globalThis, 'fetch');
            let manager = new UpdateServerManager('DISABLED', own);
            await expect(manager.getUpdateInfo()).rejects.toThrow(
                'Invalid request for connection to the update server!',
            );
            expect(fetch).not.toHaveBeenCalled();
        });
    });

    describe('_request()', function () {
        it('should ask for the URL, follow redirects and not wait for ever', async function () {
            let timeout = vi.spyOn(AbortSignal, 'timeout');
            let { fetch, manager } = managerAnswering(answer(200, 'x'));
            await manager._request('https://updates.example.org/other');
            expect(fetch).toHaveBeenCalledTimes(1);
            let [url, options] = fetch.mock.calls[0];
            expect(url).toBe('https://updates.example.org/other');
            expect(options.redirect).toBe('follow');
            expect(options.signal).toBeInstanceOf(AbortSignal);
            expect(options.signal.aborted).toBe(false);
            // a stalled update check must not block the start of the application: one minute
            expect(timeout).toHaveBeenCalledWith(60000);
        });

        it('should answer the bytes of the body', async function () {
            let { manager } = managerAnswering(answer(200, new Uint8Array([0, 1, 254, 255])));
            let bytes = await manager._request(UPDATE_URL);
            expect(bytes).toBeInstanceOf(Uint8Array);
            expect([...bytes]).toEqual([0, 1, 254, 255]);
        });

        it('should answer an empty body as no bytes', async function () {
            let { manager } = managerAnswering(answer(200, ''));
            expect((await manager._request(UPDATE_URL)).length).toBe(0);
        });

        it.each([201, 204, 206, 301, 304, 400, 401, 403, 404, 410, 429, 500, 502, 503])(
            'should refuse the status %i, as only 200 is an answer',
            async function (status) {
                let { manager } = managerAnswering(answer(status, 'the body of an error'));
                await expect(manager._request(UPDATE_URL)).rejects.toThrow(`Status: ${status}`);
            },
        );

        it.each([[undefined], [null], ['']])('should refuse to ask for %p', async function (uri) {
            let fetch = vi.spyOn(globalThis, 'fetch');
            await expect(new UpdateServerManager(UPDATE_URL, own)._request(uri)).rejects.toThrow(
                'Invalid request for connection to the update server!',
            );
            expect(fetch).not.toHaveBeenCalled();
        });

        it('should fail with the cause of a failed request, which is what says why', async function () {
            let cause = Object.assign(new Error('getaddrinfo ENOTFOUND updates.example.org'), {
                code: 'ENOTFOUND',
            });
            vi.spyOn(globalThis, 'fetch').mockRejectedValue(
                new TypeError('fetch failed', { cause }),
            );
            await expect(
                new UpdateServerManager(UPDATE_URL, own)._request(UPDATE_URL),
            ).rejects.toBe(cause);
        });

        it.each([
            ['an error without a cause', new TypeError('Invalid URL')],
            [
                'an error with a cause that is no error',
                new TypeError('fetch failed', { cause: 'a text' }),
            ],
            [
                'a timeout',
                new DOMException('The operation was aborted due to timeout', 'TimeoutError'),
            ],
        ])('should fail with the failure itself for %s', async function (_, failure) {
            vi.spyOn(globalThis, 'fetch').mockRejectedValue(failure);
            await expect(
                new UpdateServerManager(UPDATE_URL, own)._request(UPDATE_URL),
            ).rejects.toBe(failure);
        });

        it('should fail when the body breaks off', async function () {
            let broken = new Response(
                new ReadableStream({
                    start(controller) {
                        controller.enqueue(new Uint8Array([1]));
                        controller.error(new Error('socket hang up'));
                    },
                }),
                { status: 200 },
            );
            let { manager } = managerAnswering(broken);
            await expect(manager._request(UPDATE_URL)).rejects.toThrow('socket hang up');
        });
    });

    describe('getUpdateInfo()', function () {
        it('should read the name of the package and its signature from the answer, and make the link absolute', async function () {
            let { manager } = managerAnswering(answer(200, 'K3F9A2.zip?signature=00ff12ab'));
            let info = await manager.getUpdateInfo();
            expect(info).toBeInstanceOf(UpdatePackageInfo);
            expect(info.version).toBe('K3F9A2');
            expect(info.signature).toBe('00ff12ab');
            expect(info.link).toBe(
                'https://updates.example.org/channel/K3F9A2.zip?signature=00ff12ab',
            );
        });

        it.each([
            ['a line feed', 'ABC.zip?signature=aa\n'],
            ['a line feed and a carriage return', 'ABC.zip?signature=aa\r\n'],
            ['spaces around it', '  ABC.zip?signature=aa  '],
            ['a tab and several blank lines', '\tABC.zip?signature=aa\n\n\n'],
        ])('should leave out %s', async function (_, body) {
            let { manager } = managerAnswering(answer(200, body));
            let info = await manager.getUpdateInfo();
            expect(info.version).toBe('ABC');
            expect(info.signature).toBe('aa');
            expect(info.link).toBe('https://updates.example.org/channel/ABC.zip?signature=aa');
        });

        it('should take the link as it is when it is absolute', async function () {
            let { manager } = managerAnswering(
                answer(200, 'https://cdn.example.org/assets/ABC.zip?signature=aa'),
            );
            let info = await manager.getUpdateInfo();
            expect(info.link).toBe('https://cdn.example.org/assets/ABC.zip?signature=aa');
            expect(info.signature).toBe('aa');
        });

        it('should find a package in a directory next to the answer', async function () {
            let { manager } = managerAnswering(answer(200, 'packages/ABC.zip?signature=aa'));
            expect((await manager.getUpdateInfo()).link).toBe(
                'https://updates.example.org/channel/packages/ABC.zip?signature=aa',
            );
        });

        it('should have no signature when the link has none, which makes the verification refuse the package', async function () {
            let { manager } = managerAnswering(answer(200, 'ABC.zip'));
            let info = await manager.getUpdateInfo();
            expect(info.signature).toBeNull();
            await expect(info.validate(new Uint8Array([1]), 'not a key')).rejects.toThrow();
        });

        it('should take the first signature of several', async function () {
            let { manager } = managerAnswering(answer(200, 'ABC.zip?signature=aa&signature=bb'));
            expect((await manager.getUpdateInfo()).signature).toBe('aa');
        });

        it('should decode the signature, as the verification wants hex', async function () {
            let { manager } = managerAnswering(answer(200, 'ABC.zip?signature=%61%62&other=1'));
            expect((await manager.getUpdateInfo()).signature).toBe('ab');
        });

        it('should fail when the server does not answer with a 200', async function () {
            let { manager } = managerAnswering(answer(404));
            await expect(manager.getUpdateInfo()).rejects.toThrow('Status: 404');
        });

        // NOTE: an empty answer is taken for a package named "" that is the answer itself, which the later steps refuse:
        // there is no signature to verify. Characterisation of what the next steps are given.
        it('should hand an empty answer on as a package without name and signature, that points back at the update URL', async function () {
            let { manager } = managerAnswering(answer(200, ''));
            let info = await manager.getUpdateInfo();
            expect(info.version).toBe('');
            expect(info.signature).toBeNull();
            expect(info.link).toBe(UPDATE_URL);
        });
    });

    describe('getUpdateArchive()', function () {
        it('should download the link of the update information', async function () {
            let { fetch, manager } = managerAnswering(answer(200, new Uint8Array([80, 75, 3, 4])));
            let bytes = await manager.getUpdateArchive({
                link: 'https://updates.example.org/channel/ABC.zip?signature=aa',
            });
            expect(fetch.mock.calls[0][0]).toBe(
                'https://updates.example.org/channel/ABC.zip?signature=aa',
            );
            expect([...bytes]).toEqual([80, 75, 3, 4]);
        });

        it.each([
            ['no information', undefined],
            ['null', null],
            ['information without a link', {}],
            ['an empty link', { link: '' }],
        ])('should refuse %s', async function (_, info) {
            let fetch = vi.spyOn(globalThis, 'fetch');
            await expect(
                new UpdateServerManager(UPDATE_URL, own).getUpdateArchive(info),
            ).rejects.toThrow('Invalid request for connection to the update server!');
            expect(fetch).not.toHaveBeenCalled();
        });

        it('should fail when the archive is not there', async function () {
            let { manager } = managerAnswering(answer(404));
            await expect(
                manager.getUpdateArchive({ link: 'https://updates.example.org/channel/ABC.zip' }),
            ).rejects.toThrow('Status: 404');
        });
    });

    describe('when the server redirects', function () {
        let server = null;
        let base = null;

        beforeEach(async () => {
            vi.restoreAllMocks();
            server = http.createServer((request, response) => {
                // no keep-alive: the sockets of one test must not be reused by the next
                response.setHeader('Connection', 'close');
                if (request.url === '/channel/latest') {
                    response.writeHead(302, { Location: '/storage/object-4711/latest' });
                    return response.end();
                }
                if (request.url === '/storage/object-4711/latest') {
                    return response.end('ABC.zip?signature=aa');
                }
                if (request.url === '/channel/ABC.zip?signature=aa') {
                    response.writeHead(301, { Location: '/storage/object-4711/ABC.zip' });
                    return response.end();
                }
                if (request.url === '/storage/object-4711/ABC.zip') {
                    return response.end(new Uint8Array([80, 75]));
                }
                if (request.url === '/loop') {
                    response.writeHead(302, { Location: '/loop' });
                    return response.end();
                }
                response.writeHead(404);
                return response.end();
            });
            await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
            base = `http://127.0.0.1:${server.address().port}`;
        });

        afterEach(async () => {
            server.closeAllConnections();
            await new Promise((resolve) => server.close(resolve));
        });

        it('should follow the redirect of the update URL and of the archive', async function () {
            let manager = new UpdateServerManager(`${base}/channel/latest`, own);
            let info = await manager.getUpdateInfo();
            expect(info.version).toBe('ABC');
            let archive = await manager.getUpdateArchive(info);
            expect([...archive]).toEqual([80, 75]);
        });

        it('should make the link absolute against the update URL, not against where the redirect led', async function () {
            let manager = new UpdateServerManager(`${base}/channel/latest`, own);
            let info = await manager.getUpdateInfo();
            expect(info.link).toBe(`${base}/channel/ABC.zip?signature=aa`);
        });

        it('should fail instead of redirecting for ever', async function () {
            let manager = new UpdateServerManager(`${base}/channel/latest`, own);
            await expect(manager._request(`${base}/loop`)).rejects.toThrow();
        });
    });
});
