// Release pipeline contract: what deploy-web.js packs and signs with
// node:crypto is exactly what the client's updater verifies and extracts.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const util = require('node:util');
const { unzipSync } = require('fflate');
const { pack, readTree, resolveChannel } = require('../../../deploy-web.js');
const UpdatePackageInfo = require('../UpdatePackageInfo');
const CacheDirectoryManager = require('../CacheDirectoryManager');
const { createConsole, loadToolScript } = require('./support/toolScripts');

const DEPLOY = path.resolve(__dirname, '..', '..', '..', 'deploy-web.js');
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
    vi.useRealTimers();
    fs.rmSync(build, { recursive: true, force: true });
    fs.rmSync(cache, { recursive: true, force: true });
    delete process.env.RAKKOMIK_PRIVATE_KEY;
    delete process.env.RAKKOMIK_PASSPHRASE;
    delete process.env.CHANNEL;
    delete process.env.GITHUB_REF;
});

/**
 * A copy of deploy-web.js that runs against a GitHub CLI that records its arguments, with the environment and the
 * configuration of the test (the real ones would be read from the process and from deploy-web.config).
 * `answer` decides what `gh` does: it returns the output, or throws to fail.
 */
function loadDeploy({ env = {}, config = {}, answer = () => '', entry = false } = {}) {
    const calls = [];
    const execFile = () => {
        throw new Error('deploy-web.js is expected to promisify execFile');
    };
    execFile[util.promisify.custom] = async (file, args, options) => {
        calls.push({ file, args, options });
        return { stdout: answer(file, args) ?? '', stderr: '' };
    };
    const output = createConsole();
    const fake = { env, on: vi.fn() };
    const { module, exposed } = loadToolScript(DEPLOY, {
        modules: {
            'node:child_process': { execFile },
            './deploy-web.config': { build, tagPrefix: 'web-', meta: 'latest', channel: '', ...config }
        },
        globals: { process: fake, console: output },
        expose: [ 'main' ],
        entry
    });
    return { ...module.exports, main: exposed.main, calls, output, process: fake };
}

// everything that the deployment needs from the environment of a workflow
function workflowEnvironment(overrides = {}) {
    return {
        RAKKOMIK_PRIVATE_KEY: keys.privateKey,
        RAKKOMIK_PASSPHRASE: PASSPHRASE,
        GITHUB_TOKEN: 'a-token',
        GITHUB_REPOSITORY: 'owner/repo',
        GITHUB_REF: 'refs/heads/main',
        GITHUB_SHA: 'abc123def',
        ...overrides
    };
}

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
        // the configuration reads CHANNEL once, when it is loaded: it is set here, whatever the environment of the run is
        const settings = require('../../../deploy-web.config');
        const original = settings.channel;
        try {
            settings.channel = '';
            process.env.GITHUB_REF = 'refs/heads/feature/x';
            expect(resolveChannel()).toBe('feature-x');
            delete process.env.GITHUB_REF;
            expect(() => resolveChannel()).toThrow(/Cannot derive deployment channel/);
            settings.channel = 'manual-run';
            process.env.GITHUB_REF = 'refs/heads/feature/x';
            expect(resolveChannel()).toBe('manual-run');
        } finally {
            settings.channel = original;
        }
    });
});

describe('readTree', () => {
    it('should return the bytes of every file below the folder, however deep, under the name that a ZIP entry has', async () => {
        fs.mkdirSync(path.join(build, 'mjs', 'engine', 'deeper'), { recursive: true });
        const bytes = Buffer.from(Array.from({ length: 256 }, (value, index) => index));
        fs.writeFileSync(path.join(build, 'mjs', 'engine', 'deeper', 'all-bytes.bin'), bytes);
        fs.writeFileSync(path.join(build, 'mjs', 'empty.mjs'), '');
        fs.writeFileSync(path.join(build, '日本語 ファイル ✓.txt'), 'text');

        const files = await readTree(build);

        expect(Object.keys(files).sort()).toEqual([ 'index.html', 'js/app.js', 'mjs/empty.mjs', 'mjs/engine/deeper/all-bytes.bin', '日本語 ファイル ✓.txt' ].sort());
        expect(files['mjs/engine/deeper/all-bytes.bin']).toBeInstanceOf(Uint8Array);
        expect(Buffer.from(files['mjs/engine/deeper/all-bytes.bin'])).toEqual(bytes);
        expect(files['mjs/empty.mjs']).toHaveLength(0);
    });

    it('should list files only: a folder, empty or not, is not an entry', async () => {
        fs.mkdirSync(path.join(build, 'empty'));
        fs.mkdirSync(path.join(build, 'img', 'tray'), { recursive: true });
        expect(Object.keys(await readTree(build)).sort()).toEqual([ 'index.html', 'js/app.js' ]);
    });

    it('should return nothing for a folder without files', async () => {
        const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'rakkomik-empty-'));
        try {
            await expect(readTree(empty)).resolves.toEqual({});
        } finally {
            fs.rmSync(empty, { recursive: true, force: true });
        }
    });

    it('should fail for a folder that does not exist', async () => {
        await expect(readTree(path.join(build, 'missing'))).rejects.toThrow(/ENOENT/);
    });
});

