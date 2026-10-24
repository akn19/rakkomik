// WestManga (v1.westmanga.my): the API and the images answer the pages of the website only, with the visit token that
// the website gives them. The scripts that the connector sends to a page run here against a site that answers like the
// real one did on 2026-10-24: a check of Cloudflare until it is passed, the token, a limit of the requests.

let WestManga = null;

beforeAll(async () => {
    WestManga = await import('../mjs/connectors/WestManga.mjs');
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete globalThis.Engine;
});

const SITE = 'https://v1.westmanga.my';
const TOKEN = 'v1.MTIzfDEyNy4wLjAuMXwxNzkyODM1MDgy.c2lnbmF0dXJl';
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const json = (data, status = 200, headers = {}) =>
    new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json', ...headers },
    });

const challenge = () =>
    new Response('<title>Just a moment...</title>', {
        status: 403,
        headers: { 'content-type': 'text/html', 'cf-mitigated': 'challenge' },
    });

/**
 * The website as the pages see it. `passed` is whether the check of Cloudflare was passed, `routes` answers the paths of
 * the API (the token is checked first), `requests` keeps what the pages sent.
 */
function createSite({ passed = true, routes = {} } = {}) {
    const site = { passed, requests: [], tokens: 0 };
    site.fetch = vi.fn(async (input, init = {}) => {
        const path = String(input).replace(SITE, '');
        const headers = new Headers(init.headers);
        site.requests.push({ path, method: init.method || 'GET', headers, body: init.body });
        if (!site.passed) {
            return challenge();
        }
        if (path === '/api/visit-token') {
            site.tokens++;
            return json({ status: true, token: TOKEN + site.tokens, expires_at: 1792835082 });
        }
        if (path.startsWith('/img/')) {
            return new Response(new Uint8Array(PNG), { headers: { 'content-type': 'image/png' } });
        }
        if (!headers.get('X-WM-Visit')?.startsWith(TOKEN)) {
            return new Response('', { status: 404 });
        }
        const route = Object.keys(routes).find((prefix) => path.startsWith('/api/' + prefix));
        return route ? routes[route](path, headers, init) : new Response('', { status: 404 });
    });
    return site;
}

/**
 * The engine: fetchUI runs the script of the connector "in the page", against the site, and passing the check on the
 * home page is what passes it.
 */
function createEngine(site) {
    vi.stubGlobal('fetch', site.fetch);
    // a new manga tells the page about its status
    vi.stubGlobal('document', { dispatchEvent: vi.fn() });
    vi.stubGlobal('EventListener', { onMangaStatusChanged: 'onMangaStatusChanged' });
    const fetchUI = vi.fn(async (request, script) => {
        if (script === 'true') {
            site.passed = true;
            return true;
        }
        return (0, eval)(script);
    });
    globalThis.Engine = {
        Settings: { addEventListener: vi.fn() },
        Storage: { sanatizePath: (title) => title },
        Request: { fetchUI, challengeTimeout: 60000 },
    };
    return fetchUI;
}

const comic = (slug, title) => ({ slug, title });

