// Progress of a manga list update: while a connector updates, the fetch helpers of the base class count
// the requests they complete; the progress ends together with the update.
let Connector = null;

beforeAll(async () => {
    Connector = (await import('../mjs/engine/Connector.mjs')).default;
});

afterEach(() => {
    vi.unstubAllGlobals();
    delete globalThis.Engine;
});

function site() {
    const connector = new Connector();
    connector.id = 'site';
    connector.label = 'Site';
    connector.url = 'https://site.test';
    connector.initialized = true; // no browser window for the initialization
    return connector;
}

function respond(status, body, type) {
    return new Response(body, { status, headers: { 'content-type': type } });
}

describe('isUpdating', () => {
    it('should start and end the progress of an update', () => {
        const connector = site();
        expect(connector.isUpdating).toBe(false);
        expect(connector.updateProgress).toBeUndefined();
        connector.isUpdating = true;
        expect(connector.isUpdating).toBe(true);
        expect(connector.updateProgress).toEqual({ requests: 0, startedAt: expect.any(Number) });
        connector.isUpdating = false;
        expect(connector.isUpdating).toBe(false);
        expect(connector.updateProgress).toBeUndefined();
    });
});

describe('request counting', () => {
    function stubFetch() {
        const fetch = vi.fn(async request => {
            const url = typeof request === 'string' ? request : request.url;
            if (url.endsWith('/json')) {
                return respond(200, '[1]', 'application/json');
            }
            if (url.endsWith('/html')) {
                return respond(200, '<p></p>', 'text/html');
            }
            if (url.endsWith('/flaky')) {
                return fetch.mock.calls.filter(call => /\/flaky$/.test(typeof call[0] === 'string' ? call[0] : call[0].url)).length > 1
                    ? respond(200, '<p></p>', 'text/html')
                    : respond(503, '', 'text/html');
            }
            return respond(200, 'x1 x2 x3', 'text/plain');
        });
        vi.stubGlobal('fetch', fetch);
        return fetch;
    }

    it('should count every request the fetch helpers complete during an update', async () => {
        stubFetch();
        const connector = site();
        connector.createDOM = () => ({ querySelectorAll: () => [ 'a', 'b' ] });
        connector.isUpdating = true;

        await connector.fetchJSON('https://site.test/json');
        expect(connector.updateProgress.requests).toBe(1);
        await connector.fetchDOM('https://site.test/html', 'p');
        expect(connector.updateProgress.requests).toBe(2);
        await expect(connector.fetchRegex(new Request('https://site.test/text'), /x(\d)/g)).resolves.toEqual([ '1', '2', '3' ]);
        expect(connector.updateProgress.requests).toBe(3);
        // built on fetchJSON: one request, whatever the answer means
        await connector.fetchGraphQL('https://site.test/json', 'operation', 'query', {}).catch(() => undefined);
        expect(connector.updateProgress.requests).toBe(4);
    });

    it('should count a retried request every time it is sent', async () => {
        stubFetch();
        const connector = site();
        connector.createDOM = () => ({ querySelectorAll: () => [] });
        connector.wait = async () => undefined;
        connector.isUpdating = true;
        await connector.fetchDOM('https://site.test/flaky', 'p', 1);
        expect(connector.updateProgress.requests).toBe(2);
    });

    it('should count a failed request as well', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => {
            throw new Error('offline');
        }));
        const connector = site();
        connector.isUpdating = true;
        await expect(connector.fetchJSON('https://site.test/json')).rejects.toThrow('offline');
        expect(connector.updateProgress.requests).toBe(1);
    });

    it('should not track anything while the connector is idle', async () => {
        stubFetch();
        const connector = site();
        await connector.fetchJSON('https://site.test/json');
        expect(connector.updateProgress).toBeUndefined();
        expect(connector.isUpdating).toBe(false);
    });
});

describe('updateMangas', () => {
    it('should report the requests of the update while it runs and nothing afterwards', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => respond(200, '[{"id":"b","title":"B"},{"id":"a","title":"A"}]', 'application/json')));
        globalThis.Engine = { Storage: { saveMangaList: vi.fn(async () => undefined) } };
        const connector = site();
        const seen = [];
        connector._getMangas = async function() {
            const mangas = [];
            for (let page = 1; page <= 3; page++) {
                mangas.push(...await this.fetchJSON('https://site.test/list?page=' + page));
                seen.push(this.updateProgress.requests);
            }
            return mangas;
        };

        // getMangas runs after the list is saved, when the update (and its progress) is over
        const afterwards = await new Promise(resolve => {
            connector.getMangas = () => resolve({ updating: connector.isUpdating, progress: connector.updateProgress });
            connector.updateMangas(() => undefined);
        });

        expect(seen).toEqual([ 1, 2, 3 ]);
        expect(afterwards).toEqual({ updating: false, progress: undefined });
        expect(Engine.Storage.saveMangaList).toHaveBeenCalledWith('site', [ { id: 'a', title: 'A' }, { id: 'b', title: 'B' } ]);
    });

    it('should end the progress when the update fails', async () => {
        const connector = site();
        connector._getMangas = async () => {
            throw new Error('site down');
        };
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const state = await new Promise(resolve => {
            connector.updateMangas(error => resolve({ message: error.message, updating: connector.isUpdating, progress: connector.updateProgress }));
        });
        expect(state).toEqual({ message: 'site down', updating: false, progress: undefined });
    });
});
