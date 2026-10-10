// Hermetic UI tests on the real application (isolated profile, no site access):
// startup budget, connector picker, 10k-title list, chapter list, reader, menu.
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

    test('should read a chapter: thumbnails, zoom, chapter order and Escape', async ({ page }) => {
        await reload(page);
        await openSeededManga(page);
        // open "Chapter 80" (6th row)
        await page.locator('[role=list] > div > div').nth(5).getByTitle(/^Show preview/).click();
        const thumbnails = page.getByRole('button', { name: /^Page \d$/ });
        await expect(thumbnails).toHaveCount(6);
        await thumbnails.nth(2).click();
        const images = page.locator('img.rk-page');
        await expect(images).toHaveCount(6);

        await page.keyboard.press('+');
        await expect(images.first()).toHaveCSS('width', /./);
        expect(await images.first().evaluate(element => element.style.width)).toBe('90%');

        // ArrowRight = the entry above in the list (classic chapterUp), ArrowLeft = below
        await page.keyboard.press('ArrowRight');
        await expect.poll(() => page.evaluate(() => decodeURIComponent(location.hash))).toContain('chapter=/c/81');
        await expect(images).toHaveCount(6);
        await page.keyboard.press('ArrowLeft');
        await expect.poll(() => page.evaluate(() => decodeURIComponent(location.hash))).toContain('chapter=/c/80');
        await expect(images).toHaveCount(6);

        await page.keyboard.press('Escape');
        await expect(images).toHaveCount(0);
        await expect(thumbnails).toHaveCount(6);
        await page.keyboard.press('Escape');
        await expect(page.getByText('Welcome to RakKomik')).toBeVisible();
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

test('should never contact an external host', async ({ app }) => {
    expect(app.external).toEqual([]);
});
