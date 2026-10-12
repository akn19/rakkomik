// scripts/test-package.js runs the end-to-end tests on a package that build-app.js made: a copy of the package gets the
// inspector fuse of Electron back and Playwright is started on the executable of the copy. The script runs here on a
// package that is made up (an executable with a fuse wire), with a Playwright that only records how it was started.
const fs = require('node:fs');
const path = require('node:path');
const config = require('../../../build-app.config');
const { electronExecutable, readFuseWire, write } = require('./support/buildAppHarness');
const {
    createConsole,
    loadToolScript,
    useTemporaryWorkingDirectory,
} = require('./support/toolScripts');

const REPOSITORY = path.resolve(__dirname, '..', '..', '..');
const SCRIPT = path.join(REPOSITORY, 'scripts', 'test-package.js');
// the wire of a packaged executable: the inspector (the fourth fuse) is off, the application only loads from app.asar
const PACKAGED = '000001011';
const INSPECTABLE = '000101011';

useTemporaryWorkingDirectory();

/**
 * The script, as if it were in `scripts/` of the working directory, with a Playwright that records how it is started
 * and answers with `status`.
 */
function load({
    platform = 'linux',
    arch = 'x64',
    env = { DISPLAY: ':0' },
    status = 0,
    error,
    entry = false,
} = {}) {
    const starts = [];
    const exits = [];
    const output = createConsole();
    const { module } = loadToolScript(SCRIPT, {
        dirname: path.join(process.cwd(), 'scripts'),
        modules: {
            'node:child_process': {
                spawnSync: (command, args, options) => {
                    starts.push({ command, args, options });
                    return error ? { error } : { status };
                },
            },
        },
        globals: {
            process: {
                platform,
                arch,
                env,
                execPath: '/usr/bin/node',
                exit: (code) => exits.push(code),
            },
            console: output,
        },
        entry,
    });
    return { ...module.exports, starts, exits, output };
}

// the package of a platform in `build`, as build-app.js leaves it: the executable with a fuse wire and the app.asar
function writePackage(platform, architecture = 'amd64') {
    const executable = electronExecutable(platform === 'darwin' ? '101100011' : PACKAGED);
    // the staging directory, the folder of the application in it and the executable in that folder
    const layouts = {
        linux: [
            `linux_${architecture}`,
            path.join('usr', 'lib', config.name.package),
            config.binary.linux,
        ],
        win32: [`windows-portable_${architecture}`, '', config.binary.windows],
        darwin: [
            `macos_${architecture}`,
            `${config.name.product}.app`,
            path.join('Contents', 'MacOS', config.binary.darwin),
        ],
    };
    const [suffix, inner, binary] = layouts[platform];
    const root = path.join('build', `${config.name.package}_${config.version}_${suffix}`);
    const folder = path.join(root, inner);
    write(path.join(folder, binary), executable);
    write(
        path.join(
            folder,
            platform === 'darwin'
                ? path.join('Contents', 'Resources', 'app.asar')
                : path.join('resources', 'app.asar'),
        ),
        'the application',
    );
    // the copy keeps the place of the application in its package
    return {
        folder,
        binary: path.join(folder, binary),
        copy: path.join('build', 'test-package', path.basename(root), inner),
    };
}

