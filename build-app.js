const path = require('node:path');
const fs = require('node:fs');
const zlib = require('node:zlib');
const { EOL: eol } = require('node:os');
const { exec } = require('node:child_process');
const { pipeline } = require('node:stream/promises');
const { Readable } = require('node:stream');
const {
    flipFuses,
    getCurrentFuseWire,
    FuseVersion,
    FuseV1Options,
    FuseState,
} = require('@electron/fuses');
const { packApp } = require('./scripts/pack-app');
const config = require('./build-app.config');

// The files of the Electron archive that the packages do not ship: the licence texts and the version of the archive on
// every platform, and the parts of Electron that the application never loads (docs/development.md, "What the packages
// leave out"). What a package does load stays, the fallbacks of the GPU included (SwiftShader, Vulkan, the locales).
const NOT_SHIPPED = {
    all: ['version', 'LICENSE', 'LICENSES.chromium.html'],
    // the crash reporter is never started (`crashReporter.start`), so the handler process has nothing to do
    linux: ['chrome_crashpad_handler'],
    // the DirectX shader compiler is loaded for WebGPU only, which neither the interface nor a connector uses; a page
    // that asks for WebGPU gets the compiler of the system instead (d3dcompiler_47.dll, which stays)
    win32: ['dxcompiler.dll', 'dxil.dll'],
    darwin: [],
};

// Electron fuses (build-time hardening of the shipped binary): the application cannot be
// turned into a Node runtime (ELECTRON_RUN_AS_NODE, NODE_OPTIONS, --inspect) and only loads
// from app.asar. Cookie encryption and ASAR integrity stay off: the former needs a keyring on
// Linux, the latter an integrity resource the packager does not embed.
const FUSES = {
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
};

/**
 * Base class for platform dependent electron packagers
 */
class ElectronPackager {
    /**
     *
     */
    constructor(configuration) {
        this._configuration = configuration;
    }

    /**
     *
     */
    build(architecture) {
        throw new Error('Not implemented!');
    }

    /**
     * Flip the fuses of the bundled electron binary and verify the result.
     * @param {string} binary path of the (renamed) electron executable
     */
    async _applyFuses(binary) {
        console.log('Flipping electron fuses ...');
        await flipFuses(binary, { version: FuseVersion.V1, ...FUSES });
        const wire = await getCurrentFuseWire(binary);
        for (const [fuse, enabled] of Object.entries(FUSES)) {
            const expected = enabled ? FuseState.ENABLE : FuseState.DISABLE;
            if (wire[fuse] !== expected) {
                throw new Error(
                    `Fuse ${FuseV1Options[fuse]} of "${binary}" is ${FuseState[wire[fuse]]}, expected ${FuseState[expected]}!`,
                );
            }
        }
    }

    /**
     *
     * @param {*} folder
     */
    async _getSize(folder) {
        // Installed-Size in KiB, derived from the file sizes (no `du`)
        let entries = await fs.promises.readdir(folder, { recursive: true, withFileTypes: true });
        let bytes = 0;
        for (let entry of entries.filter((entry) => entry.isFile())) {
            bytes += (await fs.promises.stat(path.join(entry.parentPath, entry.name))).size;
        }
        return String(Math.ceil(bytes / 1024));
    }

    /**
     *
     * @param {string} archive
     * @param {string} target
     */
    async _extractArchive(archive, target) {
        // symlinks and unix modes of the Electron archive must survive: delegate to the platform's archiver
        // (bsdtar ships with Windows 10+, `unzip` is required on linux/darwin)
        if (process.platform === 'win32') {
            await this._executeCommand(`tar -xf "${archive}" -C "${target}"`);
        } else {
            await this._executeCommand(`unzip "${archive}" -d "${target}"`);
        }
    }

    /**
     *
     * @param {string} source
     * @param {string} archive
     */
    async _compressArchive(source, archive) {
        // bsdtar picks the ZIP format from the archive suffix (`-a`)
        await this._executeCommand(
            `${this._zipTool} -a -c -f "${archive}" -C "${path.dirname(source)}" "${path.basename(source)}"`,
        );
    }

    /**
     * Windows and macOS ship bsdtar as `tar`, but the `tar` of a Linux host is GNU tar, which cannot write a ZIP.
     */
    get _zipTool() {
        return process.platform === 'linux' ? 'bsdtar' : 'tar';
    }

