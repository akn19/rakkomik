// How the page starts the interface: `index.html` calls `mountReactShell` once the engine is loaded.
import { act } from '@testing-library/react';
import { mountReactShell } from '../main.jsx';
import { createConnector, installBridge, installEngine } from './support/fakeEngine.js';

let engine = null;
let container = null;

// counts how many listeners of each kind are left, for every object of the engine that has events
function listening() {
    const counts = {};
    for (const [name, target] of [
        ['downloads', engine.DownloadManager],
        ['settings', engine.Settings],
        ['bookmarks', engine.BookmarkManager],
        ['chaptermarks', engine.ChaptermarkManager],
        ['registry', engine.ConnectorRegistry],
    ]) {
        const added = vi.spyOn(target, 'addEventListener');
        const removed = vi.spyOn(target, 'removeEventListener');
        counts[name] = { added, removed };
    }
    return counts;
}

beforeEach(() => {
    engine = installEngine({ connectors: [createConnector({ id: 'site', label: 'Site' })] });
    installBridge();
    container = document.createElement('div');
    document.body.appendChild(container);
});

afterEach(() => {
    container.remove();
    vi.restoreAllMocks();
});

describe('mounting the interface', () => {
    it('should draw the application into the container that it is given', async () => {
        await act(async () => {
            mountReactShell(container);
        });
        expect(container.querySelector('header')).not.toBeNull();
        expect(container.textContent).toContain('Manga List');
        expect(container.textContent).toContain('Chapter List');
    });

    it('should hand back the function that takes it away again', async () => {
        let unmount = null;
        await act(async () => {
            unmount = mountReactShell(container);
        });
        expect(unmount).toBeTypeOf('function');
        await act(async () => {
            unmount();
        });
        expect(container.innerHTML).toBe('');
    });

    it('should leave no listener behind on the engine when it is taken away, although strict mode mounts everything twice', async () => {
        const counts = listening();
        let unmount = null;
        await act(async () => {
            unmount = mountReactShell(container);
        });
        await act(async () => {
            unmount();
        });
        // the list of the download jobs follows the manager for as long as the page lives (engine.js): that one listener stays
        const permanent = { downloads: ['updated'] };
        for (const [name, { added, removed }] of Object.entries(counts)) {
            const adds = added.mock.calls.map(([event]) => event).sort();
            for (const event of permanent[name] || []) {
                adds.splice(adds.indexOf(event), 1);
            }
            const removes = removed.mock.calls.map(([event]) => event).sort();
            expect({ name, events: removes }).toEqual({ name, events: adds });
        }
        // and the engine was listened to at all
        expect(counts.downloads.added).toHaveBeenCalled();
        expect(counts.settings.added).toHaveBeenCalled();
    });

    it('should be able to start again in a container after it was taken away', async () => {
        let unmount = null;
        await act(async () => {
            unmount = mountReactShell(container);
        });
        await act(async () => {
            unmount();
        });
        await act(async () => {
            unmount = mountReactShell(container);
        });
        expect(container.querySelector('header')).not.toBeNull();
        await act(async () => {
            unmount();
        });
    });
});
