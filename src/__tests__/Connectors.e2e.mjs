// Live smoke tests: every connector must still deliver manga, chapters and
// page links from its real website (needs network access; run with
// `pnpm run test:e2e:sites`). Sites change, so expectations may need updating.
import { test, expect, connectorsReady } from './support/electronApp.mjs';

/**
 * Resolve manga, first/last chapter and its pages inside the application and
 * return plain data for the assertions.
 */
async function resolveFromSite(page, parameters) {
    return page.evaluate(async ({ connectorID, mangaURL, chaptersAccessor }) => {
        const connector = Engine.Connectors.find(entry => entry.id === connectorID);
        const manga = await connector.getMangaFromURI(new URL(mangaURL));
        const chapters = await new Promise(resolve => manga.getChapters((_, list) => resolve(list)));
        // first => shift, last => pop, INT => getAtIndex, { id } => the chapter with that ID
        const chapter = typeof chaptersAccessor === 'object'
            ? chapters.find(entry => entry.id === chaptersAccessor.id)
            : Number.isInteger(chaptersAccessor) ? chapters[chaptersAccessor] : chapters[chaptersAccessor]();
        const pages = await new Promise(resolve => chapter.getPages((_, list) => resolve(list)));
        return {
            connectorClass: connector.constructor.name,
            mangaClass: manga.constructor.name,
            mangaID: manga.id,
            mangaTitle: manga.title,
            chapterClass: chapter.constructor.name,
            chapterID: chapter.id,
            chapterTitle: chapter.title,
            pages
        };
    }, parameters);
}

function pageLink(page, connectorID) {
    if (!page.startsWith('connector://' + connectorID)) {
        return page;
    }
    const payload = JSON.parse(Buffer.from(decodeURIComponent(page.split('payload=')[1]), 'base64').toString());
    return connectorID === 'mangadex' ? payload.networkNode + payload.hash + '/' + payload.file : payload.url;
}

