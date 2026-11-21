// Shinigami (s1.shinigami.mx): everything comes from its API (api.shinigami.io/v1), which moved with the site on
// 2026-11-20. The list comes in pages of an offset, the chapters in pages that a cursor leads through. The answers here
// have the shape that the API gave on 2026-11-21.

let ShinigamiID = null;

beforeAll(async () => {
    ShinigamiID = (await import('../mjs/connectors/ShinigamiID.mjs')).default;
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete globalThis.Engine;
});

const json = (value, status = 200) =>
    new Response(JSON.stringify(value), {
        status,
        headers: { 'content-type': 'application/json' },
    });

// the API: `route` answers a request, every request is kept
function createApi(route) {
    const requests = [];
    vi.stubGlobal(
        'fetch',
        vi.fn(async (request) => {
            const url = new URL(request.url);
            requests.push({ url, headers: request.headers });
            return route(url) || json({ message: 'Not Found' }, 404);
        }),
    );
    return requests;
}

function createConnector() {
    globalThis.Engine = {
        Settings: { save: vi.fn() },
        Storage: { sanatizePath: (title) => title },
    };
    // a new manga tells the page about its status
    vi.stubGlobal('document', { dispatchEvent: vi.fn() });
    vi.stubGlobal('EventListener', { onMangaStatusChanged: 'onMangaStatusChanged' });
    const connector = new ShinigamiID();
    connector.wait = vi.fn(async () => undefined);
    return connector;
}

const meta = (fields) => ({ request_id: 'r', process_time: '1ms', ...fields });

describe('Shinigami', () => {
    it('should take the list from the API in pages of 100, with a pause between them', async () => {
        const all = Array.from({ length: 150 }, (_, index) => ({
            manga_id: `id-${index}`,
            title: ` Title ${index} `,
        }));
        const requests = createApi((url) => {
            if (url.pathname !== '/v1/manga/list') {
                return undefined;
            }
            const offset = Number(url.searchParams.get('offset'));
            const limit = Number(url.searchParams.get('limit'));
            return json({
                data: all.slice(offset, offset + limit),
                meta: meta({ offset, limit, has_next: offset + limit < all.length }),
            });
        });
        const connector = createConnector();

        const mangas = await connector._getMangas();

        expect(mangas).toHaveLength(150);
        expect(mangas[0]).toEqual({ id: 'id-0', title: 'Title 0' });
        expect(requests.map(({ url }) => url.host + url.pathname + url.search)).toEqual([
            'api.shinigami.io/v1/manga/list?offset=0&limit=100',
            'api.shinigami.io/v1/manga/list?offset=100&limit=100',
        ]);
        expect(requests[0].headers.get('accept')).toBe('application/json');
        expect(connector.wait).toHaveBeenCalledTimes(1);
    });

    it('should follow the cursor through the chapters, 500 a page', async () => {
        const pages = {
            '': {
                data: [
                    { chapter_id: 'c-3', chapter_number: 3, chapter_title: '' },
                    { chapter_id: 'c-2', chapter_number: 2.5, chapter_title: 'Extra' },
                ],
                meta: meta({ limit: 500, has_next: true, next_cursor: 'eyJzIjoyfQ' }),
            },
            eyJzIjoyfQ: {
                data: [{ chapter_id: 'c-1', chapter_number: 1, chapter_title: '' }],
                meta: meta({ limit: 500, has_next: false, next_cursor: null }),
            },
        };
        const requests = createApi((url) =>
            url.pathname === '/v1/chapter/m-1/list' && url.searchParams.get('limit') === '500'
                ? json(pages[url.searchParams.get('cursor') || ''])
                : undefined,
        );
        const connector = createConnector();

        const chapters = await connector._getChapters({ id: 'm-1' });

        expect(chapters).toEqual([
            { id: 'c-3', title: 'Chapter 3' },
            { id: 'c-2', title: 'Chapter 2.5 Extra' },
            { id: 'c-1', title: 'Chapter 1' },
        ]);
        expect(requests).toHaveLength(2);
    });

    it('should stop at a page that names no cursor, even when it says that there is more', async () => {
        createApi(() =>
            json({
                data: [{ chapter_id: 'c-1', chapter_number: 1, chapter_title: '' }],
                meta: meta({ has_next: true, next_cursor: '' }),
            }),
        );
        const connector = createConnector();

        await expect(connector._getChapters({ id: 'm-1' })).resolves.toHaveLength(1);
    });

    it('should hand out the images of a chapter from its base address and path', async () => {
        createApi((url) =>
            url.pathname === '/v1/chapter/detail/c-1'
                ? json({
                      data: {
                          base_url: 'https://cdn.shinigami.gg',
                          chapter: {
                              path: '/chapter/manga_m-1/chapter_c-1/',
                              data: ['page-0001-00-a6e9.jpg', 'page-0002-00-b7f0.jpg'],
                          },
                      },
                  })
                : undefined,
        );
        const connector = createConnector();

        const pages = await connector._getPages({ id: 'c-1' });

        expect(pages).toEqual([
            'https://cdn.shinigami.gg/chapter/manga_m-1/chapter_c-1/page-0001-00-a6e9.jpg',
            'https://cdn.shinigami.gg/chapter/manga_m-1/chapter_c-1/page-0002-00-b7f0.jpg',
        ]);
    });

    it('should take a series from its link, on the new domain and the earlier ones', async () => {
        createApi((url) =>
            url.pathname === '/v1/manga/detail/c0f1d049'
                ? json({ data: { manga_id: 'c0f1d049', title: ' Demonic Emperor ' } })
                : undefined,
        );
        const connector = createConnector();

        for (const link of [
            'https://s1.shinigami.mx/series/c0f1d049',
            'https://09.shinigami.asia/series/c0f1d049',
        ]) {
            const uri = new URL(link);
            expect(connector.canHandleURI(uri)).toBe(true);
            const manga = await connector._getMangaFromURI(uri);
            expect([manga.id, manga.title]).toEqual(['c0f1d049', 'Demonic Emperor']);
        }
        expect(connector.canHandleURI(new URL('https://example.com/series/c0f1d049'))).toBe(false);
        await expect(
            connector._getMangaFromURI(new URL('https://s1.shinigami.mx/chapter/c-1')),
        ).rejects.toThrow('This is no link of a series of Shinigami ID');
    });
});