describe('the test of a package', () => {
    it('should start Playwright on a copy of the package of Linux, with the inspector of the copy enabled and the package untouched', async () => {
        const { folder, binary, copy } = writePackage('linux');
        const { main, starts } = load();
        expect(await main()).toBe(0);
        const tested = path.resolve(copy, config.binary.linux);
        expect(readFuseWire(tested)).toBe(INSPECTABLE);
        expect(readFuseWire(binary)).toBe(PACKAGED);
        expect(fs.readFileSync(path.join(copy, 'resources', 'app.asar'), 'utf8')).toBe(
            'the application',
        );
        expect(starts).toEqual([
            {
                command: '/usr/bin/node',
                args: [
                    path.resolve('node_modules', '@playwright', 'test', 'cli.js'),
                    'test',
                    '--project=ui',
                ],
                options: {
                    cwd: process.cwd(),
                    stdio: 'inherit',
                    env: { DISPLAY: ':0', E2E_ELECTRON: tested },
                },
            },
        ]);
        expect(fs.existsSync(path.join(folder, config.binary.linux))).toBe(true);
    });

    it('should run the tests under xvfb-run on a Linux machine without a display', async () => {
        writePackage('linux');
        const { main, starts } = load({ env: {} });
        await main();
        expect(starts[0].command).toBe('xvfb-run');
        expect(starts[0].args).toEqual([
            '-a',
            '/usr/bin/node',
            path.resolve('node_modules', '@playwright', 'test', 'cli.js'),
            'test',
            '--project=ui',
        ]);
    });

    it('should report the failures as annotations as well on GitHub Actions', async () => {
        writePackage('linux');
        const { main, starts } = load({ env: { DISPLAY: ':0', GITHUB_ACTIONS: 'true' } });
        await main();
        expect(starts[0].args).toEqual([
            path.resolve('node_modules', '@playwright', 'test', 'cli.js'),
            'test',
            '--project=ui',
            '--reporter=list,github',
        ]);
    });

    it('should take a Wayland display for a display', async () => {
        writePackage('linux');
        const { main, starts } = load({ env: { WAYLAND_DISPLAY: 'wayland-0' } });
        await main();
        expect(starts[0].command).toBe('/usr/bin/node');
    });

    it('should test the portable package of Windows, with its inspector enabled', async () => {
        const { copy } = writePackage('win32');
        const { main, starts } = load({ platform: 'win32', env: {} });
        expect(await main()).toBe(0);
        const tested = path.resolve(copy, config.binary.windows);
        expect(readFuseWire(tested)).toBe(INSPECTABLE);
        expect(starts[0].command).toBe('/usr/bin/node');
        expect(starts[0].options.env.E2E_ELECTRON).toBe(tested);
    });

    it('should test the application bundle of macOS as it is: its fuses were never flipped, and its signature has to stay', async () => {
        const { copy } = writePackage('darwin', 'arm64');
        const { main, starts } = load({ platform: 'darwin', arch: 'arm64', env: {} });
        expect(await main()).toBe(0);
        const tested = path.resolve(copy, 'Contents', 'MacOS', config.binary.darwin);
        expect(readFuseWire(tested)).toBe('101100011');
        expect(starts[0].options.env.E2E_ELECTRON).toBe(tested);
    });

    it('should test the package of the architecture of the machine', async () => {
        writePackage('linux', 'arm64');
        const { main, starts } = load({ arch: 'arm64' });
        await main();
        expect(starts[0].options.env.E2E_ELECTRON).toContain(`_linux_arm64${path.sep}`);
    });

    it('should replace the copy of an earlier run', async () => {
        const { copy } = writePackage('linux');
        write(path.join(copy, 'stale.txt'), 'of an earlier run');
        await load().main();
        expect(fs.existsSync(path.join(copy, 'stale.txt'))).toBe(false);
    });

    it('should answer with the status of Playwright', async () => {
        writePackage('linux');
        expect(await load({ status: 3 }).main()).toBe(3);
    });

    it('should fail when Playwright cannot be started', async () => {
        writePackage('linux');
        await expect(load({ error: new Error('spawn failed') }).main()).rejects.toThrow(
            'spawn failed',
        );
    });

    it('should keep the copies of the packages apart by their names, so the copy of Linux names its architecture', async () => {
        writePackage('linux');
        const { main, starts } = load();
        await main();
        expect(starts[0].options.env.E2E_ELECTRON).toBe(
            path.resolve(
                'build',
                'test-package',
                `${config.name.package}_${config.version}_linux_amd64`,
                'usr',
                'lib',
                config.name.package,
                config.binary.linux,
            ),
        );
    });

    it('should ask for a build when there is no package', async () => {
        const { main, starts } = load();
        await expect(main()).rejects.toThrow(
            `There is no package in "${path.resolve('build', `${config.name.package}_${config.version}_linux_amd64`, 'usr', 'lib', config.name.package)}", run 'pnpm run build:app' first!`,
        );
        expect(starts).toEqual([]);
    });

    it.each([
        ['linux', 'ia32', 'No package is built for the architecture "ia32"!'],
        ['freebsd', 'x64', 'No package is built for the platform "freebsd"!'],
    ])('should refuse a machine without a package (%s %s)', async (platform, arch, message) => {
        await expect(load({ platform, arch }).main()).rejects.toThrow(message);
    });

    it('should exit with the status of the tests when it is run as a command', async () => {
        writePackage('linux');
        const { exits } = load({ status: 2, entry: true });
        await vi.waitFor(() => expect(exits).toEqual([2]));
    });

    it('should report a failure and exit with 1 when it is run as a command', async () => {
        const { exits, output } = load({ entry: true });
        await vi.waitFor(() => expect(exits).toEqual([1]));
        expect(output.entries.map((entry) => entry.text).join('\n')).toContain(
            'There is no package in',
        );
    });
});