const sites = [
    {
        name: 'MangaDex',
        parameters: { connectorID: 'mangadex', mangaURL: 'https://mangadex.org/title/0e711546-48be-4d95-90eb-c336cfc0ddce', chaptersAccessor: 'pop' },
        expectations: {
            connectorClass: 'MangaDex',
            mangaID: '0e711546-48be-4d95-90eb-c336cfc0ddce',
            mangaTitle: 'They Say I Was Born a King\'s Daughter',
            chapterID: '87623776-1db5-458e-b057-a4faff9d4af1',
            chapterTitle: 'Ch.0001 (pt-br) [Usagi Scan]',
            pageCount: 51,
            pageMatcher: /^https:\/\/(s\d+|uploads).mangadex.org\/data\/[0-9a-f]{32}\/R\d+-[0-9a-f]{64}.jpg$/
        }
    },
    {
        name: 'MangaGo',
        parameters: { connectorID: 'mangago', mangaURL: 'http://www.mangago.me/read-manga/black_clover/', chaptersAccessor: 'pop' },
        expectations: {
            connectorClass: 'MangaGo',
            mangaID: '/read-manga/black_clover/',
            mangaTitle: 'Black Clover',
            chapterID: '/read-manga/black_clover/bt/314637/Ch1/',
            chapterTitle: 'Ch.1  : The Boy\'s Vow',
            pageCount: 51,
            pageMatcher: /^https?:\/\/iweb\d+\.mangapicgallery.com\/r\/newpiclink\/black_clover\/1\/[a-z0-9]{32}\.(?:png|jpg|jpeg)$/
        }
    },
    {
        name: 'EpikManga',
        parameters: { connectorID: 'epikmanga', mangaURL: 'https://www.epikmanga.com/seri/battle-through-the-heavens', chaptersAccessor: 'pop' },
        expectations: {
            connectorClass: 'EpikManga',
            mangaID: '/seri/battle-through-the-heavens',
            mangaTitle: 'Battle Through the Heavens',
            chapterID: '/seri/battle-through-the-heavens/bolum/6',
            chapterTitle: '#1 Artık Dahi Değil',
            pageCount: 20,
            pageMatcher: /^https:\/\/www\.epikmanga.com\/upload\/manga\/battle-through-the-heavens\/1\/\d+.jpg$/
        }
    },
    {
        name: 'Baozimh',
        parameters: { connectorID: 'baozimh', mangaURL: 'https://www.baozimh.com/comic/nudiduolanyan-fuxiaolianmeng', chaptersAccessor: 'pop' },
        expectations: {
            connectorClass: 'Baozimh',
            mangaID: '/comic/nudiduolanyan-fuxiaolianmeng',
            mangaTitle: '女帝多藍顏',
            chapterID: '/user/page_direct?comic_id=nudiduolanyan-fuxiaolianmeng&section_slot=0&chapter_slot=0',
            chapterTitle: '預告',
            pageCount: 46,
            pageMatcher: /^https:\/\/.*.baozimh.com\/scomic\/nudiduolanyan-fuxiaolianmeng\/\d\/.*\/(\d*).jpg$/
        }
    },
    {
        name: 'ComicBrise',
        parameters: { connectorID: 'comicbrise', mangaURL: 'https://comic-brise.com/contents/oshiai', chaptersAccessor: 'pop' },
        expectations: {
            connectorClass: 'ComicBrise',
            mangaID: '/contents/oshiai',
            mangaTitle: '推しに認知してもらうためにアイドル始めました。',
            chapterID: '/comic_ep/oshiai_ep1',
            chapterTitle: '第１話',
            pageCount: 49
        }
    },
    {
        name: 'To-Corona-Ex',
        parameters: { connectorID: 'to-corona-ex', mangaURL: 'https://to-corona-ex.com/comics/20000000051530', chaptersAccessor: 'pop' },
        expectations: {
            connectorClass: 'ToCoronaEx',
            mangaID: '20000000051530',
            mangaTitle: '悪役令嬢ですが攻略対象の様子が異常すぎる@COMIC',
            chapterID: "20000000496345",
            chapterTitle: '第1話',
            pageCount: 34
        }
    },
    {
        name: 'ReadM',
        parameters: { connectorID: 'readm', mangaURL: 'https://readm.org/manga/9465', chaptersAccessor: 'pop' },
        expectations: {
            connectorClass: 'ReadM',
            mangaID: '/manga/9465',
            mangaTitle: 'D.N. Angel',
            chapterID: '/manga/9465/1/all-pages',
            chapterTitle: 'Chapter 1',
            pageCount: 59,
            pageMatcher: /^https:\/\/readm\.org\/uploads\/chapter_files\/9465\/0\/p_\d{5}\.jpg\?v=\d+$/
        }
    },
    {
        name: 'Comic Valkyrie',
        parameters: { connectorID: 'comicvalkyrie', mangaURL: 'https://www.comic-valkyrie.com/isemaji', chaptersAccessor: 'pop' },
        expectations: {
            connectorClass: 'ComicValkyrie',
            mangaID: 'isemaji',
            mangaTitle: '異世界魔術師は魔法を唱えない',
            chapterID: 'https://www.comic-valkyrie.com/samplebook/val_isemaji01/',
            chapterTitle: '第1話',
            pageCount: 34,
        }
    },
    {
        name: 'Comix',
        parameters: {
            connectorID: 'comixto',
            mangaURL: 'https://comix.to/title/k7yg7-the-spark-in-your-eyes',
            chaptersAccessor: { id: '/title/k7yg7-the-spark-in-your-eyes/2536461-chapter-66' }
        },
        expectations: {
            connectorClass: 'ComixTo',
            mangaID: '/title/k7yg7-the-spark-in-your-eyes',
            mangaTitle: 'The Spark in Your Eyes',
            chapterID: '/title/k7yg7-the-spark-in-your-eyes/2536461-chapter-66',
            chapterTitle: '66 - The Period of Humans (4) [UToon]',
            pageCount: 86,
            pageMatcher: /^https:\/\/[^/]+\/.+/
        }
    }
];

test.describe('connectors on the real websites', () => {
    for (const site of sites) {
        test(`${site.name}: should get manga, chapters and page links`, async ({ page }) => {
            await connectorsReady(page);
            const result = await resolveFromSite(page, site.parameters);
            const expected = site.expectations;
            expect(result.connectorClass).toEqual(expected.connectorClass);
            expect(result.mangaClass).toEqual('Manga');
            expect(result.mangaID).toEqual(expected.mangaID);
            expect(result.mangaTitle).toEqual(expected.mangaTitle);
            expect(result.chapterClass).toEqual('Chapter');
            expect(result.chapterID).toEqual(expected.chapterID);
            expect(result.chapterTitle).toEqual(expected.chapterTitle);
            expect(result.pages.length).toEqual(expected.pageCount);
            if (expected.pageMatcher) {
                for (const link of result.pages.map(entry => pageLink(entry, site.parameters.connectorID))) {
                    expect(link).toMatch(expected.pageMatcher);
                }
            }
        });
    }
});
