// Voratoon: the domain of the website is a setting, and the API is a proxy on that domain (/api/proxy), as the extension
// of Keiyoushi (id/voratoon) has it since 2026-10-23. The proxy answers 403 until the home page has set its cookie.

let Voratoon = null;

beforeAll(async () => {
    Voratoon = await import('../mjs/connectors/Voratoon.mjs');
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete globalThis.Engine;
});

const json = (data, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

/**
 * The website: its home page sets the cookie of the proxy, the proxy answers `routes` once the cookie is there.
 */
function createSite(routes = {}) {
    const site = { cookie: false, requests: [] };
    vi.stubGlobal(
        'fetch',
        vi.fn(async (request) => {
            const url = new URL(request.url);
            site.requests.push({ url: request.url, headers: request.headers });
            if (url.pathname === '/') {
                site.cookie = true;
                return new Response('<html></html>', { headers: { 'content-type': 'text/html' } });
            }
            if (!site.cookie) {
                return json({ message: 'Forbidden' }, 403);
            }
            const route = routes[url.pathname + url.search];
            return route ? json(route) : json({ message: 'Not found' }, 404);
        }),
    );
    return site;
}

function createConnector() {
    const listeners = {};
    globalThis.Engine = {
        Settings: {
            addEventListener: vi.fn((name, listener) => (listeners[name] = listener)),
            save: vi.fn(),
        },
    };
    const connector = new Voratoon.default();
    connector.wait = vi.fn(async () => undefined);
    return { connector, listeners };
}

const series = (slug, title) => ({ id: 1, data: { slug, title } });

describe('Voratoon', () => {
    it('should get the cookie of the proxy from the home page when the proxy refuses, and ask again', async () => {
        const site = createSite({
            '/api/proxy/series/solo-leveling': { data: series('solo-leveling', ' Solo Leveling ') },
        });
        const { connector } = createConnector();

        const data = await connector.fetchAPI('series/solo-leveling');

        expect(data.data.data.title).toBe(' Solo Leveling ');
        expect(site.requests.map(({ url }) => url)).toEqual([
            'https://voratoon.co/api/proxy/series/solo-leveling',
            'https://voratoon.co/',
            'https://voratoon.co/api/proxy/series/solo-leveling',
        ]);
        const { headers } = site.requests[2];
        expect(headers.get('accept')).toBe('application/json');
        expect(headers.get('x-sec-fetch-site')).toBe('same-origin');
        expect(headers.get('x-referer')).toBe('https://voratoon.co/');
        expect(headers.get('x-origin')).toBe('https://voratoon.co');
    });

    it('should ask the home page once only, and report a proxy that still refuses', async () => {
        const site = createSite();
        site.cookie = true;
        const { connector } = createConnector();

        await expect(connector.fetchAPI('series/missing')).rejects.toThrow(/status: 404/);
        expect(site.requests).toHaveLength(1);
    });

    it('should take the pages of the list until the last one, with a pause between them', async () => {
        createSite({
            '/api/proxy/series?take=100&page=1&includeMeta=true': {
                data: [series('a', 'A'), series('b', 'B ')],
                meta: { page: 1, lastPage: 2 },
            },
            '/api/proxy/series?take=100&page=2&includeMeta=true': {
                data: [series('c', 'C')],
                meta: { page: 2, lastPage: 2 },
            },
        });
        const { connector } = createConnector();

        const mangas = await connector._getMangas();

        expect(mangas).toEqual([
            { id: 'a', title: 'A' },
            { id: 'b', title: 'B' },
            { id: 'c', title: 'C' },
        ]);
        expect(connector.wait).toHaveBeenCalledTimes(1);
    });

    it('should follow the domain of the settings, for the API, the headers and the links', async () => {
        const site = createSite({
            '/api/proxy/series/a/chapters': { data: [{ data: { index: 1, title: 'Awal' } }] },
        });
        const { connector, listeners } = createConnector();

        connector.config.url.value = 'https://voratoon.net/ ';
        listeners.saved();
        const chapters = await connector._getChapters({ id: 'a' });

        expect(chapters).toEqual([{ id: 1, title: 'Chapter 1 Awal' }]);
        expect(site.requests.at(-1).url).toBe('https://voratoon.net/api/proxy/series/a/chapters');
        expect(site.requests.at(-1).headers.get('x-origin')).toBe('https://voratoon.net');
        expect(connector.canHandleURI(new URL('https://voratoon.net/series/a'))).toBe(true);
        expect(connector.canHandleURI(new URL('https://v9.voratoon.com/series/a'))).toBe(true);
        expect(connector.canHandleURI(new URL('https://example.com/series/a'))).toBe(false);
    });
});
