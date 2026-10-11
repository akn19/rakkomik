// The connectors of novels used to draw a chapter into an image (html2canvas, loaded from a CDN). A novel is text, so
// they take the text of the chapter instead (`Engine.Request.fetchNovel`). Each of them keeps the selectors its
// screenshot script used: the element that holds the text, and what in it is no part of the text.
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', 'mjs');

function walk(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const full = path.join(directory, entry.name);
        return entry.isDirectory() ? walk(full) : full.endsWith('.mjs') ? [full] : [];
    });
}

afterEach(() => {
    delete globalThis.Engine;
});

async function connector(name) {
    const Connector = (await import(`../mjs/connectors/${name}.mjs`)).default;
    return new Connector();
}

// `Engine.Request.fetchNovel` answers with the novel page it is asked for
function novelEngine() {
    const fetchNovel = vi.fn(async (request, selector) => `novel-page:${request.url}:${selector}`);
    globalThis.Engine = { Request: { fetchNovel } };
    return fetchNovel;
}

describe('the code of the connectors', () => {
    it('should not draw a novel into an image any more', () => {
        const offenders = walk(root).filter(file => /html2canvas/.test(fs.readFileSync(file, 'utf8')));
        expect(offenders.map(file => path.relative(root, file))).toEqual([]);
    });

    it('should not depend on the layout of a screenshot any more', () => {
        const offenders = walk(path.join(root, 'connectors')).filter(file => /novelWidth|novelPadding|novelFormat|novelContainer|NovelColorProfile/.test(fs.readFileSync(file, 'utf8')));
        expect(offenders.map(file => path.relative(root, file))).toEqual([]);
    });
});