    /**
     * Put the web part (`pnpm run build:web`) next to `app.asar`: the packaged application finds it there and copies
     * it into its cache directory when the cache is empty (see `App._seedCache`); the updates replace it from then on.
     * @param {string} resourcesDirectory the directory that holds `app.asar`
     */
    async _bundleWebPart(resourcesDirectory) {
        const web = path.join('build', 'web');
        if (!fs.existsSync(path.join(web, 'index.html'))) {
            throw new Error(`The web part is missing in "${web}", run 'pnpm run build:web' first!`);
        }
        console.log('Bundle web part ...');
        await fs.promises.cp(web, path.join(resourcesDirectory, 'web'), { recursive: true });
    }

    /**
     *
     * @param {*} file
     * @param {*} data
     * @param {*} gzip
     * @param {number} [mode] permissions of the file (not those of the umask): readable by everybody unless it is given
     */
    _saveFile(file, data, gzip, mode = 0o644) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        let content = gzip ? zlib.gzipSync(data, { level: 9 }) : data;
        fs.writeFileSync(
            file,
            content,
            typeof content === 'string' ? { encoding: 'utf8' } : undefined,
        );
        fs.chmodSync(file, mode);
    }

    /**
     *
     * @param {*} uri
     * @param {*} file
     */
    async _download(uri, file) {
        let response = await fetch(uri, { redirect: 'follow' });
        if (!response.ok) {
            throw new Error(`Failed to download electron client (${response.status} ${uri})!`);
        }
        console.log('Downloading:', file);
        await fs.promises.mkdir(path.dirname(file), { recursive: true });
        // saved under another name until it is complete: `_downloadElectron` takes any file of the right name for a finished download
        const partial = file + '.part';
        try {
            await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(partial));
            await fs.promises.rename(partial, file);
        } catch (error) {
            await fs.promises.rm(partial, { force: true });
            throw error;
        }
    }

    /**
     *
     * @param {*} version
     * @param {*} platform
     */
    async _downloadElectron(version, platform, directory) {
        let file = `electron-v${version}-${platform}.zip`;
        let uri = `https://github.com/electron/electron/releases/download/v${version}/${file}`;
        file = path.join('redist', file);

        if (!fs.existsSync(file)) {
            await this._download(uri, file);
        }
        await fs.promises.mkdir(directory, { recursive: true });
        await this._extractArchive(file, directory);
        for (const name of [...NOT_SHIPPED.all, ...NOT_SHIPPED[platform.split('-')[0]]]) {
            await fs.promises.rm(path.join(directory, name), { recursive: true, force: true });
        }
    }

    /**
     *
     * @param {string} command
     * @param {bool} silent
     */
    _executeCommand(command, silent) {
        if (!silent) {
            console.log('>', command);
        }
        return new Promise((resolve, reject) => {
            exec(command, (error, stdout, stderr) => {
                if (!silent) {
                    console.log(stdout);
                    console.log(stderr);
                }
                if (error) {
                    reject(error);
                } else {
                    resolve(stdout);
                }
            });
        });
    }

    /**
     *
     * @param  {...string} commands
     */
    async _validateCommands(...commands) {
        for (let command of commands) {
            try {
                await this._executeCommand(command, true);
            } catch (error) {
                throw new Error(
                    `Failed to run command '${command}', make sure it is correctly installed!`,
                );
            }
        }
    }
}

/**
 * Packager for linux platform
 */
class ElectronPackagerLinux extends ElectronPackager {
    /**
     *
     */
    constructor(configuration) {
        super(configuration);
        // Desktop only: x86_64 + arm64. i386/armv7l/armhf are not built
        // (upstream Electron no longer ships them). RISC-V stays conditional
        // on upstream Electron providing riscv64 builds (it provides none yet).
        this.architectures = {
            64: {
                name: 'amd64',
                // the architecture of the RPM (the name that rpm uses, not the one of Debian)
                rpm: 'x86_64',
                suffix: 'linux_amd64',
                platform: 'linux-x64',
            },
            ARM64: {
                name: 'arm64',
                rpm: 'aarch64',
                suffix: 'linux_arm64',
                platform: 'linux-arm64',
            },
        };
        this._architecture = this.architectures[0];
    }

    /**
     *
     */
    get _dirBuildRoot() {
        return path.join(
            'build',
            `${this._configuration.name.package}_${this._configuration.version}_${this._architecture.suffix}`,
        );
    }

    /**
     *
     */
    get _stagingExecutableDirectory() {
        return path.join(this._dirBuildRoot, 'usr', 'lib', this._configuration.name.package);
    }

    /**
     *
     * @param {string} architecture '32' or '64'
     */
    async build(architecture) {
        await this.buildDEB(architecture);
        await this.buildRPM(architecture);
    }

