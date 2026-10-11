// The packager of the installers: what the packages hold, as far as that can be checked without building one. The
// mistakes that this guards against only showed when the package was built (by the first run of the packager anywhere):
// dpkg-deb refused maintainer scripts that were not executable, the RPM of ARM64 was labelled x86_64, and the installer
// of ARM64 for Windows did not tell Windows which architecture it is for.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const asar = require('@electron/asar');
const { FuseState, FuseV1Options, FuseVersion } = require('@electron/fuses');
const { ElectronPackagerLinux, ElectronPackagerWindows } = require('../../../build-app.js');
const config = require('../../../build-app.config');
const { REPOSITORY, STOCK_FUSES, electronExecutable, loadBuildApp, readFuseWire, write, writeElectronArchive, writeSources } = require('./support/buildAppHarness');
const { useTemporaryWorkingDirectory } = require('./support/toolScripts');

let directory = null;
let umask = null;

beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rakkomik-packager-'));
    // the umask of a CI runner or of a user who shares nothing: the scripts must not depend on it
    umask = process.umask(0o077);
    // the packager reports every step it takes, which these tests do not need to see
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
    vi.restoreAllMocks();
    process.umask(umask);
    fs.rmSync(directory, { recursive: true, force: true });
});

function linuxPackager(architecture = '64') {
    const packager = new ElectronPackagerLinux(config);
    packager._architecture = packager.architectures[architecture];
    Object.defineProperty(packager, '_dirBuildRoot', { get: () => path.join(directory, 'package') });
    return packager;
}

function modeOf(file) {
    return fs.statSync(file).mode & 0o777;
}

// A DEB is built on Linux only. Windows has no file modes (`stat` reports 0o666 for every writable file) and writes the
// paths of the Linux target with backslashes, so there is nothing to check there.
describe.skipIf(process.platform === 'win32')('the maintainer scripts of the DEB', () => {
    const script = name => path.join(directory, 'package', 'DEBIAN', name);

    it('should be executable whatever the umask is, because dpkg-deb refuses anything else', () => {
        const packager = linuxPackager();
        packager._createPostScript('postinst');
        packager._createPostScript('postrm');
        for (const name of ['postinst', 'postrm']) {
            // "must be >=0555 and <=0775" (dpkg-deb)
            expect(modeOf(script(name))).toBeGreaterThanOrEqual(0o555);
            expect(modeOf(script(name))).toBeLessThanOrEqual(0o775);
            expect(modeOf(script(name))).toBe(0o755);
        }
    });

    it('should link the application into the path after the installation, and remove the link with it', () => {
        const packager = linuxPackager();
        packager._createPostScript('postinst');
        packager._createPostScript('postrm');
        const symbolic = `/usr/bin/${config.name.package}`;
        const binary = `/usr/lib/${config.name.package}/${config.binary.linux}`;
        const postinst = fs.readFileSync(script('postinst'), 'utf8');
        const postrm = fs.readFileSync(script('postrm'), 'utf8');
        expect(postinst.startsWith('#!/bin/sh\nset -e')).toBe(true);
        expect(postinst).toContain(`if [ ! -f ${symbolic} ] ; then ln -s ${binary} ${symbolic} ; fi`);
        expect(postrm.startsWith('#!/bin/sh\nset -e')).toBe(true);
        expect(postrm).toContain(`if [ -f ${symbolic} ] ; then rm -f ${symbolic} ; fi`);
    });

    it('should not make the other files executable', () => {
        const packager = linuxPackager();
        const file = path.join(directory, 'package', 'DEBIAN', 'control');
        packager._saveFile(file, 'Package: rakkomik\n', false);
        expect(modeOf(file) & 0o111).toBe(0);
    });

    it('should give a file the permissions it is asked for, and not those of the umask', () => {
        const packager = linuxPackager();
        const file = path.join(directory, 'script.sh');
        packager._saveFile(file, '#!/bin/sh\n', false, 0o755);
        expect(modeOf(file)).toBe(0o755);
        const archive = path.join(directory, 'manual.gz');
        packager._saveFile(archive, 'text', true, 0o644);
        expect(modeOf(archive)).toBe(0o644);
    });
});

describe('the RPM', () => {
    function rpmPackager(architecture) {
        const packager = linuxPackager(architecture);
        const commands = [];
        packager._validateCommands = async () => undefined;
        packager._copySkeletonRPM = async () => undefined;
        packager._bundleElectron = async () => undefined;
        packager._createManpage = () => undefined;
        packager._createChangelog = () => undefined;
        packager._createDesktopShortcut = () => undefined;
        packager._createSpecsRPM = async () => path.join(directory, 'specfile.spec');
        packager._executeCommand = async command => {
            commands.push(command);
            return '';
        };
        return { packager, commands };
    }

    it('should name the architecture of each package: the name of rpm, which is not the one of Debian', () => {
        const { architectures } = linuxPackager();
        expect(Object.values(architectures).map(entry => [entry.name, entry.rpm])).toEqual([['amd64', 'x86_64'], ['arm64', 'aarch64']]);
    });

    it.each([['64', 'x86_64'], ['ARM64', 'aarch64']])('should be built for the architecture of the package (%s: %s)', async (architecture, target) => {
        const { packager, commands } = rpmPackager(architecture);
        await packager.buildRPM(architecture);
        const build = commands.find(command => command.startsWith('rpmbuild'));
        expect(build).toContain(` --target ${target} `);
        expect(build).toMatch(/^rpmbuild -bb --noclean --target \S+ --define "_topdir .+[\\/]package" --define "buildroot %\{_topdir\}" ".+specfile\.spec"$/);
        // the package is moved from the directory of its architecture, whichever that is
        expect(commands.find(command => command.startsWith('mv'))).toContain('/RPMS/*/*.rpm');
    });
});

