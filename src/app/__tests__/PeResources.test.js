// scripts/pe-resources.mjs gives the Windows executable of Electron the icon and the version information of the
// application, in pure JavaScript. The tests make real PE files (pe-library builds them from nothing) and read the
// resources back with the libraries, not with the editor that is tested.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { FUSE_SENTINEL, STOCK_FUSES, readFuseWire } = require('./support/buildAppHarness');
const { createExecutable, createIcon, readResources } = require('./support/peFixture');

const REPOSITORY = path.resolve(__dirname, '..', '..', '..');

let setExecutableResources = null;
let readVersionStrings = null;
let directory = null;
let executable = null;
let icon = null;

beforeAll(async () => {
    ({ setExecutableResources, readVersionStrings } =
        await import('../../../scripts/pe-resources.mjs'));
});

beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rakkomik-pe-'));
    executable = path.join(directory, 'app.exe');
    icon = path.join(directory, 'app.ico');
});

afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
});

async function stage({ ico = createIcon([16, 32, 256]), ...options } = {}) {
    fs.writeFileSync(executable, await createExecutable(options));
    fs.writeFileSync(icon, ico);
}

const strings = (extra = {}) => ({
    ProductName: 'RakKomik',
    CompanyName: '',
    FileDescription: 'Manga and comic downloader',
    OriginalFilename: 'rakkomik.exe',
    ...extra,
});

// the entries of the directory of an icon file: the width of each image (0 for 256) and the size of its data
function iconDirectory(bytes) {
    return Array.from({ length: bytes.readUInt16LE(4) }, (value, index) => ({
        width: bytes[6 + index * 16],
        dataSize: bytes.readUInt32LE(6 + index * 16 + 8),
    }));
}

