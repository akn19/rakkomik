// Hermetic UI tests on the real application (isolated profile, no site access):
// startup budget, connector picker, 10k-title list, chapter list, reader, menu.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { unzipSync } from 'fflate';
import { test, expect, reload, connectorsReady, SEED_CONNECTOR, SEED_TITLES } from './support/electronApp.mjs';

const FATHER = 'The Father and the Daughter';

async function pickConnector(page, id) {
    await page.locator('input[aria-label="Website"]').click();
    await page.getByRole('listbox', { name: 'Connectors' }).waitFor();
    await page.getByTitle('Show only websites with a name that matches the entered pattern (case-insensitive)').fill(id);
    await page.locator(`[role=option][title*="ID: ${id}"]`).first().click();
}

// Chapters/pages come from the (offline) fixture instead of a website.
async function useFakeChapters(page) {
    await page.evaluate(async id => {
        // resolved by the application's own protocol (a runtime URL, not a project file)
        const chapterModule = '/mjs/engine/Chapter.mjs';
        const { default: Chapter } = await import(chapterModule);
        const connector = Engine.Connectors.find(entry => entry.id === id);
        connector.initialize = async () => undefined;
        connector._getChapterList = (manga, callback) => {
            const list = [];
            for (let number = 85; number >= 1; number--) {
                list.push(new Chapter(manga, '/c/' + number, 'Chapter ' + number, number % 9 === 0 ? 'en' : 'id', 'available'));
            }
            callback(null, list);
        };
        const svg = (index, height) => 'data:image/svg+xml;utf8,' + encodeURIComponent(
            `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="${height}"><rect width="800" height="${height}" fill="hsl(${index * 40},60%,60%)"/><text x="40" y="80" font-size="60">Page ${index + 1}</text></svg>`
        );
        Chapter.prototype.getPages = function(callback) {
            callback(null, [0, 1, 2, 3, 4, 5].map(index => svg(index, 1100)));
        };
    }, SEED_CONNECTOR);
}

async function openSeededManga(page) {
    await connectorsReady(page);
    await pickConnector(page, SEED_CONNECTOR);
    await useFakeChapters(page);
    await page.getByRole('option', { name: new RegExp(`^${FATHER}`) }).click();
    await expect(page.getByText('Chapters: 85 / 85')).toBeVisible();
}

test.describe('startup', () => {
    test('should show the shell first and load the connectors in the background', async ({ page }) => {
        await reload(page);
        const marks = await page.evaluate(() => Object.fromEntries(performance.getEntriesByType('mark').map(entry => [entry.name, entry.startTime])));
        // shell-first (audit 5.7): interactive in < 1s on a normal machine; the budget is generous for slow CI
        expect(marks['rk:shell']).toBeLessThan(2000);
        await connectorsReady(page);
        const total = await page.evaluate(() => Engine.Connectors.length);
        expect(total).toBeGreaterThan(900);
        const readyMarks = await page.evaluate(() => performance.getEntriesByName('rk:connectors')[0].startTime);
        expect(readyMarks).toBeLessThan(10000);
        expect(marks['rk:shell']).toBeLessThan(readyMarks);
    });

    test('should wait for the connector list before choosing a default connector', async ({ page }) => {
        await reload(page);
        await connectorsReady(page);
        await expect(page.locator('input[aria-label="Website"]')).not.toHaveValue(/Loading connectors/);
        await expect(page.locator('input[aria-label="Website"]')).not.toHaveValue('');
    });
});

