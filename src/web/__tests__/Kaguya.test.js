// Kaguya ID (01.kaguya.re): the list and the comics come from the API of the site (tsuki.kaguya.re), the tokens of the
// images of a chapter from the reader of the site, and the API delivers an image for a token. The answers here have the
// shape that the site gave on 2026-11-09.

let Kaguya = null;

beforeAll(async () => {
    Kaguya = (await import('../mjs/connectors/Kaguya.mjs')).default;
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete globalThis.Engine;
});

const API = 'https://tsuki.kaguya.re/api/v1';

const json = (value, status = 200) =>
    new Response(JSON.stringify(value), {
        status,
        headers: { 'content-type': 'application/json' },
    });

/**
 * The site and its API: `routes` answers a path with its query, every request is kept with its headers.
 */
function createSite(routes) {
    const requests = [];
    vi.stubGlobal(
        'fetch',
        vi.fn(async (request) => {
            const url = new URL(request.url);
            requests.push({ url: request.url, headers: request.headers });
            const route =
                routes[url.host + url.pathname + url.search] || routes[url.host + url.pathname];
            return route ? route(url) : json({ success: false, message: 'Not found' }, 404);
        }),
    );
    return requests;
}

function createConnector() {
    const listeners = {};
    globalThis.Engine = {
        Settings: {
            addEventListener: vi.fn((name, listener) => (listeners[name] = listener)),
            save: vi.fn(),
        },
        Storage: { sanatizePath: (title) => title },
    };
    // a new manga tells the page about its status
    vi.stubGlobal('document', { dispatchEvent: vi.fn() });
    vi.stubGlobal('EventListener', { onMangaStatusChanged: 'onMangaStatusChanged' });
    const connector = new Kaguya();
    return { connector, listeners };
}

const comic = (slug, title) => ({ id: `id-${slug}`, slug, title, type: 'MANHWA', isAdult: true });

const chapterOf = (id, title) => ({ id, title, manga: { id: 'i-want-to-work-quietly' } });

const COMIC = {
    success: true,
    data: {
        id: 'cmr570gfnm09rig8yuk0bd3f9',
        slug: 'i-want-to-work-quietly',
        title: ' I Want To Work Quietly',
        chapters: [
            { id: 'ch-48', number: '48', title: null, isLocked: true },
            { id: 'ch-47', number: '47', title: null, isLocked: false },
            { id: 'ch-1', number: '1', title: ' The Beginning ', isLocked: false },
        ],
    },
};