describe('setExecutableResources', () => {
    describe('the strings', () => {
        it('should set the strings it is given, and keep the strings of Electron that it is not given', async () => {
            await stage();
            await setExecutableResources(executable, {
                icon,
                version: '1.0.0',
                strings: strings({ LegalCopyright: '2031' }),
            });
            expect((await readResources(fs.readFileSync(executable))).strings).toMatchObject({
                ProductName: 'RakKomik',
                // an empty string is a value too: it replaces "GitHub, Inc."
                CompanyName: '',
                FileDescription: 'Manga and comic downloader',
                OriginalFilename: 'rakkomik.exe',
                LegalCopyright: '2031',
                // given by Electron, not by the call
                InternalName: 'electron.exe',
            });
        });

        it('should write them as Unicode, whatever they hold', async () => {
            await stage();
            await setExecutableResources(executable, {
                icon,
                version: '1.0.0',
                strings: strings({
                    ProductName: 'ラクコミック ✓ ünï',
                    FileDescription: 'a'.repeat(300),
                }),
            });
            const written = (await readResources(fs.readFileSync(executable))).strings;
            expect(written.ProductName).toBe('ラクコミック ✓ ünï');
            expect(written.FileDescription).toBe('a'.repeat(300));
        });

        it('should keep the language of the resources that are there, and not add another', async () => {
            await stage({ language: 0x0407 });
            await setExecutableResources(executable, {
                icon,
                version: '1.0.0',
                strings: strings(),
            });
            const resources = await readResources(fs.readFileSync(executable));
            expect(resources.languages.map((entry) => entry.lang)).toEqual([0x0407]);
            expect(resources.strings).toMatchObject({
                ProductName: 'RakKomik',
                FileVersion: '1.0.0.0',
                ProductVersion: '1.0.0.0',
            });
            expect(resources.groups.map((group) => group.lang)).toEqual([0x0407]);
        });
    });

    describe('the version', () => {
        it.each([
            ['1.2.3', '1.2.3.0', 1, 2, 3, 0],
            ['10.20.30.40', '10.20.30.40', 10, 20, 30, 40],
            ['1.2', '1.2.0.0', 1, 2, 0, 0],
            ['7', '7.0.0.0', 7, 0, 0, 0],
            ['1.2.3-4', '1.2.3.4', 1, 2, 3, 4],
            ['2.0.0-beta.1', '2.0.0.0', 2, 0, 0, 0],
            ['', '0.0.0.0', 0, 0, 0, 0],
            // anything that is not text is made one: a number is a major version
            [3, '3.0.0.0', 3, 0, 0, 0],
        ])(
            'should turn %j into the version %s of both the file and the product',
            async (version, text, major, minor, patch, revision) => {
                await stage();
                await setExecutableResources(executable, { icon, version, strings: strings() });
                const { fixed, strings: written } = await readResources(
                    fs.readFileSync(executable),
                );
                // a version number is stored as two 32-bit words: major and minor, then patch and revision
                expect([fixed.fileVersionMS, fixed.fileVersionLS]).toEqual([
                    major * 65536 + minor,
                    patch * 65536 + revision,
                ]);
                expect([fixed.productVersionMS, fixed.productVersionLS]).toEqual([
                    major * 65536 + minor,
                    patch * 65536 + revision,
                ]);
                expect([written.FileVersion, written.ProductVersion]).toEqual([text, text]);
            },
        );
    });

    describe('the icon', () => {
        it('should replace the icon group of the executable by the images of the icon file, in the same slot', async () => {
            await stage({
                ico: fs.readFileSync(path.join(REPOSITORY, 'redist', 'iss', 'app.ico')),
            });
            await setExecutableResources(executable, {
                icon,
                version: '1.0.0',
                strings: strings(),
            });
            const { groups } = await readResources(fs.readFileSync(executable));
            expect(groups).toHaveLength(1);
            // the group that Electron had (and so the icon that the Explorer shows)
            expect([groups[0].id, groups[0].lang]).toEqual([101, 1033]);
            expect(
                groups[0].icons.map((entry) => ({
                    width: entry.width === 256 ? 0 : entry.width,
                    dataSize: entry.dataSize,
                })),
            ).toEqual(iconDirectory(fs.readFileSync(icon)));
            expect(groups[0].icons).toHaveLength(8);
        });

        it('should keep the icon of the executable when no icon is given', async () => {
            await stage();
            const before = (await readResources(fs.readFileSync(executable))).groups[0].icons;
            for (const none of [undefined, '']) {
                await setExecutableResources(executable, {
                    icon: none,
                    version: '1.0.0',
                    strings: strings(),
                });
                expect((await readResources(fs.readFileSync(executable))).groups[0].icons).toEqual(
                    before,
                );
            }
        });

        it('should refuse an executable that has no icon group to replace, and leave it as it is', async () => {
            await stage({ icon: false });
            const before = fs.readFileSync(executable);
            await expect(
                setExecutableResources(executable, { icon, version: '1.0.0', strings: strings() }),
            ).rejects.toThrow(`"${executable}" has no icon group to replace!`);
            expect(fs.readFileSync(executable).equals(before)).toBe(true);
        });

        it('should fail for an icon file that is cut short, and leave the executable as it is', async () => {
            await stage({
                ico: fs
                    .readFileSync(path.join(REPOSITORY, 'redist', 'iss', 'app.ico'))
                    .subarray(0, 3000),
            });
            const before = fs.readFileSync(executable);
            await expect(
                setExecutableResources(executable, { icon, version: '1.0.0', strings: strings() }),
            ).rejects.toThrow();
            expect(fs.readFileSync(executable).equals(before)).toBe(true);
        });

        it.each([
            ['a text file', Buffer.from('not an icon file')],
            ['a file of zeros', Buffer.alloc(100)],
        ])(
            'should refuse %s as the icon, and leave the executable as it is',
            async (description, ico) => {
                await stage({ ico });
                const before = fs.readFileSync(executable);
                await expect(
                    setExecutableResources(executable, {
                        icon,
                        version: '1.0.0',
                        strings: strings(),
                    }),
                ).rejects.toThrow();
                expect(fs.readFileSync(executable).equals(before)).toBe(true);
            },
        );

        it('should fail for an icon file that is missing, and leave the executable as it is', async () => {
            await stage();
            fs.rmSync(icon);
            const before = fs.readFileSync(executable);
            await expect(
                setExecutableResources(executable, { icon, version: '1.0.0', strings: strings() }),
            ).rejects.toThrow(/ENOENT/);
            expect(fs.readFileSync(executable).equals(before)).toBe(true);
        });
    });

    describe('the executable', () => {
        it('should be rewritten in place, as a file that is still an executable', async () => {
            await stage();
            const PELibrary = await import('pe-library');
            await setExecutableResources(executable, {
                icon,
                version: '1.0.0',
                strings: strings(),
            });
            expect(fs.readdirSync(directory).sort()).toEqual(['app.exe', 'app.ico']);
            const bytes = fs.readFileSync(executable);
            expect(bytes.toString('latin1', 0, 2)).toBe('MZ');
            expect(() => PELibrary.NtExecutable.from(bytes)).not.toThrow();
        });

        it('should keep what the executable holds behind its sections, which is where the fuses of Electron are', async () => {
            await stage({ wire: STOCK_FUSES });
            expect(readFuseWire(executable)).toBe(STOCK_FUSES);
            await setExecutableResources(executable, {
                icon,
                version: '1.0.0',
                strings: strings(),
            });
            expect(readFuseWire(executable)).toBe(STOCK_FUSES);
            expect(fs.readFileSync(executable).includes(FUSE_SENTINEL)).toBe(true);
        });

        it('should rewrite an executable that carries a signature, as the releases of Electron do, and drop the signature', async () => {
            const PELibrary = await import('pe-library');
            await stage({ signed: true });
            // the fixture is signed: the library refuses it unless it is told to ignore the signature
            expect(() => PELibrary.NtExecutable.from(fs.readFileSync(executable))).toThrow(
                /signed/,
            );
            await setExecutableResources(executable, {
                icon,
                version: '1.0.0',
                strings: strings(),
            });
            const bytes = fs.readFileSync(executable);
            expect(() => PELibrary.NtExecutable.from(bytes)).not.toThrow();
            expect((await readResources(bytes)).strings.ProductName).toBe('RakKomik');
            expect(readFuseWire(executable)).toBe(STOCK_FUSES);
        });

        it('should refuse an executable that has no version information, and leave it as it is', async () => {
            await stage({ versionInfo: false });
            const before = fs.readFileSync(executable);
            await expect(
                setExecutableResources(executable, { icon, version: '1.0.0', strings: strings() }),
            ).rejects.toThrow(`"${executable}" has no version information to edit!`);
            expect(fs.readFileSync(executable).equals(before)).toBe(true);
        });

        it('should refuse a file that is not an executable, and leave it as it is', async () => {
            await stage();
            fs.writeFileSync(
                executable,
                Buffer.from('this is not a portable executable'.repeat(40)),
            );
            const before = fs.readFileSync(executable);
            await expect(
                setExecutableResources(executable, { icon, version: '1.0.0', strings: strings() }),
            ).rejects.toThrow();
            expect(fs.readFileSync(executable).equals(before)).toBe(true);
        });

        it('should fail for an executable that is missing', async () => {
            await stage();
            fs.rmSync(executable);
            await expect(
                setExecutableResources(executable, { icon, version: '1.0.0', strings: strings() }),
            ).rejects.toThrow(/ENOENT/);
            expect(fs.existsSync(executable)).toBe(false);
        });
    });
});

