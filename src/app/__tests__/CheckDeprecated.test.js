// The CI gate that refuses deprecated dependencies (`pnpm run check:deprecated`). The script runs as soon as it is
// loaded and ends the process with `process.exit`, so a copy of it runs here on a project of the test's own (its
// `__dirname` is the `scripts` folder of a temporary project), against a registry that is a function, with a
// `process.exit` that records the exit code and stops the script where it is.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createConsole, loadToolScript, settle } = require('./support/toolScripts');

const CHECK = path.resolve(__dirname, '..', '..', '..', 'scripts', 'check-deprecated.js');
const REPOSITORY = path.resolve(__dirname, '..', '..', '..');

let project = null;

beforeEach(() => {
    project = fs.mkdtempSync(path.join(os.tmpdir(), 'rakkomik-deprecated-'));
});

afterEach(() => {
    fs.rmSync(project, { recursive: true, force: true });
});

function write(file, content) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
}

/**
 * The manifests of a project and its installed packages.
 * @param {object} layout
 * @param {Record<string, string>} [layout.devDependencies] declared by the root
 * @param {Record<string, string>} [layout.dependencies] declared by the application in src/app
 * @param {Record<string, string>} [layout.installed] name -> version, installed in the root
 * @param {Record<string, string>} [layout.nested] name -> version, installed in src/app
 */
function createProject({ devDependencies, dependencies, installed = {}, nested = {} }) {
    write(path.join(project, 'package.json'), { name: 'root', devDependencies });
    write(path.join(project, 'src', 'app', 'package.json'), { name: 'app', dependencies });
    for (const [name, version] of Object.entries(installed)) {
        write(path.join(project, 'node_modules', ...name.split('/'), 'package.json'), {
            name,
            version,
        });
    }
    for (const [name, version] of Object.entries(nested)) {
        write(
            path.join(project, 'src', 'app', 'node_modules', ...name.split('/'), 'package.json'),
            { name, version },
        );
    }
}

/**
 * A registry of the abbreviated documents that the script asks for. A value is the document, a number (the status
 * of an error response), an Error (the request fails) or a function that returns one of these, possibly late.
 */
function createRegistry(documents) {
    const requests = [];
    const fetch = async (url, options) => {
        requests.push({ url, options });
        const name = decodeURIComponent(url.slice('https://registry.npmjs.org/'.length));
        let answer = documents[name];
        if (typeof answer === 'function') {
            answer = await answer();
        }
        if (answer instanceof Error) {
            throw answer;
        }
        if (typeof answer === 'number') {
            return { ok: false, status: answer, json: async () => ({}) };
        }
        if (answer === 'not json') {
            return { ok: true, status: 200, json: async () => JSON.parse('<html>') };
        }
        return { ok: true, status: 200, json: async () => answer };
    };
    return { fetch, requests };
}

// the document of a package whose versions are as `versions` says: version -> deprecation message, or null
function document(versions) {
    return {
        versions: Object.fromEntries(
            Object.entries(versions).map(([version, deprecated]) => [
                version,
                deprecated === null ? {} : { deprecated },
            ]),
        ),
    };
}

/**
 * Start the gate. `result()` lets everything that is ready run and tells how far the gate came: `exitCode` is the
 * code of the first `process.exit` (null when the script has not ended it). The real process would have ended at that
 * call, so what the script printed and asked for is what came before it.
 */
function startGate({ documents = {}, allowlist = {}, fetch, root = project } = {}) {
    const registry = createRegistry(documents);
    const output = createConsole();
    const state = { exitCode: null, printed: null, requested: null };
    const fake = {
        exit(code) {
            if (state.exitCode === null) {
                state.exitCode = code;
                state.printed = output.entries.length;
                state.requested = registry.requests.length;
            }
        },
    };
    const { exposed } = loadToolScript(CHECK, {
        dirname: path.join(root, 'scripts'),
        globals: {
            process: fake,
            console: output,
            fetch: fetch ?? registry.fetch,
            AbortSignal: { timeout: (timeout) => ({ timeout }) },
        },
        expose: ['ALLOWLIST'],
    });
    // the script has started and waits for the registry: the recorded exceptions are in the list before it decides
    for (const [name, reason] of Object.entries(allowlist)) {
        exposed.ALLOWLIST.set(name, reason);
    }
    return {
        async result() {
            await settle();
            const printed = output.entries.slice(0, state.printed ?? undefined);
            return {
                exitCode: state.exitCode,
                requests: registry.requests.slice(0, state.requested ?? undefined),
                stdout: printed
                    .filter((entry) => entry.stream === 'log')
                    .map((entry) => entry.text),
                stderr: printed
                    .filter((entry) => entry.stream === 'error')
                    .map((entry) => entry.text),
            };
        },
    };
}