describe('the Inno Setup script of the Windows installer', () => {
    function script(architecture) {
        const packager = new ElectronPackagerWindows(config);
        packager._architecture = packager.architectures[architecture].is;
        let content = '';
        packager._saveFile = (file, data) => {
            content = data;
        };
        packager._createScriptIS(true);
        return { lines: content.split(/\r?\n/), name: path.basename(packager._dirBuildRoot) };
    }

    it.each([['64', 'x64compatible'], ['ARM64', 'arm64']])('should allow the installer on its own architecture only, and install in 64-bit mode there (%s: %s)', (architecture, identifier) => {
        const { lines } = script(architecture);
        expect(lines).toContain(`ArchitecturesAllowed=${identifier}`);
        expect(lines).toContain(`ArchitecturesInstallIn64BitMode=${identifier}`);
    });

    it('should not use the identifier x64, which Windows 11 on Arm does not match and Inno Setup deprecated', () => {
        for (const architecture of ['64', 'ARM64']) {
            expect(script(architecture).lines.filter(line => /^;?Architectures\w+=x64$/.test(line))).toEqual([]);
        }
    });

    it.each(['64', 'ARM64'])('should pack the folder of the package into the installer that the workflow collects (%s)', architecture => {
        const { lines, name } = script(architecture);
        expect(lines).toContain(`OutputBaseFilename=${name}`);
        expect(lines).toContain(`Source: ${name}\\*; DestDir: {app}; Flags: recursesubdirs`);
        expect(lines).toContain('OutputDir=.');
    });
});

describe('the configuration of the packagers', () => {
    const application = require('../package.json');

    it('should carry the version of the application, which the tag of a release has to equal', () => {
        expect(config.version).toMatch(/^\d+\.\d+\.\d+$/);
        expect(config.version).toBe(require('../../../package.json').version);
        expect(config.version).toBe(application.version);
    });

    it('should bundle one exact version of Electron, the installed one, because the download names it', () => {
        expect(config.electron).toMatch(/^\d+\.\d+\.\d+$/);
        expect(config.electron).toBe(require('electron/package.json').version);
    });

    it('should pack a directory that holds the entry point of the application', () => {
        expect(fs.existsSync(path.join(REPOSITORY, config.src, application.main))).toBe(true);
    });

    it('should name a package that dpkg accepts', () => {
        // Debian policy 5.6.1: lower case letters, digits and "+-.", at least two characters, a letter or a digit first
        expect(config.name.package).toMatch(/^[a-z0-9][a-z0-9+.-]+$/);
    });
});