describe('connectors that hold novels', () => {
    const request = url => expect.objectContaining({ url });

    it('should take the text of a chapter of Novel Ringan', async () => {
        const fetchNovel = novelEngine();
        const pages = await (await connector('NovelRingan'))._getPages({ id: '/chapter-1' });
        expect(pages).toEqual(['novel-page:https://novelringan.com/chapter-1:div.entry-content']);
        expect(fetchNovel).toHaveBeenCalledWith(request('https://novelringan.com/chapter-1'), 'div.entry-content');
    });

    it('should take the text of a chapter of Novelgo, without its advertisements', async () => {
        const fetchNovel = novelEngine();
        const pages = await (await connector('Novelgo'))._getPages({ id: '/chapter/1/' });
        expect(pages).toHaveLength(1);
        expect(fetchNovel).toHaveBeenCalledWith(request('https://novelgo.id/chapter/1/'), 'div.noveils-chapter-wrapper div#chapter-post-content', { obstacles: 'div.code-block' });
    });

    it('should take the text of a chapter of SakuraNovel, without its numbered blocks', async () => {
        const fetchNovel = novelEngine();
        const pages = await (await connector('SakuraNovel'))._getPages({ id: '/chapter-1/' });
        expect(pages).toHaveLength(1);
        expect(fetchNovel).toHaveBeenCalledWith(request('https://sakuranovel.id/chapter-1/'), 'div.asdasd', { obstacles: '[data-index]' });
    });

    it('should take the text of a chapter of KolNovel, without the elements that have a class', async () => {
        const fetchNovel = novelEngine();
        const page = request('https://kolnovel.com/chapter-1/');
        const pages = await (await connector('KolNovel'))._getPagesNovel(page);
        expect(pages).toHaveLength(1);
        expect(fetchNovel).toHaveBeenCalledWith(page, 'div.epcontent', { obstacles: 'div[class]' });
    });

    it('should take the text of a chapter of Saikaiscan, but not the images of its comics', async () => {
        const fetchNovel = novelEngine();
        const pages = await (await connector('Saikaiscan'))._getPages({ id: '/series/story/chapter-1' });
        expect(pages).toHaveLength(1);
        expect(fetchNovel).toHaveBeenCalledWith(request('https://saikaiscans.net/series/story/chapter-1'), 'div#leitor-serie-body');
    });

    it('should take the text of a chapter of ScanManga', async () => {
        const fetchNovel = novelEngine();
        const page = request('https://www.scan-manga.com/novel');
        expect(await (await connector('ScanManga'))._getPagesNovel(page)).toHaveLength(1);
        expect(fetchNovel).toHaveBeenCalledWith(page, 'article.aLN');
    });

    it('should take the text of a chapter of Tapas', async () => {
        const fetchNovel = novelEngine();
        const page = request('https://tapas.io/episode/1');
        expect(await (await connector('Tapas'))._getPagesNovel(page)).toHaveLength(1);
        expect(fetchNovel).toHaveBeenCalledWith(page, '.ep-epub-content');
    });

    it('should take the text of a chapter of a Madara theme, without what the site marks as obstacle', async () => {
        const fetchNovel = novelEngine();
        const sites = [
            ['WuxiaWorld', '_'],
            ['MyNovel', 'div.addtoany_content'],
            ['WBNovel', 'div#text-chapter-toolbar, div.ad, div.go-to-top']
        ];
        for (const [name, obstacles] of sites) {
            fetchNovel.mockClear();
            const page = request('https://novels.example/chapter-1');
            expect(await (await connector(name))._getPagesNovel(page)).toHaveLength(1);
            expect(fetchNovel).toHaveBeenCalledWith(page, 'div.entry-content', { obstacles });
        }
    });

    it('should take the text of a chapter of NovelCool, in every language', async () => {
        const source = fs.readFileSync(path.join(root, 'connectors', 'templates', 'NovelCool.mjs'), 'utf8');
        expect(source).toContain('Engine.Request.fetchNovel(request, this.novelContentQuery, { obstacles: this.novelObstaclesQuery })');
        const instance = await connector('NovelCoolEN');
        expect(instance.novelContentQuery).toBe('div.chapter-reading-section.position-relative');
        expect(instance.novelObstaclesQuery).toBe('div.chapter-section-report.model-trigger');
    });

    it('should take the text of a chapter of a HeanCms site', async () => {
        const fetchNovel = novelEngine();
        const site = await connector('YugenMangas');
        site.url = 'https://reader.example';
        expect(await site._getNovel('story', 'chapter-1')).toEqual(['novel-page:https://reader.example/series/story/chapter-1:div#reader-container']);
        expect(fetchNovel).toHaveBeenCalledWith(request('https://reader.example/series/story/chapter-1'), 'div#reader-container');
    });

    it.each(['GremoryMangas', 'Miauscan'])('should take the text of a chapter of %s, when it has the reader of a novel', async name => {
        const fetchNovel = novelEngine();
        const site = await connector(name);
        site.fetchDOM = vi.fn(async () => [{}]);
        const pages = await site._getPages({ id: '/chapter-1/' });
        expect(pages).toHaveLength(1);
        expect(site.fetchDOM).toHaveBeenCalledWith(expect.anything(), 'div#readerarea.rdminimal');
        expect(fetchNovel).toHaveBeenCalledWith(expect.anything(), 'div#readerarea.rdminimal');
    });

    it('should take the text of a chapter of Tsundoku Traduções, without its logo and its own advertisement', async () => {
        const fetchNovel = novelEngine();
        const site = await connector('TsundokuTraducoes');
        site.fetchDOM = vi.fn(async () => [{}]);
        await site._getPages({ id: '/chapter-1/' });
        expect(fetchNovel).toHaveBeenCalledWith(expect.anything(), 'div#readerarea.rdminimal', {
            obstacles: 'img[src*="Logo-Tsundoku"]',
            ignoredTexts: ['https://tsundoku.com.br']
        });
    });

    it.each(['GremoryMangas', 'Miauscan', 'TsundokuTraducoes'])('should leave the chapters of comics of %s alone', async name => {
        const fetchNovel = novelEngine();
        const site = await connector(name);
        site.fetchDOM = vi.fn(async () => []);
        const comicPages = ['https://cdn.example/1.jpg'];
        vi.spyOn(Object.getPrototypeOf(Object.getPrototypeOf(site)), '_getPages').mockResolvedValue(comicPages);
        expect(await site._getPages({ id: '/chapter-1/' })).toEqual(comicPages);
        expect(fetchNovel).not.toHaveBeenCalled();
    });
});
