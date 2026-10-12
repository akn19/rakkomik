// Accessibility of the real application (WCAG 2.2 AA, checked by axe-core): the start page with its panels, the menu,
// the website picker, the downloads and bookmarks views and the reader are scanned for violations in both themes. The
// keyboard is tried where the interface has its own patterns (the list box of the mangas, the grid of the chapters,
// the dialogs), and the zoom of the window that the menu of the application offers.
import { AxeBuilder } from '@axe-core/playwright';
import { test, expect, reload, connectorsReady, SEED_CONNECTOR } from './support/electronApp.mjs';

const FATHER = 'The Father and the Daughter';

async function pickConnector(page, id) {
    await page.getByRole('button', { name: /^Website:/ }).click();
    await page.getByRole('list', { name: 'Connectors' }).waitFor();
    await page.getByLabel('Website', { exact: true }).fill(id);
    await page.locator(`[role=listitem][title*="ID: ${id}"]`).first().click();
}

// Chapters come from the (offline) fixture instead of a website.
async function useFakeChapters(page) {
    await page.evaluate(async (id) => {
        const chapterModule = '/mjs/engine/Chapter.mjs';
        const { default: Chapter } = await import(chapterModule);
        const connector = Engine.Connectors.find((entry) => entry.id === id);
        connector.initialize = async () => undefined;
        connector._getChapterList = (manga, callback) => {
            const list = [];
            for (let number = 30; number >= 1; number--) {
                list.push(
                    new Chapter(manga, '/c/' + number, 'Chapter ' + number, 'en', 'available'),
                );
            }
            callback(null, list);
        };
        const svg = (index, height) =>
            'data:image/svg+xml;utf8,' +
            encodeURIComponent(
                `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="${height}"><rect width="800" height="${height}" fill="hsl(${index * 40},60%,60%)"/><text x="40" y="80" font-size="60">Page ${index + 1}</text></svg>`,
            );
        Chapter.prototype.getPages = function (callback) {
            callback(
                null,
                [0, 1, 2].map((index) => svg(index, 1100)),
            );
        };
    }, SEED_CONNECTOR);
}

async function openSeededManga(page) {
    await connectorsReady(page);
    await pickConnector(page, SEED_CONNECTOR);
    await useFakeChapters(page);
    await page.getByRole('option', { name: new RegExp(`^${FATHER}`) }).click();
    await expect(page.getByText('Chapters: 30 / 30')).toBeVisible();
}

async function setTheme(page, dark) {
    // the start page, not the view of the last test: a reload in the reader would ask the website for the chapter
    await page.evaluate(
        (theme) => {
            window.localStorage.setItem('rakkomik.theme', theme);
            window.location.hash = '';
        },
        dark ? 'dark' : 'light',
    );
    await reload(page);
    expect(await page.evaluate(() => !!document.querySelector('#react-root .dark'))).toBe(dark);
}

// the violations of axe, as a list that names the rule and the elements, empty when there are none. The legacy mode
// runs axe inside the page: the window of Electron cannot open the blank page that the other mode collects its results in.
async function violationsOf(page) {
    const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
        .setLegacyMode(true)
        .analyze();
    return results.violations.map(
        (violation) =>
            `${violation.id}: ${violation.help}\n` +
            violation.nodes.map((node) => `    ${node.target.join(' ')}`).join('\n'),
    );
}

