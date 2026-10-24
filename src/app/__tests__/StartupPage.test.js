// @vitest-environment happy-dom
// The page of the window while the update is checked (App.startupPage): what it says for every step that
// Updater.updateCache reports, and how its progress bar shows it.
const App = require('../App');

function open(version = '1.2.4') {
    const html = App.startupPage(version);
    document.body.innerHTML = html.match(/<body>([\s\S]*?)<script>/)[1];
    (0, eval)(html.match(/<script>([\s\S]*?)<\/script>/)[1]);
    const element = (id) => document.getElementById(id);
    return {
        html,
        show: (step) => window.showStatus(step),
        status: () => element('status').textContent,
        detail: () => element('detail').textContent,
        state: () => element('startup').className,
        bar: element('bar'),
        fill: element('fill'),
    };
}

// a web part is named after the time of its build, in base 36 (deploy-web.js)
const BUILT = new Date(2026, 9, 24, 16, 32).getTime();
const VERSION = BUILT.toString(36).toUpperCase();
const MB = 1048576;

describe('the page of the start', () => {
    it('should name the application and its version, in a document that a screen reader can follow', () => {
        const page = open('1.2.4');
        expect(page.html).toContain('<html lang="en">');
        expect(page.html).toContain('<title>RakKomik</title>');
        expect(document.querySelector('h1').textContent).toBe('RakKomik');
        expect(document.querySelector('.version').textContent).toBe('Version 1.2.4');
        expect(
            document.querySelector('[role="status"]').contains(document.getElementById('status')),
        ).toBe(true);
        expect(page.bar.getAttribute('role')).toBe('progressbar');
        expect(page.bar.getAttribute('aria-label')).toBe('Progress');
        expect(page.status()).toBe('Starting');
        expect(page.state()).toBe('busy');
    });

    it('should say that it checks for updates, without a known progress', () => {
        const page = open();
        page.show({ stage: 'checking' });
        expect(page.status()).toBe('Checking for updates');
        expect(page.detail()).toMatch(/update server/);
        expect(page.state()).toBe('busy');
        expect(page.bar.hasAttribute('aria-valuenow')).toBe(false);
    });

    it('should name an update after the time of its build', () => {
        const page = open();
        page.show({ stage: 'current', version: VERSION });
        expect(page.status()).toBe('Up to date');
        expect(page.detail()).toBe('Installed: update of 24 Oct 2026, 16:32');
        expect(page.state()).toBe('done');
        expect(page.bar.getAttribute('aria-valuenow')).toBe('100');
    });

    it('should name an update by its version when that is not a time', () => {
        const page = open();
        page.show({ stage: 'installing', version: 'NEW' });
        expect(page.detail()).toBe('Update NEW');
        page.show({ stage: 'current' });
        expect(page.detail()).toBe('Installed: the update');
    });

    it('should show how much of a download arrived, when the server tells the size', () => {
        const page = open();
        page.show({ stage: 'downloading', version: VERSION, received: 1 * MB, total: 4 * MB });
        expect(page.status()).toBe('Downloading the update of 24 Oct 2026, 16:32');
        expect(page.detail()).toBe('1.0 MB of 4.0 MB (25%)');
        expect(page.state()).toBe('');
        expect(page.fill.style.width).toBe('25%');
        expect(page.bar.getAttribute('aria-valuenow')).toBe('25');
    });

    it('should show what arrived of a download of an unknown size, without a progress', () => {
        const page = open();
        page.show({ stage: 'downloading', version: VERSION, received: 0, total: 0 });
        expect(page.detail()).toBe('Connecting');
        page.show({ stage: 'downloading', version: VERSION, received: 2 * MB, total: 0 });
        expect(page.detail()).toBe('2.0 MB');
        expect(page.state()).toBe('busy');
        expect(page.fill.style.width).toBe('');
        expect(page.bar.hasAttribute('aria-valuenow')).toBe(false);
    });

    it('should say that it verifies and installs the update', () => {
        const page = open();
        page.show({ stage: 'verifying', version: VERSION });
        expect([page.status(), page.detail()]).toEqual([
            'Verifying the download',
            'Checking the signature of the update of 24 Oct 2026, 16:32',
        ]);
        page.show({ stage: 'installing', version: VERSION });
        expect([page.status(), page.detail()]).toEqual([
            'Installing the update',
            'Update of 24 Oct 2026, 16:32',
        ]);
        page.show({ stage: 'updated', version: VERSION });
        expect([page.status(), page.state()]).toEqual(['Updated', 'done']);
    });

    it('should say why an update failed, and that the installed version starts', () => {
        const page = open();
        page.show({ stage: 'failed', message: 'getaddrinfo ENOTFOUND github.com' });
        expect(page.status()).toBe('The update failed');
        expect(page.detail()).toBe(
            'getaddrinfo ENOTFOUND github.com. RakKomik starts with the installed version.',
        );
        expect(page.state()).toBe('failed');
    });

    it('should say that the updates are switched off, and that the application starts', () => {
        const page = open();
        page.show({ stage: 'disabled' });
        expect([page.status(), page.detail()]).toEqual(['Starting', 'Updates are switched off']);
        page.show({ stage: 'starting' });
        expect([page.status(), page.detail(), page.state()]).toEqual([
            'Starting RakKomik',
            '',
            'busy',
        ]);
    });

    it('should show the text of a message as text', () => {
        const page = open();
        page.show({ stage: 'failed', message: '<img src=x onerror=alert(1)>' });
        expect(document.querySelector('#detail img')).toBeNull();
        expect(page.detail()).toContain('<img src=x onerror=alert(1)>');
    });
});
