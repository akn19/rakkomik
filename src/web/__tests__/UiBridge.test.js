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
});