test.describe('connector picker', () => {
    test('should filter, select and close with Escape', async ({ page }) => {
        await reload(page);
        await connectorsReady(page);
        await page.locator('input[aria-label="Website"]').click();
        const listbox = page.getByRole('listbox', { name: 'Connectors' });
        await expect(page.getByText(/\d+ \/ \d+ websites/)).toContainText(/(\d+) \/ \1 websites/);
        // virtualized: far fewer cards than connectors in the DOM
        expect(await listbox.getByRole('option').count()).toBeLessThan(80);
        await page.keyboard.type(SEED_CONNECTOR);
        await expect(page.getByText(/^1 \/ \d+ websites/)).toBeVisible();
        await listbox.getByRole('option').first().click();
        await expect(page.locator('input[aria-label="Website"]')).toHaveValue('WestManga');
        await page.locator('input[aria-label="Website"]').click();
        await expect(listbox).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(listbox).toBeHidden();
    });

    test('should narrow the list with tags and reset the filters', async ({ page }) => {
        await reload(page);
        await connectorsReady(page);
        await page.locator('input[aria-label="Website"]').click();
        const counter = page.getByText(/\d+ \/ \d+ websites/);
        const total = Number((await counter.textContent()).match(/(\d+) \/ (\d+)/)[2]);
        await page.getByRole('button', { name: 'indonesian' }).click();
        const narrowed = Number((await counter.textContent()).match(/(\d+) \//)[1]);
        expect(narrowed).toBeGreaterThan(0);
        expect(narrowed).toBeLessThan(total);
        await page.getByTitle('Reset all filters').click();
        await expect(counter).toContainText(`${total} / ${total}`);
    });
});

test.describe('large manga list', () => {
    test('should render, filter and scroll 10k titles smoothly', async ({ page }) => {
        await reload(page);
        await connectorsReady(page);
        await pickConnector(page, SEED_CONNECTOR);
        await expect(page.getByText(`Mangas: ${SEED_TITLES} / ${SEED_TITLES}`)).toBeVisible();
        const list = page.getByRole('listbox', { name: 'Manga list' });
        expect(await list.getByRole('option').count()).toBeLessThan(120);

        const started = Date.now();
        await page.getByTitle(/^Enter a pattern \(at least 3/).fill('Sample Manga 0500');
        await expect(page.getByText(`Mangas: 10 / ${SEED_TITLES}`)).toBeVisible();
        expect(Date.now() - started).toBeLessThan(1500);
        await page.getByTitle(/^Enter a pattern \(at least 3/).fill('');

        await list.evaluate(element => { element.scrollTop = element.scrollHeight; });
        await expect(list.getByRole('option', { name: `Sample Manga ${String(SEED_TITLES - 8).padStart(5, '0')}` })).toBeVisible();
    });
});

test.describe('chapters and reader', () => {
    test('should show status, filter by regex and language, and sort', async ({ page }) => {
        await reload(page);
        await openSeededManga(page);
        const rows = page.locator('[role=list] > div > div');
        await expect(rows.first().getByRole('button').first()).toHaveAttribute('title', /^AVAILABLE/);

        const filter = page.getByTitle(/^Enter a pattern \(regex/);
        await filter.fill('/chapter 8[0-5]/i');
        await expect(page.getByText('Chapters: 6 / 85')).toBeVisible();
        await filter.fill('');
        await page.getByTitle('Select a language to filter the chapter list').selectOption('en');
        await expect(page.getByText('Chapters: 9 / 85')).toBeVisible();
        await page.getByTitle('Select a language to filter the chapter list').selectOption('');

        await page.getByTitle('Click to toggle chapter sorting').click();
        await expect(rows.first().locator('span[title]')).toHaveText('Chapter 1');
    });

    test('should toggle the bookmark of the selected manga', async ({ page }) => {
        await reload(page);
        await openSeededManga(page);
        const before = await page.evaluate(() => Engine.BookmarkManager.bookmarks.length);
        await page.getByTitle(/^Click to add the selected manga/).click();
        await expect.poll(() => page.evaluate(() => Engine.BookmarkManager.bookmarks.length)).toBe(before + 1);
        await page.getByTitle(/^Click to remove the selected manga/).click();
        await expect.poll(() => page.evaluate(() => Engine.BookmarkManager.bookmarks.length)).toBe(before);
    });

    // A download changes the status of its chapter in place, and the icon of the row has to follow: cloud, then the
    // download cloud while it is queued and downloading, then the folder. It writes a chapter, so it has its own app.
    test('should follow the download of a chapter with the icon of its row', async ({ isolatedApp }) => {
        const { page } = isolatedApp;
        await openSeededManga(page);
        // the page list is held back, so the chapter stays in the downloading stage until the test lets it go
        await page.evaluate(async () => {
            const chapterModule = '/mjs/engine/Chapter.mjs';
            const { default: Chapter } = await import(chapterModule);
            Chapter.prototype.getPages = function(callback) {
                window.finishPages = () => callback(null, [ 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"/>') ]);
            };
        });
        const status = page.locator('[role=list] > div > div').first().getByRole('button').first();
        const icon = status.locator('svg');
        const iconIs = name => new RegExp(`(^|\\s)lucide-${name}(\\s|$)`);

        await expect(status).toHaveAttribute('title', /^AVAILABLE/);
        await expect(icon).toHaveClass(iconIs('cloud'));
        await status.click();
        await expect(status).toHaveAttribute('title', /^(QUEUED|DOWNLOADING)/);
        await expect(icon).toHaveClass(iconIs('cloud-download'));
        // the job asked for the page list: it is downloading now
        await expect.poll(() => page.evaluate(() => typeof window.finishPages)).toBe('function');
        await expect(status).toHaveAttribute('title', 'DOWNLOADING');
        await expect(icon).toHaveClass(iconIs('cloud-download'));
        await page.evaluate(() => window.finishPages());
        await expect(status).toHaveAttribute('title', /^DOWNLOADED/);
        await expect(icon).toHaveClass(iconIs('folder-open'));
    });

    test('should read a chapter: thumbnails, full-window reading, zoom, chapter order and Escape', async ({ page }) => {
        await reload(page);
        await openSeededManga(page);
        // open "Chapter 80" (6th row)
        await page.locator('[role=list] > div > div').nth(5).getByTitle(/^Show preview/).click();
        const thumbnails = page.getByRole('button', { name: /^Page \d$/ });
        await expect(thumbnails).toHaveCount(6);
        const panels = page.locator('input[aria-label="Website"]');
        await expect(panels).toBeVisible();
        await thumbnails.nth(2).click();
        const images = page.locator('img.rk-page');
        await expect(images).toHaveCount(6);

        // reading takes over the window below the titlebar: the panels are gone, the window buttons stay usable
        await expect(panels).toBeHidden();
        const area = images.first().locator('xpath=..');
        await expect.poll(async () => (await area.boundingBox()).width).toBeCloseTo(page.viewportSize().width, 0);
        await page.getByTitle('Close window').click({ trial: true });

        // the toolbar shows while the pointer is over it, or the keyboard focus is in it, and not after a click
        const toolbar = page.getByTitle('Zoom In (+)').locator('xpath=..');
        await page.mouse.move(100, 400);
        await expect(toolbar).toHaveCSS('opacity', '0');
        await page.getByTitle('Zoom In (+)').hover();
        await expect(toolbar).toHaveCSS('opacity', '1');
        // the toolbar sits above the pages but must not take the mouse wheel from them
        const scrolled = await area.evaluate(element => element.scrollTop);
        await page.mouse.wheel(0, 200);
        await expect.poll(() => area.evaluate(element => element.scrollTop)).toBeGreaterThan(scrolled);
        await page.getByTitle('Default Image Width (/)').click();
        await page.mouse.move(100, 400);
        await expect(toolbar).toHaveCSS('opacity', '0');
        await page.getByTitle('Default Image Width (/)').evaluate(button => button.blur());
        for (let presses = 0; presses < 12 && !(await toolbar.evaluate(element => element.contains(document.activeElement))); presses++) {
            await page.keyboard.press('Tab');
        }
        await expect(toolbar).toHaveCSS('opacity', '1');
        await page.evaluate(() => document.activeElement.blur());
        await expect(toolbar).toHaveCSS('opacity', '0');

        await page.keyboard.press('+');
        await expect(images.first()).toHaveCSS('width', /./);
        expect(await images.first().evaluate(element => element.style.width)).toBe('90%');

        // ArrowRight = the entry above in the list (classic chapterUp), ArrowLeft = below. The panels must not show
        // for a single frame in between, while the next chapter resolves.
        await page.evaluate(() => {
            const column = document.querySelector('#react-root > div > div').firstElementChild;
            window.exposedFrames = 0;
            const sample = () => {
                if (getComputedStyle(column).visibility !== 'hidden') {
                    window.exposedFrames += 1;
                }
                window.sampling = requestAnimationFrame(sample);
            };
            sample();
        });
        await page.keyboard.press('ArrowRight');
        await expect.poll(() => page.evaluate(() => decodeURIComponent(location.hash))).toContain('chapter=/c/81');
        await expect(images).toHaveCount(6);
        await page.keyboard.press('ArrowLeft');
        await expect.poll(() => page.evaluate(() => decodeURIComponent(location.hash))).toContain('chapter=/c/80');
        await expect(images).toHaveCount(6);
        expect(await page.evaluate(() => {
            cancelAnimationFrame(window.sampling);
            return window.exposedFrames;
        })).toBe(0);

        await page.keyboard.press('Escape');
        await expect(images).toHaveCount(0);
        await expect(thumbnails).toHaveCount(6);
        await expect(panels).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.getByText('Welcome to RakKomik')).toBeVisible();
    });
});

test.describe('download list', () => {
    test('should open inside the left column without resizing the layout', async ({ page }) => {
        await reload(page);
        const column = page.locator('#react-root > div > div').first().locator('> div').first();
        const main = page.locator('main');
        const before = (await column.boundingBox()).width;
        await page.evaluate(() => {
            const job = (status, progress, number) => ({
                status,
                progress,
                errors: [],
                labels: { connector: 'WestManga', manga: 'The Father and the Daughter', chapter: 'Chapter ' + number },
                isSame: () => false,
                chapter: {}
            });
            for (const entry of [job('downloading', 55, 85), job('queued', 0, 84)]) {
                Engine.DownloadManager.dispatchEvent(new CustomEvent('updated', { detail: entry }));
            }
        });
        await expect(page.getByText('2 Download(s)')).toBeVisible();
        await page.getByTitle('Toggle download list').click();
        await expect(page.getByText('Chapter 85')).toBeVisible();
        // regression: the table in the list once sized the whole column to ~800000px
        expect((await column.boundingBox()).width).toBeCloseTo(before, 0);
        expect((await main.boundingBox()).width).toBeGreaterThan(500);
        await expect(page.getByText('Welcome to RakKomik')).toBeVisible();
        await page.getByTitle('Toggle download list').click();
        await expect(page.getByText('Chapter 85')).toBeHidden();
    });
});

test.describe('menu and settings', () => {
    test('should open the About and Settings popup, close it with Escape and save', async ({ page }) => {
        await reload(page);
        await connectorsReady(page);
        await page.getByTitle('Toggle menu').click();
        await expect(page.getByText('About', { exact: true })).toBeVisible();
        await expect(page.getByText('Enable Reader')).toBeVisible();
        await expect(page.getByText('Frontend')).toHaveCount(0);
        await page.keyboard.press('Escape');
        await expect(page.getByText('About', { exact: true })).toBeHidden();

        await page.getByTitle('Toggle menu').click();
        await page.getByTitle('Save settings and close menu').click();
        await expect(page.getByText('Settings saved.')).toBeVisible();
        await expect(page.getByText('About', { exact: true })).toBeHidden();
    });

    test('should remember the theme across reloads', async ({ page }) => {
        await reload(page);
        const isDark = () => page.evaluate(() => !!document.querySelector('#react-root .dark'));
        const initial = await isDark();
        await page.getByTitle('Toggle theme').click();
        await reload(page);
        expect(await isDark()).toBe(!initial);
        await page.getByTitle('Toggle theme').click();
        await reload(page);
        expect(await isDark()).toBe(initial);
    });

    test('should not warn about a directory that does not exist yet, but about a file', async ({ page }) => {
        await reload(page);
        await connectorsReady(page);
        const warnings = await page.evaluate(async () => {
            const captured = [];
            const original = window.alert;
            window.alert = message => { captured.push(message); };
            const probe = async value => {
                captured.length = 0;
                Engine.Settings._getValidValue('General', { label: 'Manga Directory', input: 'directory', value }, false);
                await new Promise(resolve => setTimeout(resolve, 400));
                return captured.slice();
            };
            const missing = await probe('/nonexistent/rakkomik-dir');
            const notDirectory = await probe('/etc/hostname');
            window.alert = original;
            return { missing, notDirectory };
        });
        expect(warnings.missing).toEqual([]);
        expect(warnings.notDirectory).toHaveLength(1);
    });
});

// An FMD favorites database, built with node:sqlite on the test side.
function fmdDatabase() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rakkomik-fmd-'));
    const file = path.join(directory, 'favorites.db');
    const database = new DatabaseSync(file);
    database.exec('CREATE TABLE favorites (websitelink TEXT, link TEXT, website TEXT, title TEXT)');
    const insert = database.prepare('INSERT INTO favorites VALUES (?, ?, ?, ?)');
    insert.run('example.org/manga/alpha', 'https://example.org/manga/alpha', 'Example', 'Alpha');
    insert.run('example.net/series/beta', 'https://example.net/series/beta?lang=en', 'Example Net', 'Beta');
    database.close();
    const bytes = fs.readFileSync(file);
    fs.rmSync(directory, { recursive: true, force: true });
    return Array.from(bytes);
}

test.describe('archives and bookmark import', () => {
    test('should write CBZ and EPUB archives and read the CBZ pages back', async ({ app, page }) => {
        await reload(page);
        const result = await page.evaluate(async base => {
            const storage = Engine.Storage;
            const pages = [];
            for (const color of [ '#f00', '#0f0' ]) {
                const canvas = document.createElement('canvas');
                canvas.width = 8;
                canvas.height = 8;
                const context = canvas.getContext('2d');
                context.fillStyle = color;
                context.fillRect(0, 0, 8, 8);
                const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
                pages.push({ name: `00${pages.length + 1}.png`, type: 'image/png', data: blob });
            }
            const archive = storage.path.join(base, 'Archive Test', 'Chapter 1.cbz');
            const ebook = storage.path.join(base, 'Archive Test', 'Chapter 1.epub');
            storage._createDirectoryChain(storage.path.dirname(archive));
            await storage._saveChapterPagesCBZ(archive, pages, 'Archive Test', 'Chapter 1');
            await storage._saveChapterPagesEPUB(ebook, pages);
            return { archive, ebook, urls: await storage._loadChapterPagesCBZ(archive) };
        }, path.join(app.userDirectory, 'mangas'));

        expect(result.urls).toHaveLength(2);
        expect(result.urls[0]).toMatch(/^file:\/\/.*001\.png\?ts=\d+$/);
        const cbz = unzipSync(new Uint8Array(fs.readFileSync(result.archive)));
        expect(Object.keys(cbz).sort()).toEqual([ '001.png', '002.png', 'ComicInfo.xml' ]);
        expect(Array.from(cbz['001.png'].slice(0, 4))).toEqual([ 0x89, 0x50, 0x4e, 0x47 ]);
        expect(new TextDecoder().decode(cbz['ComicInfo.xml'])).toContain('<PageCount>2</PageCount>');

        const epub = fs.readFileSync(result.ebook);
        // EPUB container rule: `mimetype` is the first entry and stored (compression method 0)
        expect(epub.subarray(30, 38).toString()).toBe('mimetype');
        expect(epub.readUInt16LE(8)).toBe(0);
        expect(Object.keys(unzipSync(new Uint8Array(epub)))).toEqual(expect.arrayContaining([ 'mimetype', 'META-INF/container.xml', 'OEBPS/content.opf', 'OEBPS/img/001.png', 'OEBPS/xhtml/1.xhtml' ]));
    });

    test('should import FMD bookmarks through node:sqlite in the main process', async ({ page }) => {
        await reload(page);
        const bookmarks = await page.evaluate(async bytes => {
            const file = new File([ new Uint8Array(bytes) ], 'favorites.db', { type: 'application/x-sqlite3' });
            return Engine.BookmarkManager._bookmarkImporter.importBookmarks(file);
        }, fmdDatabase());
        expect(bookmarks).toEqual([
            { key: { connector: 'example.org', manga: '/manga/alpha' }, title: { connector: 'Example', manga: 'Alpha' } },
            { key: { connector: 'example.net', manga: '/series/beta' }, title: { connector: 'Example Net', manga: 'Beta' } }
        ]);
    });
});

// A local site behind interstitials, like the ones anti-bot services serve:
// `/auto` completes by itself, `/manual` needs a click, `/stuck` never completes.
// A completed check is granted its cookie by the `/pass` endpoint (a Set-Cookie
// header, as the real services do: HeaderSurgery makes it usable across sites),
// after which every route answers with the real content.
function createGateServer() {
    const hits = { auto: [], manual: [], stuck: [] };
    const page = (title, body) => `<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`;
    const server = http.createServer((request, response) => {
        const [ route, query ] = request.url.slice(1).split('?');
        if (route === 'pass') {
            response.writeHead(204, { 'set-cookie': `${query}=passed; Path=/; Secure` });
            return response.end();
        }
        const passed = (request.headers.cookie || '').includes(`${route}=passed`);
        if (hits[route]) {
            hits[route].push(passed ? 'content' : 'interstitial');
        }
        if (passed) {
            response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
            return response.end(page('Content', `<h1>${route} passed</h1>`));
        }
        const interstitial = (status, body) => {
            response.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cf-mitigated': 'challenge', server: 'cloudflare' });
            response.end(page('Just a moment...', body));
        };
        const pass = `fetch('/pass?${route}').then(() => location.reload())`;
        switch (route) {
            case 'auto':
                return interstitial(503, `<div id="challenge-running"></div><script>setTimeout(() => ${pass}, 700);</script>`);
            case 'manual':
                return interstitial(403, `<div id="challenge-stage"><button id="verify">Verify you are human</button></div><script>document.getElementById('verify').onclick = () => ${pass};</script>`);
            case 'stuck':
                return interstitial(503, `<div id="challenge-running"></div>`);
            default:
                response.writeHead(404);
                return response.end();
        }
    });
    return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        hits,
        close: () => new Promise(done => {
            server.closeAllConnections();
            server.close(done);
        })
    })));
}

const fetchHeading = (base, route) => [ async ([ base, route, id ]) => {
    const connector = Engine.Connectors.find(entry => entry.id === id);
    const [ heading ] = await connector.fetchDOM(new Request(`${base}/${route}`, connector.requestOptions), 'h1');
    return heading.textContent;
}, [ base, route, SEED_CONNECTOR ] ];

const visibleWindows = app => app.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(window => window.isVisible()).length);

