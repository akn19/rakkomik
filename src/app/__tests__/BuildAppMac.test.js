// The disk image of macOS. It is built on a Mac only (hdiutil, codesign), so the steps run here against a shell that
// records the commands, and the files that the packager writes or rewrites are checked for what they hold.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const asar = require('@electron/asar');
const config = require('../../../build-app.config');
const { INFO_PLIST, loadBuildApp, write, writeElectronArchive, writeSources } = require('./support/buildAppHarness');
const { useTemporaryWorkingDirectory } = require('./support/toolScripts');

const name = config.name.package;
const product = config.name.product;

function macApp(architecture = '64', options) {
    const app = loadBuildApp({ platform: 'darwin', ...options });
    const packager = new app.ElectronPackagerDarwin(config);
    packager._architecture = packager.architectures[architecture].dmg;
    return { ...app, packager };
}

// every key and string of a property list, in order
function plistValues(text) {
    return Object.fromEntries([ ...text.matchAll(/<key>([^<]+)<\/key>\s*<string>([^<]*)<\/string>/g) ].map(match => [ match[1], match[2] ]));
}

describe('the disk image of macOS', () => {
    useTemporaryWorkingDirectory();

    it('should name each architecture for the disk image and for the Electron archive', () => {
        expect(macApp().packager.architectures).toEqual({
            '64': { dmg: { name: 'amd64', suffix: 'macos_amd64', platform: 'darwin-x64' } },
            'ARM64': { dmg: { name: 'arm64', suffix: 'macos_arm64', platform: 'darwin-arm64' } }
        });
    });

    it('should stage the package in a folder named after the package, its version and its architecture', () => {
        const { packager } = macApp('ARM64');
        expect(packager._dirBuildRoot).toBe(path.join('build', `${name}_${config.version}_macos_arm64`));
        expect(packager._stagingExecutableDirectory).toBe(path.join(packager._dirBuildRoot, `${product}.app`, 'Contents', 'MacOS'));
    });

    describe('_wait', () => {
        afterEach(() => {
            vi.useRealTimers();
        });

        it('should resolve once the given time has passed and not before', async () => {
            vi.useFakeTimers();
            let done = false;
            const waiting = macApp().packager._wait(5000).then(() => {
                done = true;
            });
            await vi.advanceTimersByTimeAsync(4999);
            expect(done).toBe(false);
            await vi.advanceTimersByTimeAsync(1);
            await waiting;
            expect(done).toBe(true);
        });
    });

    describe('_createPList', () => {
        const keys = {
            CFBundleDisplayName: product,
            CFBundleExecutable: config.binary.darwin,
            CFBundleIconFile: `${config.binary.darwin}.icns`,
            CFBundleIdentifier: config.identifier,
            CFBundleName: product,
            CFBundleShortVersionString: config.version,
            CFBundleVersion: config.version
        };

        function stage(text = INFO_PLIST, packager = macApp().packager) {
            const file = path.join(packager._dirBuildRoot, `${product}.app`, 'Contents', 'Info.plist');
            write(file, text);
            return { packager, file };
        }

        it('should give the bundle the name, the executable, the icon, the identifier and the version of the application', async () => {
            const { packager, file } = stage();
            await expect(packager._createPList()).resolves.toBe(file);
            expect(plistValues(fs.readFileSync(file, 'utf8'))).toMatchObject(keys);
        });

        it('should change no more than the lines of those keys', async () => {
            const { packager, file } = stage();
            await packager._createPList();
            const before = INFO_PLIST.split('\n');
            const after = fs.readFileSync(file, 'utf8').split('\n');
            expect(after).toHaveLength(before.length);
            const changed = before.flatMap((line, index) => line === after[index] ? [] : [ index ]);
            expect(changed.map(index => before[index - 1])).toEqual(Object.keys(keys).map(key => `\t<key>${key}</key>`));
            // what Electron says about the system that it needs and about its principal class stays as it is
            expect(plistValues(after.join('\n'))).toMatchObject({ LSMinimumSystemVersion: '12.0', NSPrincipalClass: 'AtomApplication', CFBundlePackageType: 'APPL', CFBundleInfoDictionaryVersion: '6.0' });
        });

        it.each([
            [ 'line breaks of Windows', INFO_PLIST.replace(/\n/g, '\r\n') ],
            [ 'a key and its string on the same line', INFO_PLIST.replace(/<\/key>\s*<string>/g, '</key><string>') ],
            [ 'empty strings', INFO_PLIST.replace(/<string>[^<]*<\/string>/g, '<string></string>') ]
        ])('should patch a property list with %s', async (description, text) => {
            const { packager, file } = stage(text);
            await packager._createPList();
            expect(plistValues(fs.readFileSync(file, 'utf8'))).toMatchObject(keys);
        });

        it.each(Object.keys(keys))('should refuse an Info.plist without %s, and leave it as it is', async key => {
            const text = INFO_PLIST.replace(new RegExp(`\\t<key>${key}</key>\\n\\t<string>[^<]*</string>\\n`), '');
            expect(text).not.toBe(INFO_PLIST);
            const { packager, file } = stage(text);
            await expect(packager._createPList()).rejects.toThrow(`The Info.plist of Electron has no key "${key}"!`);
            expect(fs.readFileSync(file, 'utf8')).toBe(text);
        });

        it('should write a value as it is, also when it has the characters that mean something to a replacement', async () => {
            const packager = new (macApp().ElectronPackagerDarwin)({ ...config, identifier: 'io.example.$&$1$$' });
            packager._architecture = packager.architectures['64'].dmg;
            const { file } = stage(INFO_PLIST, packager);
            await packager._createPList();
            // "$&", "$1" and "$$" are kept as they are; the ampersand is written the way XML has it
            expect(plistValues(fs.readFileSync(file, 'utf8')).CFBundleIdentifier).toBe('io.example.$&amp;$1$$');
        });

        // the values become the text of XML elements: what XML reserves is written the way XML has it
        it('should escape what it writes into the XML of the list', async () => {
            const packager = new (macApp().ElectronPackagerDarwin)({ ...config, identifier: 'io.example.Rak & <Komik>' });
            packager._architecture = packager.architectures['64'].dmg;
            const { file } = stage(INFO_PLIST, packager);
            await packager._createPList();
            expect(fs.readFileSync(file, 'utf8')).toContain('<string>io.example.Rak &amp; &lt;Komik&gt;</string>');
        });
    });

    describe('_signApplication', () => {
        it('should sign the bundle ad hoc, with the options that make the signature cover the nested code', async () => {
            const { packager, runner } = macApp('ARM64');
            await packager._signApplication();
            expect(runner.commands).toEqual([ `codesign --force --deep --sign - "${path.join(packager._dirBuildRoot, `${product}.app`)}"` ]);
        });
    });

    describe('_bundleElectron', () => {
        function stage(architecture) {
            const app = macApp(architecture);
            writeSources();
            write(path.join('redist', 'macos', 'icon.icns'), 'icon of the application');
            write(path.join('redist', 'macos', 'OSXSetup.png'), 'background of the disk image');
            const downloads = [];
            app.packager._downloadElectron = async (version, platform, folder) => {
                downloads.push({ version, platform, folder });
                writeElectronArchive(folder, 'darwin');
            };
            return { ...app, downloads };
        }

        it.each([ [ '64', 'darwin-x64' ], [ 'ARM64', 'darwin-arm64' ] ])('should turn the app of Electron into the app of the application (%s)', async (architecture, electron) => {
            const { packager, downloads } = stage(architecture);
            await packager._bundleElectron();
            const root = packager._dirBuildRoot;
            const contents = path.join(root, `${product}.app`, 'Contents');
            expect(downloads).toEqual([ { version: config.electron, platform: electron, folder: root } ]);
            expect(fs.existsSync(path.join(root, 'Electron.app'))).toBe(false);
            // the executable of Electron carries the name that the Info.plist gives it
            expect(fs.existsSync(path.join(contents, 'MacOS', 'Electron'))).toBe(false);
            expect(fs.existsSync(path.join(contents, 'MacOS', config.binary.darwin))).toBe(true);
            expect(fs.existsSync(path.join(contents, 'Info.plist'))).toBe(true);
            expect(fs.existsSync(path.join(contents, 'Resources', 'default_app.asar'))).toBe(false);
            const packed = (await asar.listPackage(path.join(contents, 'Resources', 'app.asar'), { isPack: false })).map(entry => entry.split(path.sep).join('/'));
            expect(packed).toEqual(expect.arrayContaining([ '/main.js', '/package.json' ]));
            expect(fs.readFileSync(path.join(contents, 'Resources', 'web', 'index.html'), 'utf8')).toBe('<html>web part</html>');
        });

        it('should replace the icon of Electron by the icon of the application, under the name that the Info.plist gives it', async () => {
            const { packager } = stage('64');
            await packager._bundleElectron();
            const resources = path.join(packager._dirBuildRoot, `${product}.app`, 'Contents', 'Resources');
            expect(fs.existsSync(path.join(resources, 'electron.icns'))).toBe(false);
            expect(fs.readFileSync(path.join(resources, `${config.binary.darwin}.icns`), 'utf8')).toBe('icon of the application');
        });

        it('should put the background of the disk image where the script of the Finder looks for it', async () => {
            const { packager } = stage('64');
            await packager._bundleElectron();
            expect(fs.readFileSync(path.join(packager._dirBuildRoot, '.images', 'OSXSetup.png'), 'utf8')).toBe('background of the disk image');
            expect(packager._appleScript).toContain('file ".images:OSXSetup.png"');
        });

        it('should stop when the web part is missing', async () => {
            const { packager } = stage('64');
            fs.rmSync(path.join('build', 'web'), { recursive: true });
            await expect(packager._bundleElectron()).rejects.toThrow(`The web part is missing in "${path.join('build', 'web')}", run 'pnpm run build:web' first!`);
        });
    });

    describe('the script of the Finder', () => {
        it('should lay out the window of the disk image: the application, the link to the Applications folder and nothing else in sight', () => {
            const script = macApp().packager._appleScript;
            expect(script).toContain(`tell disk "${product}"`);
            expect(script).toContain('set the bounds of container window to {100, 100, 560, 620}');
            expect(script).toContain('set position of item "Applications" of container window to {360, 390}');
            expect(script).toContain('make new alias file at container window to POSIX file "/Applications" with properties {name:"Applications"}');
            // the hidden items are put at the bottom edge of the window
            expect(script).toContain('set position of item ".fseventsd" of container window to {180, 620}');
            expect(script).toContain('set position of item ".images" of container window to {280, 620}');
        });

        it.skipIf(process.platform === 'win32')('should reach osascript through the shell with the name of the application in place', async () => {
            const { packager, runner } = macApp();
            packager._bundleElectron = packager._createPList = packager._signApplication = packager._wait = async () => undefined;
            runner.respond = command => command.startsWith('hdiutil attach') ? '/dev/disk4\n' : '';
            await packager.buildDMG('64');
            const command = runner.commands.find(entry => entry.startsWith('echo '));
            expect(command.endsWith(' | osascript')).toBe(true);
            // the shell reads what the command echoes, with `cat` where osascript would be
            const received = execFileSync('sh', [ '-c', command.replace(/ \| osascript$/, ' | cat') ], { encoding: 'utf8' });
            expect(received.split('\n').filter(line => line.trim() !== '')).toEqual(packager._appleScript.replaceAll(`"'${product}'"`, `"${product}"`).split('\n').filter(line => line.trim() !== ''));
            expect(received).toContain(`set position of item "${product}" of container window to {360, 180}`);
        });
    });

    describe('buildDMG', () => {
        // the steps that have a test of their own are replaced by markers; the shell answers like hdiutil does
        function dmgApp(architecture, { failing = null, device = '/dev/disk4\n' } = {}) {
            const app = macApp(architecture);
            const events = [];
            app.packager._bundleElectron = async portable => events.push(`bundle ${portable}`);
            app.packager._createPList = async () => events.push('plist');
            app.packager._signApplication = async () => events.push('sign');
            app.packager._wait = async milliseconds => events.push(`wait ${milliseconds}`);
            app.runner.respond = command => {
                events.push(command.startsWith('echo ') ? 'osascript' : command);
                if (failing && command.startsWith(failing)) {
                    return new Error(`${failing} failed`);
                }
                // hdiutil makes the read-write image, and the final one from it
                if (command.startsWith('hdiutil create')) {
                    write(`${app.packager._dirBuildRoot}.tmp.dmg`, 'read-write image');
                }
                if (command.startsWith('hdiutil convert')) {
                    write(`${app.packager._dirBuildRoot}.dmg`, 'final image');
                }
                return command.startsWith('hdiutil attach') ? device : '';
            };
            return { ...app, events };
        }

        it.each([ '64', 'ARM64' ])('should make a read-write image of the folder, lay it out in the Finder, then compress it into the final image (%s)', async architecture => {
            const { packager, events } = dmgApp(architecture);
            const root = path.join('build', `${name}_${config.version}_macos_${architecture === '64' ? 'amd64' : 'arm64'}`);
            // the images of an earlier build are replaced
            write(`${root}.dmg`, 'image of an earlier build');
            write(`${root}.tmp.dmg`, 'image that an earlier build did not finish');

            await packager.buildDMG(architecture);

            expect(packager._dirBuildRoot).toBe(root);
            expect(events).toEqual([
                'hdiutil info',
                'which codesign',
                'bundle false',
                'plist',
                'sign',
                `hdiutil create -volname "${product}" -srcfolder "${root}" -fs "HFS+" -fsargs "-c c=64,a=16,e=16" -format "UDRW" "${root}.tmp"`,
                `hdiutil attach -readwrite -noverify -noautoopen "${root}.tmp.dmg" | egrep '^/dev/' | sed 1q | awk '{print $1}'`,
                // the volume needs time to mount before the Finder sees it, and to settle before it is detached and converted
                'wait 5000',
                'osascript',
                `chmod -Rf go-w "/Volumes/${product}"`,
                'sync',
                'wait 5000',
                'hdiutil detach "/dev/disk4"',
                'wait 5000',
                `hdiutil convert "${root}.tmp.dmg" -format "UDZO" -imagekey zlib-level=9 -o "${root}.dmg"`
            ]);
            // the image of the earlier build is replaced, and the read-write image does not stay behind
            expect(fs.readFileSync(`${root}.dmg`, 'utf8')).toBe('final image');
            expect(fs.existsSync(`${root}.tmp.dmg`)).toBe(false);
        });

        it('should detach the device that hdiutil attached, whatever it is called', async () => {
            const { packager, events } = dmgApp('64', { device: '  /dev/disk17 \n' });
            await packager.buildDMG('64');
            expect(events).toContain('hdiutil detach "/dev/disk17"');
        });

        it('should build nothing when hdiutil or codesign is missing', async () => {
            const { packager, events } = dmgApp('64', { failing: 'which codesign' });
            await expect(packager.buildDMG('64')).rejects.toThrow("Failed to run command 'which codesign', make sure it is correctly installed!");
            expect(events).toEqual([ 'hdiutil info', 'which codesign' ]);
        });

        it('should stop at the command that fails, and not go on to detach or convert', async () => {
            const { packager, events } = dmgApp('64', { failing: 'chmod' });
            await expect(packager.buildDMG('64')).rejects.toThrow('chmod failed');
            expect(events.at(-1)).toBe(`chmod -Rf go-w "/Volumes/${product}"`);
        });
    });

    it('should build the disk image of the architecture it is given', async () => {
        const { packager } = macApp();
        const calls = [];
        packager.buildDMG = async architecture => calls.push(architecture);
        await packager.build('ARM64');
        expect(calls).toEqual([ 'ARM64' ]);
    });
});
