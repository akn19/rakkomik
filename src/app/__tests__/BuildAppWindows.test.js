// The packages of Windows, the installer (Inno Setup) and the portable archive. The steps run for real in a working
// directory of their own: the archive of Electron is replaced by a tree with a real PE file in it, the shell only records
// the commands it is given, and nothing touches the network.
const fs = require('node:fs');
const path = require('node:path');
const asar = require('@electron/asar');
const config = require('../../../build-app.config');
const { REPOSITORY, loadBuildApp, readFuseWire, write, writeElectronArchive, writeSources } = require('./support/buildAppHarness');
const { createExecutable, readResources } = require('./support/peFixture');
const { useTemporaryWorkingDirectory } = require('./support/toolScripts');

const name = config.name.package;

describe('the architectures of the Windows packages', () => {
    it('should name the installer and the portable archive apart, for the architecture of Windows and of Electron', () => {
        expect(new (loadBuildApp().ElectronPackagerWindows)(config).architectures).toEqual({
            '64': {
                is: { name: 'amd64', suffix: 'windows-setup_amd64', platform: 'win32-x64' },
                zip: { name: 'amd64', suffix: 'windows-portable_amd64', platform: 'win32-x64' }
            },
            'ARM64': {
                is: { name: 'arm64', suffix: 'windows-setup_arm64', platform: 'win32-arm64' },
                zip: { name: 'arm64', suffix: 'windows-portable_arm64', platform: 'win32-arm64' }
            }
        });
    });

    it('should stage a package in the folder that carries its name, its version and its flavour', () => {
        const { ElectronPackagerWindows } = loadBuildApp();
        const packager = new ElectronPackagerWindows(config);
        packager._architecture = packager.architectures.ARM64.zip;
        expect(packager._dirBuildRoot).toBe(path.join('build', `${name}_${config.version}_windows-portable_arm64`));
        // the executable sits in the root of the package, where the installer and the archive expect it
        expect(packager._stagingExecutableDirectory).toBe(packager._dirBuildRoot);
    });
});

// What Inno Setup reads is written on Windows, where the paths have backslashes
describe('the Inno Setup script that a Windows host writes', () => {
    function script(architecture, is64 = true) {
        const { ElectronPackagerWindows } = loadBuildApp({ platform: 'win32', modules: { 'node:path': path.win32 } });
        const packager = new ElectronPackagerWindows(config);
        packager._architecture = packager.architectures[architecture].is;
        const saved = [];
        packager._saveFile = (file, data) => saved.push({ file, data });
        const returned = packager._createScriptIS(is64);
        return { returned, saved, lines: saved[0].data.split(/\r?\n/), packager };
    }

    it('should be written to build\\setup.iss, the file that the compiler is given', () => {
        const { returned, saved } = script('64');
        expect(returned).toBe('build\\setup.iss');
        expect(saved.map(entry => entry.file)).toEqual([ 'build\\setup.iss' ]);
    });

    it('should hold the sections of the installer, in the order that Inno Setup is used to', () => {
        expect(script('64').lines.filter(line => line.startsWith('['))).toEqual([ '[Setup]', '[Tasks]', '[Files]', '[UninstallDelete]', '[Icons]' ]);
    });

    it('should name the application, its version and its publisher', () => {
        expect(script('64').lines).toEqual(expect.arrayContaining([
            `AppName=${config.name.product}`,
            `AppVerName=${config.name.product}`,
            `AppVersion=${config.version}`,
            `VersionInfoVersion=${config.version}`,
            `AppPublisher=${config.author}`,
            `AppPublisherURL=${config.url}`
        ]));
    });

    it('should install under the program files and show the icon of the executable in the list of programs', () => {
        expect(script('64').lines).toEqual(expect.arrayContaining([
            `DefaultDirName={pf}\\${config.name.product}`,
            `UninstallDisplayIcon={app}\\${config.binary.windows}`
        ]));
    });

    it('should take the images of the wizard from the folder of the skeleton, one level above the script', () => {
        expect(script('64').lines).toEqual(expect.arrayContaining([
            'WizardImageFile=..\\redist\\iss\\wizard.bmp',
            'WizardSmallImageFile=..\\redist\\iss\\wizard-small.bmp'
        ]));
    });

    it.each([ '64', 'ARM64' ])('should pack the folder of its own package into an installer of the same name, next to the script (%s)', architecture => {
        const { lines, packager } = script(architecture);
        const folder = path.win32.basename(packager._dirBuildRoot);
        expect(folder).toBe(`${name}_${config.version}_windows-setup_${architecture === '64' ? 'amd64' : 'arm64'}`);
        expect(lines).toEqual(expect.arrayContaining([ 'OutputDir=.', `OutputBaseFilename=${folder}`, `Source: ${folder}\\*; DestDir: {app}; Flags: recursesubdirs` ]));
    });

    it('should offer the shortcuts of the desktop and of the start menu, and remove everything with the application', () => {
        const { lines } = script('64');
        expect(lines).toEqual(expect.arrayContaining([
            'Name: shortcuts\\desktop; Description: "Desktop"; GroupDescription: "Create Shortcuts:";',
            'Name: shortcuts\\startmenu; Description: "Startmenu Programs"; GroupDescription: "Create Shortcuts:"; Flags: unchecked',
            'Name: {app}; Type: filesandordirs',
            `Name: "{commondesktop}\\${config.name.product}"; Tasks: shortcuts\\desktop; Filename: "{app}\\${config.binary.windows}";`,
            `Name: "{commonstartmenu}\\${config.name.product}"; Tasks: shortcuts\\startmenu; Filename: "{app}\\${config.binary.windows}";`
        ]));
    });

    it('should comment out the architecture of the installer when the build is not 64-bit', () => {
        const { lines } = script('64', false);
        expect(lines).toEqual(expect.arrayContaining([ ';ArchitecturesAllowed=x64compatible', ';ArchitecturesInstallIn64BitMode=x64compatible' ]));
        expect(lines.filter(line => line.startsWith('Architectures'))).toEqual([]);
    });
});