test.describe('anti-bot interstitials', () => {
    test('should complete an interstitial that finishes by itself, then retry the request', async ({ page }) => {
        const gate = await createGateServer();
        try {
            await reload(page);
            await connectorsReady(page);
            await expect(page.evaluate(...fetchHeading(gate.url, 'auto'))).resolves.toBe('auto passed');
            // fetch (challenged), hidden window (challenged), the page's own reload (content), fetch again (content)
            expect(gate.hits.auto).toEqual([ 'interstitial', 'interstitial', 'content', 'content' ]);
        } finally {
            await gate.close();
        }
    });

    test('should show the window to the user when the interstitial needs a click', async ({ app, page }) => {
        const gate = await createGateServer();
        try {
            await reload(page);
            await connectorsReady(page);
            await page.evaluate(() => { Engine.Request.interactiveAfter = 500; });
            const windowOpened = app.electronApp.waitForEvent('window', { timeout: 15000 });
            const pending = page.evaluate(...fetchHeading(gate.url, 'manual'));
            const challenge = await windowOpened;
            await expect.poll(() => visibleWindows(app), { timeout: 10000 }).toBe(2);
            await challenge.click('#verify');
            await expect(pending).resolves.toBe('manual passed');
            expect(gate.hits.manual).toEqual([ 'interstitial', 'interstitial', 'content', 'content' ]);
            await expect.poll(() => visibleWindows(app), { timeout: 10000 }).toBe(1);
        } finally {
            await gate.close();
        }
    });

    test('should give up with a clear error when the interstitial never completes', async ({ app, page }) => {
        const gate = await createGateServer();
        try {
            await reload(page);
            await connectorsReady(page);
            await page.evaluate(() => {
                Engine.Request.interactiveAfter = 300;
                Engine.Request.challengeTimeout = 1500;
                Engine.Request.interactiveTimeout = 1500;
            });
            await expect(page.evaluate(...fetchHeading(gate.url, 'stuck'))).rejects.toThrow(/anti-bot check of "http:\/\/127\.0\.0\.1:\d+" could not be completed \(status: 503\)/);
            // fetch (challenged), the hidden window (never completes): no retry without a completed check
            expect(gate.hits.stuck).toEqual([ 'interstitial', 'interstitial' ]);
            await expect.poll(() => app.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), { timeout: 10000 }).toBe(1);
        } finally {
            await gate.close();
        }
    });
});