describe('pack', () => {
    const readMeta = meta => fs.readFileSync(meta, 'utf8').split('?signature=');

    it('should write the archive and a meta file that names it and carries its RSA SHA-256 signature in hex', async () => {
        const [ archive, meta ] = await pack(build, 'XYZ.zip', 'latest');
        expect(archive).toBe(path.join(build, 'XYZ.zip'));
        expect(meta).toBe(path.join(build, 'latest'));
        const [ name, signature ] = readMeta(meta);
        expect(name).toBe('XYZ.zip');
        // a key of 2048 bits signs with 256 bytes
        expect(signature).toMatch(/^[0-9a-f]{512}$/);
        // checked here with the plain API of Node, not with the updater of the application
        expect(crypto.verify('sha256', fs.readFileSync(archive), keys.publicKey, Buffer.from(signature, 'hex'))).toBe(true);
    });

    it('should not verify for a different archive, nor with a different key', async () => {
        const [ archive, meta ] = await pack(build, 'XYZ.zip', 'latest');
        const signature = Buffer.from(readMeta(meta)[1], 'hex');
        const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
        expect(crypto.verify('sha256', fs.readFileSync(archive), other.publicKey, signature)).toBe(false);
        expect(crypto.verify('sha256', Buffer.from('another archive'), keys.publicKey, signature)).toBe(false);
    });

    it('should pack every file of the bundle with its bytes and its name, nested or not', async () => {
        fs.mkdirSync(path.join(build, 'mjs', 'engine'), { recursive: true });
        const bytes = Buffer.from(Array.from({ length: 256 }, (value, index) => 255 - index));
        fs.writeFileSync(path.join(build, 'mjs', 'engine', 'blob.bin'), bytes);
        fs.writeFileSync(path.join(build, '日本語.txt'), 'ünï ✓');
        fs.writeFileSync(path.join(build, 'empty'), '');

        const [ archive ] = await pack(build, 'XYZ.zip', 'latest');
        const entries = unzipSync(new Uint8Array(fs.readFileSync(archive)));

        expect(Object.keys(entries).sort()).toEqual([ 'empty', 'index.html', 'js/app.js', 'mjs/engine/blob.bin', '日本語.txt' ]);
        expect(Buffer.from(entries['mjs/engine/blob.bin'])).toEqual(bytes);
        expect(new TextDecoder().decode(entries['日本語.txt'])).toBe('ünï ✓');
        expect(entries.empty).toHaveLength(0);
    });

    it('should keep the private key in memory: no file in the folder holds it or its passphrase', async () => {
        await pack(build, 'XYZ.zip', 'latest');
        const files = fs.readdirSync(build, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile());
        // the two files of the bundle, the archive and the meta file
        expect(files).toHaveLength(4);
        for (const entry of files) {
            const content = fs.readFileSync(path.join(entry.parentPath, entry.name)).toString('latin1');
            expect(content).not.toContain('PRIVATE KEY');
            expect(content).not.toContain(PASSPHRASE);
        }
    });

    it.each([
        [ 'a wrong passphrase', () => {
            process.env.RAKKOMIK_PASSPHRASE = 'not the passphrase';
        } ],
        [ 'no key', () => {
            delete process.env.RAKKOMIK_PRIVATE_KEY;
        } ],
        [ 'a key that is not one', () => {
            process.env.RAKKOMIK_PRIVATE_KEY = 'not a pem';
        } ]
    ])('should write neither the archive nor the meta file when the signing fails for %s', async (description, spoil) => {
        spoil();
        await expect(pack(build, 'XYZ.zip', 'latest')).rejects.toThrow();
        expect(fs.readdirSync(build).sort()).toEqual([ 'index.html', 'js' ]);
    });

    it('should fail for a bundle that does not exist, and write nothing', async () => {
        await expect(pack(path.join(build, 'missing'), 'XYZ.zip', 'latest')).rejects.toThrow(/ENOENT/);
        expect(fs.readdirSync(build).sort()).toEqual([ 'index.html', 'js' ]);
    });

    it('should not pack the archive and the meta file of an earlier run', async () => {
        await pack(build, 'FIRST.zip', 'latest');
        const [ second ] = await pack(build, 'SECOND.zip', 'latest');
        expect(Object.keys(unzipSync(new Uint8Array(fs.readFileSync(second)))).sort()).toEqual([ 'index.html', 'js/app.js' ]);
    });
});

