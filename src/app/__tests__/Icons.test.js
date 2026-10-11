// scripts/icons.js renders assets/icon.svg with Electron and writes every icon and image that is derived from it: the
// theme icons of the Linux packages, the icon and the wizard images of the Windows installer, the icon and the
// background of the macOS disk image, the logos and the tray icons of the web UI. It needs a display, and it does its
// work as soon as it is loaded, so a copy of it runs here with an Electron that renders nothing (a window whose
// pictures are made up of their size), in a temporary project. The encoders of the formats are checked on their own,
// and the committed images are checked against the table that the script writes them from.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createConsole, loadToolScript, settle } = require('./support/toolScripts');

const REPOSITORY = path.resolve(__dirname, '..', '..', '..');
const ICONS = path.join(REPOSITORY, 'scripts', 'icons.js');
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1"/></svg>';

const LINUX_SIZES = [ 16, 24, 32, 48, 64, 96, 128, 256 ];
const ICO_SIZES = [ 16, 24, 32, 48, 64, 96, 128, 256 ];
// the icons of the tray for the scale factors of Windows: 100 %, 125 %, 150 %, 200 %, 300 %, 400 %
const TRAY = { 'logo.png': 16, 'logo@1.25x.png': 20, 'logo@1.5x.png': 24, 'logo@2x.png': 32, 'logo@3x.png': 48, 'logo@4x.png': 64 };
const ICNS = [ [ 'icp4', 16 ], [ 'icp5', 32 ], [ 'icp6', 64 ], [ 'ic07', 128 ], [ 'ic08', 256 ], [ 'ic09', 512 ], [ 'ic11', 32 ], [ 'ic12', 64 ], [ 'ic13', 256 ], [ 'ic14', 512 ] ];

let project = null;

beforeEach(() => {
    project = fs.mkdtempSync(path.join(os.tmpdir(), 'rakkomik-icons-'));
});

afterEach(() => {
    fs.rmSync(project, { recursive: true, force: true });
});

// a picture that Electron would capture: it knows its size, and it makes PNG bytes and pixels of its own from that
function createImage(width, height) {
    return {
        getSize: () => ({ width, height }),
        toPNG: () => Buffer.from(`PNG ${width}x${height}`),
        toBitmap: () => {
            const bgra = Buffer.alloc(width * height * 4);
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    bgra.set(pixel(x, y), (y * width + x) * 4);
                }
            }
            return bgra;
        }
    };
}

// the blue, green, red and alpha of the pixel (x, y) of the pictures above
const pixel = (x, y) => [ (x * 7 + y) & 255, (x + y * 11) & 255, (x * 3 + y * 5) & 255, 200 ];

/**
 * An Electron that renders nothing. `ready` resolves the promise that the script waits for, `capture` makes the picture of
 * a rectangle (a picture of its size by default) and `failLoad` is the error that loading the page ends with.
 */
function createElectron({ capture = ({ width, height }) => createImage(width, height), failLoad = null } = {}) {
    let ready = null;
    const whenReady = new Promise(resolve => {
        ready = resolve;
    });
    const windows = [];
    const app = {
        commandLine: { appendSwitch: vi.fn() },
        disableHardwareAcceleration: vi.fn(),
        whenReady: () => whenReady,
        quit: vi.fn(),
        exit: vi.fn()
    };
    class BrowserWindow {
        constructor(options) {
            this.options = options;
            this.loaded = [];
            this.pages = [];
            this.rectangles = [];
            this.destroyed = false;
            this.webContents = {
                executeJavaScript: async code => {
                    this.pages.push(code);
                },
                capturePage: async rectangle => {
                    this.rectangles.push(rectangle);
                    return capture(rectangle, this);
                }
            };
            windows.push(this);
        }

        async loadURL(url) {
            if (failLoad) {
                throw failLoad;
            }
            this.loaded.push(url);
        }

        destroy() {
            this.destroyed = true;
        }
    }
    return { electron: { app, BrowserWindow }, app, windows, ready };
}

/**
 * Load the script. The script reads assets/icon.svg and writes below the root of its project, which is a folder of the test.
 * @returns what `loadToolScript` returns, with `output` (the console), `delays` (what the script waited for) and the fake Electron
 */