describe('a build of the Windows packages', () => {
    useTemporaryWorkingDirectory();

    let executable = null;

    beforeAll(async () => {
        executable = await createExecutable();
    });

    beforeEach(() => {
        // the executable names the year of the build as its copyright
        vi.useFakeTimers({ toFake: [ 'Date' ] });
        vi.setSystemTime(new Date(2031, 5, 15));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    // the sources, the web part and the icon, and an archive of Electron that holds a real executable
    function windowsApp(options) {
        const app = loadBuildApp({ platform: 'win32', ...options });
        const packager = new app.ElectronPackagerWindows(config);
        const downloads = [];
        packager._downloadElectron = async (version, platform, folder) => {
            downloads.push({ version, platform, folder });
            writeElectronArchive(folder, 'win32', executable);
        };
        writeSources();
        write(path.join('redist', 'iss', 'app.ico'), fs.readFileSync(path.join(REPOSITORY, 'redist', 'iss', 'app.ico')));
        return { ...app, packager, downloads };
    }

    async function resourcesOf(file) {
        return readResources(fs.readFileSync(file));
    }

    describe.each([
        [ '64', 'windows-portable_amd64', 'win32-x64' ],
        [ 'ARM64', 'windows-portable_arm64', 'win32-arm64' ]
    ])('of the portable archive (%s)', (architecture, suffix, electron) => {
        it('should assemble Electron, the application and the web part, mark the folder as portable and pack it', async () => {
            const { packager, runner, downloads } = windowsApp();
            const root = path.join('build', `${name}_${config.version}_${suffix}`);
            // an archive of an earlier build is replaced, not extended
            write(`${root}.zip`, 'archive of an earlier build');

            await packager.buildZIP(architecture);

            expect(downloads).toEqual([ { version: config.electron, platform: electron, folder: root } ]);
            expect(fs.readFileSync(path.join(root, `${config.binary.windows}.portable`), 'utf8')).toBe('Delete this File to disable Portable Mode');
            expect(fs.existsSync(path.join(root, 'electron.exe'))).toBe(false);
            expect(fs.existsSync(path.join(root, 'resources', 'default_app.asar'))).toBe(false);
            expect(fs.existsSync(path.join(root, 'ffmpeg.dll'))).toBe(true);
            expect(fs.readFileSync(path.join(root, 'resources', 'web', 'index.html'), 'utf8')).toBe('<html>web part</html>');
            const packed = (await asar.listPackage(path.join(root, 'resources', 'app.asar'), { isPack: false })).map(entry => entry.split(path.sep).join('/'));
            expect(packed).toEqual(expect.arrayContaining([ '/main.js', '/package.json' ]));
            expect(runner.commands).toEqual([
                'tar --version',
                'asar --version',
                `tar -a -c -f "${root}.zip" -C "build" "${path.basename(root)}"`
            ]);
            expect(fs.existsSync(`${root}.zip`)).toBe(false);
        });

        it('should harden the executable and then give it the name, the version and the icon of the application, without losing the hardening', async () => {
            const { packager } = windowsApp();
            await packager.buildZIP(architecture);
            const file = path.join(packager._dirBuildRoot, config.binary.windows);
            expect(readFuseWire(file)).toBe('000001011');
            const resources = await resourcesOf(file);
            const [ major, minor, patch ] = config.version.split('.').map(Number);
            expect(resources.strings).toEqual({
                ProductName: config.name.product,
                CompanyName: '',
                FileDescription: config.description.short,
                InternalName: '',
                OriginalFilename: config.binary.windows,
                LegalCopyright: '2031',
                FileVersion: `${config.version}.0`,
                ProductVersion: `${config.version}.0`
            });
            expect([ resources.fixed.fileVersionMS, resources.fixed.fileVersionLS ]).toEqual([ major * 65536 + minor, patch * 65536 ]);
            expect([ resources.fixed.productVersionMS, resources.fixed.productVersionLS ]).toEqual([ major * 65536 + minor, patch * 65536 ]);
            // the icons of redist/iss/app.ico replace the single icon of Electron
            expect(resources.groups).toHaveLength(1);
            expect(resources.groups[0].icons.map(icon => icon.width)).toEqual([ 16, 24, 32, 48, 64, 96, 128, 0 ]);
        });
    });

    describe.each([
        [ '64', 'windows-setup_amd64', 'win32-x64', 'x64compatible' ],
        [ 'ARM64', 'windows-setup_arm64', 'win32-arm64', 'arm64' ]
    ])('of the installer (%s)', (architecture, suffix, electron, identifier) => {
        it('should assemble the package without the marker of the portable mode and compile it with a script that exists for that', async () => {
            const { packager, runner, downloads } = windowsApp();
            const root = path.join('build', `${name}_${config.version}_${suffix}`);
            let scriptWhileCompiling = null;
            runner.respond = command => {
                if (command.startsWith('innosetup-compiler')) {
                    scriptWhileCompiling = fs.readFileSync(path.join('build', 'setup.iss'), 'utf8');
                }
                return '';
            };

            await packager.buildIS(architecture);

            expect(downloads).toEqual([ { version: config.electron, platform: electron, folder: root } ]);
            expect(runner.commands).toEqual([
                'tar --version',
                'asar --version',
                'where innosetup-compiler',
                `innosetup-compiler "${path.join('build', 'setup.iss')}"`
            ]);
            expect(scriptWhileCompiling.split(/\r?\n/)).toEqual(expect.arrayContaining([ `ArchitecturesAllowed=${identifier}`, `OutputBaseFilename=${path.basename(root)}` ]));
            // the script is removed once it has served
            expect(fs.existsSync(path.join('build', 'setup.iss'))).toBe(false);
            expect(fs.existsSync(path.join(root, `${config.binary.windows}.portable`))).toBe(false);
            expect(fs.existsSync(path.join(root, 'electron.exe'))).toBe(false);
            expect(readFuseWire(path.join(root, config.binary.windows))).toBe('000001011');
            expect((await resourcesOf(path.join(root, config.binary.windows))).strings.ProductName).toBe(config.name.product);
        });
    });

    it.each([
        [ 'linux', 'bsdtar' ],
        [ 'darwin', 'tar' ],
        [ 'win32', 'tar' ]
    ])('should pack the archive with the archiver that the build platform has (%s: %s)', async (platform, tool) => {
        const { packager, runner } = windowsApp({ platform });
        await packager.buildZIP('64');
        expect(runner.commands[0]).toBe(`${tool} --version`);
        expect(runner.commands[2]).toMatch(new RegExp(`^${tool} -a -c -f `));
    });

    it('should not build anything when a tool of the platform is missing', async () => {
        const { packager, runner, downloads } = windowsApp();
        runner.respond = command => command === 'where innosetup-compiler' ? new Error('not found') : '';
        await expect(packager.buildIS('64')).rejects.toThrow("Failed to run command 'where innosetup-compiler', make sure it is correctly installed!");
        expect(downloads).toEqual([]);
        expect(fs.existsSync('build')).toBe(true);
        expect(fs.readdirSync('build')).toEqual([ 'web' ]);
    });

    it('should build the installer and then the archive of the architecture it is given', async () => {
        const { packager } = windowsApp();
        const calls = [];
        packager.buildIS = async architecture => calls.push([ 'installer', architecture ]);
        packager.buildZIP = async architecture => calls.push([ 'archive', architecture ]);
        await packager.build('ARM64');
        expect(calls).toEqual([ [ 'installer', 'ARM64' ], [ 'archive', 'ARM64' ] ]);
    });

    describe('when the web part has not been built', () => {
        it('should stop before it packs anything', async () => {
            const { packager, runner } = windowsApp();
            fs.rmSync(path.join('build', 'web'), { recursive: true, force: true });
            await expect(packager.buildZIP('64')).rejects.toThrow(`The web part is missing in "${path.join('build', 'web')}", run 'pnpm run build:web' first!`);
            expect(runner.commands).toEqual([ 'tar --version', 'asar --version' ]);
        });
    });
});