describe('resolveChannel', () => {
    it.each([
        [ 'refs/heads/main', 'main' ],
        [ 'refs/heads/6.1.7', '6.1.7' ],
        [ 'refs/heads/feature/x', 'feature-x' ],
        [ 'refs/heads/a/b/c', 'a-b-c' ],
        [ 'refs/heads/ünï/日本', 'ünï-日本' ]
    ])('should name the channel after the branch of the ref %s: %s', (ref, channel) => {
        expect(loadDeploy({ env: { GITHUB_REF: ref } }).resolveChannel()).toBe(channel);
    });

    it.each([ '', undefined, 'refs/tags/v1.0.0', 'refs/pull/7/merge', 'refs/heads/', 'heads/main', 'x/refs/heads/main' ])('should not derive a channel from the ref %j', ref => {
        const { resolveChannel } = loadDeploy({ env: ref === undefined ? {} : { GITHUB_REF: ref } });
        expect(() => resolveChannel()).toThrow('Cannot derive deployment channel: set CHANNEL or run in GitHub Actions (GITHUB_REF)!');
    });

    it('should prefer the channel of the configuration (CHANNEL of a manual run) to the branch', () => {
        const { resolveChannel } = loadDeploy({ env: { GITHUB_REF: 'refs/heads/main' }, config: { channel: 'manual' } });
        expect(resolveChannel()).toBe('manual');
    });
});

