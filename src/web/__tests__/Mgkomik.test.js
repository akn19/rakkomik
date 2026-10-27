// @vitest-environment happy-dom
// MGKOMIK (web1.mgkomik.cc): the pages of a chapter are the images of the reader (#readingContent), the chapters the
// links of #chapterList. The site answers with the markup that it had on 2026-10-28, and the page goes through fetchDOM
// as in the application: createDOM turns every `img` into a `source` there.

let Mgkomik = null;

beforeAll(async () => {
    Mgkomik = (await import('../mjs/connectors/Mgkomik.mjs')).default;
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

const CHAPTER = 'https://web1.mgkomik.cc/komik/50kg-no-cinderella/chapter-32/';

// the site: every request gets a page with this body
function site(body) {
    vi.stubGlobal(
        'fetch',
        vi.fn(
            async () =>
                new Response(
                    `<html><head><title>MGKOMIK</title></head><body>${body}</body></html>`,
                    {
                        headers: { 'content-type': 'text/html; charset=utf-8' },
                    },
                ),
        ),
    );
    return new Mgkomik();
}

const payloadOf = (uri) =>
    JSON.parse(Buffer.from(new URL(uri).searchParams.get('payload'), 'base64').toString());

describe('MGKOMIK', () => {
    it('should take the images of the reader as the pages, and not the images around it', async () => {
        const connector = site(`
            <img src="https://web1.mgkomik.cc/logo.png" alt="MGKOMIK">
            <div class="reading-content longstrip" id="readingContent">
                <img src="https://static.mgis.my.id/manga/50kg-no-cinderella/chapter-32/image-0.webp" alt="Page 1" data-page="1" loading="eager">
                <img src="https://static.mgis.my.id/manga/50kg-no-cinderella/chapter-32/image-1.webp" alt="Page 2" data-page="2" loading="eager">
                <img src="/images/chapter-32/image-2.webp" alt="Page 3" data-page="3">
            </div>
            <div class="related"><img class="manga-cover" src="https://static.mgis.my.id/covers/other.webp"></div>
        `);

        const pages = await connector._getPages({
            id: '/komik/50kg-no-cinderella/chapter-32/',
            title: 'Chapter 32',
        });

        expect(pages.map(payloadOf)).toEqual([
            {
                url: 'https://static.mgis.my.id/manga/50kg-no-cinderella/chapter-32/image-0.webp',
                referer: CHAPTER,
            },
            {
                url: 'https://static.mgis.my.id/manga/50kg-no-cinderella/chapter-32/image-1.webp',
                referer: CHAPTER,
            },
            { url: 'https://web1.mgkomik.cc/images/chapter-32/image-2.webp', referer: CHAPTER },
        ]);
    });

    it('should say that a chapter without images in its reader has no pages', async () => {
        const connector = site('<div class="reading-content" id="readingContent"></div>');
        await expect(
            connector._getPages({ id: '/komik/a/chapter-1/', title: 'Chapter 1' }),
        ).rejects.toThrow('No pages found for Chapter 1');
    });

    it('should name the chapters of the list after their number', async () => {
        const connector = site(`
            <div id="chapterList">
                <div class="chapter-list-item">
                    <a class="chapter-link" href="/komik/50kg-no-cinderella/chapter-32/">
                        <span class="chapter-number">Chapter 32</span><span class="chapter-date">2 hari lalu</span>
                    </a>
                </div>
                <div class="chapter-list-item">
                    <a class="chapter-link" href="/komik/50kg-no-cinderella/chapter-31/">
                        <span class="chapter-number">Chapter 31</span>
                    </a>
                </div>
            </div>
        `);

        const chapters = await connector._getChapters({
            id: '/komik/50kg-no-cinderella/',
            title: '50kg',
        });

        expect(chapters).toEqual([
            { id: '/komik/50kg-no-cinderella/chapter-32/', title: 'Chapter 32', language: '' },
            { id: '/komik/50kg-no-cinderella/chapter-31/', title: 'Chapter 31', language: '' },
        ]);
    });
});