describe('the steps that every packager shares', () => {
    useTemporaryWorkingDirectory();

    function shared(options) {
        const app = loadBuildApp(options);
        return { ...app, packager: new app.ElectronPackagerLinux(config) };
    }

    // a download that breaks after the first bytes
    function brokenDownload() {
        let sent = false;
        return new Response(new ReadableStream({
            pull(controller) {
                if (sent) {
                    controller.error(new Error('connection reset'));
                } else {
                    sent = true;
                    controller.enqueue(new Uint8Array([ 1, 2, 3 ]));
                }
            }
        }));
    }

    it('should refuse to build as the base of the packagers', () => {
        const Base = Object.getPrototypeOf(ElectronPackagerLinux);
        expect(() => new Base(config).build('64')).toThrow('Not implemented!');
    });

    describe('_getSize', () => {
        function stage(sizes) {
            sizes.forEach((size, index) => write(path.join('tree', index % 2 ? 'nested' : '.', `file${index}`), Buffer.alloc(size)));
            fs.mkdirSync(path.join('tree', 'empty'), { recursive: true });
            return 'tree';
        }

        it.each([
            [ 'a tree without files', [], '0' ],
            [ 'a single byte', [ 1 ], '1' ],
            [ 'exactly one KiB', [ 1024 ], '1' ],
            [ 'one byte more than one KiB', [ 1025 ], '2' ],
            [ 'files of several folders that add up', [ 600, 600, 600 ], '2' ]
        ])('should report %s in KiB, rounded up, as a string', async (description, sizes, expected) => {
            await expect(shared().packager._getSize(stage(sizes))).resolves.toBe(expected);
        });

        it('should count the files below the folder it is given and nothing beside it', async () => {
            write(path.join('root', 'usr', 'bin', 'app'), Buffer.alloc(3000));
            write(path.join('root', 'DEBIAN', 'control'), Buffer.alloc(50000));
            await expect(shared().packager._getSize(path.join('root', 'usr'))).resolves.toBe('3');
        });
    });

    describe('_saveFile', () => {
        it('should create the folders of the file', () => {
            const file = path.join('a', 'b', 'c.txt');
            shared().packager._saveFile(file, 'text', false);
            expect(fs.readFileSync(file, 'utf8')).toBe('text');
        });

        it('should write text as UTF-8 and bytes as they are', () => {
            const { packager } = shared();
            packager._saveFile('text', 'ünï ✓ 日本', false);
            packager._saveFile('bytes', Buffer.from([ 0, 255, 128, 10, 13 ]), false);
            expect(fs.readFileSync('text')).toEqual(Buffer.from('ünï ✓ 日本', 'utf8'));
            expect(fs.readFileSync('bytes')).toEqual(Buffer.from([ 0, 255, 128, 10, 13 ]));
        });

        it('should compress with the highest level when it is asked to', () => {
            shared().packager._saveFile('page.gz', 'manual '.repeat(100), true);
            const bytes = fs.readFileSync('page.gz');
            expect(zlib.gunzipSync(bytes).toString('utf8')).toBe('manual '.repeat(100));
            // RFC 1952: the extra flags say "maximum compression" for the level 9
            expect([ bytes[0], bytes[1], bytes[8] ]).toEqual([ 0x1f, 0x8b, 2 ]);
        });
    });

    describe('_extractArchive', () => {
        it.each([
            [ 'win32', 'tar -xf "pkg.zip" -C "out"' ],
            [ 'linux', 'unzip "pkg.zip" -d "out"' ],
            [ 'darwin', 'unzip "pkg.zip" -d "out"' ]
        ])('should use the archiver of the platform (%s)', async (platform, command) => {
            const { packager, runner } = shared({ platform });
            await packager._extractArchive('pkg.zip', 'out');
            expect(runner.commands).toEqual([ command ]);
        });
    });

    describe('_compressArchive', () => {
        // GNU tar of a Linux host cannot write a ZIP, bsdtar can; Windows and macOS ship bsdtar as `tar`
        it.each([ [ 'linux', 'bsdtar' ], [ 'darwin', 'tar' ], [ 'win32', 'tar' ] ])('should pack the folder next to its own name with the tool of the platform (%s: %s)', async (platform, tool) => {
            const { packager, runner } = shared({ platform });
            expect(packager._zipTool).toBe(tool);
            await packager._compressArchive(path.join('build', 'pkg_1.0.0'), path.join('build', 'pkg_1.0.0.zip'));
            expect(runner.commands).toEqual([ `${tool} -a -c -f "${path.join('build', 'pkg_1.0.0.zip')}" -C "build" "pkg_1.0.0"` ]);
        });
    });

    describe('_executeCommand', () => {
        it('should print the command and its output and resolve with the output', async () => {
            const { packager, runner, output } = shared();
            runner.respond = () => ({ stdout: 'built', stderr: 'a warning' });
            await expect(packager._executeCommand('make all')).resolves.toBe('built');
            expect(output.lines()).toEqual([ '> make all', 'built', 'a warning' ]);
        });

        it('should print nothing when it is silent', async () => {
            const { packager, runner, output } = shared();
            runner.respond = () => 'quiet';
            await expect(packager._executeCommand('probe', true)).resolves.toBe('quiet');
            expect(output.lines()).toEqual([]);
        });

        it('should fail with the error of the command, after it printed what the command wrote', async () => {
            const { packager, runner, output } = shared();
            runner.respond = () => ({ error: new Error('exit code 2'), stdout: 'partial', stderr: 'no space left' });
            await expect(packager._executeCommand('make')).rejects.toThrow('exit code 2');
            expect(output.lines()).toEqual([ '> make', 'partial', 'no space left' ]);
        });
    });

    describe('_validateCommands', () => {
        it('should run every command silently and in order', async () => {
            const { packager, runner, output } = shared();
            await packager._validateCommands('a --version', 'b --version', 'c --version');
            expect(runner.commands).toEqual([ 'a --version', 'b --version', 'c --version' ]);
            expect(output.lines()).toEqual([]);
        });

        it('should name the first command that fails and not run the others', async () => {
            const { packager, runner } = shared();
            runner.respond = command => command === 'b --version' ? new Error('not found') : '';
            await expect(packager._validateCommands('a --version', 'b --version', 'c --version'))
                .rejects.toThrow("Failed to run command 'b --version', make sure it is correctly installed!");
            expect(runner.commands).toEqual([ 'a --version', 'b --version' ]);
        });
    });

    describe('_download', () => {
        const uri = 'https://example.test/electron.zip';
        const file = path.join('redist', 'electron.zip');

        it('should store what the server sends, whatever the bytes are, and follow redirects', async () => {
            const bytes = Buffer.from([ 0, 255, 128, 10, 13, 0x50, 0x4b ]);
            const fetch = vi.fn(async () => new Response(bytes));
            await shared({ fetch }).packager._download(uri, file);
            expect(fs.readFileSync(file)).toEqual(bytes);
            expect(fetch).toHaveBeenCalledTimes(1);
            expect(fetch).toHaveBeenCalledWith(uri, { redirect: 'follow' });
        });

        it('should fail with the status and the address when the server refuses, and write nothing', async () => {
            const { packager } = shared({ fetch: async () => new Response('missing', { status: 404 }) });
            await expect(packager._download(uri, file)).rejects.toThrow(`Failed to download electron client (404 ${uri})!`);
            expect(fs.existsSync('redist')).toBe(false);
        });

        // `_downloadElectron` takes a file of the right name for a finished download, so a truncated one would stay in use
        it('should fail, and leave neither the archive nor a part of it behind, when the connection breaks', async () => {
            const { packager } = shared({ fetch: async () => brokenDownload() });
            await expect(packager._download(uri, file)).rejects.toThrow('connection reset');
            expect(fs.readdirSync('redist')).toEqual([]);
        });

        it('should show the archive under its name only when the download is complete', async () => {
            const seen = [];
            let chunks = 0;
            const body = new ReadableStream({
                pull(controller) {
                    seen.push(fs.existsSync(file));
                    if (chunks < 3) {
                        controller.enqueue(new Uint8Array([ ++chunks ]));
                    } else {
                        controller.close();
                    }
                }
            });
            await shared({ fetch: async () => new Response(body) }).packager._download(uri, file);
            expect(seen.length).toBeGreaterThan(1);
            expect(seen.every(exists => !exists)).toBe(true);
            expect(fs.readFileSync(file)).toEqual(Buffer.from([ 1, 2, 3 ]));
            expect(fs.readdirSync('redist')).toEqual([ 'electron.zip' ]);
        });
    });

    describe('_downloadElectron', () => {
        const archive = path.join('redist', 'electron-v44.7.0-linux-x64.zip');
        const target = path.join('build', 'staging');

        // the archive of Electron holds these three files next to the application; the packagers do not ship them
        function extractor(packager) {
            const extracted = [];
            packager._extractArchive = async (zip, directory) => {
                extracted.push([ zip, directory ]);
                for (const name of [ 'electron', 'version', 'LICENSE', 'LICENSES.chromium.html' ]) {
                    fs.writeFileSync(path.join(directory, name), name);
                }
            };
            return extracted;
        }

        it('should download the archive of the release for the platform once, and extract it', async () => {
            const fetch = vi.fn(async () => new Response('zip bytes'));
            const { packager } = shared({ fetch });
            const extracted = extractor(packager);
            await packager._downloadElectron('44.7.0', 'linux-x64', target);
            expect(fetch).toHaveBeenCalledWith('https://github.com/electron/electron/releases/download/v44.7.0/electron-v44.7.0-linux-x64.zip', { redirect: 'follow' });
            expect(fs.readFileSync(archive, 'utf8')).toBe('zip bytes');
            expect(extracted).toEqual([ [ archive, target ] ]);
        });

        it('should not download an archive that is cached in redist', async () => {
            write(archive, 'cached bytes');
            const fetch = vi.fn();
            const { packager } = shared({ fetch });
            const extracted = extractor(packager);
            await packager._downloadElectron('44.7.0', 'linux-x64', target);
            expect(fetch).not.toHaveBeenCalled();
            expect(fs.readFileSync(archive, 'utf8')).toBe('cached bytes');
            expect(extracted).toEqual([ [ archive, target ] ]);
        });

        it('should drop the files of the archive that are not part of the package', async () => {
            write(archive, 'cached bytes');
            const { packager } = shared();
            extractor(packager);
            await packager._downloadElectron('44.7.0', 'linux-x64', target);
            expect(fs.readdirSync(target)).toEqual([ 'electron' ]);
        });

        it('should not extract anything when the download fails', async () => {
            const { packager } = shared({ fetch: async () => new Response('', { status: 503 }) });
            const extracted = extractor(packager);
            await expect(packager._downloadElectron('44.7.0', 'linux-x64', target)).rejects.toThrow('Failed to download electron client (503 https://github.com/electron/electron/releases/download/v44.7.0/electron-v44.7.0-linux-x64.zip)!');
            expect(extracted).toEqual([]);
            expect(fs.existsSync(target)).toBe(false);
        });
    });

    describe('_bundleWebPart', () => {
        it.each([
            [ 'does not exist', () => undefined ],
            [ 'holds no index.html', () => write(path.join('build', 'web', 'js', 'app.js'), 'x') ]
        ])('should refuse a web part that %s, and say how to build it', async (description, prepare) => {
            prepare();
            const { packager } = shared();
            await expect(packager._bundleWebPart('resources'))
                .rejects.toThrow(`The web part is missing in "${path.join('build', 'web')}", run 'pnpm run build:web' first!`);
            expect(fs.existsSync(path.join('resources', 'web'))).toBe(false);
        });

        it('should copy the whole web part into the folder `web` next to app.asar', async () => {
            writeSources();
            write(path.join('build', 'web', 'img', 'tray', 'logo.png'), Buffer.from([ 137, 80, 78, 71 ]));
            await shared().packager._bundleWebPart('resources');
            expect(fs.readFileSync(path.join('resources', 'web', 'index.html'), 'utf8')).toBe('<html>web part</html>');
            expect(fs.readFileSync(path.join('resources', 'web', 'mjs', 'engine', 'Engine.mjs'), 'utf8')).toBe('export default {};');
            expect(fs.readFileSync(path.join('resources', 'web', 'img', 'tray', 'logo.png'))).toEqual(Buffer.from([ 137, 80, 78, 71 ]));
            // the web part itself stays where it is
            expect(fs.existsSync(path.join('build', 'web', 'index.html'))).toBe(true);
        });
    });

    // NOTE: every build checks that the command `asar` runs, and none of them runs it: the application is packed with the library of
    // @electron/asar. docs/development.md does not list the command among the requirements, and it is on the path only when the build
    // runs through pnpm (`node build-app.js` in a shell without node_modules/.bin fails here). Unsure whether the check is meant to show
    // that the dependencies are installed (the script cannot even be loaded without them)
    it.each([
        [ 'the DEB', 'ElectronPackagerLinux', 'buildDEB' ],
        [ 'the RPM', 'ElectronPackagerLinux', 'buildRPM' ],
        [ 'the installer of Windows', 'ElectronPackagerWindows', 'buildIS' ],
        [ 'the archive of Windows', 'ElectronPackagerWindows', 'buildZIP' ]
    ])('should check that the command asar exists before it builds %s', async (description, Packager, method) => {
        const app = loadBuildApp({ platform: 'linux' });
        const packager = new app[Packager](config);
        let checked = null;
        packager._validateCommands = async (...commands) => {
            checked = commands;
            throw new Error('stop after the check');
        };
        await expect(packager[method]('64')).rejects.toThrow('stop after the check');
        expect(checked).toContain('asar --version');
    });

    describe('_applyFuses', () => {
        it.each([
            // RunAsNode, EnableNodeOptionsEnvironmentVariable and EnableNodeCliInspectArguments off, OnlyLoadAppFromAsar on;
            // the other fuses keep the state they have
            [ 'stock Electron', STOCK_FUSES, '000001011' ],
            [ 'a binary with every fuse enabled', '111111111', '010011111' ],
            [ 'a binary with every fuse disabled', '000000000', '000001000' ]
        ])('should harden %s and leave the other fuses alone', async (description, stock, hardened) => {
            write('binary', electronExecutable(stock));
            const before = fs.readFileSync('binary');
            await shared().packager._applyFuses('binary');
            expect(readFuseWire('binary')).toBe(hardened);
            // nothing but the wire changed
            const after = fs.readFileSync('binary');
            expect(after.length).toBe(before.length);
            expect(after.toString('latin1').replace(hardened, '')).toBe(before.toString('latin1').replace(stock, ''));
        });

        it.each([
            [ 'does not hold a fuse wire', Buffer.from('not an electron binary'), /Could not find sentinel/ ],
            [ 'has a wire that is too short for the fuses', electronExecutable('101'), /not long enough/ ]
        ])('should fail the build for a binary that %s, which must not ship unhardened', async (description, bytes, message) => {
            write('binary', bytes);
            await expect(shared().packager._applyFuses('binary')).rejects.toThrow(message);
        });

        describe('read back', () => {
            function packagerWith(wire) {
                const flipFuses = vi.fn(async () => 1);
                const fuses = { ...require('@electron/fuses'), flipFuses, getCurrentFuseWire: async () => ({ version: FuseVersion.V1, ...wire }) };
                return { flipFuses, ...shared({ modules: { '@electron/fuses': fuses } }) };
            }
            const hardened = {
                [FuseV1Options.RunAsNode]: FuseState.DISABLE,
                [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: FuseState.DISABLE,
                [FuseV1Options.EnableNodeCliInspectArguments]: FuseState.DISABLE,
                [FuseV1Options.OnlyLoadAppFromAsar]: FuseState.ENABLE
            };

            it('should ask for exactly the four fuses of the hardening, in the first version of the wire', async () => {
                const { packager, flipFuses } = packagerWith(hardened);
                await packager._applyFuses('the-binary');
                expect(flipFuses).toHaveBeenCalledTimes(1);
                expect(flipFuses).toHaveBeenCalledWith('the-binary', {
                    version: FuseVersion.V1,
                    [FuseV1Options.RunAsNode]: false,
                    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
                    [FuseV1Options.EnableNodeCliInspectArguments]: false,
                    [FuseV1Options.OnlyLoadAppFromAsar]: true
                });
            });

            it.each([
                [ 'RunAsNode', FuseV1Options.RunAsNode, FuseState.ENABLE, 'ENABLE', 'DISABLE' ],
                [ 'EnableNodeOptionsEnvironmentVariable', FuseV1Options.EnableNodeOptionsEnvironmentVariable, FuseState.ENABLE, 'ENABLE', 'DISABLE' ],
                [ 'EnableNodeCliInspectArguments', FuseV1Options.EnableNodeCliInspectArguments, FuseState.REMOVED, 'REMOVED', 'DISABLE' ],
                [ 'OnlyLoadAppFromAsar', FuseV1Options.OnlyLoadAppFromAsar, FuseState.DISABLE, 'DISABLE', 'ENABLE' ]
            ])('should fail when the binary still has %s in the wrong state', async (name, fuse, found, foundName, expectedName) => {
                const { packager } = packagerWith({ ...hardened, [fuse]: found });
                await expect(packager._applyFuses('the-binary')).rejects.toThrow(`Fuse ${name} of "the-binary" is ${foundName}, expected ${expectedName}!`);
            });

            it('should fail when the wire has no state for a fuse at all', async () => {
                const partial = { ...hardened };
                delete partial[FuseV1Options.OnlyLoadAppFromAsar];
                await expect(packagerWith(partial).packager._applyFuses('the-binary')).rejects.toThrow('Fuse OnlyLoadAppFromAsar of "the-binary" is undefined, expected ENABLE!');
            });
        });
    });
});

// The files of the Linux packages are written for a Linux system: they are checked where such a package is built
describe.skipIf(process.platform === 'win32')('the files of the Linux packages', () => {
    useTemporaryWorkingDirectory();

    function linuxApp(architecture = '64', options) {
        const app = loadBuildApp({ platform: 'linux', ...options });
        const packager = new app.ElectronPackagerLinux(config);
        packager._architecture = packager.architectures[architecture];
        return { ...app, packager };
    }

    const lines = file => fs.readFileSync(file, 'utf8').split(/\r?\n/);
    const gunzippedLines = file => zlib.gunzipSync(fs.readFileSync(file)).toString('utf8').split(/\r?\n/);

    it('should name each architecture the way that Debian, rpm, Electron and the names of the packages need', () => {
        expect(new ElectronPackagerLinux(config).architectures).toEqual({
            '64': { name: 'amd64', rpm: 'x86_64', suffix: 'linux_amd64', platform: 'linux-x64' },
            'ARM64': { name: 'arm64', rpm: 'aarch64', suffix: 'linux_arm64', platform: 'linux-arm64' }
        });
    });

    it('should stage the package in a folder named after the package, its version and its architecture', () => {
        const { packager } = linuxApp('ARM64');
        expect(packager._dirBuildRoot).toBe(path.join('build', `${config.name.package}_${config.version}_linux_arm64`));
        expect(packager._stagingExecutableDirectory).toBe(path.join(packager._dirBuildRoot, 'usr', 'lib', config.name.package));
    });

    it('should write the manual page as gzip, in the folder of section 1', () => {
        const { packager } = linuxApp();
        packager._createManpage();
        expect(gunzippedLines(path.join(packager._dirBuildRoot, 'usr', 'share', 'man', 'man1', `${config.name.package}.1.gz`))).toEqual([
            `.TH ${config.name.package} 1 "" ""`,
            '',
            '.SH NAME',
            `${config.name.package} - ${config.description.short}`,
            '',
            '.SH SYNOPSIS',
            config.name.package,
            '',
            '.SH DESCRIPTION',
            config.description.long
        ]);
    });

    it('should write the changelog as gzip, in the folder of the documentation of the package', () => {
        const { packager } = linuxApp();
        packager._createChangelog();
        expect(gunzippedLines(path.join(packager._dirBuildRoot, 'usr', 'share', 'doc', config.name.package, 'changelog.gz'))).toEqual([ '-' ]);
    });

    it('should write the desktop entry that starts the installed binary under the name of the product', () => {
        const { packager } = linuxApp();
        packager._createDesktopShortcut();
        expect(lines(path.join(packager._dirBuildRoot, 'usr', 'share', 'applications', `${config.name.package}.desktop`))).toEqual([
            '[Desktop Entry]',
            'Version=1.0',
            'Type=Application',
            `Name=${config.name.product}`,
            `GenericName=${config.description.short}`,
            `Exec=/usr/lib/${config.name.package}/${config.binary.linux}`,
            `Icon=${config.name.package}`,
            'Categories=Network;FileTransfer;'
        ]);
    });

    it.each([ 'deb', 'rpm' ])('should find the icon that the desktop entry names in the skeleton of the %s', flavour => {
        const icon = path.join(REPOSITORY, 'redist', flavour, 'usr', 'share', 'icons', 'hicolor', '256x256', 'apps', `${config.name.package}.png`);
        expect(fs.existsSync(icon)).toBe(true);
    });

    describe('the control file of the DEB', () => {
        async function control(architecture) {
            const { packager } = linuxApp(architecture);
            const root = packager._dirBuildRoot;
            write(path.join(root, 'usr', 'lib', 'app', 'binary'), Buffer.alloc(2000));
            write(path.join(root, 'usr', 'share', 'doc', 'copyright'), Buffer.alloc(100));
            // the size of the package is the size of what it installs: DEBIAN does not count
            write(path.join(root, 'DEBIAN', 'preinst'), Buffer.alloc(40000));
            await packager._createControlDEB();
            return lines(path.join(root, 'DEBIAN', 'control'));
        }

        it.each([ [ '64', 'amd64' ], [ 'ARM64', 'arm64' ] ])('should describe the package, with the size of its files and the architecture of Debian (%s: %s)', async (architecture, debian) => {
            expect(await control(architecture)).toEqual([
                `Package: ${config.name.package}`,
                `Version: ${config.version}`,
                'Section: net',
                `Architecture: ${debian}`,
                'Installed-Size: 3',
                `Depends: ${config.meta.dependencies.deb}`,
                `Maintainer: ${config.author}`,
                'Priority: optional',
                `Homepage: ${config.url}`,
                `Description: ${config.description.short}`,
                // a line of the long description starts with a space
                ` ${config.description.long}`,
                // and the file ends with a line break
                ''
            ]);
        });
    });

    // The umask of these tests is 077 (see beforeEach): the user of a hardened system, or a runner that shares nothing. What goes into the
    // package keeps the permissions it was made with: dpkg-deb refuses a DEBIAN of 0700 ("control directory has bad permissions 700"),
    // and files of 0600 would be installed for root alone
    it('should make the folder DEBIAN one that dpkg-deb accepts, whatever the umask is', async () => {
        const { packager } = linuxApp();
        write(path.join(packager._dirBuildRoot, 'usr', 'bin', 'app'), 'binary');
        await packager._createControlDEB();
        const mode = fs.statSync(path.join(packager._dirBuildRoot, 'DEBIAN')).mode & 0o777;
        expect(mode).toBeGreaterThanOrEqual(0o755);
        expect(mode).toBeLessThanOrEqual(0o775);
    });

    it('should write the files that the package installs so that everybody can read them, whatever the umask is', async () => {
        const { packager } = linuxApp();
        write(path.join(packager._dirBuildRoot, 'usr', 'bin', 'app'), 'binary');
        packager._createManpage();
        packager._createChangelog();
        packager._createDesktopShortcut();
        await packager._createControlDEB();
        const root = packager._dirBuildRoot;
        for (const file of [
            path.join(root, 'usr', 'share', 'man', 'man1', `${config.name.package}.1.gz`),
            path.join(root, 'usr', 'share', 'doc', config.name.package, 'changelog.gz'),
            path.join(root, 'usr', 'share', 'applications', `${config.name.package}.desktop`),
            path.join(root, 'DEBIAN', 'control')
        ]) {
            expect(fs.statSync(file).mode & 0o777).toBe(0o644);
        }
    });

    it('should list the files of the usr tree in the checksums, relative to the folder of the package', async () => {
        const { packager, runner } = linuxApp();
        await packager._createChecksumsDEB();
        expect(runner.commands).toEqual([ `cd "${packager._dirBuildRoot}" && find usr -type f -print0 | xargs -0 md5sum > "DEBIAN/md5sums"` ]);
    });

    describe('the specification of the RPM', () => {
        const files = [ '/usr/lib/rakkomik/rakkomik', '/usr/lib/rakkomik/resources/app.asar', '/usr/share/applications/rakkomik.desktop' ];

        async function specification(architecture = '64') {
            const { packager, runner } = linuxApp(architecture);
            runner.respond = () => files.map(file => `${file}\n`).join('');
            const file = await packager._createSpecsRPM();
            return { file, runner, packager, lines: lines(file) };
        }

        it('should be written to build/specfile.spec', async () => {
            const { file } = await specification();
            expect(file).toBe(path.join('build', 'specfile.spec'));
            expect(fs.existsSync(file)).toBe(true);
        });

        it('should describe the package, own its folder, list its files and link the application after the installation', async () => {
            const { lines: spec } = await specification();
            const symbolic = `/usr/bin/${config.name.package}`;
            const binary = `/usr/lib/${config.name.package}/${config.binary.linux}`;
            expect(spec.slice(0, 11)).toEqual([
                `Name: ${config.name.package}`,
                `Version: ${config.version}`,
                'Release: 0',
                `License: ${config.license}`,
                `URL: ${config.url}`,
                `Requires: ${config.meta.dependencies.rpm}`,
                `Summary: ${config.description.short}`,
                '',
                'Autoreq: no',
                'AutoReqProv: no',
                ''
            ]);
            // the files of the package come from the find in the staging folder, in the order of the sections of a specification
            expect(spec.slice(11).filter(line => line !== '')).toEqual([
                '%description',
                config.description.long,
                '%files',
                `%dir /usr/lib/${config.name.package}/`,
                ...files,
                '%post',
                `if [ ! -f ${symbolic} ] ; then ln -s ${binary} ${symbolic} ; fi`,
                '%postun',
                `if [ -f ${symbolic} ] ; then rm -f ${symbolic} ; fi`
            ]);
        });

        it('should ask the staging folder for the absolute names of its files', async () => {
            const { runner, packager } = await specification();
            expect(runner.commands).toEqual([ `cd "${packager._dirBuildRoot}" && find usr -type f -exec echo /{} \\;` ]);
        });
    });

    it('should point the desktop entry, the link of the installation and the list of files at the folder where the application is staged', async () => {
        const { packager, runner } = linuxApp();
        runner.respond = () => '';
        // /usr/lib/rakkomik, as the staging folder says it
        const installed = '/' + path.relative(packager._dirBuildRoot, packager._stagingExecutableDirectory).split(path.sep).join('/');
        packager._createDesktopShortcut();
        packager._createPostScript('postinst');
        const specification = lines(await packager._createSpecsRPM());
        expect(lines(path.join(packager._dirBuildRoot, 'usr', 'share', 'applications', `${config.name.package}.desktop`))).toContain(`Exec=${installed}/${config.binary.linux}`);
        expect(fs.readFileSync(path.join(packager._dirBuildRoot, 'DEBIAN', 'postinst'), 'utf8')).toContain(`ln -s ${installed}/${config.binary.linux} /usr/bin/${config.name.package} ;`);
        expect(specification).toContain(`%dir ${installed}/`);
    });

    it('should build the DEB and then the RPM of the architecture it is given', async () => {
        const { packager } = linuxApp();
        const calls = [];
        packager.buildDEB = async architecture => calls.push([ 'deb', architecture ]);
        packager.buildRPM = async architecture => calls.push([ 'rpm', architecture ]);
        await packager.build('ARM64');
        expect(calls).toEqual([ [ 'deb', 'ARM64' ], [ 'rpm', 'ARM64' ] ]);
    });

    describe('a build', () => {
        const listing = root => fs.readdirSync(root, { recursive: true, withFileTypes: true })
            .filter(entry => entry.isFile())
            .map(entry => path.relative(root, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'))
            .sort();

        // the skeletons that redist/ holds, the archive of Electron, the sources of the application and the web part
        function stage(packager) {
            writeSources();
            for (const flavour of [ 'deb', 'rpm' ]) {
                write(path.join('redist', flavour, 'usr', 'share', 'icons', 'hicolor', '16x16', 'apps', `${config.name.package}.png`), 'icon');
            }
            const downloads = [];
            packager._downloadElectron = async (version, platform, folder) => {
                downloads.push({ version, platform, folder });
                writeElectronArchive(folder, 'linux');
            };
            return downloads;
        }

        const name = config.name.package;
        const staged = [
            `usr/lib/${name}/${name}`,
            `usr/lib/${name}/chrome-sandbox`,
            `usr/lib/${name}/libffmpeg.so`,
            `usr/lib/${name}/locales/en-US.pak`,
            `usr/lib/${name}/resources/app.asar`,
            `usr/lib/${name}/resources/web/index.html`,
            `usr/lib/${name}/resources/web/mjs/engine/Engine.mjs`,
            `usr/share/applications/${name}.desktop`,
            `usr/share/doc/${name}/changelog.gz`,
            `usr/share/icons/hicolor/16x16/apps/${name}.png`,
            `usr/share/man/man1/${name}.1.gz`
        ];

        describe.each([ [ '64', 'amd64', 'linux-x64' ], [ 'ARM64', 'arm64', 'linux-arm64' ] ])('of the DEB (%s)', (architecture, debian, electron) => {
            it('should assemble the package from the skeleton, Electron, the application and the web part, and pack it last', async () => {
                const { packager, runner } = linuxApp(architecture);
                const downloads = stage(packager);
                const root = packager._dirBuildRoot;
                const folder = packager._stagingExecutableDirectory;
                // what an earlier build left behind must not get into the package or stand in its way
                write(path.join(root, 'stale.txt'), 'left over');
                write(`${root}.deb`, 'package of an earlier build');
                const stagedWhenChecksummed = [];
                runner.respond = command => {
                    if (command.includes('md5sum')) {
                        stagedWhenChecksummed.push(...listing(root));
                    }
                    return '';
                };

                await packager.buildDEB(architecture);

                expect(downloads).toEqual([ { version: config.electron, platform: electron, folder } ]);
                expect(runner.commands).toEqual([
                    'unzip --help', 'asar --version', 'fakeroot --version', 'dpkg --version', 'lintian --version',
                    `find "${folder}" -type f -iname "*.so" -exec chmod -x {} \\;`,
                    `cd "${root}" && find usr -type f -print0 | xargs -0 md5sum > "DEBIAN/md5sums"`,
                    `fakeroot dpkg-deb -v -b "${root}" "${root}.deb"`,
                    `lintian --profile debian "${root}.deb" || true`
                ]);
                // the checksums are made when everything that they cover, and the control files, are in place
                expect(stagedWhenChecksummed).toEqual(expect.arrayContaining([ ...staged, 'DEBIAN/control', 'DEBIAN/postinst', 'DEBIAN/postrm' ]));
                const files = listing(root);
                expect(files).toEqual(expect.arrayContaining(staged));
                expect(files).not.toContain('stale.txt');
                expect(files).not.toContain(`usr/lib/${name}/electron`);
                expect(files).not.toContain(`usr/lib/${name}/resources/default_app.asar`);
                // the old package is gone before dpkg-deb writes the new one (the shell here does not)
                expect(fs.existsSync(`${root}.deb`)).toBe(false);
                expect(lines(path.join(root, 'DEBIAN', 'control'))).toContain(`Architecture: ${debian}`);
            });

            it('should harden the binary, pack the application and make the sandbox helper setuid', async () => {
                const { packager } = linuxApp(architecture);
                stage(packager);
                await packager.buildDEB(architecture);
                const folder = packager._stagingExecutableDirectory;
                expect(readFuseWire(path.join(folder, name))).toBe('000001011');
                const packed = (await asar.listPackage(path.join(folder, 'resources', 'app.asar'), { isPack: false })).map(entry => entry.split(path.sep).join('/'));
                expect(packed).toEqual(expect.arrayContaining([ '/main.js', '/package.json' ]));
                // https://github.com/electron/electron/issues/17972
                expect(fs.statSync(path.join(folder, 'chrome-sandbox')).mode & 0o7777).toBe(0o4755);
            });
        });

        describe.each([ [ '64', 'x86_64', 'linux-x64' ], [ 'ARM64', 'aarch64', 'linux-arm64' ] ])('of the RPM (%s)', (architecture, target, electron) => {
            it('should assemble the package, describe it in a specification that exists while rpmbuild runs, and clean up after it', async () => {
                const { packager, runner } = linuxApp(architecture);
                const downloads = stage(packager);
                const root = packager._dirBuildRoot;
                const folder = packager._stagingExecutableDirectory;
                write(path.join(root, 'stale.txt'), 'left over');
                write(`${root}.rpm`, 'package of an earlier build');
                let specificationWhileBuilding = null;
                runner.respond = command => {
                    if (command.startsWith('rpmbuild')) {
                        specificationWhileBuilding = fs.readFileSync(path.join('build', 'specfile.spec'), 'utf8');
                    }
                    return command.includes('find usr') ? `/usr/lib/${name}/${name}\n` : '';
                };

                await packager.buildRPM(architecture);

                expect(downloads).toEqual([ { version: config.electron, platform: electron, folder } ]);
                expect(runner.commands).toEqual([
                    'unzip --help', 'asar --version', 'fakeroot --version', 'rpm --version',
                    `find "${folder}" -type f -iname "*.so" -exec chmod -x {} \\;`,
                    `cd "${root}" && find usr -type f -exec echo /{} \\;`,
                    `rpmbuild -bb --noclean --target ${target} --define "_topdir $(pwd)/${root}" --define "buildroot %{_topdir}" "${path.join('build', 'specfile.spec')}"`,
                    `mv -f ${root}/RPMS/*/*.rpm ${root}.rpm`
                ]);
                expect(specificationWhileBuilding).toContain(`Name: ${name}`);
                expect(listing(root)).toEqual(expect.arrayContaining(staged));
                expect(listing(root)).not.toContain('stale.txt');
                // the specification and the package of an earlier build are gone (the shell here builds nothing)
                expect(fs.existsSync(path.join('build', 'specfile.spec'))).toBe(false);
                expect(fs.existsSync(`${root}.rpm`)).toBe(false);
            });
        });
    });
});