describe('a deployment', () => {
    // the archive is named after the time in base 36, in capitals: 2031-01-01T12:00:00Z is 1925035200000 milliseconds
    const ARCHIVE = 'OKCK96O0.zip';
    beforeEach(() => {
        vi.useFakeTimers({ toFake: [ 'Date' ] });
        vi.setSystemTime(Date.UTC(2031, 0, 1, 12));
    });

    const argumentsOf = calls => calls.map(call => call.args);

    it('should sign the bundle and upload it to the rolling release of the channel, which is created when it does not exist', async () => {
        const { main, calls, output } = loadDeploy({
            env: workflowEnvironment(),
            answer: (file, args) => {
                if (args[1] === 'view') {
                    throw new Error('release not found');
                }
                return `done: ${args[1]}`;
            }
        });

        await main();

        expect(calls.every(call => call.file === 'gh')).toBe(true);
        expect(calls.every(call => call.options.maxBuffer === 16 * 1024 * 1024)).toBe(true);
        expect(argumentsOf(calls)).toEqual([
            [ 'release', 'view', 'web-main', '--repo', 'owner/repo' ],
            [ 'release', 'create', 'web-main', '--repo', 'owner/repo', '--title', 'Web cache (web-main)', '--notes', expect.stringContaining('Rolling web-application cache'), '--target', 'abc123def' ],
            [ 'release', 'upload', 'web-main', path.join(build, ARCHIVE), path.join(build, 'latest'), '--repo', 'owner/repo', '--clobber' ]
        ]);
        // the check of the release is silent, the rest is reported with the output of gh
        expect(output.lines()).toEqual([
            expect.stringMatching(/^> gh release create web-main --repo owner\/repo --title Web cache \(web-main\) --notes Rolling /),
            'done: create',
            expect.stringMatching(/^> gh release upload web-main .*OKCK96O0\.zip .*latest --repo owner\/repo --clobber$/),
            'done: upload'
        ]);
        const [ name, signature ] = fs.readFileSync(path.join(build, 'latest'), 'utf8').split('?signature=');
        expect(name).toBe(ARCHIVE);
        expect(crypto.verify('sha256', fs.readFileSync(path.join(build, ARCHIVE)), keys.publicKey, Buffer.from(signature, 'hex'))).toBe(true);
    });

    it('should only upload to a release that exists, and replace the assets of it', async () => {
        const { main, calls } = loadDeploy({ env: workflowEnvironment() });
        await main();
        expect(argumentsOf(calls).map(args => args[1])).toEqual([ 'view', 'upload' ]);
        expect(calls[1].args).toContain('--clobber');
    });

    it('should create the release at the commit that is built, when the workflow says which one', async () => {
        const create = async env => {
            const { main, calls } = loadDeploy({ env, answer: (file, args) => {
                if (args[1] === 'view') {
                    throw new Error('release not found');
                }
                return '';
            } });
            await main();
            return calls.find(call => call.args[1] === 'create').args;
        };
        expect(await create(workflowEnvironment({ GITHUB_SHA: 'cafe0123' }))).toEqual(expect.arrayContaining([ '--target', 'cafe0123' ]));
        expect(await create(workflowEnvironment({ GITHUB_SHA: '' }))).not.toContain('--target');
    });

    it('should name the release after the prefix of the configuration and the channel', async () => {
        const { main, calls } = loadDeploy({ env: workflowEnvironment({ GITHUB_REF: 'refs/heads/release/6.1' }), config: { tagPrefix: 'cache-' } });
        await main();
        expect(calls.every(call => call.args[2] === 'cache-release-6.1')).toBe(true);
    });

    it('should publish to the channel of a manual run, whatever the ref is', async () => {
        const { main, calls } = loadDeploy({ env: workflowEnvironment({ GITHUB_REF: undefined }), config: { channel: 'manual' } });
        await main();
        expect(calls[0].args).toEqual([ 'release', 'view', 'web-manual', '--repo', 'owner/repo' ]);
    });

    it.each([
        [ 'view', 'release create failed' ],
        [ 'create', 'release create failed' ]
    ])('should stop with the error of gh when the release cannot be created, and upload nothing (%s)', async (failing, message) => {
        const { main, calls } = loadDeploy({
            env: workflowEnvironment(),
            answer: (file, args) => {
                if (args[1] === 'view' || args[1] === 'create') {
                    throw new Error(args[1] === 'create' ? message : 'release not found');
                }
                return '';
            }
        });
        await expect(main()).rejects.toThrow(message);
        expect(argumentsOf(calls).map(args => args[1])).toEqual([ 'view', 'create' ]);
    });

    it('should let the error of the upload out', async () => {
        const { main } = loadDeploy({
            env: workflowEnvironment(),
            answer: (file, args) => {
                if (args[1] === 'upload') {
                    throw new Error('HTTP 502');
                }
                return '';
            }
        });
        await expect(main()).rejects.toThrow('HTTP 502');
    });

    describe('with an incomplete environment', () => {
        it.each([
            [ 'RAKKOMIK_PRIVATE_KEY', 'providing the PEM signing key' ],
            [ 'RAKKOMIK_PASSPHRASE', 'to decrypt private key for signature' ],
            [ 'GITHUB_TOKEN', 'for GitHub Releases upload (gh CLI)' ],
            [ 'GITHUB_REPOSITORY', '(owner/repo) for GitHub Releases upload' ]
        ])('should stop before it packs or publishes anything when %s is missing', async (variable, purpose) => {
            const { main, calls } = loadDeploy({ env: workflowEnvironment({ [variable]: '' }) });
            await expect(main()).rejects.toThrow(`Missing environment variable "${variable}" ${purpose}!`);
            expect(calls).toEqual([]);
            expect(fs.readdirSync(build).sort()).toEqual([ 'index.html', 'js' ]);
        });

        it('should report the first variable that is missing', async () => {
            const { main } = loadDeploy({ env: { GITHUB_TOKEN: 'a-token' } });
            await expect(main()).rejects.toThrow('Missing environment variable "RAKKOMIK_PRIVATE_KEY"');
        });

        it('should stop before it packs or publishes anything when no channel can be derived', async () => {
            const { main, calls } = loadDeploy({ env: workflowEnvironment({ GITHUB_REF: 'refs/tags/v1.0.0' }) });
            await expect(main()).rejects.toThrow('Cannot derive deployment channel');
            expect(calls).toEqual([]);
            expect(fs.readdirSync(build).sort()).toEqual([ 'index.html', 'js' ]);
        });
    });

    describe('as the entry point of a process', () => {
        it('should run the deployment of the environment of the process, and end the process on a rejection that nobody handles', async () => {
            let finished = null;
            const uploaded = new Promise(resolve => {
                finished = resolve;
            });
            const { process: fake, calls } = loadDeploy({
                entry: true,
                env: workflowEnvironment(),
                answer: (file, args) => {
                    if (args[1] === 'upload') {
                        finished();
                    }
                    return '';
                }
            });
            await uploaded;
            expect(argumentsOf(calls).map(args => args[1])).toEqual([ 'view', 'upload' ]);
            const [ [ event, handler ] ] = fake.on.mock.calls;
            expect(event).toBe('unhandledRejection');
            const error = new Error('the deployment failed');
            expect(() => handler(error)).toThrow(error);
        });

        it('should do nothing when it is only required', () => {
            const { process: fake, calls } = loadDeploy({ env: workflowEnvironment() });
            expect(fake.on).not.toHaveBeenCalled();
            expect(calls).toEqual([]);
        });
    });
});
