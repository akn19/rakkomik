// Bridge contract tests: engine.js reads window.Engine without importing it.
let bridge = null;

beforeAll(async () => {
    bridge = await import('../ui/engine.js');
});

function fakeEngine(overrides) {
    globalThis.window = Object.assign({}, globalThis.window, {
        Engine: Object.assign({
            Connectors: [{ id: 'a' }, { id: 'b' }],
            Settings: {
                frontend: {
                    value: 'frontend@react',
                    options: [
                        { value: 'frontend@classic-light', name: 'Classic (Light)' },
                        { value: 'frontend@react', name: 'React (Beta)' }
                    ]
                }
            },
            Version: {
                branch: { label: 'main' },
                revision: { label: 'a1965c' }
            }
        }, overrides)
    });
}

afterEach(() => {
    delete globalThis.window.Engine;
});

describe('ui engine bridge', () => {
    it('should snapshot connector count, frontend label and version', () => {
        fakeEngine();
        expect(bridge.getEngineStatus()).toEqual({
            connectors: 2,
            frontend: 'React (Beta)',
            version: 'main@a1965c'
        });
    });

    it('should fall back to the raw value for unknown frontends', () => {
        fakeEngine({ Settings: { frontend: { value: 'frontend@x', options: [] } } });
        expect(bridge.getEngineStatus().frontend).toBe('frontend@x');
    });

    it('should degrade to empties when the engine global is missing', () => {
        expect(bridge.getEngineStatus()).toEqual({ connectors: 0, frontend: '', version: '' });
    });

    it('should subscribe to bookmark manager events and read live bookmarks', () => {
        const listeners = {};
        const bookmarks = [{ key: { manga: 'm1', connector: 'c1' }, title: { manga: 'M1', connector: 'C1' } }];
        fakeEngine({
            BookmarkManager: {
                bookmarks,
                addEventListener: jest.fn((event, handler) => {
                    listeners[event] = handler;
                }),
                removeEventListener: jest.fn(),
                deleteBookmark: jest.fn(() => true)
            }
        });
        const notify = jest.fn();
        const unsubscribe = bridge.subscribeBookmarks(notify);
        expect(bridge.getBookmarks()).toBe(bookmarks);
        listeners.added();
        expect(notify).toHaveBeenCalledTimes(1);
        expect(bridge.deleteBookmark(bookmarks[0])).toBe(true);
        unsubscribe();
    });

    it('should roundtrip a settings draft through save with numeric clamping', async () => {
        const text = { input: 'text', label: 'T', value: 'hello' };
        const numeric = { input: 'numeric', label: 'N', value: 5, min: 1, max: 10 };
        const saved = [];
        fakeEngine({
            Settings: {
                getCategorizedSettings: () => [{ category: 'General', settings: [text, numeric] }],
                save: jest.fn(async () => {
                    saved.push([text.value, numeric.value]);
                })
            }
        });
        const draft = bridge.getSettingsDraft();
        expect(draft).toHaveLength(1);
        draft[0].items[0].value = 'world';
        draft[0].items[1].value = 99;
        await bridge.saveSettingsDraft(draft);
        expect(text.value).toBe('world');
        expect(numeric.value).toBe(10);
        expect(saved).toEqual([['world', 10]]);
    });

    it('should browse directories and files through the available bridges', async () => {
        fakeEngine({
            Storage: { folderBrowser: jest.fn(async () => '/tmp/manga') }
        });
        await expect(bridge.browseDirectory('/tmp')).resolves.toBe('/tmp/manga');
        globalThis.window.hakuneko = {
            dialog: { showOpenDialog: jest.fn(async () => ({ canceled: false, filePaths: ['/tmp/a.epub'] })) }
        };
        await expect(bridge.browseFile()).resolves.toBe('/tmp/a.epub');
        delete globalThis.window.hakuneko;
    });
});