function runGate(options) {
    return startGate(options).result();
}

describe('the gate for deprecated dependencies', () => {
    describe('when nothing is deprecated', () => {
        beforeEach(() => {
            createProject({
                devDependencies: { alpha: '^1.0.0', '@scope/beta': '^2.0.0' },
                dependencies: { gamma: '^3.0.0', alpha: '^1.0.0' },
                installed: { alpha: '1.2.3', '@scope/beta': '2.0.0' },
                nested: { gamma: '3.1.0' },
            });
        });

        const documents = () => ({
            alpha: document({ '1.2.3': null }),
            '@scope/beta': document({ '2.0.0': null }),
            gamma: document({ '3.1.0': null }),
        });

        it('should pass without ending the process, after it counted every package once', async () => {
            const { exitCode, stdout, stderr } = await runGate({ documents: documents() });
            expect(exitCode).toBeNull();
            expect(stderr).toEqual([]);
            expect(stdout).toEqual([
                // alpha is declared by both manifests
                'Checking 3 declared packages at installed versions ...',
                '\nOK: no unrecorded deprecated packages (0 allowlisted).',
            ]);
        });

        it('should ask the registry for the abbreviated document of each package, with a time limit', async () => {
            const { requests } = await runGate({ documents: documents() });
            expect(requests.map((request) => request.url)).toEqual([
                'https://registry.npmjs.org/alpha',
                // the slash of a scope is encoded
                'https://registry.npmjs.org/@scope%2fbeta',
                'https://registry.npmjs.org/gamma',
            ]);
            for (const { options } of requests) {
                expect(options.headers).toEqual({ accept: 'application/vnd.npm.install-v1+json' });
                expect(options.signal).toEqual({ timeout: 20000 });
            }
        });

        it('should judge the installed version, and not the other versions of the package', async () => {
            // the versions before and after the installed one (1.2.3) are deprecated
            const { exitCode } = await runGate({
                documents: {
                    ...documents(),
                    alpha: document({
                        '1.0.0': 'old',
                        '1.2.3': null,
                        '2.0.0': 'newer and already deprecated',
                    }),
                },
            });
            expect(exitCode).toBeNull();
        });

        it('should not take an empty deprecation message for a deprecation', async () => {
            const { exitCode } = await runGate({
                documents: { ...documents(), alpha: document({ '1.2.3': '' }) },
            });
            expect(exitCode).toBeNull();
        });

        it('should read the version of the root install before the one that the application has', async () => {
            write(path.join(project, 'src', 'app', 'node_modules', 'alpha', 'package.json'), {
                name: 'alpha',
                version: '9.9.9',
            });
            const { exitCode, stdout } = await runGate({
                documents: { ...documents(), alpha: document({ '1.2.3': 'old', '9.9.9': null }) },
            });
            expect(exitCode).toBe(1);
            expect(stdout).toContain(
                '  X alpha@1.2.3 (package.json:devDependencies): DEPRECATED — old',
            );
        });
    });

    describe('when a package is deprecated', () => {
        beforeEach(() => {
            createProject({
                devDependencies: { alpha: '^1.0.0', delta: '^4.0.0' },
                dependencies: { gamma: '^3.0.0' },
                installed: { alpha: '1.2.3', delta: '4.0.0' },
                nested: { gamma: '3.1.0' },
            });
        });

        it('should name it, where it is declared and what the registry says, and end the process with 1', async () => {
            const { exitCode, stdout, stderr } = await runGate({
                documents: {
                    alpha: document({ '1.2.3': 'Use beta' }),
                    delta: document({ '4.0.0': null }),
                    gamma: document({ '3.1.0': null }),
                },
            });
            expect(exitCode).toBe(1);
            expect(stdout).toEqual([
                'Checking 3 declared packages at installed versions ...',
                '  X alpha@1.2.3 (package.json:devDependencies): DEPRECATED — Use beta',
            ]);
            expect(stderr).toEqual([
                '\nFAIL: 1 deprecated package(s) without recorded exception.',
                'Add a replacement, or record an exception in scripts/check-deprecated.js ALLOWLIST.',
            ]);
        });

        it('should report every deprecated package, those of the application too', async () => {
            const { exitCode, stdout, stderr } = await runGate({
                documents: {
                    alpha: document({ '1.2.3': 'one' }),
                    delta: document({ '4.0.0': null }),
                    gamma: document({ '3.1.0': 'two' }),
                },
            });
            expect(exitCode).toBe(1);
            expect(stdout).toEqual([
                'Checking 3 declared packages at installed versions ...',
                '  X alpha@1.2.3 (package.json:devDependencies): DEPRECATED — one',
                '  X gamma@3.1.0 (src/app/package.json:dependencies): DEPRECATED — two',
            ]);
            expect(stderr[0]).toBe('\nFAIL: 2 deprecated package(s) without recorded exception.');
        });

        it('should let a recorded exception pass, say so, and still refuse the others', async () => {
            const documents = {
                alpha: document({ '1.2.3': 'Use beta' }),
                delta: document({ '4.0.0': 'Use epsilon' }),
                gamma: document({ '3.1.0': null }),
            };
            const { exitCode, stdout, stderr } = await runGate({
                documents,
                allowlist: { alpha: 'needed until the next major' },
            });
            expect(exitCode).toBe(1);
            expect(stdout).toEqual([
                'Checking 3 declared packages at installed versions ...',
                '  ~ alpha@1.2.3: deprecated but allowlisted — needed until the next major',
                '    upstream note: Use beta',
                '  X delta@4.0.0 (package.json:devDependencies): DEPRECATED — Use epsilon',
            ]);
            expect(stderr[0]).toBe('\nFAIL: 1 deprecated package(s) without recorded exception.');
        });

        it('should pass when every deprecated package has a recorded exception, and count them', async () => {
            const documents = {
                alpha: document({ '1.2.3': 'Use beta' }),
                delta: document({ '4.0.0': 'Use epsilon' }),
                gamma: document({ '3.1.0': null }),
            };
            const { exitCode, stdout, stderr } = await runGate({
                documents,
                allowlist: { alpha: 'because', delta: 'because too' },
            });
            expect(exitCode).toBeNull();
            expect(stderr).toEqual([]);
            expect(stdout.at(-1)).toBe('\nOK: no unrecorded deprecated packages (2 allowlisted).');
        });
    });

    describe('when a package is not installed', () => {
        it('should name every package that is missing, before it asks the registry anything, and end the process with 1', async () => {
            createProject({
                devDependencies: { alpha: '^1.0.0', beta: '^2.0.0' },
                dependencies: { gamma: '^3.0.0' },
                installed: { beta: '2.0.0' },
            });
            const { exitCode, stdout, stderr, requests } = await runGate({
                documents: { beta: document({ '2.0.0': null }) },
            });
            expect(exitCode).toBe(1);
            expect(requests).toEqual([]);
            expect(stdout).toEqual(['Checking 3 declared packages at installed versions ...']);
            expect(stderr).toEqual([
                'FAIL: 2 package(s) not installed (run install first): alpha, gamma',
            ]);
        });
    });

    describe('when the registry does not give an answer', () => {
        beforeEach(() => {
            createProject({
                devDependencies: { alpha: '^1.0.0', beta: '^2.0.0' },
                installed: { alpha: '1.2.3', beta: '2.0.0' },
            });
        });

        const fine = document({ '2.0.0': null });

        it.each([
            ['an error status', 503, 'registry responded 503 for alpha'],
            ['a package that is unknown', 404, 'registry responded 404 for alpha'],
            ['no network', new TypeError('fetch failed'), 'fetch failed'],
            [
                'a timeout',
                new DOMException('The operation was aborted due to timeout', 'TimeoutError'),
                'The operation was aborted due to timeout',
            ],
            ['a document that is not JSON', 'not json', 'Unexpected token'],
            ['a document without versions', {}, 'alpha@1.2.3 not found on registry'],
            [
                'a document that lacks the installed version',
                document({ '0.9.0': null }),
                'alpha@1.2.3 not found on registry',
            ],
        ])(
            'should fail the gate for %s, since a package that was not checked is not a package that is fine',
            async (description, answer, message) => {
                const { exitCode, stdout, stderr } = await runGate({
                    documents: { alpha: answer, beta: fine },
                });
                expect(exitCode).toBe(1);
                expect(stdout).toHaveLength(2);
                expect(stdout[1]).toContain(`  ! alpha@1.2.3: registry check failed — ${message}`);
                expect(stderr).toEqual([
                    '\nFAIL: 1 registry check(s) errored (network required for this gate).',
                ]);
            },
        );

        it('should report a package that is deprecated and a package that could not be checked, both', async () => {
            const { exitCode, stdout } = await runGate({
                documents: {
                    alpha: new Error('socket hang up'),
                    beta: document({ '2.0.0': 'Use alpha' }),
                },
            });
            expect(exitCode).toBe(1);
            expect(stdout).toEqual(
                expect.arrayContaining([
                    '  ! alpha@1.2.3: registry check failed — socket hang up',
                    '  X beta@2.0.0 (package.json:devDependencies): DEPRECATED — Use alpha',
                ]),
            );
        });

        it('should wait for every answer before it decides, whichever is last', async () => {
            let release = null;
            const late = new Promise((resolve) => {
                release = resolve;
            });
            const gate = startGate({
                documents: {
                    alpha: () => late.then(() => document({ '1.2.3': 'late news' })),
                    beta: document({ '2.0.0': null }),
                },
            });
            // beta was answered, alpha was not: nothing is decided
            const waiting = await gate.result();
            expect(waiting.requests).toHaveLength(2);
            expect(waiting.exitCode).toBeNull();
            expect(waiting.stdout).toEqual([
                'Checking 2 declared packages at installed versions ...',
            ]);
            release();
            const decided = await gate.result();
            expect(decided.exitCode).toBe(1);
            expect(decided.stdout).toContain(
                '  X alpha@1.2.3 (package.json:devDependencies): DEPRECATED — late news',
            );
        });
    });

    describe('when the manifests cannot be read', () => {
        it.each([
            [
                'the manifest of the project is missing',
                () => fs.rmSync(path.join(project, 'package.json')),
                /^FAIL: ENOENT.*package\.json/,
            ],
            [
                'the manifest of the application is missing',
                () => fs.rmSync(path.join(project, 'src', 'app', 'package.json')),
                /^FAIL: ENOENT.*package\.json/,
            ],
            [
                'the manifest of the project is not JSON',
                () => fs.writeFileSync(path.join(project, 'package.json'), '{ not json'),
                /^FAIL: /,
            ],
            [
                'the manifest of an installed package is not JSON',
                () =>
                    fs.writeFileSync(
                        path.join(project, 'node_modules', 'alpha', 'package.json'),
                        '',
                    ),
                /^FAIL: /,
            ],
        ])(
            'should end the process with 1 and one message when %s',
            async (description, spoil, message) => {
                createProject({
                    devDependencies: { alpha: '^1.0.0' },
                    installed: { alpha: '1.2.3' },
                });
                spoil();
                const { exitCode, stderr, requests } = await runGate({
                    documents: { alpha: document({ '1.2.3': null }) },
                });
                expect(exitCode).toBe(1);
                expect(stderr).toHaveLength(1);
                expect(stderr[0]).toMatch(message);
                expect(requests).toEqual([]);
            },
        );
    });

    it('should pass for a project that declares nothing', async () => {
        createProject({});
        const { exitCode, stdout, requests } = await runGate();
        expect(exitCode).toBeNull();
        expect(requests).toEqual([]);
        expect(stdout).toEqual([
            'Checking 0 declared packages at installed versions ...',
            '\nOK: no unrecorded deprecated packages (0 allowlisted).',
        ]);
    });

    // the registry here says that no version of anything is deprecated; the gate reads the manifests and the install of this checkout
    it('should find every package that this repository declares installed, scoped ones and those of the application included', async () => {
        const manifest = (file) => JSON.parse(fs.readFileSync(path.join(REPOSITORY, file), 'utf8'));
        const declared = [
            ...new Set([
                ...Object.keys(manifest('package.json').devDependencies),
                ...Object.keys(manifest(path.join('src', 'app', 'package.json')).dependencies),
            ]),
        ];
        const asked = [];
        const { exitCode, stdout, stderr } = await runGate({
            root: REPOSITORY,
            fetch: async (url) => {
                asked.push(decodeURIComponent(url.slice('https://registry.npmjs.org/'.length)));
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({ versions: new Proxy({}, { get: () => ({}) }) }),
                };
            },
        });
        expect(stderr).toEqual([]);
        expect(exitCode).toBeNull();
        expect(stdout[0]).toBe(
            `Checking ${declared.length} declared packages at installed versions ...`,
        );
        expect(asked.sort()).toEqual([...declared].sort());
        expect(stdout.at(-1)).toMatch(/^\nOK: /);
    });
});
