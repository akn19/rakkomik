// Connector registry contract: system connectors register at once, website
// connectors load in the background (batched, concurrent imports) and every
// stage is observable (`registered` per batch, `ready` when done).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let Connectors = null;
let dir = null;

function connectorModule(file, source) {
    const target = path.join(dir, file);
    fs.writeFileSync(target, source);
    return pathToFileURL(target).href;
}

function simple(file, id, label) {
    return connectorModule(file, `export default class { constructor() { this.id = '${id}'; this.label = '${label}'; } }`);
}

function registry() {
    return new Connectors({ listen: vi.fn() });
}

beforeAll(async () => {
    Connectors = (await import('../mjs/engine/Connectors.mjs')).default;
});

beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rk-connectors-'));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
});

describe('connector registry', () => {
    it('should register and sort connectors by label', async () => {
        const connectors = registry();
        await connectors.register([simple('b.mjs', 'b', 'Beta'), simple('a.mjs', 'a', 'alpha'), simple('c.mjs', 'c', 'Gamma')]);
        expect(connectors.list.map(connector => connector.id)).toEqual(['a', 'b', 'c']);
    });

    it('should skip broken modules and constructors, and keep the first of duplicate IDs', async () => {
        const connectors = registry();
        await connectors.register([
            simple('one.mjs', 'x', 'First'),
            connectorModule('broken.mjs', 'export default class {'),
            connectorModule('throws.mjs', 'export default class { constructor() { throw new Error("boom"); } }'),
            simple('two.mjs', 'x', 'Second')
        ]);
        expect(connectors.list.map(connector => connector.label)).toEqual(['First']);
        expect(console.warn).toHaveBeenCalledTimes(3);
    });

    it('should announce every batch with the sorted list', async () => {
        const connectors = registry();
        const seen = [];
        connectors.addEventListener('registered', event => seen.push(event.detail.length));
        const files = Array.from({ length: 130 }, (_, index) => simple(`c${index}.mjs`, `id${index}`, `C${String(index).padStart(3, '0')}`));
        await connectors.register(files);
        expect(seen).toEqual([128, 130]);
        expect(connectors.list[0].label).toBe('C000');
    });

    it('should load in the background, let user plugins win and announce ready once', async () => {
        const connectors = registry();
        const user = simple('user.mjs', 'dup', 'User Version');
        const internal = [simple('dup.mjs', 'dup', 'Internal Version'), simple('other.mjs', 'other', 'Other')];
        vi.spyOn(connectors, '_loadPlugins').mockImplementation(async uri => (uri.includes('plugins') ? [user] : internal));
        const ready = vi.fn();
        connectors.addEventListener('ready', ready);
        expect(connectors.isReady).toBe(false);
        await connectors.load();
        expect(connectors.isReady).toBe(true);
        expect(ready).toHaveBeenCalledTimes(1);
        await expect(connectors.ready).resolves.toBe(connectors.list);
        expect(connectors.list.map(connector => connector.label)).toEqual(['Other', 'User Version']);
    });

    it('should hold connector:// requests until their connector is registered', async () => {
        const ipc = { listen: vi.fn() };
        const connectors = new Connectors(ipc);
        const handler = ipc.listen.mock.calls[0][1];
        const late = connectorModule('late.mjs', `export default class { constructor() { this.id = 'late'; this.label = 'Late'; } handleConnectorURI(uri) { return 'handled ' + uri.pathname; } }`);
        vi.spyOn(connectors, '_loadPlugins').mockImplementation(async uri => (uri.includes('plugins') ? [] : [late]));
        const pending = handler({ url: 'connector://late/image.png' });
        await connectors.load();
        await expect(pending).resolves.toBe('handled /image.png');
    });

    it('should answer unknown connector:// requests once everything is loaded', async () => {
        const ipc = { listen: vi.fn() };
        const connectors = new Connectors(ipc);
        vi.spyOn(connectors, '_loadPlugins').mockResolvedValue([]);
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        await connectors.load();
        await expect(ipc.listen.mock.calls[0][1]({ url: 'connector://nobody/x' })).resolves.toBeUndefined();
    });
});