// A website that answers its manga list page by page, and slowly: the update of its connector takes a while.
function createPagedServer(delay) {
    const server = http.createServer((request, response) => {
        const number = new URL(request.url, 'http://localhost').searchParams.get('page');
        setTimeout(() => {
            response.writeHead(200, { 'content-type': 'application/json' });
            response.end(JSON.stringify([ { id: `/manga/${number}-a`, title: `Paged ${number} A` }, { id: `/manga/${number}-b`, title: `Paged ${number} B` } ]));
        }, delay);
    });
    return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise(done => {
            server.closeAllConnections();
            server.close(done);
        })
    })));
}

test.describe('manga list update', () => {
    test('should show the progress of the update while it runs', async ({ page }) => {
        const server = await createPagedServer(700);
        const connectorID = 'mangadex';
        try {
            await reload(page);
            await connectorsReady(page);
            // the connector asks the local site instead of its real website, one request per page
            await page.evaluate(({ id, base }) => {
                const connector = Engine.Connectors.find(entry => entry.id === id);
                connector.initialize = async () => undefined;
                connector._getMangas = async function() {
                    const mangas = [];
                    for (let number = 1; number <= 4; number++) {
                        mangas.push(...await this.fetchJSON(`${base}/list?page=${number}`));
                    }
                    return mangas;
                };
            }, { id: connectorID, base: server.url });
            await pickConnector(page, connectorID);
            await page.getByTitle(/^Synchronize local manga list with online list from </).first().click();

            const bar = page.getByRole('progressbar', { name: 'Updating manga list' });
            await expect(bar).toBeVisible();
            // the status line counts the requests that completed, and the count grows
            await expect(page.getByText(/^Updating… 1 request · \d+:\d{2}$/)).toBeVisible();
            await expect(page.getByText(/^Updating… [2-9] requests · \d+:\d{2}$/)).toBeVisible();

            await expect(page.getByText('Manga list updated (8 titles).')).toBeVisible({ timeout: 15000 });
            await expect(page.getByText('Mangas: 8 / 8')).toBeVisible();
            await expect(bar).toHaveCount(0);
            expect(await page.evaluate(id => Engine.Connectors.find(entry => entry.id === id).updateProgress, connectorID)).toBeUndefined();
        } finally {
            await page.evaluate(id => {
                const connector = Engine.Connectors.find(entry => entry.id === id);
                delete connector.initialize;
                delete connector._getMangas;
            }, connectorID);
            await server.close();
        }
    });
});