    /**
     *
     */
    async buildDEB(architecture) {
        this._architecture = this.architectures[architecture];

        await this._validateCommands(
            'unzip --help',
            'fakeroot --version',
            'dpkg --version',
            'lintian --version',
        );

        await fs.promises.rm(this._dirBuildRoot, { recursive: true, force: true });
        await this._copySkeletonDEB();
        await this._bundleElectron();
        this._createManpage();
        this._createChangelog();
        this._createDesktopShortcut();
        await this._createControlDEB();
        this._createPostScript('postrm');
        this._createPostScript('postinst');
        await this._createChecksumsDEB();

        let deb = this._dirBuildRoot + '.deb';
        await fs.promises.rm(deb, { recursive: true, force: true });
        // xz at its highest level: the package is a few percent smaller than at the default level, and dpkg of any
        // release unpacks it (the level only sets the size of the dictionary, 64 MiB)
        await this._executeCommand(
            `fakeroot dpkg-deb -v -Zxz -z9 -b "${this._dirBuildRoot}" "${deb}"`,
        );
        await this._executeCommand(`lintian --profile debian "${deb}" || true`);
    }

    /**
     *
     */
    async buildRPM(architecture) {
        this._architecture = this.architectures[architecture];

        await this._validateCommands('unzip --help', 'fakeroot --version', 'rpm --version');

        await fs.promises.rm(this._dirBuildRoot, { recursive: true, force: true });
        await this._copySkeletonRPM();
        await this._bundleElectron();
        this._createManpage();
        this._createChangelog();
        this._createDesktopShortcut();
        let specs = await this._createSpecsRPM();

        let rpm = this._dirBuildRoot + '.rpm';
        await fs.promises.rm(rpm, { recursive: true, force: true });
        // the target names the architecture of the package: without it the RPM of ARM64 is built for the host. The
        // payload is compressed with xz instead of the gzip that rpmbuild falls back to (a quarter smaller); every rpm
        // since 4.7 (2009) reads it
        await this._executeCommand(
            `rpmbuild -bb --noclean --target ${this._architecture.rpm} --define "_topdir $(pwd)/${this._dirBuildRoot}" --define "buildroot %{_topdir}" --define "_binary_payload w9.xzdio" "${specs}"`,
        );
        await this._executeCommand(`mv -f ${this._dirBuildRoot}/RPMS/*/*.rpm ${rpm}`);
        await fs.promises.rm(specs, { recursive: true, force: true });
    }

    /**
     *
     */
    async _bundleElectron() {
        console.log('Bundle electron ...');
        let folder = this._stagingExecutableDirectory;
        await this._downloadElectron(
            this._configuration.electron,
            this._architecture.platform,
            folder,
        );
        await fs.promises.rm(path.join(folder, 'resources', 'default_app.asar'), {
            recursive: true,
            force: true,
        });
        await packApp(config.src, path.join(folder, 'resources', 'app.asar'));
        await this._bundleWebPart(path.join(folder, 'resources'));
        await fs.promises.rename(
            path.join(folder, 'electron'),
            path.join(folder, this._configuration.binary.linux),
        );
        await this._applyFuses(path.join(folder, this._configuration.binary.linux));
        // chmod 4755 fixes https://github.com/electron/electron/issues/17972
        await fs.promises.chmod(path.join(folder, 'chrome-sandbox'), '4755');
        // remove executable flag from libraries => avoid lintian errors
        await this._executeCommand(`find "${folder}" -type f -iname "*.so" -exec chmod -x {} \\;`);
    }

    /**
     *
     */
    async _copySkeletonDEB() {
        console.log('Copy DEB Skeleton ...');
        //await this._executeCommand(`cp -r "redist/deb" "${this._dirBuildRoot}"`);
        await fs.promises.cp(path.join('redist', 'deb'), this._dirBuildRoot, { recursive: true });
    }

    /**
     *
     */
    async _copySkeletonRPM() {
        console.log('Copy RPM Skeleton ...');
        //await this._executeCommand(`cp -r "redist/rpm" "${this._dirBuildRoot}"`);
        await fs.promises.cp(path.join('redist', 'rpm'), this._dirBuildRoot, { recursive: true });
    }

