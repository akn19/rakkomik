// The packager of the installers: what the packages hold, as far as that can be checked without building one. The
// mistakes that this guards against only showed when the package was built (by the first run of the packager anywhere):
// dpkg-deb refused maintainer scripts that were not executable, the RPM of ARM64 was labelled x86_64, and the installer
// of ARM64 for Windows did not tell Windows which architecture it is for.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ElectronPackagerLinux, ElectronPackagerWindows } = require('../../../build-app.js');
const config = require('../../../build-app.config');

let directory = null;
let umask = null;

beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rakkomik-packager-'));
    // the umask of a CI runner or of a user who shares nothing: the scripts must not depend on it
    umask = process.umask(0o077);
});

afterEach(() => {
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

describe('the maintainer scripts of the DEB', () => {
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
        expect(build).toMatch(/^rpmbuild -bb --noclean --target \S+ --define "_topdir .+\/package" --define "buildroot %\{_topdir\}" ".+specfile\.spec"$/);
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
