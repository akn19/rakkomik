/**
 * Regenerates every icon and image that is derived from the application logo
 * (`assets/icon.svg`, a stack of books):
 * - Linux:   hicolor PNGs of the deb and rpm skeletons (`redist/{deb,rpm}/usr/share/icons`)
 * - Windows: installer icon + wizard bitmaps (`redist/iss`)
 * - macOS:   `.icns` + DMG background (`redist/macos`)
 * - Web UI:  logos and tray icons (`src/web/img`)
 *
 * Electron renders the SVG, so no other tool is needed; it needs a display
 * (`xvfb-run pnpm run icons` on a headless machine). Run with `pnpm run icons`
 * and commit the result: the generated files are what the packagers consume.
 */
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'assets', 'icon.svg');
const NAME = 'rakkomik';
const PRODUCT = 'RakKomik';
const TAGLINE = 'Manga and comic downloader';

// the largest image is limited by the window (and the window by the screen)
const CANVAS = 512;
// single quotes: the value is used inside double-quoted style attributes
const FONT = "'Segoe UI', 'Helvetica Neue', Arial, system-ui, sans-serif";
const NAVY = [ '#34497f', '#16213f' ];

const LINUX_SIZES = [ 16, 24, 32, 48, 64, 96, 128, 256 ];
const ICO_SIZES = [ 16, 24, 32, 48, 64, 96, 128, 256 ];
const TRAY = { 'logo.png': 16, 'logo@1.25x.png': 20, 'logo@1.5x.png': 24, 'logo@2x.png': 32, 'logo@3x.png': 48, 'logo@4x.png': 64 };
// icns chunk types (PNG payloads): 16/32/64 as icp4-6, 128-512 as ic07-ic09, retina variants ic11-ic14
const ICNS_CHUNKS = [
    [ 'icp4', 16 ], [ 'icp5', 32 ], [ 'icp6', 64 ], [ 'ic07', 128 ], [ 'ic08', 256 ], [ 'ic09', 512 ],
    [ 'ic11', 32 ], [ 'ic12', 64 ], [ 'ic13', 256 ], [ 'ic14', 512 ]
];

const written = [];