    /**
     *
     */
    _createManpage() {
        console.log('Creating Manpage ...');
        let file = path.join(
            this._dirBuildRoot,
            'usr',
            'share',
            'man',
            'man1',
            this._configuration.name.package + '.1.gz',
        );
        let content = [
            `.TH ${this._configuration.name.package} 1 "" ""`,
            '',
            '.SH NAME',
            `${this._configuration.name.package} - ${this._configuration.description.short}`,
            '',
            '.SH SYNOPSIS',
            this._configuration.name.package,
            '',
            '.SH DESCRIPTION',
            this._configuration.description.long,
        ];
        this._saveFile(file, content.join(eol), true);
    }

    /**
     *
     */
    _createChangelog() {
        console.log('Creating Changelog ...');
        let file = path.join(
            this._dirBuildRoot,
            'usr',
            'share',
            'doc',
            this._configuration.name.package,
            'changelog.gz',
        );
        this._saveFile(file, '-', true);
    }

    /**
     *
     */
    _createDesktopShortcut() {
        console.log('Creating Desktop Shortcut ...');
        let file = path.join(
            this._dirBuildRoot,
            'usr',
            'share',
            'applications',
            this._configuration.name.package + '.desktop',
        );
        let content = [
            '[Desktop Entry]',
            'Version=1.0',
            'Type=' + this._configuration.meta.type,
            'Name=' + this._configuration.name.product,
            'GenericName=' + this._configuration.description.short,
            'Exec=' +
                path.join(
                    '/usr',
                    'lib',
                    this._configuration.name.package,
                    this._configuration.binary.linux,
                ),
            'Icon=' + this._configuration.name.package,
            'Categories=' + this._configuration.meta.categories,
        ];
        this._saveFile(file, content.join(eol), false);
    }

    /**
     *
     */
    async _createControlDEB() {
        console.log('Creating DEB Control File ...');
        let file = path.join(this._dirBuildRoot, 'DEBIAN', 'control');
        let content = [
            'Package: ' + this._configuration.name.package,
            'Version: ' + this._configuration.version,
            'Section: ' + this._configuration.meta.section,
            'Architecture: ' + this._architecture.name,
            'Installed-Size: ' + (await this._getSize(path.join(this._dirBuildRoot, 'usr'))),
            'Depends: ' + this._configuration.meta.dependencies.deb,
            'Maintainer: ' + this._configuration.author,
            'Priority: optional',
            'Homepage: ' + this._configuration.url,
            'Description: ' + this._configuration.description.short,
            ' ' + this._configuration.description.long,
            '',
        ];
        this._saveFile(file, content.join(eol), false);
        // dpkg-deb accepts a DEBIAN folder of 0755 to 0775 only, and the umask decides how a folder is made
        fs.chmodSync(path.dirname(file), 0o755);
    }

    /**
     *
     */
    _createPostScript(name) {
        console.log(`Creating PostScript '${name}' ...`);
        let file = path.join(this._dirBuildRoot, 'DEBIAN', name);
        let symbolic = path.join('/usr', 'bin', this._configuration.name.package);
        let binary = path.join(
            '/usr',
            'lib',
            this._configuration.name.package,
            this._configuration.binary.linux,
        );
        let content = [
            '#!/bin/sh',
            'set -e',
            '#if [ -x /usr/bin/update-mime ] ; then update-mime ; fi',
            '#if [ -x /usr/bin/update-menus ] ; then update-menus ; fi',
        ];
        if (name === 'postinst') {
            content.push(`if [ ! -f ${symbolic} ] ; then ln -s ${binary} ${symbolic} ; fi`);
        }
        if (name === 'postrm') {
            content.push(`if [ -f ${symbolic} ] ; then rm -f ${symbolic} ; fi`);
        }
        // dpkg-deb refuses a maintainer script that is not executable
        this._saveFile(file, content.join(eol), false, 0o755);
    }

    /**
     *
     */
    async _createChecksumsDEB() {
        console.log('Creating Checksums ...');
        await this._executeCommand(
            `cd "${this._dirBuildRoot}" && find usr -type f -print0 | xargs -0 md5sum > "DEBIAN/md5sums"`,
        );
    }

    /**
     *
     */
    async _createSpecsRPM() {
        console.log('Creating RPM Specification File ...');
        let file = path.join('build', 'specfile.spec');
        let symbolic = path.join('/usr', 'bin', this._configuration.name.package);
        let binary = path.join(
            '/usr',
            'lib',
            this._configuration.name.package,
            this._configuration.binary.linux,
        );
        let content = [
            'Name: ' + this._configuration.name.package,
            'Version: ' + this._configuration.version,
            'Release: 0',
            'License: ' + this._configuration.license,
            'URL: ' + this._configuration.url,
            'Requires: ' + this._configuration.meta.dependencies.rpm,
            'Summary: ' + this._configuration.description.short,
            '',
            'Autoreq: no',
            'AutoReqProv: no',
            '',
            '%description',
            this._configuration.description.long,
            '',
            '%files',
            `%dir /usr/lib/${this._configuration.name.package}/`,
            await this._executeCommand(
                `cd "${this._dirBuildRoot}" && find usr -type f -exec echo /{} \\;`,
            ),
            '%post',
            `if [ ! -f ${symbolic} ] ; then ln -s ${binary} ${symbolic} ; fi`,
            '',
            '%postun',
            `if [ -f ${symbolic} ] ; then rm -f ${symbolic} ; fi`,
        ];
        this._saveFile(file, content.join(eol), false);
        return file;
    }
}

