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
function createEngine(site, { stored } = {}) {
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
        Storage: {
            sanatizePath: (title) => title,
            // the list of the last update; none before the first one
            loadMangaList: vi.fn(async () =>
                stored ? stored : Promise.reject(new Error('no list')),
            ),
        },
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
    /**
     * The list of the site: `catalog` in A-Z order, `added` the slugs in the order they were added (the newest first).
     * `limitAfter` answers 429 after so many requests of the list.
     */
    function listingSite({
        catalog,
        added = catalog.map(({ slug }) => slug),
        limitAfter = Infinity,
    }) {
        const asked = [];
        const site = createSite({
            routes: {
                contents: (path) => {
                    const query = new URL(path, SITE).searchParams;
                    const page = Number(query.get('page'));
                    const order = query.get('orderBy');
                    asked.push(`${order} ${page}`);
                    expect([query.get('per_page'), query.get('type')]).toEqual(['25', 'Comic']);
                    if (asked.length > limitAfter) {
                        return json({ message: 'Too many requests, please slow down.' }, 429, {
                            'retry-after': '3600',
                        });
                    }
                    const ordered =
                        order === 'Added'
                            ? added.map((slug) => catalog.find((entry) => entry.slug === slug))
                            : catalog;
                    const last = Math.max(1, Math.ceil(ordered.length / 25));
                    return json({
                        data: ordered.slice((page - 1) * 25, page * 25),
                        paginator: { current_page: page, last_page: last, total: catalog.length },
                    });
                },
            },
        });
        return { site, asked };
    }

    const catalogOf = (count) =>
        Array.from({ length: count }, (_, index) => {
            const number = String(index + 1).padStart(3, '0');
            return comic(`comic-${number}`, `Comic ${number}`);
        });
    const storedOf = (entries) => entries.map(({ slug, title }) => ({ id: slug, title }));

    it('should take the whole list in A-Z order in one window at the first update, without "Bahasa Indonesia"', async () => {
        const catalog = [
            comic('one-piece', 'One Piece'),
            comic('solo-leveling', 'Solo Leveling Bahasa Indonesia'),
            ...catalogOf(23),
            comic('tower-of-god', 'Tower of God bahasa indonesia'),
        ];
        const { site, asked } = listingSite({ catalog });
        const fetchUI = createEngine(site);

        const mangas = await new WestManga.default()._getMangas();

        expect(asked).toEqual(['Az 1', 'Az 2']);
        expect(mangas).toHaveLength(26);
        expect(mangas.slice(0, 2)).toEqual([
            { id: 'one-piece', title: 'One Piece' },
            { id: 'solo-leveling', title: 'Solo Leveling' },
        ]);
        expect(mangas.at(-1)).toEqual({ id: 'tower-of-god', title: 'Tower of God' });
        expect(fetchUI).toHaveBeenCalledTimes(1);
        expect(fetchUI.mock.calls[0][2]).toBe(15 * 60 * 1000);
    });

    it('should only ask for the comics that were added since the last update, and keep the list', async () => {
        const catalog = catalogOf(100);
        // the newest two are new, the rest was known at the last update
        const added = ['comic-100', 'comic-099', ...catalog.slice(0, 98).map(({ slug }) => slug)];
        const { site, asked } = listingSite({ catalog, added });
        createEngine(site, { stored: storedOf(catalog.slice(0, 98)) });

        const mangas = await new WestManga.default()._getMangas();

        expect(asked).toEqual(['Added 1']);
        expect(mangas).toHaveLength(100);
        expect(mangas.slice(-2)).toEqual([
            { id: 'comic-100', title: 'Comic 100' },
            { id: 'comic-099', title: 'Comic 099' },
        ]);
    });

    it('should go on to the next page of the added comics while all of a page are new', async () => {
        const catalog = catalogOf(80);
        const added = [
            ...catalog
                .slice(40)
                .map(({ slug }) => slug)
                .reverse(),
            ...catalog.slice(0, 40).map(({ slug }) => slug),
        ];
        const { site, asked } = listingSite({ catalog, added });
        createEngine(site, { stored: storedOf(catalog.slice(0, 40)) });

        const mangas = await new WestManga.default()._getMangas();

        expect(asked).toEqual(['Added 1', 'Added 2']);
        expect(new Set(mangas.map(({ id }) => id)).size).toBe(80);
    });

    it('should go on with a list that the limit stopped, in A-Z order from about where it ended', async () => {
        const catalog = catalogOf(200);
        const { site, asked } = listingSite({ catalog });
        // the first 100 in A-Z order arrived before the limit stopped the last update
        createEngine(site, { stored: storedOf(catalog.slice(0, 100)) });

        const mangas = await new WestManga.default()._getMangas();

        // the added comics are known already, but the list is short of the total: A-Z from two pages before its end
        expect(asked).toEqual(['Added 1', 'Az 3', 'Az 4', 'Az 5', 'Az 6', 'Az 7', 'Az 8']);
        expect(new Set(mangas.map(({ id }) => id)).size).toBe(200);
    });

    it('should keep what arrived when the limit stops an update, and say so', async () => {
        const catalog = catalogOf(100);
        const { site, asked } = listingSite({ catalog, limitAfter: 2 });
        createEngine(site);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        const mangas = await new WestManga.default()._getMangas();

        expect(asked).toEqual(['Az 1', 'Az 2', 'Az 3']);
        expect(mangas).toHaveLength(50);
        expect(warn).toHaveBeenCalledWith(
            'WestManga: 50 of 100 comics so far. WestManga limits the requests, try again in 60 minutes to get the rest.',
        );
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