describe('readVersionStrings', () => {
    it('should return the strings of the version information', async () => {
        await stage();
        await expect(readVersionStrings(executable)).resolves.toMatchObject({
            ProductName: 'Electron',
            FileDescription: 'Electron',
            CompanyName: 'GitHub, Inc.',
            OriginalFilename: 'electron.exe',
        });
    });

    // NOTE: the keys FileVersion and ProductVersion hold the first 32-bit word of the number (major and minor), not the text that
    // the file carries ("2.5.7.0"), although the return type in the comment says that every value is a string. Is that meant?
    it('should return the major and minor version as a number under FileVersion and ProductVersion', async () => {
        await stage();
        await setExecutableResources(executable, { icon, version: '2.5.7', strings: strings() });
        const read = await readVersionStrings(executable);
        expect(read.FileVersion).toBe(2 * 65536 + 5);
        expect(read.ProductVersion).toBe(2 * 65536 + 5);
        expect((await readResources(fs.readFileSync(executable))).strings.FileVersion).toBe(
            '2.5.7.0',
        );
    });

    it('should read an executable that carries a signature', async () => {
        await stage({ signed: true });
        await expect(readVersionStrings(executable)).resolves.toMatchObject({
            ProductName: 'Electron',
        });
    });

    it('should fail for a file that is missing', async () => {
        await expect(readVersionStrings(path.join(directory, 'missing.exe'))).rejects.toThrow(
            /ENOENT/,
        );
    });
});