/**
 * Packager for windows platform
 */
class ElectronPackagerWindows extends ElectronPackager {
    /**
     *
     */
    constructor(configuration) {
        super(configuration);
        // Desktop only: x86_64 + arm64. i386 is not built
        // (upstream Electron deprecated it).
        this.architectures = {
            64: {
                is: {
                    name: 'amd64',
                    suffix: 'windows-setup_amd64',
                    platform: 'win32-x64',
                },
                zip: {
                    name: 'amd64',
                    suffix: 'windows-portable_amd64',
                    platform: 'win32-x64',
                },
            },
            ARM64: {
                is: {
                    name: 'arm64',
                    suffix: 'windows-setup_arm64',
                    platform: 'win32-arm64',
                },
                zip: {
                    name: 'arm64',
                    suffix: 'windows-portable_arm64',
                    platform: 'win32-arm64',
                },
            },
        };
        this._architecture = this.architectures[0];
    }

    /**
     *
     */
    get _dirBuildRoot() {
        return path.join(
            'build',
            `${this._configuration.name.package}_${this._configuration.version}_${this._architecture.suffix}`,
        );
    }

    /**
     *
     */
    get _stagingExecutableDirectory() {
        return this._dirBuildRoot;
    }

    /**
     *
     * @param {string} architecture '32' or '64'
     */
    async build(architecture) {
        await this.buildIS(architecture);
        await this.buildZIP(architecture);
    }

    /**
     * Create InnoSetup installer
     * @param {string} architecture
     */
    async buildIS(architecture) {
        this._architecture = this.architectures[architecture].is;

        // NOTE: `innosetup-compiler /?` exits non-zero by design, so probe presence instead.
        await this._validateCommands('tar --version', 'where innosetup-compiler');

        await fs.promises.rm(this._dirBuildRoot, { recursive: true, force: true });
        await this._bundleElectron(false);
        await this._editResource();
        // Every architecture that is built is 64-bit (there is no i386 build).
        let setup = this._createScriptIS(true);

        await this._executeCommand(`innosetup-compiler "${setup}"`);
        await fs.promises.rm(setup, { recursive: true, force: true });
    }

    /**
     * Create portable archive
     * @param {string} architecture
     */
    async buildZIP(architecture) {
        this._architecture = this.architectures[architecture].zip;

        await this._validateCommands(`${this._zipTool} --version`);

        await fs.promises.rm(this._dirBuildRoot, { recursive: true, force: true });
        await this._bundleElectron(true);
        await this._editResource();

        let zip = this._dirBuildRoot + '.zip';
        await fs.promises.rm(zip, { recursive: true, force: true });
        await this._compressArchive(this._dirBuildRoot, zip);
    }

    /**
     *
     * @param {bool} portable
     */
    async _bundleElectron(portable) {
        console.log('Bundle electron ...');
        let folder = this._stagingExecutableDirectory;
        await this._downloadElectron(
            this._configuration.electron,
            this._architecture.platform,
            folder,
        );
        await fs.promises.rm(path.join(folder, 'resources', 'default_app.asar'), {
            recursive: true,
            force: true,
        });
        if (portable) {
            this._saveFile(
                path.join(folder, this._configuration.binary.windows + '.portable'),
                'Delete this File to disable Portable Mode',
            );
        }
        await packApp(config.src, path.join(folder, 'resources', 'app.asar'));
        await this._bundleWebPart(path.join(folder, 'resources'));
        await fs.promises.rename(
            path.join(folder, 'electron.exe'),
            path.join(folder, this._configuration.binary.windows),
        );
        await this._applyFuses(path.join(folder, this._configuration.binary.windows));
    }

