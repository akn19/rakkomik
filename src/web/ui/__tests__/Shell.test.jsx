import { act, fireEvent, screen, within } from '@testing-library/react';
import Shell from '../shell.jsx';
import { addChapter, addManga, createConnector, createDownloadJob, installBridge, installEngine } from './support/fakeEngine.js';
import { renderRouted } from './support/render.jsx';

let engine = null;
let bridge = null;

function frame() {
    return screen.getByRole('banner').parentElement;
}

// the Shell is the root of the application: it is rendered the way the router renders it
async function renderShell(options = {}) {
    const view = await renderRouted(<Shell />, { selection: false, ...options });
    // the manga list of the panel arrives a moment later: wait for it, so that nothing happens after the test
    await screen.findByText(/^Mangas: \d+ \/ \d+$/);
    return view;
}

function runningDownload() {
    const site = engine.Connectors[0];
    const chapter = addChapter(addManga(site, { title: 'Berserk' }), { title: 'Chapter 1' });
    engine.DownloadManager.queue[site.id] = [createDownloadJob(chapter, { status: 'downloading' })];
}

beforeEach(() => {
    engine = installEngine({ connectors: [createConnector({ id: 'site', label: 'Site' })] });
    bridge = installBridge();
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('theme', () => {
    it('should follow the operating system when nothing was chosen', async () => {
        vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true });
        await renderShell();
        expect(frame().classList.contains('dark')).toBe(true);
        expect(window.matchMedia).toHaveBeenCalledWith('(prefers-color-scheme: dark)');
    });

    it('should be light when the operating system is not dark', async () => {
        vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: false });
        await renderShell();
        expect(frame().classList.contains('dark')).toBe(false);
    });

    it('should be light when the browser cannot tell what the operating system prefers', async () => {
        vi.spyOn(window, 'matchMedia', 'get').mockReturnValue(undefined);
        await renderShell();
        expect(frame().classList.contains('dark')).toBe(false);
    });

    it.each([['dark', true], ['light', false]])('should prefer what was chosen (%s) to the operating system', async (stored, dark) => {
        vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: !dark });
        window.localStorage.setItem('rakkomik.theme', stored);
        await renderShell();
        expect(frame().classList.contains('dark')).toBe(dark);
    });

    it('should remember what the toggle switched to, and show the icon of the theme it switches to', async () => {
        vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: false });
        await renderShell();
        const toggle = screen.getByTitle('Toggle theme');
        expect(toggle.querySelector('svg').classList.contains('lucide-moon')).toBe(true);
        fireEvent.click(toggle);
        expect(frame().classList.contains('dark')).toBe(true);
        expect(window.localStorage.getItem('rakkomik.theme')).toBe('dark');
        expect(toggle.querySelector('svg').classList.contains('lucide-sun')).toBe(true);
        fireEvent.click(toggle);
        expect(frame().classList.contains('dark')).toBe(false);
        expect(window.localStorage.getItem('rakkomik.theme')).toBe('light');
    });

    it('should still switch when the choice cannot be stored, and when a stored choice cannot be read', async () => {
        vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true });
        // a storage of its own and not a spy on Storage.prototype: the storage of happy-dom binds a method to itself the
        // first time it is read, so the blocked methods would stay in the storage of every later test of this file
        const blocked = () => {
            throw new Error('storage is blocked');
        };
        vi.spyOn(window, 'localStorage', 'get').mockReturnValue({ getItem: blocked, setItem: blocked });
        await renderShell();
        expect(frame().classList.contains('dark')).toBe(true);
        fireEvent.click(screen.getByTitle('Toggle theme'));
        expect(frame().classList.contains('dark')).toBe(false);
    });
});

describe('window buttons', () => {
    it('should minimize and close the window through the bridge', async () => {
        await renderShell();
        fireEvent.click(screen.getByTitle('Minimize window'));
        fireEvent.click(screen.getByTitle('Close window'));
        expect(bridge.window.minimize).toHaveBeenCalledTimes(1);
        expect(bridge.window.close).toHaveBeenCalledTimes(1);
    });

    it('should maximize a window that is not maximized, and restore one that is', async () => {
        await renderShell();
        bridge.window.isMaximized.mockResolvedValueOnce(false);
        fireEvent.click(screen.getByTitle('Maximize window'));
        await vi.waitFor(() => expect(bridge.window.maximize).toHaveBeenCalledTimes(1));
        expect(bridge.window.unmaximize).not.toHaveBeenCalled();
        bridge.window.isMaximized.mockResolvedValueOnce(true);
        fireEvent.click(screen.getByTitle('Maximize window'));
        await vi.waitFor(() => expect(bridge.window.unmaximize).toHaveBeenCalledTimes(1));
        expect(bridge.window.maximize).toHaveBeenCalledTimes(1);
    });

    it('should not fail when the bridge of the window rejects', async () => {
        const unhandled = vi.fn();
        process.on('unhandledRejection', unhandled);
        bridge.window.minimize.mockRejectedValueOnce(new Error('window is gone'));
        await renderShell();
        fireEvent.click(screen.getByTitle('Minimize window'));
        await new Promise(resolve => setTimeout(resolve, 10));
        process.off('unhandledRejection', unhandled);
        expect(unhandled).not.toHaveBeenCalled();
    });

    it('should do nothing, and not fail, without a bridge', async () => {
        delete window.hakuneko;
        await renderShell();
        expect(() => {
            fireEvent.click(screen.getByTitle('Minimize window'));
            fireEvent.click(screen.getByTitle('Maximize window'));
            fireEvent.click(screen.getByTitle('Close window'));
        }).not.toThrow();
    });
});

