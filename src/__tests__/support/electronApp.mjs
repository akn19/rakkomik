// Playwright fixture: launches the packaged web bundle in Electron with an
// isolated profile (own settings, bookmarks and manga lists), so e2e runs never
// touch the user's data. Run `pnpm run build:web` first (the `test:e2e*` scripts do).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test as base, expect, _electron as electron } from '@playwright/test';
import electronPath from 'electron';

const root = path.resolve(import.meta.dirname, '..', '..', '..');
const webDirectory = process.env.E2E_WEB || path.join(root, 'build', 'web');

export const SEED_CONNECTOR = 'westmanga';
export const SEED_TITLES = 10389;

function seedProfile(userDirectory) {
    const mangas = path.join(userDirectory, 'mangas');
    fs.mkdirSync(mangas, { recursive: true });
    fs.writeFileSync(path.join(userDirectory, 'hakuneko.settings'), JSON.stringify({
        baseDirectory: mangas,
        bookmarkDirectory: userDirectory
    }));
    const titles = ['The Father and the Daughter', 'One Piece', 'Solo Leveling', 'Tower of God', 'Omniscient Reader', 'Kimetsu no Yaiba', 'Jujutsu Kaisen', 'Chainsaw Man'];
    for (let index = 1; titles.length < SEED_TITLES; index++) {
        titles.push(`Sample Manga ${String(index).padStart(5, '0')}`);
    }
    fs.writeFileSync(
        path.join(userDirectory, `hakuneko.mangas.${SEED_CONNECTOR}`),
        JSON.stringify(titles.map((title, index) => ({ id: `/manga/${index}`, title })))
    );
}

export const test = base.extend({
    // One application per worker: the Electron start is the expensive part.
    app: [async ({}, use) => {
        const userDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'rakkomik-e2e-'));
        seedProfile(userDirectory);
        const electronApp = await electron.launch({
            executablePath: electronPath,
            args: [
                '.',
                '--update-url=DISABLED',
                `--cache-directory=${webDirectory}`,
                `--user-directory=${userDirectory}`
            ],
            cwd: root
        });
        const page = await electronApp.firstWindow();
        const external = [];
        page.on('request', request => {
            if (!/^(hakuneko|connector|data|blob|devtools|chrome-extension):/.test(request.url()) && !/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(request.url())) {
                external.push(request.url());
            }
        });
        await page.setViewportSize({ width: 1500, height: 960 });
        // the engine and the UI shell are ready when the connector picker is there
        await page.locator('input[aria-label="Website"]').waitFor({ timeout: 30000 });
        await use({ electronApp, page, userDirectory, external });
        // the window only quits once the UI answers the close request: do not hang on a broken UI
        const closed = electronApp.close().then(() => true, () => true);
        const forced = new Promise(resolve => setTimeout(() => resolve(false), 8000));
        if (!(await Promise.race([closed, forced]))) {
            electronApp.process().kill('SIGKILL');
        }
        fs.rmSync(userDirectory, { recursive: true, force: true });
    }, { scope: 'worker' }],

    page: async ({ app }, use) => {
        await use(app.page);
    }
});

/**
 * Reload the application and wait until the UI shell is interactive.
 */
export async function reload(page) {
    await page.reload();
    await page.locator('input[aria-label="Website"]').waitFor({ timeout: 30000 });
}

/**
 * Wait until all website connectors are registered (they load in the background).
 */
export async function connectorsReady(page) {
    await page.evaluate(() => Engine.ConnectorsReady);
}

export { expect };