    /**
     *
     */
    async _editResource() {
        console.log('Editing executable resources ...');
        const { setExecutableResources } = await import('./scripts/pe-resources.mjs');
        await setExecutableResources(
            path.join(this._dirBuildRoot, this._configuration.binary.windows),
            {
                icon: path.join('redist', 'iss', 'app.ico'),
                version: this._configuration.version,
                strings: {
                    ProductName: this._configuration.name.product,
                    CompanyName: '',
                    LegalCopyright: String(new Date().getFullYear()),
                    FileDescription: this._configuration.description.short,
                    InternalName: '',
                    OriginalFilename: this._configuration.binary.windows,
                },
            },
        );
    }

    /**
     *
     * @param {bool} is64
     */
    _createScriptIS(is64) {
        console.log('Creating InnoSetup Script ...');
        let file = path.join('build', 'setup.iss');
        // x64compatible also matches Windows 11 on Arm, which runs x64 programs (the older x64 does not, and is deprecated);
        // the installer of ARM64 only runs, and installs in 64-bit mode, on Arm64 Windows
        let architecture = this._architecture.platform.endsWith('arm64')
            ? 'arm64'
            : 'x64compatible';
        let content = [
            '[Setup]',
            'AppName=' + this._configuration.name.product,
            'AppVerName=' + this._configuration.name.product,
            'AppVersion=' + this._configuration.version,
            'VersionInfoVersion=' + this._configuration.version,
            'AppPublisher=' + this._configuration.author,
            'AppPublisherURL=' + this._configuration.url,
            (is64 ? '' : ';') + 'ArchitecturesAllowed=' + architecture,
            (is64 ? '' : ';') + 'ArchitecturesInstallIn64BitMode=' + architecture,
            'DisableWelcomePage=yes',
            'DefaultDirName=' + path.join('{pf}', this._configuration.name.product),
            'DisableProgramGroupPage=yes',
            //'DefaultGroupName=' + this._configuration.name.product,
            'DisableReadyPage=yes',
            'UninstallDisplayIcon=' + path.join('{app}', this._configuration.binary.windows),
            //'WizardImageFile=compiler:wizmodernimage.bmp',
            //'WizardSmallImageFile=compiler:wizmodernsmallimage.bmp',
            'WizardImageFile=' + path.join('..', 'redist', 'iss', 'wizard.bmp'),
            'WizardSmallImageFile=' + path.join('..', 'redist', 'iss', 'wizard-small.bmp'),
            'OutputDir=.',
            'OutputBaseFilename=' + path.basename(this._dirBuildRoot),
            'ChangesEnvironment=yes',
            // one LZMA2 stream at the highest level over all files: the thousand connectors and icons compress together
            'Compression=lzma2/ultra64',
            'SolidCompression=yes',
            '',
            '[Tasks]',
            'Name: shortcuts; Description: "All"; GroupDescription: "Create Shortcuts:";',
            'Name: shortcuts\\desktop; Description: "Desktop"; GroupDescription: "Create Shortcuts:";',
            'Name: shortcuts\\startmenu; Description: "Startmenu Programs"; GroupDescription: "Create Shortcuts:"; Flags: unchecked',
            '',
            '[Files]',
            `Source: ${path.basename(this._dirBuildRoot)}\\*; DestDir: {app}; Flags: recursesubdirs`,
            '',
            '[UninstallDelete]',
            'Name: {app}; Type: filesandordirs',
            '',
            '[Icons]',
            `Name: "{commondesktop}\\${this._configuration.name.product}"; Tasks: shortcuts\\desktop; Filename: "{app}\\${this._configuration.binary.windows}";`,
            `Name: "{commonstartmenu}\\${this._configuration.name.product}"; Tasks: shortcuts\\startmenu; Filename: "{app}\\${this._configuration.binary.windows}";`,
        ];
        this._saveFile(file, content.join(eol), false);
        return file;
    }
}

/**
 * Packager for windows platform
 */
class ElectronPackagerDarwin extends ElectronPackager {
    /**
     *
     */
    constructor(configuration) {
        super(configuration);
        // Desktop only: x86_64 and arm64. The minimum macOS version is the one
        // of the Electron build (the Info.plist step below keeps it).
        // Notarization is OPTIONAL: it needs a paid Apple Developer account;
        // without it macOS users bypass Gatekeeper manually.
        this.architectures = {
            64: {
                dmg: {
                    name: 'amd64',
                    suffix: 'macos_amd64',
                    platform: 'darwin-x64',
                },
            },
            ARM64: {
                dmg: {
                    name: 'arm64',
                    suffix: 'macos_arm64',
                    platform: 'darwin-arm64',
                },
            },
        };
        this._architecture = this.architectures[0];
    }

