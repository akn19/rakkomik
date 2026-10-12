// scripts/pack-app.js packs the shell of the application into an app.asar with the files that the application loads at
// run time, and leaves out what only the developers of the shell and of its dependencies need. The packer runs for real
// on a shell that is made up here, and the archive is listed to see what it holds.
const fs = require('node:fs');
const path = require('node:path');
const asar = require('@electron/asar');
const { packApp, isShipped } = require('../../../scripts/pack-app');
const { useTemporaryWorkingDirectory } = require('./support/toolScripts');

useTemporaryWorkingDirectory();

function write(file, content = file) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
}

// what the shell looks like once it is installed: its sources, its tests, the files of pnpm and a hoisted node_modules
// tree with everything that a package ships
function writeShell(source = 'app') {
    const files = {
        'main.js': 'require("./App");',
        'App.js': 'module.exports = class App {};',
        'package.json':
            '{ "name": "app", "main": "main.js", "dependencies": { "dep": "1.0.0", "@scope/dep": "2.0.0" } }',
        '__tests__/App.test.js': 'test();',
        '__tests__/App.test.js.log': 'log of the test',
        '__tests__/support/fixture.js': 'fixture',
        'pnpm-lock.yaml': 'lockfileVersion: 9',
        'pnpm-workspace.yaml': 'nodeLinker: hoisted',
        '.npmrc': 'setting',
        'node_modules/.bin/dep': 'script',
        'node_modules/.pnpm/lock.yaml': 'lock',
        'node_modules/.modules.yaml': 'modules',
        'node_modules/.pnpm-workspace-state-v1.json': '{}',
        'node_modules/dep/package.json': '{ "name": "dep", "main": "index.js" }',
        'node_modules/dep/index.js': 'module.exports = {};',
        'node_modules/dep/index.mjs': 'export default {};',
        'node_modules/dep/index.cjs': 'module.exports = {};',
        'node_modules/dep/index.d.ts': 'export {};',
        'node_modules/dep/index.d.mts': 'export {};',
        'node_modules/dep/index.js.map': '{}',
        'node_modules/dep/lib/parser.wasm': 'wasm',
        'node_modules/dep/lib/data.json': '{}',
        'node_modules/dep/lib/worker.js': 'worker',
        'node_modules/dep/src/index.ts': 'source',
        'node_modules/dep/src/index.mts': 'source',
        'node_modules/dep/README.md': 'readme',
        'node_modules/dep/README': 'readme',
        'node_modules/dep/CHANGELOG': 'changes',
        'node_modules/dep/History.md': 'history',
        'node_modules/dep/LICENSE': 'MIT',
        'node_modules/dep/LICENSE.txt': 'MIT',
        'node_modules/dep/tsconfig.json': '{}',
        'node_modules/dep/tsconfig.build.json': '{}',
        'node_modules/dep/.github/workflows/ci.yml': 'ci',
        'node_modules/dep/.eslintrc.json': '{}',
        'node_modules/dep/test/index.test.js': 'test',
        'node_modules/dep/tests/fixtures/data.json': '{}',
        'node_modules/dep/__tests__/index.js': 'test',
        'node_modules/dep/benchmark/run.js': 'bench',
        'node_modules/dep/examples/basic.js': 'example',
        'node_modules/dep/docs/api.html': 'docs',
        'node_modules/dep/coverage/lcov.info': 'coverage',
        'node_modules/dep/.travis.yml': 'ci',
        'node_modules/dep/build.log': 'log',
        'node_modules/dep/index.tsbuildinfo': '{}',
        'node_modules/@scope/dep/package.json':
            '{ "name": "@scope/dep", "exports": { ".": { "require": "./dist/index.js", "import": "./dist/index.mjs" } } }',
        'node_modules/@scope/dep/dist/index.js': 'module.exports = {};',
        'node_modules/@scope/dep/dist/index.mjs': 'export default {};',
        'node_modules/@scope/dep/dist/index.d.ts': 'export {};',
        'node_modules/@scope/dep/dist/index.mjs.map': '{}',
        'node_modules/@scope/dep/CODE_OF_CONDUCT.md': 'conduct',
        'node_modules/@scope/dep/SECURITY.md': 'security',
    };
    for (const [name, content] of Object.entries(files)) {
        write(path.join(source, ...name.split('/')), content);
    }
    return source;
}

async function entriesOf(archive) {
    return (await asar.listPackage(archive, { isPack: false }))
        .map((entry) => entry.split(path.sep).join('/'))
        .sort();
}