describe('the API of WestManga', () => {
    it('should ask the API from a light page of the website, with the visit token of the website', async () => {
        const site = createSite({
            routes: {
                'comic/solo-leveling': () =>
                    json({ data: { title: 'Solo Leveling Bahasa Indonesia' } }),
            },
        });
        const fetchUI = createEngine(site);
        const connector = new WestManga.default();

        const manga = await connector._getMangaFromURI(new URL(SITE + '/comic/solo-leveling'));

        expect(manga.id).toBe('solo-leveling');
        expect(manga.title).toBe('Solo Leveling');
        expect(fetchUI).toHaveBeenCalledTimes(1);
        expect(fetchUI.mock.calls[0][0].url).toBe(SITE + '/robots.txt');
        const request = site.requests.find(({ path }) => path === '/api/comic/solo-leveling');
        expect(request.headers.get('X-WM-Visit')).toBe(TOKEN + 1);
        expect(request.headers.has('Authorization')).toBe(false);
    });

    it('should pass the check of the website on its home page, with the images, before it asks again', async () => {
        const site = createSite({
            passed: false,
            routes: { 'comic/solo-leveling': () => json({ data: { title: 'Solo Leveling' } }) },
        });
        const fetchUI = createEngine(site);
        const connector = new WestManga.default();

        await connector._getMangaFromURI(new URL(SITE + '/comic/solo-leveling'));

        expect(fetchUI).toHaveBeenCalledTimes(3);
        const [request, script, timeout, images] = fetchUI.mock.calls[1];
        expect([request.url, script, timeout, images]).toEqual([SITE + '/', 'true', 60000, true]);
        expect(fetchUI.mock.calls[2][0].url).toBe(SITE + '/robots.txt');
    });

    it('should report a check that is still there after it was passed', async () => {
        const site = createSite({ passed: false });
        const fetchUI = createEngine(site);
        fetchUI.mockImplementation(async (request, script) =>
            script === 'true' ? true : (0, eval)(script),
        );
        const connector = new WestManga.default();

        await expect(connector.fetchAPI('comic/solo-leveling')).rejects.toThrow(
            /check of the website/,
        );
        expect(fetchUI).toHaveBeenCalledTimes(3);
    });

    it('should fetch a new token when the API says that it is no longer valid, and ask again', async () => {
        let calls = 0;
        const site = createSite({
            routes: {
                'comic/solo-leveling': () =>
                    ++calls === 1
                        ? json({ status: false }, 403, { 'X-WM-Visit-Error': 'expired' })
                        : json({ data: { title: 'Solo Leveling' } }),
            },
        });
        createEngine(site);
        const connector = new WestManga.default();

        const { data } = await connector.fetchAPI('comic/solo-leveling');

        expect(data.title).toBe('Solo Leveling');
        const tokens = site.requests
            .filter(({ path }) => path === '/api/comic/solo-leveling')
            .map(({ headers }) => headers.get('X-WM-Visit'));
        expect(tokens).toEqual([TOKEN + 1, TOKEN + 2]);
    });

    it('should stop at the limit of the requests and say when to try again, without asking again', async () => {
        const site = createSite({
            routes: {
                contents: () =>
                    json({ message: 'Too many requests, please slow down.', status: false }, 429, {
                        'retry-after': '3600',
                    }),
            },
        });
        createEngine(site);
        const connector = new WestManga.default();

        await expect(connector._getMangas()).rejects.toThrow(
            'WestManga limits the requests, try again in 60 minutes',
        );
        expect(site.requests.filter(({ path }) => path.startsWith('/api/contents'))).toHaveLength(
            1,
        );
    });

    it('should give the error of the API with its message', async () => {
        const site = createSite({
            routes: { 'comic/missing': () => json({ message: 'Not found', status: false }, 404) },
        });
        createEngine(site);
        const connector = new WestManga.default();

        await expect(connector.fetchAPI('comic/missing')).rejects.toThrow(
            /status: 404\) - Not found/,
        );
    });

    it('should follow the domain of the settings, and still take the links of the earlier domains', async () => {
        const site = createSite({
            routes: { 'comic/solo-leveling': () => json({ data: { title: 'Solo Leveling' } }) },
        });
        const fetchUI = createEngine(site);
        const connector = new WestManga.default();
        connector.config.url.value = 'https://v2.westmanga.my/ ';

        await connector.fetchAPI('comic/solo-leveling');

        expect(fetchUI.mock.calls[0][0].url).toBe('https://v2.westmanga.my/robots.txt');
        expect(connector.canHandleURI(new URL('https://v2.westmanga.my/comic/a'))).toBe(true);
        expect(connector.canHandleURI(new URL('https://v1.westmanga.cc/comic/a'))).toBe(true);
        expect(connector.canHandleURI(new URL('https://example.com/comic/a'))).toBe(false);
    });
});