    /**
     *
     */
    get _dirBuildRoot() {
        return path.join(
            'build',
            `${this._configuration.name.package}_${this._configuration.version}_${this._architecture.suffix}`,
        );
    }

    /**
     *
     */
    get _stagingExecutableDirectory() {
        return path.join(
            this._dirBuildRoot,
            this._configuration.name.product + '.app',
            'Contents',
            'MacOS',
        );
    }

    _wait(milliseconds) {
        return new Promise((resolve) => {
            setTimeout(() => resolve(), milliseconds);
        });
    }

    /**
     *
     * @param {string} architecture '64'
     */
    async build(architecture) {
        await this.buildDMG(architecture);
    }

    /**
     * Create InnoSetup installer
     * @param {string} architecture
     */
    async buildDMG(architecture) {
        this._architecture = this.architectures[architecture].dmg;

        await this._validateCommands('hdiutil info', 'which codesign');

        await fs.promises.rm(this._dirBuildRoot, { recursive: true, force: true });
        await this._bundleElectron(false);
        await this._createPList();
        await this._signApplication();

        let dmg = this._dirBuildRoot + '.dmg';
        await fs.promises.rm(dmg, { recursive: true, force: true });
        let tmp = this._dirBuildRoot + '.tmp';
        await fs.promises.rm(tmp + '.dmg', { recursive: true, force: true });
        await this._executeCommand(
            `hdiutil create -volname "${this._configuration.name.product}" -srcfolder "${this._dirBuildRoot}" -fs "HFS+" -fsargs "-c c=64,a=16,e=16" -format "UDRW" "${tmp}"`,
        );
        let device = (
            await this._executeCommand(
                `hdiutil attach -readwrite -noverify -noautoopen "${tmp}.dmg" | egrep '^/dev/' | sed 1q | awk '{print $1}'`,
            )
        ).trim();
        await this._wait(5000);
        await this._executeCommand(`echo '${this._appleScript}' | osascript`);
        await this._executeCommand(`chmod -Rf go-w "/Volumes/${this._configuration.name.product}"`);
        await this._executeCommand(`sync`);
        await this._wait(5000);
        await this._executeCommand(`hdiutil detach "${device}"`);
        await this._wait(5000);
        await this._executeCommand(
            `hdiutil convert "${tmp}.dmg" -format "UDZO" -imagekey zlib-level=9 -o "${dmg}"`,
        );
        await fs.promises.rm(tmp + '.dmg', { recursive: true, force: true });
    }

    /**
     *
     */
    async _bundleElectron() {
        console.log('Bundle electron ...');
        let folder = path.join(this._dirBuildRoot, 'Electron.app', 'Contents');
        await this._downloadElectron(
            this._configuration.electron,
            this._architecture.platform,
            this._dirBuildRoot,
        );
        await fs.promises.rm(path.join(folder, 'Resources', 'default_app.asar'), {
            recursive: true,
            force: true,
        });
        await packApp(config.src, path.join(folder, 'Resources', 'app.asar'));
        await this._bundleWebPart(path.join(folder, 'Resources'));
        await fs.promises.rename(
            path.join(folder, 'MacOS', 'Electron'),
            path.join(folder, 'MacOS', this._configuration.binary.darwin),
        );
        await fs.promises.rm(path.join(folder, 'Resources', 'electron.icns'), {
            recursive: true,
            force: true,
        });
        await fs.promises.cp(
            path.join('redist', 'macos', 'icon.icns'),
            path.join(folder, 'Resources', this._configuration.binary.darwin + '.icns'),
            { recursive: true },
        );
        await fs.promises.mkdir(path.join(this._dirBuildRoot, '.images'), { recursive: true });
        await fs.promises.cp(
            path.join('redist', 'macos', 'OSXSetup.png'),
            path.join(this._dirBuildRoot, '.images', 'OSXSetup.png'),
            { recursive: true },
        );
        await fs.promises.rename(
            path.join(this._dirBuildRoot, 'Electron.app'),
            path.join(this._dirBuildRoot, this._configuration.name.product + '.app'),
        );
    }