describe('Kaguya', () => {
    it('should take every page of the list from the API in A-Z order, with trimmed titles', async () => {
        const requests = createSite({
            'tsuki.kaguya.re/api/v1/comics?limit=100&page=1&sort=az': () =>
                json({
                    success: true,
                    data: {
                        data: [comic('a-comic', ' A Comic'), comic('b-comic', 'B Comic ')],
                        meta: { total: 3, page: 1, limit: 100, totalPages: 2 },
                    },
                }),
            'tsuki.kaguya.re/api/v1/comics?limit=100&page=2&sort=az': () =>
                json({
                    success: true,
                    data: {
                        data: [comic('c-comic', 'C Comic')],
                        meta: { total: 3, page: 2, limit: 100, totalPages: 2 },
                    },
                }),
        });
        const { connector } = createConnector();

        const mangas = await connector._getMangas();

        expect(mangas).toEqual([
            { id: 'a-comic', title: 'A Comic' },
            { id: 'b-comic', title: 'B Comic' },
            { id: 'c-comic', title: 'C Comic' },
        ]);
        expect(requests).toHaveLength(2);
        expect(requests[0].headers.get('x-referer')).toBe('https://01.kaguya.re/');
        expect(requests[0].headers.get('x-origin')).toBe('https://01.kaguya.re');
    });

    it('should name the chapters after their number and title, and mark the ones for premium members', async () => {
        createSite({ 'tsuki.kaguya.re/api/v1/comics/i-want-to-work-quietly': () => json(COMIC) });
        const { connector } = createConnector();

        const chapters = await connector._getChapters({ id: 'i-want-to-work-quietly' });

        expect(chapters).toEqual([
            { id: 'ch-48', title: 'Chapter 48 [Premium]', language: '' },
            { id: 'ch-47', title: 'Chapter 47', language: '' },
            { id: 'ch-1', title: 'Chapter 1 - The Beginning', language: '' },
        ]);
    });

    it('should hand out the images of a chapter in their order, as links that the API delivers', async () => {
        const requests = createSite({
            '01.kaguya.re/api/reader/ch-47/pages': () =>
                json({
                    success: true,
                    data: {
                        locked: false,
                        pages: [
                            { id: 'p2', order: 1, mode: 'r2', token: 'eyJzIjoiYiJ9.sig+2/=' },
                            { id: 'p1', order: 0, mode: 'r2', token: 'eyJzIjoiYSJ9.sig1' },
                        ],
                    },
                }),
        });
        const { connector } = createConnector();

        const pages = await connector._getPages(chapterOf('ch-47', 'Chapter 47'));

        expect(pages).toEqual([
            `${API}/media/chapter/deliver?token=eyJzIjoiYSJ9.sig1`,
            `${API}/media/chapter/deliver?token=eyJzIjoiYiJ9.sig%2B2%2F%3D`,
        ]);
        expect(requests[0].url).toBe('https://01.kaguya.re/api/reader/ch-47/pages');
        // as the reader of the site asks, from the page of the chapter: a request from another site gets ten pages
        const { headers } = requests[0];
        expect(headers.get('x-referer')).toBe(
            'https://01.kaguya.re/comic/i-want-to-work-quietly/chapter/ch-47',
        );
        expect(headers.get('accept')).toBe('*/*');
        expect(headers.get('content-type')).toBe('application/json');
        expect(headers.get('x-sec-fetch-site')).toBe('same-origin');
    });

    it.each([
        ['a refusal of the reader', () => json({ success: false, message: 'Premium only' }, 403)],
        ['a locked chapter', () => json({ success: true, data: { locked: true, pages: [] } })],
    ])('should say that a chapter is for premium members, on %s', async (_, answer) => {
        createSite({ '01.kaguya.re/api/reader/ch-48/pages': answer });
        const { connector } = createConnector();

        await expect(
            connector._getPages(chapterOf('ch-48', 'Chapter 48 [Premium]')),
        ).rejects.toThrow('"Chapter 48 [Premium]" is for the premium members of Kaguya only.');
    });

    it('should say that the pages of a chapter could not be received', async () => {
        createSite({ '01.kaguya.re/api/reader/ch-1/pages': () => json({ success: false }, 500) });
        const { connector } = createConnector();

        await expect(connector._getPages(chapterOf('ch-1', 'Chapter 1'))).rejects.toThrow(
            'Failed to receive the pages of "Chapter 1" (status: 500)',
        );
    });

    it('should take a comic from the link of the comic or of one of its chapters', async () => {
        createSite({ 'tsuki.kaguya.re/api/v1/comics/i-want-to-work-quietly': () => json(COMIC) });
        const { connector } = createConnector();

        for (const link of [
            'https://01.kaguya.re/comic/i-want-to-work-quietly',
            'https://01.kaguya.re/comic/i-want-to-work-quietly/chapter/ch-47',
        ]) {
            const manga = await connector._getMangaFromURI(new URL(link));
            expect([manga.id, manga.title]).toEqual([
                'i-want-to-work-quietly',
                'I Want To Work Quietly',
            ]);
        }
        await expect(
            connector._getMangaFromURI(new URL('https://01.kaguya.re/comics')),
        ).rejects.toThrow('This is no link of a comic of Kaguya');
    });

    it('should follow the domain of the settings, and still take the links of the earlier domains', async () => {
        const requests = createSite({
            'kaguya.example/api/reader/ch-47/pages': () =>
                json({ success: true, data: { locked: false, pages: [] } }),
        });
        const { connector, listeners } = createConnector();

        connector.config.url.value = 'https://kaguya.example/ ';
        listeners.saved();
        await connector._getPages(chapterOf('ch-47', 'Chapter 47'));

        expect(requests[0].url).toBe('https://kaguya.example/api/reader/ch-47/pages');
        expect(requests[0].headers.get('x-origin')).toBe('https://kaguya.example');
        expect(connector.canHandleURI(new URL('https://kaguya.example/comic/a'))).toBe(true);
        expect(connector.canHandleURI(new URL('https://02.kaguya.pro/comic/a'))).toBe(true);
        expect(connector.canHandleURI(new URL('https://01.kaguya.re/comic/a'))).toBe(true);
        expect(connector.canHandleURI(new URL('https://example.com/comic/a'))).toBe(false);
    });
});