describe('the content of WestManga', () => {
    it('should collect the comics of all pages of the list in one window, without "Bahasa Indonesia"', async () => {
        const pages = [
            [
                comic('solo-leveling', 'Solo Leveling Bahasa Indonesia'),
                comic('one-piece', 'One Piece'),
            ],
            [comic('tower-of-god', 'Tower of God bahasa indonesia')],
        ];
        const site = createSite({
            routes: {
                contents: (path) => {
                    const query = new URL(path, SITE).searchParams;
                    const page = Number(query.get('page'));
                    expect([query.get('per_page'), query.get('type')]).toEqual(['25', 'Comic']);
                    return json({
                        data: pages[page - 1],
                        paginator: { current_page: page, last_page: 2 },
                    });
                },
            },
        });
        const fetchUI = createEngine(site);
        const connector = new WestManga.default();

        const mangas = await connector._getMangas();

        expect(mangas).toEqual([
            { id: 'solo-leveling', title: 'Solo Leveling' },
            { id: 'one-piece', title: 'One Piece' },
            { id: 'tower-of-god', title: 'Tower of God' },
        ]);
        expect(fetchUI).toHaveBeenCalledTimes(1);
        expect(fetchUI.mock.calls[0][2]).toBe(15 * 60 * 1000);
    });

    it('should name the chapters after their number', async () => {
        const site = createSite({
            routes: {
                'comic/solo-leveling': () =>
                    json({
                        data: {
                            chapters: [
                                { slug: 'solo-leveling-chapter-179-5', number: '179.5' },
                                {
                                    slug: 'solo-leveling-chapter-spesial',
                                    number: 'Chapter Spesial',
                                },
                            ],
                        },
                    }),
            },
        });
        createEngine(site);
        const connector = new WestManga.default();

        const chapters = await connector._getChapters({ id: 'solo-leveling' });

        expect(chapters).toEqual([
            { id: 'solo-leveling-chapter-179-5', title: 'Chapter 179.5' },
            { id: 'solo-leveling-chapter-spesial', title: 'Chapter Spesial' },
        ]);
    });

    it('should hand out the images as links of the connector, and read them in a page of the website', async () => {
        const site = createSite({
            routes: {
                'v/solo-leveling-chapter-1': () =>
                    json({
                        data: {
                            images: [
                                '/img/solo-leveling/1.png',
                                'https://v1.westmanga.my/img/2.png',
                            ],
                        },
                    }),
            },
        });
        const fetchUI = createEngine(site);
        const connector = new WestManga.default();

        const pages = await connector._getPages({ id: 'solo-leveling-chapter-1' });
        expect(pages.every((page) => page.startsWith('connector://westmanga'))).toBe(true);

        const image = await connector.handleConnectorURI(new URL(pages[0]));

        expect(image.mimeType).toBe('image/png');
        expect(Array.from(image.data)).toEqual(PNG);
        expect(site.requests.at(-1).path).toBe('/img/solo-leveling/1.png');
        expect(fetchUI.mock.calls.at(-1)[0].url).toBe(SITE + '/robots.txt');
    });
});

describe('the login of WestManga', () => {
    it('should log in from a page of the website and send the token of the login with the requests', async () => {
        let login;
        const site = createSite({
            routes: {
                'auth/login': (path, headers, init) => {
                    login = {
                        method: init.method,
                        type: headers.get('Content-Type'),
                        body: JSON.parse(init.body),
                    };
                    return json({
                        status: true,
                        data: { access_token: 'access', refresh_token: 'refresh' },
                    });
                },
                'comic/solo-leveling': () => json({ data: { title: 'Solo Leveling' } }),
            },
        });
        createEngine(site);
        const connector = new WestManga.default();

        await connector._login('reader@example.com', 'pass "word"');
        await connector.fetchAPI('comic/solo-leveling');

        expect(login).toEqual({
            method: 'POST',
            type: 'application/json',
            body: { email: 'reader@example.com', password: 'pass "word"' },
        });
        expect(connector.token).toBe('access');
        const request = site.requests.find(({ path }) => path === '/api/comic/solo-leveling');
        expect(request.headers.get('Authorization')).toBe('Bearer access');
    });

    it('should not log in without an email and a password, and report a refused login', async () => {
        const site = createSite({
            routes: {
                'auth/login': () =>
                    json({ message: 'Invalid username or password', status: false }, 403),
            },
        });
        const fetchUI = createEngine(site);
        const connector = new WestManga.default();

        await connector._login('', '');
        expect(fetchUI).not.toHaveBeenCalled();

        await expect(connector._login('reader@example.com', 'wrong')).rejects.toThrow(
            /Invalid username or password/,
        );
        expect(connector.token).toBeUndefined();
    });
});
