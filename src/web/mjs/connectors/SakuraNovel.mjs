import WordPressMangastream from './templates/WordPressMangastream.mjs';
//template/theme LightNovel, basically WordPressMangastreamNovel
export default class SakuraNovel extends WordPressMangastream {

    constructor() {
        super();
        super.id = 'sakuranovel';
        super.label = 'SakuraNovel';
        this.tags = ['novel', 'indonesian'];
        this.url = 'https://sakuranovel.id';

        this.querMangaTitleFromURI = 'div.series-title h2';
        this.queryMangas = 'div.novellist-blc ul li a.series';
        this.queryChapters = 'ul.series-chapterlists li a';
        this.queryChaptersTitle = 'span:not(.date)';
        this.path = '/daftar-novel/';

        this.novelContentQuery = 'div.asdasd';
        this.novelObstaclesQuery = '[data-index]';
    }

    async _getChapters(novel) {
        const novels = await super._getChapters(novel);
        novels.forEach(novel => novel.title = novel.title.replace(/Bahasa Indonesia$/i, '').trim());
        return novels;
    }

    async _getPages(chapter) {
        let uri = new URL(chapter.id, this.url);
        let request = new Request(uri, this.requestOptions);
        return this._getPagesNovel(request);
    }

    async _getPagesNovel(request) {
        return [ await Engine.Request.fetchNovel(request, this.novelContentQuery, { obstacles: this.novelObstaclesQuery }) ];
    }
}