test.describe('replaced web part', () => {
    // A rebuild of the interface and the updater of another instance both replace ui/dist while a window is open.
    // That window has its code in memory, so it may not need a single file from ui/dist anymore. It once did: the
    // views were lazy chunks with hashed names, and opening one ended in "Failed to fetch dynamically imported module".
    test('should keep opening every view after ui/dist was replaced', async ({ isolatedApp }) => {
        const { page, web } = isolatedApp;
        const requested = [];
        page.on('request', request => {
            if (request.url().includes('/ui/dist/')) {
                requested.push(request.url());
            }
        });
        await expect(page.getByText('Welcome to RakKomik')).toBeVisible();
        fs.rmSync(path.join(web, 'ui', 'dist'), { recursive: true });

        // the failure screen counts as an answer too, so a broken view fails here with the files it asked for
        const failure = page.getByText('Something went wrong!');
        const shown = async marker => {
            await expect(marker.or(failure)).toBeVisible();
            expect(requested, 'a view asked for a file of ui/dist that no longer exists').toEqual([]);
        };
        const openFromMenu = async name => {
            await page.getByTitle('Toggle menu').click();
            await page.getByRole('button', { name, exact: true }).click();
        };

        await openSeededManga(page);
        await page.locator('[role=list] > div > div').nth(5).getByTitle(/^Show preview/).click();
        await shown(page.getByRole('button', { name: 'Page 1', exact: true }));
        await openFromMenu('Downloads');
        await shown(page.getByText('The queue is empty.'));
        await openFromMenu('Bookmarks');
        await shown(page.getByText('No bookmarks yet.'));
        await openFromMenu('Start');
        await shown(page.getByText('Welcome to RakKomik'));
    });
});

test('should hand the renderer its platform data up front', async ({ app, page }) => {
    // preload bridge: values arrive through additionalArguments, no synchronous IPC
    const bootstrap = await page.evaluate(() => ({
        platform: window.hakuneko.platform,
        userData: window.hakuneko.app.getPath('userData'),
        tmpdir: window.hakuneko.os.tmpdir,
        unknown: (() => {
            try {
                return window.hakuneko.app.getPath('no-such-directory');
            } catch (error) {
                return error.message;
            }
        })()
    }));
    expect(bootstrap.platform).toBe(process.platform);
    expect(bootstrap.userData).toBe(app.userDirectory);
    expect(bootstrap.tmpdir).toBe(os.tmpdir());
    expect(bootstrap.unknown).toContain('no-such-directory');
});

test('should never contact an external host', async ({ app }) => {
    expect(app.external).toEqual([]);
});