function save(file, data) {
    const target = path.join(ROOT, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
    written.push({ file, bytes: data.length });
}

/** ICO container whose frames are PNG images (Windows Vista and later). */
function encodeICO(frames) {
    const header = Buffer.alloc(6);
    header.writeUInt16LE(1, 2); // image type: icon
    header.writeUInt16LE(frames.length, 4);
    const directory = Buffer.alloc(16 * frames.length);
    let offset = header.length + directory.length;
    frames.forEach(({ size, png }, index) => {
        const at = index * 16;
        directory.writeUInt8(size >= 256 ? 0 : size, at); // 0 means 256
        directory.writeUInt8(size >= 256 ? 0 : size, at + 1);
        directory.writeUInt16LE(1, at + 4); // colour planes
        directory.writeUInt16LE(32, at + 6); // bits per pixel
        directory.writeUInt32LE(png.length, at + 8);
        directory.writeUInt32LE(offset, at + 12);
        offset += png.length;
    });
    return Buffer.concat([ header, directory, ...frames.map(frame => frame.png) ]);
}

/** ICNS container with PNG payloads (macOS 10.7 and later). */
function encodeICNS(pngBySize) {
    const chunks = ICNS_CHUNKS.map(([ type, size ]) => {
        const png = pngBySize.get(size);
        const header = Buffer.alloc(8);
        header.write(type, 0, 'ascii');
        header.writeUInt32BE(header.length + png.length, 4);
        return Buffer.concat([ header, png ]);
    });
    const body = Buffer.concat(chunks);
    const header = Buffer.alloc(8);
    header.write('icns', 0, 'ascii');
    header.writeUInt32BE(header.length + body.length, 4);
    return Buffer.concat([ header, body ]);
}

/** Uncompressed 24 bit BMP (what Inno Setup expects for its wizard images) of an opaque image. */
function encodeBMP(image) {
    const { width, height } = image.getSize();
    const bgra = image.toBitmap();
    const rowSize = Math.ceil(width * 3 / 4) * 4;
    const file = Buffer.alloc(54 + rowSize * height);
    file.write('BM', 0, 'ascii');
    file.writeUInt32LE(file.length, 2);
    file.writeUInt32LE(54, 10); // pixel data offset
    file.writeUInt32LE(40, 14); // BITMAPINFOHEADER
    file.writeInt32LE(width, 18);
    file.writeInt32LE(height, 22);
    file.writeUInt16LE(1, 26);
    file.writeUInt16LE(24, 28);
    file.writeUInt32LE(rowSize * height, 34);
    file.writeInt32LE(2835, 38); // 72 dpi
    file.writeInt32LE(2835, 42);
    for (let y = 0; y < height; y++) {
        const from = (height - 1 - y) * width * 4; // BMP rows run bottom-up
        const to = 54 + y * rowSize;
        for (let x = 0; x < width; x++) {
            file[to + x * 3] = bgra[from + x * 4];
            file[to + x * 3 + 1] = bgra[from + x * 4 + 1];
            file[to + x * 3 + 2] = bgra[from + x * 4 + 2];
        }
    }
    return file;
}

async function main() {
    const logo = 'data:image/svg+xml;base64,' + fs.readFileSync(SOURCE).toString('base64');
    const win = new BrowserWindow({
        show: false, width: CANVAS, height: CANVAS, useContentSize: true, frame: false, transparent: true, backgroundColor: '#00000000',
        webPreferences: { offscreen: true }
    });
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><body style="margin:0;background:transparent;overflow:hidden"></body>'));

    /** Render HTML in the top-left corner of the window and capture `width` x `height` pixels of it. */
    async function render(html, width, height) {
        await win.webContents.executeJavaScript(`(async () => {
            document.body.innerHTML = ${JSON.stringify(html)};
            await Promise.all([ ...document.images ].map(image => image.decode()));
            await document.fonts.ready;
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        })()`);
        await new Promise(resolve => setTimeout(resolve, 100));
        const image = await win.webContents.capturePage({ x: 0, y: 0, width, height });
        const size = image.getSize();
        if (size.width !== width || size.height !== height) {
            throw new Error(`Captured ${size.width}x${size.height} instead of ${width}x${height}!`);
        }
        return image;
    }

    const pngs = new Map();
    const logoPNG = async size => {
        if (!pngs.has(size)) {
            const image = await render(`<img src="${logo}" width="${size}" height="${size}" style="display:block">`, size, size);
            pngs.set(size, image.toPNG());
        }
        return pngs.get(size);
    };
    const logoImage = (size, style = '') => `<img src="${logo}" width="${size}" height="${size}" style="display:block;${style}">`;

    // Linux: hicolor theme icons for both package flavours
    for (const flavour of [ 'deb', 'rpm' ]) {
        for (const size of LINUX_SIZES) {
            save(`redist/${flavour}/usr/share/icons/hicolor/${size}x${size}/apps/${NAME}.png`, await logoPNG(size));
        }
    }

    // Windows: installer/application icon and the two wizard bitmaps
    const icoFrames = [];
    for (const size of ICO_SIZES) {
        icoFrames.push({ size, png: await logoPNG(size) });
    }
    save('redist/iss/app.ico', encodeICO(icoFrames));
    save('redist/iss/wizard.bmp', encodeBMP(await render(`
        <div style="width:164px;height:314px;background:linear-gradient(160deg,${NAVY[0]},${NAVY[1]});font-family:${FONT};text-align:center;color:#fff">
            ${logoImage(120, 'margin:0 auto;padding-top:34px')}
            <div style="margin-top:22px;font-size:25px;font-weight:700;letter-spacing:.5px">${PRODUCT}</div>
            <div style="margin:8px 14px 0;font-size:12px;line-height:1.35;color:#b9c6ea">${TAGLINE}</div>
        </div>`, 164, 314)));
    save('redist/iss/wizard-small.bmp', encodeBMP(await render(`
        <div style="width:55px;height:55px;background:#fff;display:flex;align-items:center;justify-content:center">${logoImage(47)}</div>`, 55, 55)));

    // macOS: icon + the DMG background (the app icon is placed at (360, 180), Applications at (360, 390))
    save('redist/macos/icon.icns', encodeICNS(new Map(await Promise.all([ ...new Set(ICNS_CHUNKS.map(([ , size ]) => size)) ].map(async size => [ size, await logoPNG(size) ])))));
    const arrow = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="72" viewBox="0 0 64 72"><path d="M22 0h20v38h16L32 70 6 38h16z" fill="#c9cfdd"/></svg>';
    save('redist/macos/OSXSetup.png', (await render(`
        <div style="position:relative;width:460px;height:505px;background:#f3f5fa;font-family:${FONT}">
            <div style="position:absolute;left:24px;top:26px;width:270px;box-sizing:border-box;padding:16px 20px;border:3px solid ${NAVY[1]};border-radius:18px;background:#fff;color:${NAVY[1]};font-size:20px;font-weight:700;line-height:1.4">Installation:<br>Drag ${PRODUCT} into your Applications folder</div>
            <div style="position:absolute;left:44px;top:216px">${logoImage(200)}</div>
            <div style="position:absolute;left:328px;top:250px">${`<img src="data:image/svg+xml;base64,${Buffer.from(arrow).toString('base64')}" width="64" height="72">`}</div>
        </div>`, 460, 505)).toPNG());

    // Web UI: logos of the title bar / start page / about dialog, tray icons
    save('src/web/img/logo_s.png', await logoPNG(64));
    save('src/web/img/logo_m.png', await logoPNG(128));
    for (const [ file, size ] of Object.entries(TRAY)) {
        save(`src/web/img/tray/${file}`, await logoPNG(size));
    }
    save('src/web/img/tray/logo.ico', encodeICO(icoFrames));

    win.destroy();
}

app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.disableHardwareAcceleration();
app.whenReady().then(main).then(() => {
    const total = written.reduce((sum, { bytes }) => sum + bytes, 0);
    console.log(`Wrote ${written.length} files (${(total / 1024).toFixed(0)} KiB) from assets/icon.svg`);
    app.quit();
}).catch(error => {
    console.error(error);
    app.exit(1);
});