test.describe('accessibility', () => {
    for (const dark of [false, true]) {
        const theme = dark ? 'dark' : 'light';

        test(`should have no violation on the start page, in the menu and in the website picker (${theme} theme)`, async ({
            page,
        }) => {
            await setTheme(page, dark);
            await connectorsReady(page);
            expect(await violationsOf(page)).toEqual([]);

            await page.getByTitle('Toggle menu').click();
            await expect(page.getByRole('dialog', { name: 'Menu' })).toBeVisible();
            expect(await violationsOf(page)).toEqual([]);
            await page.keyboard.press('Escape');
            await expect(page.getByRole('dialog', { name: 'Menu' })).toBeHidden();

            await page.getByRole('button', { name: /^Website:/ }).click();
            await expect(page.getByRole('dialog', { name: 'Select a website' })).toBeVisible();
            expect(await violationsOf(page)).toEqual([]);
            await page.keyboard.press('Escape');
        });

        test(`should have no violation in the chapter list, the downloads, the bookmarks and the reader (${theme} theme)`, async ({
            page,
        }) => {
            await setTheme(page, dark);
            await openSeededManga(page);
            expect(await violationsOf(page)).toEqual([]);

            await page.getByTitle('Toggle menu').click();
            await page.getByRole('button', { name: 'Downloads', exact: true }).click();
            await expect(page.getByRole('main').getByText('0 Download(s)')).toBeVisible();
            expect(await violationsOf(page)).toEqual([]);

            await page.getByTitle('Toggle menu').click();
            await page.getByRole('button', { name: 'Bookmarks', exact: true }).click();
            await expect(page.getByText(/No bookmarks yet/)).toBeVisible();
            expect(await violationsOf(page)).toEqual([]);

            await page
                .locator('[role=grid] > div > div')
                .first()
                .getByTitle(/^Show preview/)
                .click();
            await expect(page.getByRole('button', { name: /^Page \d$/ })).toHaveCount(3);
            expect(await violationsOf(page)).toEqual([]);
            await page.getByRole('button', { name: 'Page 1' }).click();
            await expect(page.locator('img.rk-page')).toHaveCount(3);
            expect(await violationsOf(page)).toEqual([]);
            // back to the thumbnails, and from there to the start page
            await page.keyboard.press('Escape');
            await page.keyboard.press('Escape');
            await expect(page.getByRole('button', { name: /^Page \d$/ })).toHaveCount(0);
        });
    }

    test('should let the keyboard choose a manga in the list box and work the grid of the chapters', async ({
        page,
    }) => {
        await reload(page);
        await connectorsReady(page);
        await pickConnector(page, SEED_CONNECTOR);
        await useFakeChapters(page);
        const list = page.getByRole('listbox', { name: 'Manga list' });
        await list.focus();
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Enter');
        // the second manga of the seed is selected, and its chapters are listed
        await expect(list.locator('[aria-selected="true"]')).toHaveText('One Piece');
        await expect(page.getByText('Chapters: 30 / 30')).toBeVisible();

        // Tab from the filter above the grid reaches the grid: the status button of the first chapter; the arrows move
        // between the cells
        await page.getByLabel('Filter the chapters by title').focus();
        await page.keyboard.press('Tab');
        await expect(page.locator(':focus')).toHaveAttribute(
            'aria-label',
            'Chapter 30: available, download the chapter',
        );
        await page.keyboard.press('ArrowDown');
        await expect(page.locator(':focus')).toHaveAttribute(
            'aria-label',
            'Chapter 29: available, download the chapter',
        );
        await page.keyboard.press('End');
        await expect(page.locator(':focus')).toHaveText('Chapter 29');
        await page.keyboard.press('Control+End');
        await expect(page.locator(':focus')).toHaveText('Chapter 1');
        // one stop for Tab: the next one is outside of the grid
        await page.keyboard.press('Tab');
        await expect(page.locator(':focus')).not.toHaveAttribute('role', 'gridcell');
    });

    test('should move the focus into a dialog, keep it there and give it back', async ({
        page,
    }) => {
        await reload(page);
        await connectorsReady(page);
        const opener = page.getByRole('button', { name: /^Website:/ });
        await opener.focus();
        await page.keyboard.press('Enter');
        const dialog = page.getByRole('dialog', { name: 'Select a website' });
        await expect(dialog).toBeVisible();
        await expect(page.getByLabel('Website', { exact: true })).toBeFocused();
        // Shift+Tab from the first control goes round to the last one of the dialog
        await page.keyboard.press('Shift+Tab');
        await expect(dialog.locator(':focus')).toHaveCount(1);
        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
        await expect(opener).toBeFocused();
    });

    // The keys of the menu are bound by Electron and do not fire for the keys that Playwright types into the page: the
    // entries of the menu are worked directly, on the window of the page.
    test('should zoom the window with the entries of the menu of the application, which have their keys', async ({
        app,
        page,
    }) => {
        await reload(page);
        const url = page.url();
        const work = (role) =>
            app.electronApp.evaluate(
                ({ BrowserWindow, Menu }, [role, url]) => {
                    const window = BrowserWindow.getAllWindows().find(
                        (entry) => entry.webContents.getURL() === url,
                    );
                    const items = (list) =>
                        list.flatMap((item) => [
                            item,
                            ...(item.submenu ? items(item.submenu.items) : []),
                        ]);
                    const item = items(Menu.getApplicationMenu().items).find(
                        (entry) => String(entry.role).toLowerCase() === role,
                    );
                    item.click(undefined, window, window.webContents);
                    return {
                        accelerator: item.accelerator,
                        zoom: window.webContents.getZoomFactor(),
                    };
                },
                [role, url],
            );
        const larger = await work('zoomin');
        expect(larger.accelerator).toBe('CommandOrControl+Plus');
        expect(larger.zoom).toBeGreaterThan(1);
        const reset = await work('resetzoom');
        expect(reset.accelerator).toBe('CommandOrControl+0');
        expect(reset.zoom).toBe(1);
        const smaller = await work('zoomout');
        expect(smaller.accelerator).toBe('CommandOrControl+-');
        expect(smaller.zoom).toBeLessThan(1);
        await work('resetzoom');
    });
});