    /**
     * Give the Electron bundle the name of the application. Only the keys that name it change; everything else
     * (the minimum macOS version, the principal class, the main menu) stays as this version of Electron ships it.
     */
    async _createPList() {
        console.log('Patching P-List Info ...');
        let file = path.join(
            this._dirBuildRoot,
            this._configuration.name.product + '.app',
            'Contents',
            'Info.plist',
        );
        let content = await fs.promises.readFile(file, 'utf8');
        const names = {
            CFBundleDisplayName: this._configuration.name.product,
            CFBundleExecutable: this._configuration.binary.darwin,
            CFBundleIconFile: this._configuration.binary.darwin + '.icns',
            CFBundleIdentifier: this._configuration.identifier,
            CFBundleName: this._configuration.name.product,
            CFBundleShortVersionString: this._configuration.version,
            CFBundleVersion: this._configuration.version,
        };
        for (const [key, value] of Object.entries(names)) {
            const entry = new RegExp(`(<key>${key}</key>\\s*<string>)[^<]*(</string>)`);
            if (!entry.test(content)) {
                throw new Error(`The Info.plist of Electron has no key "${key}"!`);
            }
            // the value becomes the text of an XML element
            const text = String(value)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
            content = content.replace(entry, (match, open, close) => open + text + close);
        }
        await fs.promises.writeFile(file, content);
        return file;
    }

    /**
     * Sign the application ad hoc. Apple Silicon refuses to run code whose signature does not match its files, and the
     * signature of the Electron bundle no longer does after the renaming, the new Info.plist and the added files. An
     * ad hoc signature needs no Apple developer account; Gatekeeper still asks the user once when the app is opened.
     */
    async _signApplication() {
        console.log('Signing the application (ad hoc) ...');
        let application = path.join(this._dirBuildRoot, this._configuration.name.product + '.app');
        await this._executeCommand(`codesign --force --deep --sign - "${application}"`);
    }

    get _appleScript() {
        return `
        tell application "Finder"
            tell disk "${this._configuration.name.product}"
                open
                set current view of container window to icon view
                set toolbar visible of container window to false
                set statusbar visible of container window to false
                set the bounds of container window to {100, 100, 560, 620}
                set theViewOptions to the icon view options of container window
                set arrangement of theViewOptions to not arranged
                set icon size of theViewOptions to 64
                set background picture of theViewOptions to file ".images:OSXSetup.png"
                make new alias file at container window to POSIX file "/Applications" with properties {name:"Applications"}
                set position of item "'${this._configuration.name.product}'" of container window to {360, 180}
                set position of item "Applications" of container window to {360, 390}
                set position of item ".fseventsd" of container window to {180, 620}
                set position of item ".images" of container window to {280, 620}
                update without registering applications
                delay 5
                close
            end tell
        end tell
        `;
    }
}

// the targets of the command line and the host that builds each of them
const hosts = { windows: 'win32', linux: 'linux', macos: 'darwin' };

/**
 * node build-app.js [windows] [linux] [macos]
 * Without a target the packages of the platform that runs the build are made. The packages of Linux and macOS need
 * tools of their own platform (dpkg and rpm, hdiutil and codesign), so they can only be built there. Windows can be
 * built anywhere with bsdtar, but only a Windows host also builds the installer (Inno Setup).
 * @param {string[]} targets
 */
async function main(targets) {
    for (const target of targets) {
        if (!Object.hasOwn(hosts, target)) {
            throw new Error(
                `Unknown target "${target}", use one of: ${Object.keys(hosts).join(', ')}`,
            );
        }
        if (target !== 'windows' && process.platform !== hosts[target]) {
            throw new Error(
                `The ${target} packages can only be built on ${target}; the "Build Desktop Installers" workflow builds them.`,
            );
        }
    }
    for (const target of targets) {
        if (target === 'windows') {
            let packager = new ElectronPackagerWindows(config);
            if (process.platform === 'win32') {
                await packager.buildIS('64');
                await packager.buildIS('ARM64');
            } else {
                console.log(
                    'Skipping the Inno Setup installers, they can only be built on Windows.',
                );
            }
            await packager.buildZIP('64');
            await packager.buildZIP('ARM64');
        }
        if (target === 'linux') {
            let packager = new ElectronPackagerLinux(config);
            await packager.buildDEB('64');
            await packager.buildDEB('ARM64');
            await packager.buildRPM('64');
            await packager.buildRPM('ARM64');
        }
        if (target === 'macos') {
            let packager = new ElectronPackagerDarwin(config);
            await packager.buildDMG('64');
            await packager.buildDMG('ARM64');
        }
    }
}

module.exports = { ElectronPackagerLinux, ElectronPackagerWindows, ElectronPackagerDarwin };

if (require.main === module) {
    // exit application as soon as any uncaught exception is thrown
    process.on('unhandledRejection', (error) => {
        throw error;
    });
    main(
        process.argv.length > 2
            ? process.argv.slice(2)
            : Object.keys(hosts).filter((target) => hosts[target] === process.platform),
    );
}