function load({ electron = createElectron(), svg = SVG, expose = [] } = {}) {
    fs.mkdirSync(path.join(project, 'assets'), { recursive: true });
    if (svg !== null) {
        fs.writeFileSync(path.join(project, 'assets', 'icon.svg'), svg);
    }
    const output = createConsole();
    const delays = [];
    const loaded = loadToolScript(ICONS, {
        dirname: path.join(project, 'scripts'),
        modules: { electron: electron.electron },
        // the pictures are painted after a short wait: it takes no time here
        globals: { console: output, setTimeout: (callback, delay) => queueMicrotask(() => {
            delays.push(delay);
            callback();
        }) },
        expose
    });
    return { ...loaded, output, delays, ...electron };
}

async function run(options) {
    const loaded = load(options);
    loaded.ready();
    await settle();
    return loaded;
}

// every file below the project, as posix paths
function written() {
    return fs.readdirSync(project, { recursive: true, withFileTypes: true })
        .filter(entry => entry.isFile())
        .map(entry => path.relative(project, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'))
        .filter(file => file !== 'assets/icon.svg')
        .sort();
}

const read = file => fs.readFileSync(path.join(project, ...file.split('/')));

// the entries of an ICO: the width of each frame (0 is 256), its offset and the bytes of the image
function parseICO(bytes) {
    expect([ bytes.readUInt16LE(0), bytes.readUInt16LE(2) ]).toEqual([ 0, 1 ]);
    return Array.from({ length: bytes.readUInt16LE(4) }, (value, index) => {
        const at = 6 + index * 16;
        const size = bytes.readUInt32LE(at + 8);
        const offset = bytes.readUInt32LE(at + 12);
        return {
            width: bytes[at] || 256,
            height: bytes[at + 1] || 256,
            colors: bytes[at + 2],
            reserved: bytes[at + 3],
            planes: bytes.readUInt16LE(at + 4),
            bitCount: bytes.readUInt16LE(at + 6),
            size,
            offset,
            data: bytes.subarray(offset, offset + size)
        };
    });
}

// the chunks of an ICNS: the type and the bytes of each
function parseICNS(bytes) {
    expect(bytes.toString('ascii', 0, 4)).toBe('icns');
    expect(bytes.readUInt32BE(4)).toBe(bytes.length);
    const chunks = [];
    for (let at = 8; at < bytes.length;) {
        const length = bytes.readUInt32BE(at + 4);
        chunks.push({ type: bytes.toString('ascii', at, at + 4), data: bytes.subarray(at + 8, at + length) });
        at += length;
    }
    return chunks;
}

function parseBMP(bytes) {
    return {
        magic: bytes.toString('ascii', 0, 2),
        fileSize: bytes.readUInt32LE(2),
        reserved: bytes.readUInt32LE(6),
        pixelOffset: bytes.readUInt32LE(10),
        headerSize: bytes.readUInt32LE(14),
        width: bytes.readInt32LE(18),
        height: bytes.readInt32LE(22),
        planes: bytes.readUInt16LE(26),
        bitCount: bytes.readUInt16LE(28),
        compression: bytes.readUInt32LE(30),
        imageSize: bytes.readUInt32LE(34),
        resolution: [ bytes.readInt32LE(38), bytes.readInt32LE(42) ],
        palette: [ bytes.readUInt32LE(46), bytes.readUInt32LE(50) ]
    };
}

// the width and the height that the header of a PNG states
function parsePNG(bytes) {
    expect(bytes.subarray(0, 8)).toEqual(Buffer.from([ 137, 80, 78, 71, 13, 10, 26, 10 ]));
    expect(bytes.toString('ascii', 12, 16)).toBe('IHDR');
    return [ bytes.readUInt32BE(16), bytes.readUInt32BE(20) ];
}

describe('the encoders', () => {
    // the script has no exports: its encoders come out of a copy of it
    let encodeICO = null;
    let encodeICNS = null;
    let encodeBMP = null;

    beforeEach(() => {
        ({ encodeICO, encodeICNS, encodeBMP } = load({ expose: [ 'encodeICO', 'encodeICNS', 'encodeBMP' ] }).exposed);
    });

    describe('encodeICO', () => {
        const frames = sizes => sizes.map(size => ({ size, png: Buffer.from(`PNG ${size}`) }));

        it('should write the header of an icon file, then a directory of 16 bytes per frame, then the images', () => {
            const bytes = encodeICO(frames([ 16, 32 ]));
            expect(bytes).toHaveLength(6 + 2 * 16 + 'PNG 16'.length + 'PNG 32'.length);
            const entries = parseICO(bytes);
            expect(entries.map(entry => entry.data.toString('ascii'))).toEqual([ 'PNG 16', 'PNG 32' ]);
            expect(entries.map(entry => [ entry.width, entry.height, entry.colors, entry.reserved, entry.planes, entry.bitCount ])).toEqual([
                [ 16, 16, 0, 0, 1, 32 ],
                [ 32, 32, 0, 0, 1, 32 ]
            ]);
            // the images follow one another right behind the directory
            expect(entries.map(entry => entry.offset)).toEqual([ 38, 38 + 'PNG 16'.length ]);
        });

        it('should write 0 for the size of 256, which is how an icon file says it, and the size itself below it', () => {
            const bytes = encodeICO(frames([ 255, 256 ]));
            const directory = [ 6, 22 ].map(at => [ bytes[at], bytes[at + 1] ]);
            expect(directory).toEqual([ [ 255, 255 ], [ 0, 0 ] ]);
        });

        it('should give each image the size and the offset that it really has, whatever the sizes of the images are', () => {
            const pngs = [ 1, 700, 3, 70000 ].map(length => Buffer.alloc(length, length % 251));
            const entries = parseICO(encodeICO(pngs.map((png, index) => ({ size: 16 << index, png }))));
            expect(entries.map(entry => entry.size)).toEqual([ 1, 700, 3, 70000 ]);
            entries.forEach((entry, index) => expect(entry.data.equals(pngs[index])).toBe(true));
        });

        it('should write an icon file without images for no frame', () => {
            const bytes = encodeICO([]);
            expect(bytes).toHaveLength(6);
            expect(parseICO(bytes)).toEqual([]);
        });
    });

    describe('encodeICNS', () => {
        // a PNG for every size that the table of chunks asks for
        const pngs = () => new Map([ 16, 32, 64, 128, 256, 512 ].map(size => [ size, Buffer.from(`PNG ${size}`) ]));

        it('should write the chunks of the table, in its order, each with the picture of its size', () => {
            const chunks = parseICNS(encodeICNS(pngs()));
            expect(chunks.map(chunk => [ chunk.type, chunk.data.toString('ascii') ])).toEqual(ICNS.map(([ type, size ]) => [ type, `PNG ${size}` ]));
        });

        it('should write the length of every chunk as the length of its header and its data, and the length of the whole file in front', () => {
            const bytes = encodeICNS(pngs());
            // parseICNS walks by the lengths, and checks the length of the whole file
            const chunks = parseICNS(bytes);
            expect(chunks).toHaveLength(10);
            expect(bytes.length).toBe(8 + chunks.reduce((total, chunk) => total + 8 + chunk.data.length, 0));
        });

        it('should fail for a size that has no picture, rather than write a file that lacks an image', () => {
            const incomplete = pngs();
            incomplete.delete(512);
            expect(() => encodeICNS(incomplete)).toThrow();
        });
    });

    describe('encodeBMP', () => {
        // an image whose pixels are the pixels above
        const bitmap = (width, height) => encodeBMP(createImage(width, height));

        it('should write the headers of a 24-bit bitmap that is not compressed, with the size of the image and its resolution', () => {
            const bytes = bitmap(3, 2);
            // 3 pixels of 3 bytes are 9 bytes, and a row is padded to a multiple of 4: 12
            expect(parseBMP(bytes)).toEqual({
                magic: 'BM',
                fileSize: 54 + 12 * 2,
                reserved: 0,
                pixelOffset: 54,
                headerSize: 40,
                width: 3,
                height: 2,
                planes: 1,
                bitCount: 24,
                compression: 0,
                imageSize: 24,
                resolution: [ 2835, 2835 ],
                palette: [ 0, 0 ]
            });
            expect(bytes).toHaveLength(54 + 24);
        });

        it('should store the rows from the bottom to the top, and the colours as blue, green and red, without the alpha', () => {
            const bytes = bitmap(3, 2);
            const rowSize = 12;
            for (let y = 0; y < 2; y++) {
                const start = 54 + (1 - y) * rowSize;
                for (let x = 0; x < 3; x++) {
                    const [ blue, green, red ] = pixel(x, y);
                    expect([ ...bytes.subarray(start + x * 3, start + x * 3 + 3) ]).toEqual([ blue, green, red ]);
                }
                // the padding of the row
                expect([ ...bytes.subarray(start + 9, start + 12) ]).toEqual([ 0, 0, 0 ]);
            }
        });

        it.each([
            [ 1, 1, 4 ],
            [ 2, 1, 8 ],
            [ 3, 1, 12 ],
            [ 4, 1, 12 ],
            [ 5, 1, 16 ],
            [ 55, 3, 168 ],
            [ 164, 2, 492 ]
        ])('should pad a row of %i pixel(s) to %i bytes (%i)', (width, height, rowSize) => {
            const bytes = bitmap(width, height);
            expect(parseBMP(bytes)).toMatchObject({ width, height, imageSize: rowSize * height, fileSize: 54 + rowSize * height });
            expect(bytes).toHaveLength(54 + rowSize * height);
        });
    });
});

describe('the script', () => {
    it('should wait for Electron to be ready before it opens a window, and ask for pictures that are not scaled', async () => {
        const { app, windows, ready } = load();
        expect(app.commandLine.appendSwitch).toHaveBeenCalledWith('force-device-scale-factor', '1');
        expect(app.disableHardwareAcceleration).toHaveBeenCalledTimes(1);
        await settle();
        expect(windows).toEqual([]);
        ready();
        await settle();
        expect(windows).toHaveLength(1);
    });

    it('should render in a window that nobody sees, without a frame and with a transparent page, in the size of the largest picture', async () => {
        const { windows } = await run();
        expect(windows).toHaveLength(1);
        expect(windows[0].options).toMatchObject({
            show: false,
            width: 512,
            height: 512,
            useContentSize: true,
            frame: false,
            transparent: true,
            backgroundColor: '#00000000',
            webPreferences: { offscreen: true }
        });
        expect(windows[0].loaded).toHaveLength(1);
        expect(windows[0].loaded[0]).toMatch(/^data:text\/html;charset=utf-8,/);
        expect(windows[0].destroyed).toBe(true);
    });

    it('should write every file of the table, and nothing else', async () => {
        await run();
        const linux = [ 'deb', 'rpm' ].flatMap(flavour => LINUX_SIZES.map(size => `redist/${flavour}/usr/share/icons/hicolor/${size}x${size}/apps/rakkomik.png`));
        expect(written()).toEqual([
            ...linux,
            'redist/iss/app.ico',
            'redist/iss/wizard-small.bmp',
            'redist/iss/wizard.bmp',
            'redist/macos/OSXSetup.png',
            'redist/macos/icon.icns',
            'src/web/img/logo_m.png',
            'src/web/img/logo_s.png',
            ...Object.keys(TRAY).map(file => `src/web/img/tray/${file}`),
            'src/web/img/tray/logo.ico'
        ].sort());
    });

    it('should say how much it wrote', async () => {
        const { output, app } = await run();
        const total = written().reduce((sum, file) => sum + read(file).length, 0);
        expect(output.lines()).toEqual([ `Wrote 30 files (${(total / 1024).toFixed(0)} KiB) from assets/icon.svg` ]);
        expect(app.quit).toHaveBeenCalledTimes(1);
        expect(app.exit).not.toHaveBeenCalled();
    });

    it('should render the logo of the project, as a picture that the page decodes, in every size that it writes', async () => {
        const { windows } = await run();
        const pages = windows[0].pages.join('\n');
        const logo = `data:image/svg+xml;base64,${Buffer.from(SVG).toString('base64')}`;
        expect(pages).toContain(logo);
        expect(windows[0].rectangles.every(rectangle => rectangle.x === 0 && rectangle.y === 0)).toBe(true);
        // the logo comes in these sizes, each rendered once (the pictures of a size are shared by the files that need it)
        const sizes = windows[0].rectangles.filter(rectangle => rectangle.width === rectangle.height && ![ 55, 460 ].includes(rectangle.width)).map(rectangle => rectangle.width);
        expect(sizes.sort((a, b) => a - b)).toEqual([ 16, 20, 24, 32, 48, 64, 96, 128, 256, 512 ]);
    });

    it('should wait for the page to be painted before it takes each picture', async () => {
        const { windows, delays } = await run();
        // 10 sizes of the logo, the two wizard images and the background of the disk image
        expect(delays).toEqual(Array.from({ length: 13 }, () => 100));
        expect(windows[0].rectangles).toHaveLength(13);
    });

    describe('the files', () => {
        it('should hold, in each folder of the icon theme, the picture of the size of the folder, for both kinds of package', async () => {
            await run();
            for (const flavour of [ 'deb', 'rpm' ]) {
                for (const size of LINUX_SIZES) {
                    expect(read(`redist/${flavour}/usr/share/icons/hicolor/${size}x${size}/apps/rakkomik.png`).toString()).toBe(`PNG ${size}x${size}`);
                }
            }
        });

        it('should put the images of the web UI and the icons of the tray in the sizes of their names', async () => {
            await run();
            expect(read('src/web/img/logo_s.png').toString()).toBe('PNG 64x64');
            expect(read('src/web/img/logo_m.png').toString()).toBe('PNG 128x128');
            for (const [ file, size ] of Object.entries(TRAY)) {
                expect(read(`src/web/img/tray/${file}`).toString()).toBe(`PNG ${size}x${size}`);
            }
        });

        it('should write the icon of Windows with one image per size of the table, and the same icon for the tray', async () => {
            await run();
            const entries = parseICO(read('redist/iss/app.ico'));
            expect(entries.map(entry => entry.width)).toEqual(ICO_SIZES);
            expect(entries.map(entry => entry.data.toString())).toEqual(ICO_SIZES.map(size => `PNG ${size}x${size}`));
            expect(read('src/web/img/tray/logo.ico').equals(read('redist/iss/app.ico'))).toBe(true);
        });

        it('should write the icon of macOS with the chunks of the table, each with the picture of its size', async () => {
            await run();
            const chunks = parseICNS(read('redist/macos/icon.icns'));
            expect(chunks.map(chunk => [ chunk.type, chunk.data.toString() ])).toEqual(ICNS.map(([ type, size ]) => [ type, `PNG ${size}x${size}` ]));
        });

        it('should write the background of the disk image as it was captured', async () => {
            await run();
            expect(read('redist/macos/OSXSetup.png').toString()).toBe('PNG 460x505');
        });

        it.each([
            [ 'redist/iss/wizard.bmp', 164, 314 ],
            [ 'redist/iss/wizard-small.bmp', 55, 55 ]
        ])('should write %s as a bitmap of the picture that was captured, %ix%i', async (file, width, height) => {
            await run();
            const bytes = read(file);
            const rowSize = Math.ceil(width * 3 / 4) * 4;
            expect(parseBMP(bytes)).toMatchObject({ magic: 'BM', width, height, bitCount: 24, fileSize: 54 + rowSize * height, imageSize: rowSize * height });
            expect(bytes).toHaveLength(54 + rowSize * height);
            // the corners: the first pixel is in the last row of the file and the last pixel is in the first
            const colour = (x, y) => [ ...bytes.subarray(54 + (height - 1 - y) * rowSize + x * 3, 54 + (height - 1 - y) * rowSize + x * 3 + 3) ];
            expect(colour(0, 0)).toEqual(pixel(0, 0).slice(0, 3));
            expect(colour(width - 1, height - 1)).toEqual(pixel(width - 1, height - 1).slice(0, 3));
            expect(colour(width - 1, 0)).toEqual(pixel(width - 1, 0).slice(0, 3));
        });
    });

    describe('when something goes wrong', () => {
        it.each([
            [ 'width', ({ width, height }) => createImage(width === 64 ? 63 : width, height), 'Captured 63x64 instead of 64x64!' ],
            [ 'height', ({ width, height }) => createImage(width, width === 64 ? 65 : height), 'Captured 64x65 instead of 64x64!' ]
        ])('should end Electron with an error, and not say it wrote anything, when a picture has another %s than the one asked for', async (description, capture, message) => {
            const { app, output } = await run({ electron: createElectron({ capture }) });
            expect(app.exit).toHaveBeenCalledWith(1);
            expect(app.quit).not.toHaveBeenCalled();
            expect(output.entries).toHaveLength(1);
            expect(output.entries[0].stream).toBe('error');
            expect(output.entries[0].text).toContain(message);
            // what came before the picture that failed is on disk, what comes after it is not
            expect(written()).toContain('redist/deb/usr/share/icons/hicolor/48x48/apps/rakkomik.png');
            expect(written()).not.toContain('redist/deb/usr/share/icons/hicolor/64x64/apps/rakkomik.png');
        });

        it('should end Electron with an error when the logo is missing, before it opens a window or writes a file', async () => {
            const { app, output, windows } = await run({ svg: null });
            expect(app.exit).toHaveBeenCalledWith(1);
            expect(app.quit).not.toHaveBeenCalled();
            expect(output.lines('error')[0]).toContain('icon.svg');
            expect(windows).toEqual([]);
            expect(written()).toEqual([]);
        });

        it('should end Electron with an error when the page cannot be loaded, before it writes a file', async () => {
            const { app, output } = await run({ electron: createElectron({ failLoad: new Error('ERR_FAILED') }) });
            expect(app.exit).toHaveBeenCalledWith(1);
            expect(app.quit).not.toHaveBeenCalled();
            expect(output.lines('error')[0]).toContain('ERR_FAILED');
            expect(written()).toEqual([]);
        });
    });
});

describe('the committed images', () => {
    const committed = (...parts) => fs.readFileSync(path.join(REPOSITORY, ...parts));

    it.each([ 'deb', 'rpm' ])('should have the picture of the size of the folder in every folder of the icon theme of the %s', flavour => {
        for (const size of LINUX_SIZES) {
            expect(parsePNG(committed('redist', flavour, 'usr', 'share', 'icons', 'hicolor', `${size}x${size}`, 'apps', 'rakkomik.png'))).toEqual([ size, size ]);
        }
    });

    it('should have the logos of the web UI and the icons of the tray in the sizes of their names', () => {
        expect(parsePNG(committed('src', 'web', 'img', 'logo_s.png'))).toEqual([ 64, 64 ]);
        expect(parsePNG(committed('src', 'web', 'img', 'logo_m.png'))).toEqual([ 128, 128 ]);
        for (const [ file, size ] of Object.entries(TRAY)) {
            expect(parsePNG(committed('src', 'web', 'img', 'tray', file))).toEqual([ size, size ]);
        }
    });

    it('should have an icon of Windows with an image of the right size in every entry, and the same icon for the tray', () => {
        const bytes = committed('redist', 'iss', 'app.ico');
        const entries = parseICO(bytes);
        expect(entries.map(entry => entry.width)).toEqual(ICO_SIZES);
        for (const entry of entries) {
            expect(parsePNG(entry.data)).toEqual([ entry.width, entry.height ]);
            expect([ entry.planes, entry.bitCount ]).toEqual([ 1, 32 ]);
        }
        expect(committed('src', 'web', 'img', 'tray', 'logo.ico').equals(bytes)).toBe(true);
    });

    it('should have an icon of macOS with a picture of the right size in every chunk', () => {
        const chunks = parseICNS(committed('redist', 'macos', 'icon.icns'));
        expect(chunks.map(chunk => chunk.type)).toEqual(ICNS.map(([ type ]) => type));
        chunks.forEach((chunk, index) => expect(parsePNG(chunk.data)).toEqual([ ICNS[index][1], ICNS[index][1] ]));
    });

    it('should have the background of the disk image in the size that the Finder script lays its window out for', () => {
        expect(parsePNG(committed('redist', 'macos', 'OSXSetup.png'))).toEqual([ 460, 505 ]);
    });

    it.each([
        [ 'wizard.bmp', 164, 314 ],
        [ 'wizard-small.bmp', 55, 55 ]
    ])('should have %s as a 24-bit bitmap of %ix%i, the size that Inno Setup draws it in', (file, width, height) => {
        const bytes = committed('redist', 'iss', file);
        const rowSize = Math.ceil(width * 3 / 4) * 4;
        expect(parseBMP(bytes)).toMatchObject({ magic: 'BM', width, height, bitCount: 24, compression: 0, fileSize: bytes.length, pixelOffset: 54, imageSize: rowSize * height });
        expect(bytes).toHaveLength(54 + rowSize * height);
    });
});
