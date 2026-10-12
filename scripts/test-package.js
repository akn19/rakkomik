/**
 * Runs the end-to-end tests of the interface on a package that build-app.js made, instead of on the Electron of
 * node_modules: what the user gets is started, with its own app.asar and the web part next to it. The package of this
 * platform and architecture is copied, the copy gets the inspector fuse of Electron back (Playwright drives the
 * application through the inspector, the package itself keeps it off) and the tests start the executable of the copy.
 *
 *   pnpm run test:package      (after `pnpm run build:app`, or `node build-app.js <windows|linux|macos>`)
 *
 * On Linux without a display the tests run under xvfb-run.
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');
const config = require('../build-app.config');

const ROOT = path.resolve(__dirname, '..');
// the architecture of Node and the name that the packages carry
const ARCHITECTURES = { x64: 'amd64', arm64: 'arm64' };

/**
 * The package of a platform and an architecture that build-app.js leaves in `build`.
 * @returns {{ root: string, folder: string, executable: string, fuses: boolean }} the staging directory of the package,
 *   the folder in it that holds the application, the executable in that folder, and whether the packager flipped the
 *   fuses of the executable (macOS is signed instead)
 */
function locate(platform, architecture) {
    const name = ARCHITECTURES[architecture];
    if (!name) {
        throw new Error(`No package is built for the architecture "${architecture}"!`);
    }
    const staging = (suffix) =>
        path.join(ROOT, 'build', `${config.name.package}_${config.version}_${suffix}`);
    switch (platform) {
        case 'linux':
            return {
                root: staging(`linux_${name}`),
                folder: path.join('usr', 'lib', config.name.package),
                executable: config.binary.linux,
                fuses: true,
            };
        case 'win32':
            return {
                root: staging(`windows-portable_${name}`),
                folder: '',
                executable: config.binary.windows,
                fuses: true,
            };
        case 'darwin':
            return {
                root: staging(`macos_${name}`),
                folder: `${config.name.product}.app`,
                executable: path.join('Contents', 'MacOS', config.binary.darwin),
                fuses: false,
            };
        default:
            throw new Error(`No package is built for the platform "${platform}"!`);
    }
}

async function main() {
    const { root, folder, executable, fuses } = locate(process.platform, process.arch);
    const application = path.join(root, folder);
    if (!fs.existsSync(path.join(application, executable))) {
        throw new Error(`There is no package in "${application}", run 'pnpm run build:app' first!`);
    }
    // a copy of the application in its place of the package, so that the package stays what the packager made of it
    const copyRoot = path.join(ROOT, 'build', 'test-package', path.basename(root));
    const copy = path.join(copyRoot, folder);
    console.log(`Copying the package to "${copy}" ...`);
    fs.rmSync(copyRoot, { recursive: true, force: true });
    fs.cpSync(application, copy, { recursive: true, verbatimSymlinks: true });
    const binary = path.join(copy, executable);
    if (fuses) {
        console.log('Enabling the inspector of the copy (the package keeps it off) ...');
        await flipFuses(binary, {
            version: FuseVersion.V1,
            [FuseV1Options.EnableNodeCliInspectArguments]: true,
        });
    }

    const command = [
        process.execPath,
        path.join(ROOT, 'node_modules', '@playwright', 'test', 'cli.js'),
        'test',
        '--project=ui',
    ];
    // on GitHub Actions a failure is also an annotation of the run, which anyone can read (the log is for the admins)
    if (process.env.GITHUB_ACTIONS === 'true') {
        command.push('--reporter=list,github');
    }
    if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
        command.unshift('xvfb-run', '-a');
    }
    console.log(`Testing "${binary}" ...`);
    const result = spawnSync(command[0], command.slice(1), {
        cwd: ROOT,
        stdio: 'inherit',
        env: { ...process.env, E2E_ELECTRON: binary },
    });
    if (result.error) {
        throw result.error;
    }
    return result.status ?? 1;
}

module.exports = { locate, main };

if (require.main === module) {
    main()
        .then((status) => process.exit(status))
        .catch((error) => {
            console.error(error.message);
            process.exit(1);
        });
}