describe('layout', () => {
    it('should show the content pane next to the panels while the reader is enabled', async () => {
        await renderShell();
        expect(document.querySelector('main')).not.toBeNull();
    });

    it('should leave the content pane out when the reader is disabled, and follow a change of that setting', async () => {
        engine.Settings.readerEnabled.value = false;
        await renderShell();
        expect(document.querySelector('main')).toBeNull();
        engine.Settings.readerEnabled.value = true;
        act(() => engine.Settings.emit('saved'));
        expect(document.querySelector('main')).not.toBeNull();
        engine.Settings.readerEnabled.value = false;
        act(() => engine.Settings.emit('saved'));
        expect(document.querySelector('main')).toBeNull();
    });

    it('should keep a gutter around the content, except where the reader fills the pane', async () => {
        await renderShell();
        expect(document.querySelector('main').classList.contains('p-4')).toBe(true);
        document.body.innerHTML = '';
        await renderShell({ url: '/reader', routes: [{ path: '/reader', element: <Shell /> }] });
        expect(document.querySelector('main').classList.contains('p-4')).toBe(false);
    });

    it('should open and close the menu with its button', async () => {
        await renderShell();
        expect(screen.queryByText('Views')).toBeNull();
        fireEvent.click(screen.getByTitle('Toggle menu'));
        expect(screen.getByText('Views')).toBeTruthy();
        fireEvent.click(screen.getByTitle('Toggle menu'));
        expect(screen.queryByText('Views')).toBeNull();
    });

    it('should close the menu when it asks to be closed', async () => {
        await renderShell();
        fireEvent.click(screen.getByTitle('Toggle menu'));
        fireEvent.click(screen.getByTitle('Close menu without saving settings'));
        expect(screen.queryByText('Views')).toBeNull();
    });
});

describe('closing the application', () => {
    function dialog() {
        return within(screen.getByText('Downloads are still in progress.').closest('.fixed'));
    }

    it('should quit at once when nothing is downloading', async () => {
        await renderShell();
        act(() => bridge.emit('close'));
        expect(bridge.send).toHaveBeenCalledExactlyOnceWith('quit');
        expect(screen.queryByText('Downloads are still in progress.')).toBeNull();
    });

    it('should ask first while a download is running, and quit when that is confirmed', async () => {
        runningDownload();
        await renderShell();
        act(() => bridge.emit('close'));
        expect(screen.getByText('Close application anyway?')).toBeTruthy();
        expect(bridge.send).not.toHaveBeenCalled();
        fireEvent.click(dialog().getByRole('button', { name: 'Close' }));
        expect(bridge.send).toHaveBeenCalledExactlyOnceWith('quit');
        expect(screen.queryByText('Downloads are still in progress.')).toBeNull();
    });

    it('should ask first while the only download is running, although the manager no longer holds it in its queue', async () => {
        await renderShell();
        const site = engine.Connectors[0];
        const chapter = addChapter(addManga(site, { title: 'Berserk' }), { title: 'Chapter 1' });
        const running = createDownloadJob(chapter, { status: 'queued' });
        // a job is announced when it is queued and when it starts, and the manager takes it out of its queue then
        act(() => engine.DownloadManager.emit('updated', running));
        running.status = 'downloading';
        act(() => engine.DownloadManager.emit('updated', running));
        expect(engine.DownloadManager.queue).toHaveLength(0);
        act(() => bridge.emit('close'));
        expect(screen.getByText('Downloads are still in progress.')).toBeTruthy();
        expect(bridge.send).not.toHaveBeenCalled();
    });

    it('should stay open when the question is declined, and ask again the next time', async () => {
        runningDownload();
        await renderShell();
        act(() => bridge.emit('close'));
        fireEvent.click(dialog().getByRole('button', { name: 'Cancel' }));
        expect(screen.queryByText('Downloads are still in progress.')).toBeNull();
        expect(bridge.send).not.toHaveBeenCalled();
        act(() => bridge.emit('close'));
        expect(screen.getByText('Downloads are still in progress.')).toBeTruthy();
    });

    it('should quit at once when the only download has already completed', async () => {
        runningDownload();
        engine.DownloadManager.queue.site[0].status = 'completed';
        await renderShell();
        act(() => bridge.emit('close'));
        expect(bridge.send).toHaveBeenCalledExactlyOnceWith('quit');
    });

    it('should stop listening for the close request when it goes away', async () => {
        const { unmount } = await renderShell();
        const listener = bridge.on.mock.calls.find(([channel]) => channel === 'close')[1];
        unmount();
        expect(bridge.off).toHaveBeenCalledWith('close', listener);
        act(() => bridge.emit('close'));
        expect(bridge.send).not.toHaveBeenCalled();
    });
});