describe('the packer of the shell', () => {
    it('should pack what the application loads: its sources, its manifest and the runtime files of its dependencies', async () => {
        const source = writeShell();
        const result = await packApp(source, path.join('out', 'app.asar'));
        expect(await entriesOf(path.join('out', 'app.asar'))).toEqual([
            '/App.js',
            '/main.js',
            '/node_modules',
            '/node_modules/@scope',
            '/node_modules/@scope/dep',
            '/node_modules/@scope/dep/dist',
            '/node_modules/@scope/dep/dist/index.js',
            '/node_modules/@scope/dep/dist/index.mjs',
            '/node_modules/@scope/dep/package.json',
            '/node_modules/dep',
            '/node_modules/dep/LICENSE',
            '/node_modules/dep/LICENSE.txt',
            '/node_modules/dep/index.cjs',
            '/node_modules/dep/index.js',
            '/node_modules/dep/index.mjs',
            '/node_modules/dep/lib',
            '/node_modules/dep/lib/data.json',
            '/node_modules/dep/lib/parser.wasm',
            '/node_modules/dep/lib/worker.js',
            '/node_modules/dep/package.json',
            '/package.json',
        ]);
        // the count and the size of what was packed, and of what was left out, are reported
        expect(result.files).toBe(15);
        expect(result.bytes).toBe(
            [
                'main.js',
                'App.js',
                'package.json',
                'node_modules/dep/package.json',
                'node_modules/dep/index.js',
                'node_modules/dep/index.mjs',
                'node_modules/dep/index.cjs',
                'node_modules/dep/lib/parser.wasm',
                'node_modules/dep/lib/data.json',
                'node_modules/dep/lib/worker.js',
                'node_modules/dep/LICENSE',
                'node_modules/dep/LICENSE.txt',
                'node_modules/@scope/dep/package.json',
                'node_modules/@scope/dep/dist/index.js',
                'node_modules/@scope/dep/dist/index.mjs',
            ].reduce((sum, file) => sum + fs.statSync(path.join(source, file)).size, 0),
        );
        expect(result.left.count).toBe(37);
        expect(result.left.bytes).toBeGreaterThan(0);
    });

    it('should write the archive where it is asked to, directories included, and keep the content of the files', async () => {
        const source = writeShell();
        const archive = path.join('deep', 'er', 'app.asar');
        await packApp(source, archive);
        expect(asar.extractFile(archive, 'main.js').toString()).toBe('require("./App");');
        expect(
            asar
                .extractFile(archive, path.join('node_modules', 'dep', 'lib', 'parser.wasm'))
                .toString(),
        ).toBe('wasm');
    });

    it('should replace an archive of an earlier build', async () => {
        const source = writeShell();
        write(path.join('out', 'app.asar'), 'an archive of an earlier build');
        await packApp(source, path.join('out', 'app.asar'));
        expect(await entriesOf(path.join('out', 'app.asar'))).toContain('/main.js');
    });

    it('should refuse a directory that is not the shell', async () => {
        fs.mkdirSync('elsewhere');
        await expect(packApp('elsewhere', 'app.asar')).rejects.toThrow(
            '"elsewhere" is not the shell of the application, it has no package.json!',
        );
        expect(fs.existsSync('app.asar')).toBe(false);
    });

    it('should refuse a shell whose dependencies are not installed: the application would not start', async () => {
        const source = writeShell();
        fs.rmSync(path.join(source, 'node_modules'), { recursive: true });
        await expect(packApp(source, 'app.asar')).rejects.toThrow(
            `The dependencies of "${source}" are not installed (no node_modules), run 'pnpm install' first!`,
        );
        expect(fs.existsSync('app.asar')).toBe(false);
    });

    it('should pack a shell without dependencies without asking for node_modules', async () => {
        write(path.join('bare', 'main.js'), 'process.exit(0);');
        write(path.join('bare', 'package.json'), '{ "name": "bare", "main": "main.js" }');
        await packApp('bare', 'app.asar');
        expect(await entriesOf('app.asar')).toEqual(['/main.js', '/package.json']);
    });

    describe('what is shipped', () => {
        it.each([
            ['main.js', false],
            ['package.json', false],
            ['node_modules', true],
            ['node_modules/dep/package.json', false],
            ['node_modules/dep/index.js', false],
            ['node_modules/dep/lib/parser.wasm', false],
            ['node_modules/dep/LICENSE', false],
            ['node_modules/dep/LICENSE.md', false],
            ['node_modules/dep/NOTICE', false],
            ['node_modules/dep/AUTHORS', false],
            ['node_modules/dep/lib', true],
            // a runtime file whose name only starts like a word of the developers
            ['node_modules/dep/testing.js', false],
            ['node_modules/dep/document.js', false],
            ['node_modules/dep/readme-parser.js', false],
            ['node_modules/dep/typescript.js', false],
            ['node_modules/dep/lib/test-helpers', true],
            ['node_modules/dep/data.yml.js', false],
        ])('should ship %s', (name, directory) => {
            expect(isShipped(name, directory)).toBe(true);
        });

        it.each([
            ['__tests__', true],
            ['App.test.js.log', false],
            ['pnpm-lock.yaml', false],
            ['pnpm-workspace.yaml', false],
            ['.npmrc', false],
            ['node_modules/.bin', true],
            ['node_modules/.pnpm', true],
            ['node_modules/.modules.yaml', false],
            ['node_modules/dep/index.d.ts', false],
            ['node_modules/dep/index.d.mts', false],
            ['node_modules/dep/index.d.cts', false],
            ['node_modules/dep/src/index.ts', false],
            ['node_modules/dep/index.js.map', false],
            ['node_modules/dep/README.md', false],
            ['node_modules/dep/README', false],
            ['node_modules/dep/readme.markdown', false],
            ['node_modules/dep/CHANGELOG', false],
            ['node_modules/dep/CHANGELOG.md', false],
            ['node_modules/dep/History.md', false],
            ['node_modules/dep/SECURITY.md', false],
            ['node_modules/dep/tsconfig.json', false],
            ['node_modules/dep/tsconfig.build.json', false],
            ['node_modules/dep/.travis.yml', false],
            ['node_modules/dep/.github', true],
            ['node_modules/dep/test', true],
            ['node_modules/dep/tests', true],
            ['node_modules/dep/__tests__', true],
            ['node_modules/dep/examples', true],
            ['node_modules/dep/docs', true],
            ['node_modules/dep/benchmark', true],
            ['node_modules/dep/coverage', true],
            ['node_modules/dep/build.log', false],
            ['node_modules/dep/index.tsbuildinfo', false],
        ])('should leave out %s', (name, directory) => {
            expect(isShipped(name, directory)).toBe(false);
        });
    });
});
