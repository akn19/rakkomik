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
    await page.getByRole('button', { name: /^Website:/ }).click();
    await page.getByRole('list', { name: 'Connectors' }).waitFor();
    await page.getByTitle('Show only websites with a name that matches the entered pattern (case-insensitive)').fill(id);
    await page.locator(`[role=listitem][title*="ID: ${id}"]`).first().click();
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

// The page list of a chapter never comes by itself: its download stays where it is until `window.finishPages()` is called.
async function holdPages(page) {
    await page.evaluate(async () => {
        const chapterModule = '/mjs/engine/Chapter.mjs';
        const { default: Chapter } = await import(chapterModule);
        Chapter.prototype.getPages = function(callback) {
            window.finishPages = () => callback(null, [ 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"/>') ]);
        };
    });
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
        // shell-first: interactive in < 1s on a normal machine; the budget is generous for slow CI
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
        await expect(page.getByRole('button', { name: /^Website:/ })).not.toHaveText(/Loading connectors/);
        await expect(page.getByRole('button', { name: /^Website:/ })).not.toHaveText(/^Website:\s*$/);
    });
});

test.describe('connector picker', () => {
    test('should filter, select and close with Escape', async ({ page }) => {
        await reload(page);
        await connectorsReady(page);
        await page.getByRole('button', { name: /^Website:/ }).click();
        const listbox = page.getByRole('list', { name: 'Connectors' });
        await expect(page.getByText(/\d+ \/ \d+ websites/)).toContainText(/(\d+) \/ \1 websites/);
        // virtualized: far fewer cards than connectors in the DOM
        expect(await listbox.getByRole('listitem').count()).toBeLessThan(80);
        await page.keyboard.type(SEED_CONNECTOR);
        await expect(page.getByText(/^1 \/ \d+ websites/)).toBeVisible();
        await listbox.getByRole('listitem').first().click();
        await expect(page.getByRole('button', { name: /^Website:/ })).toHaveText('Website: WestManga');
        await page.getByRole('button', { name: /^Website:/ }).click();
        await expect(listbox).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(listbox).toBeHidden();
    });

    test('should narrow the list with tags and reset the filters', async ({ page }) => {
        await reload(page);
        await connectorsReady(page);
        await page.getByRole('button', { name: /^Website:/ }).click();
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
        const rows = page.locator('[role=grid] > div > div');
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
        const status = page.locator('[role=grid] > div > div').first().getByRole('button').first();
        const icon = status.locator('svg');
        const iconIs = name => new RegExp(`(^|\\s)lucide-${name}(\\s|$)`);

        await expect(status).toHaveAttribute('title', /^AVAILABLE/);
        await expect(icon).toHaveClass(iconIs('cloud'));
        await status.click();
        await expect(status).toHaveAttribute('title', /^(QUEUED|DOWNLOADING)/);
        await expect(icon).toHaveClass(iconIs('cloud-download'));
        // the job asked for the page list: it is downloading now
        await expect.poll(() => page.evaluate(() => typeof window.finishPages)).toBe('function');
        await expect(status).toHaveAttribute('title', /^DOWNLOADING/);
        await expect(icon).toHaveClass(iconIs('cloud-download'));
        await page.evaluate(() => window.finishPages());
        await expect(status).toHaveAttribute('title', /^DOWNLOADED/);
        await expect(icon).toHaveClass(iconIs('folder-open'));
    });

    // The icon of a chapter that is on its way cancels the download, and the place of the job goes back to the queue.
    test('should cancel the download of a chapter with the icon of its row, and download it after that', async ({ isolatedApp }) => {
        const { page } = isolatedApp;
        await openSeededManga(page);
        await holdPages(page);
        const status = page.locator('[role=grid] > div > div').first().getByRole('button').first();
        const icon = status.locator('svg');
        const iconIs = name => new RegExp(`(^|\\s)lucide-${name}(\\s|$)`);

        await status.click();
        await expect.poll(() => page.evaluate(() => typeof window.finishPages)).toBe('function');
        await expect(status).toHaveAttribute('title', /^DOWNLOADING\nClick to cancel the download$/);
        // the request of the first download is still on its way when the second click comes
        await page.evaluate(() => {
            window.late = window.finishPages;
            delete window.finishPages;
        });
        await status.click();
        await expect(page.getByText('Canceled "Chapter 85".')).toBeVisible();
        await expect(status).toHaveAttribute('title', /^AVAILABLE/);
        await expect(icon).toHaveClass(iconIs('cloud'));
        expect(await page.evaluate(() => Engine.DownloadManager.jobs.length)).toBe(0);
        // the pages come too late: nothing is written, and the chapter stays as it is
        await page.evaluate(() => window.late());
        await expect(status).toHaveAttribute('title', /^AVAILABLE/);
        await expect(page.getByText('0 Download(s)')).toBeVisible();

        // the place of the job was given back, so the chapter can be downloaded after all
        await status.click();
        await expect.poll(() => page.evaluate(() => typeof window.finishPages)).toBe('function');
        await page.evaluate(() => window.finishPages());
        await expect(status).toHaveAttribute('title', /^DOWNLOADED/);
        await expect(icon).toHaveClass(iconIs('folder-open'));
    });

    test('should cancel one download from the download list, and then all the others', async ({ isolatedApp }) => {
        const { page } = isolatedApp;
        await openSeededManga(page);
        await holdPages(page);
        const statusOf = index => page.locator('[role=grid] > div > div').nth(index).getByRole('button').first();
        for (const index of [0, 1, 2]) {
            await statusOf(index).click();
        }
        // one runs for the website, the others wait for it
        await expect(page.getByText('3 Download(s)')).toBeVisible();
        await expect(statusOf(0)).toHaveAttribute('title', /^DOWNLOADING/);
        await expect(statusOf(1)).toHaveAttribute('title', /^QUEUED/);
        await expect(statusOf(2)).toHaveAttribute('title', /^QUEUED/);

        await page.getByTitle('Toggle download list').click();
        await expect(page.getByTitle('Cancel this download')).toHaveCount(3);
        await page.getByTitle('Cancel this download').nth(1).click();
        await expect(page.getByText('Canceled "Chapter 84".')).toBeVisible();
        await expect(page.getByText('2 Download(s)')).toBeVisible();
        await expect(page.getByTitle('Cancel this download')).toHaveCount(2);
        await expect(statusOf(1)).toHaveAttribute('title', /^AVAILABLE/);
        await expect(statusOf(0)).toHaveAttribute('title', /^DOWNLOADING/);
        await expect(statusOf(2)).toHaveAttribute('title', /^QUEUED/);

        // all of them: nothing is stopped before it is confirmed
        await page.getByTitle('Cancel all downloads').click();
        await expect(page.getByText('2 download(s) that wait or run will be stopped.')).toBeVisible();
        await page.getByRole('button', { name: 'Keep them' }).click();
        await expect(page.getByText('Cancel all downloads?')).toBeHidden();
        await expect(page.getByText('2 Download(s)')).toBeVisible();
        await page.getByTitle('Cancel all downloads').click();
        await page.getByRole('button', { name: 'Cancel downloads' }).click();
        await expect(page.getByText('Canceled 2 download(s).')).toBeVisible();
        await expect(page.getByText('0 Download(s)')).toBeVisible();
        for (const index of [0, 1, 2]) {
            await expect(statusOf(index)).toHaveAttribute('title', /^AVAILABLE/);
        }
        await expect(page.getByTitle('Cancel all downloads')).toBeDisabled();
        expect(await page.evaluate(() => Engine.DownloadManager.jobs.length)).toBe(0);
    });

    test('should cancel downloads in the downloads view', async ({ isolatedApp }) => {
        const { page } = isolatedApp;
        await openSeededManga(page);
        await holdPages(page);
        const statusOf = index => page.locator('[role=grid] > div > div').nth(index).getByRole('button').first();
        await statusOf(0).click();
        await statusOf(1).click();
        await expect(statusOf(0)).toHaveAttribute('title', /^DOWNLOADING/);
        await page.getByTitle('Toggle menu').click();
        await page.getByRole('button', { name: 'Downloads', exact: true }).click();

        // the download bar of the left column counts them too: this is about the view
        const view = page.getByRole('main');
        await expect(view.getByText('2 Download(s)')).toBeVisible();
        await expect(view.getByTitle('Cancel this download')).toHaveCount(2);
        await view.getByTitle('Cancel this download').nth(1).click();
        await expect(page.getByText('Canceled "Chapter 84".')).toBeVisible();
        await expect(view.getByText('1 Download(s)')).toBeVisible();
        await expect(view.getByText('Chapter 84 — WestManga')).toBeHidden();

        await view.getByTitle('Cancel all downloads').click();
        await page.getByRole('button', { name: 'Cancel downloads' }).click();
        await expect(page.getByText('Canceled 1 download(s).')).toBeVisible();
        await expect(view.getByText('The queue is empty.')).toBeVisible();
        await expect(view.getByTitle('Cancel all downloads')).toBeDisabled();
        expect(await page.evaluate(() => Engine.DownloadManager.jobs.length)).toBe(0);
    });

    test('should read a chapter: thumbnails, full-window reading, zoom, chapter order and Escape', async ({ page }) => {
        await reload(page);
        await openSeededManga(page);
        // open "Chapter 80" (6th row)
        await page.locator('[role=grid] > div > div').nth(5).getByTitle(/^Show preview/).click();
        const thumbnails = page.getByRole('button', { name: /^Page \d$/ });
        await expect(thumbnails).toHaveCount(6);
        const panels = page.getByRole('button', { name: /^Website:/ });
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
        await expect(page.getByText('Novel File Format')).toBeVisible();
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

    test('should not warn about a directory that does not exist yet, but about a file', async ({ app, page }) => {
        await reload(page);
        await connectorsReady(page);
        // paths of the profile, which exist (or not) on every system: a file like /etc/hostname is there on Linux only
        const paths = {
            missing: path.join(app.userDirectory, 'not-made-yet', 'mangas'),
            file: path.join(app.userDirectory, 'hakuneko.settings')
        };
        const warnings = await page.evaluate(async ({ missing, file }) => {
            const captured = [];
            const original = window.alert;
            window.alert = message => { captured.push(message); };
            const probe = async value => {
                captured.length = 0;
                Engine.Settings._getValidValue('General', { label: 'Manga Directory', input: 'directory', value }, false);
                await new Promise(resolve => setTimeout(resolve, 400));
                return captured.slice();
            };
            const forMissing = await probe(missing);
            const notDirectory = await probe(file);
            window.alert = original;
            return { missing: forMissing, notDirectory };
        }, paths);
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

// A website with a novel: a chapter that is there at once, a chapter its script fills in later, and a picture in it.
function createNovelServer() {
    const picture = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    const chapter = `
        <h2>Chapter 1</h2>
        <p>First &amp; <em>foremost</em></p>
        <p class="junk">text that only fools a copier</p>
        <p class="ghost">another one</p>
        <div class="ad"><p>Buy now</p></div>
        <p>https://novels.example</p>
        <p>Last <a href="/elsewhere" onclick="steal()">linked</a> text</p>
        <p><img src="/placeholder.gif" data-src="/cover.png" alt="Cover"></p>`;
    const page = body => `<!doctype html><html><head><title>Novel</title><style>.junk { display: none } .ghost { visibility: hidden }</style></head><body><div class="menu">Menu</div>${body}</body></html>`;
    const server = http.createServer((request, response) => {
        switch (request.url) {
            case '/chapter':
                response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
                return response.end(page(`<div class="content">${chapter}</div>`));
            case '/late':
                response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
                return response.end(page('<div class="content"></div><script>const content = document.querySelector(".content"); setTimeout(() => { content.innerHTML = "<p>Loading</p>"; }, 300); setTimeout(() => { content.innerHTML = "<p>Loading the whole chapter</p>"; }, 500);</script>'));
            case '/cover.png':
                response.writeHead(200, { 'content-type': 'image/png' });
                return response.end(picture);
            default:
                response.writeHead(404);
                return response.end();
        }
    });
    return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        picture,
        close: () => new Promise(done => {
            server.closeAllConnections();
            server.close(done);
        })
    })));
}

// resolved by the application's own protocol (a runtime URL, not a project file)
const NOVEL_MODULE = '/mjs/engine/Novel.mjs';

test.describe('novels', () => {
    const takeNovel = (url, selector, options) => [ async ([ url, selector, options, module ]) => {
        const { readNovelPage } = await import(module);
        return readNovelPage(await Engine.Request.fetchNovel(new Request(url), selector, options));
    }, [ url, selector, options, NOVEL_MODULE ] ];

    test('should take the text of a chapter from a page, the way a visitor sees it', async ({ page }) => {
        const site = await createNovelServer();
        try {
            await reload(page);
            const xhtml = await page.evaluate(...takeNovel(`${site.url}/chapter`, 'div.content', { obstacles: '.ad', ignoredTexts: [ 'https://novels.example' ] }));
            expect(xhtml).toBe([
                '<h2>Chapter 1</h2>',
                '<p>First &amp; <em>foremost</em></p>',
                '<p>Last linked text</p>',
                `<p><img src="${site.url}/cover.png" alt="Cover"/></p>`
            ].join('\n'));
        } finally {
            await site.close();
        }
    });

    test('should wait for a chapter that its page fills in later', async ({ page }) => {
        const site = await createNovelServer();
        try {
            await reload(page);
            await expect(page.evaluate(...takeNovel(`${site.url}/late`, 'div.content'))).resolves.toBe('<p>Loading the whole chapter</p>');
        } finally {
            await site.close();
        }
    });

    test('should fail clearly when the page has no such chapter', async ({ app, page }) => {
        const site = await createNovelServer();
        try {
            await reload(page);
            await expect(page.evaluate(...takeNovel(`${site.url}/chapter`, 'div.missing', { timeout: 1000 }))).rejects.toThrow('The novel content "div.missing" was not found!');
            // the window that loaded the page is closed again
            await expect.poll(() => app.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), { timeout: 10000 }).toBe(1);
        } finally {
            await site.close();
        }
    });

    test('should store a chapter as an EPUB or a PDF, and read the EPUB back', async ({ app, page }) => {
        const site = await createNovelServer();
        try {
            await reload(page);
            const stored = await page.evaluate(async ([ url, module ]) => {
                const { readNovelPage } = await import(module);
                const chapter = { title: 'Chapter 1 - A & B', language: 'en', status: 'available', manga: { title: 'My Novel', existingChapters: [], connector: { label: 'Site', requestOptions: {} } } };
                const text = `<p>First &amp; foremost</p>\n<p><img src="${url}/cover.png" alt="Cover"/></p>`;
                const blob = new Blob([ text ], { type: 'application/xhtml+xml;charset=utf-8' });
                const paths = {};
                try {
                    // the format of the chapters of comics does not matter: a novel is text
                    Engine.Settings.chapterFormat.value = '.cbz';
                    for (const format of [ '.epub', '.pdf' ]) {
                        Engine.Settings.novelFormat.value = format;
                        await Engine.Storage.saveChapterPages(chapter, [ blob ]);
                        paths[format] = Engine.Storage._novelOutputPath(chapter);
                    }
                    const pages = await Engine.Storage.loadChapterPages(paths['.epub']);
                    return { paths, registered: Object.keys(chapter.manga.existingChapters), pages: pages.map(entry => readNovelPage(entry)) };
                } finally {
                    Engine.Settings.chapterFormat.value = 'img';
                    Engine.Settings.novelFormat.value = '.epub';
                }
            }, [ site.url, NOVEL_MODULE ]);

            expect(stored.paths['.epub']).toBe(path.join(app.userDirectory, 'mangas', 'My Novel', 'Chapter 1 - A & B.epub'));
            expect(stored.paths['.pdf']).toBe(path.join(app.userDirectory, 'mangas', 'My Novel', 'Chapter 1 - A & B.pdf'));
            expect(stored.registered.sort()).toEqual([ 'Chapter 1 - A & B.epub', 'Chapter 1 - A & B.pdf' ]);
            // nothing but the two files of the novel was stored
            expect(fs.readdirSync(path.join(app.userDirectory, 'mangas', 'My Novel')).sort()).toEqual([ 'Chapter 1 - A & B.epub', 'Chapter 1 - A & B.pdf' ]);

            const epub = fs.readFileSync(stored.paths['.epub']);
            expect(epub.subarray(30, 38).toString()).toBe('mimetype');
            expect(epub.readUInt16LE(8)).toBe(0);
            const archive = unzipSync(new Uint8Array(epub));
            expect(Object.keys(archive)).toEqual([ 'mimetype', 'META-INF/container.xml', 'OEBPS/css/style.css', 'OEBPS/img/1.png', 'OEBPS/xhtml/chapter.xhtml', 'OEBPS/content.opf', 'OEBPS/toc.ncx' ]);
            expect(Buffer.from(archive['OEBPS/img/1.png']).equals(site.picture)).toBe(true);
            const chapterXHTML = new TextDecoder().decode(archive['OEBPS/xhtml/chapter.xhtml']);
            expect(chapterXHTML).toContain('<h1>Chapter 1 - A &amp; B</h1>');
            expect(chapterXHTML).toContain('<p>First &amp; foremost</p>');
            expect(chapterXHTML).toContain('<img src="../img/1.png" alt="Cover"/>');
            expect(new TextDecoder().decode(archive['OEBPS/content.opf'])).toContain('<dc:title>My Novel - Chapter 1 - A &amp; B</dc:title>');

            // what the reader gets: the text, with the picture as a file
            expect(stored.pages).toHaveLength(1);
            expect(stored.pages[0]).toContain('<p>First &amp; foremost</p>');
            expect(stored.pages[0]).toMatch(/<img src="file:\/\/[^"]*\/1\.png\?ts=\d+" alt="Cover"\/>/);

            // the PDF is a document of text, printed by the main process
            const pdf = fs.readFileSync(stored.paths['.pdf']);
            expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
            expect(pdf.subarray(-6).toString()).toContain('%%EOF');
            expect(pdf.length).toBeGreaterThan(1000);
        } finally {
            await site.close();
        }
    });

    test('should download a novel as text, know the chapter as downloaded after a restart, and read it from the file', async ({ isolatedApp }) => {
        const { page, userDirectory } = isolatedApp;
        await openSeededManga(page);
        await page.evaluate(async module => {
            const { createNovelPage } = await import(module);
            const chapterModule = '/mjs/engine/Chapter.mjs';
            const { default: Chapter } = await import(chapterModule);
            Chapter.prototype.getPages = function(callback) {
                callback(null, [ createNovelPage('<h1>Chapter 85</h1>\n<p>Once upon a time</p>') ]);
            };
        }, NOVEL_MODULE);
        const row = () => page.locator('[role=grid] > div > div').first();
        await row().getByRole('button').first().click();
        await expect(row().getByRole('button').first()).toHaveAttribute('title', /^DOWNLOADED/, { timeout: 15000 });

        // the chapters of comics are stored in a folder of images (the default), a novel is an e-book anyway
        const directory = path.join(userDirectory, 'mangas', FATHER);
        expect(fs.readdirSync(directory)).toEqual([ 'Chapter 85.epub' ]);
        const archive = unzipSync(new Uint8Array(fs.readFileSync(path.join(directory, 'Chapter 85.epub'))));
        expect(new TextDecoder().decode(archive['OEBPS/xhtml/chapter.xhtml'])).toContain('<p>Once upon a time</p>');

        // after a restart the manga reads its directory: the e-book is the chapter, not a file next to it
        await reload(page);
        await connectorsReady(page);
        await pickConnector(page, SEED_CONNECTOR);
        await page.evaluate(async id => {
            const chapterModule = '/mjs/engine/Chapter.mjs';
            const { default: Chapter } = await import(chapterModule);
            const connector = Engine.Connectors.find(entry => entry.id === id);
            connector.initialize = async () => undefined;
            // no status: each chapter finds out by itself whether it is on the device
            connector._getChapterList = (manga, callback) => callback(null, [ 85, 84 ].map(number => new Chapter(manga, '/c/' + number, 'Chapter ' + number, 'en')));
        }, SEED_CONNECTOR);
        await page.getByRole('option', { name: new RegExp(`^${FATHER}`) }).click();
        await expect(page.getByText('Chapters: 2 / 2')).toBeVisible();
        await expect(row().getByRole('button').first()).toHaveAttribute('title', /^DOWNLOADED/);
        await expect(page.locator('[role=grid] > div > div').nth(1).getByRole('button').first()).toHaveAttribute('title', /^AVAILABLE/);

        // and the reader gets the text out of the file
        await row().getByTitle(/^Show preview/).click();
        await page.getByRole('button', { name: 'Page 1', exact: true }).click();
        await expect(page.locator('article.rk-novel p')).toHaveText('Once upon a time');
    });

    test('should read a chapter of a novel as text: thumbnail, reader, zoom and colours', async ({ page }) => {
        await reload(page);
        await openSeededManga(page);
        await page.evaluate(async module => {
            const { createNovelPage } = await import(module);
            const chapterModule = '/mjs/engine/Chapter.mjs';
            const { default: Chapter } = await import(chapterModule);
            // the text of an e-book can hold more than a chapter: the reader cleans it up once more
            Chapter.prototype.getPages = function(callback) {
                callback(null, [ createNovelPage('<h1>Chapter 80</h1>\n<p>First &amp; <em>foremost</em></p>\n<p>Second paragraph</p><script>window.pwned = true</script><p onclick="window.pwned = true">Third</p>') ]);
            };
        }, NOVEL_MODULE);
        await page.locator('[role=grid] > div > div').nth(5).getByTitle(/^Show preview/).click();
        const thumbnail = page.getByRole('button', { name: 'Page 1', exact: true });
        await expect(thumbnail).toContainText('Chapter 80 First & foremost Second paragraph Third');
        await thumbnail.click();

        const text = page.locator('article.rk-novel');
        await expect(text.locator('h1')).toHaveText('Chapter 80');
        await expect(text.locator('p')).toHaveText([ 'First & foremost', 'Second paragraph', 'Third' ]);
        await expect(text.locator('em')).toHaveText('foremost');
        await expect(text.locator('script')).toHaveCount(0);
        await expect(text.locator('[onclick]')).toHaveCount(0);
        expect(await page.evaluate(() => window.pwned)).toBeUndefined();
        await expect(page.locator('img.rk-page')).toHaveCount(0);

        // the colours chosen for novels (light unless told otherwise) and a column that is no wider than a page of a book
        await expect(text).toHaveCSS('background-color', 'rgb(255, 255, 255)');
        await expect(text).toHaveCSS('color', 'rgb(0, 0, 0)');
        expect((await text.boundingBox()).width).toBeLessThanOrEqual(56 * 16 * 1.01);
        await page.evaluate(() => {
            Engine.Settings.NovelColorProfiles.value = 'Dark';
        });
        await page.keyboard.press('Escape');
        await thumbnail.click();
        await expect(text).toHaveCSS('background-color', 'rgb(0, 0, 0)');
        await expect(text).toHaveCSS('color', 'rgb(255, 255, 255)');
        await page.evaluate(() => {
            Engine.Settings.NovelColorProfiles.value = 'Light';
        });

        // zoom sets the size of the letters, and the text can be selected
        const size = () => text.evaluate(element => parseFloat(getComputedStyle(element).fontSize));
        const before = await size();
        await page.keyboard.press('+');
        expect(await size()).toBeGreaterThan(before);
        await page.keyboard.press('-');
        await page.keyboard.press('-');
        expect(await size()).toBeLessThan(before);
        await expect(text).toHaveCSS('user-select', 'text');

        await page.keyboard.press('Escape');
        await expect(text).toHaveCount(0);
        await expect(thumbnail).toBeVisible();
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
        await page.locator('[role=grid] > div > div').nth(5).getByTitle(/^Show preview/).click();
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
