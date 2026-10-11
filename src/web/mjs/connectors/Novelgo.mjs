import Connector from '../engine/Connector.mjs';

export default class Novelgo extends Connector {

    constructor() {
        super();
        super.id = 'novelgo';
        super.label = 'Novelgo.ID';
        this.tags = [ 'novel', 'indonesian' ];
        this.url = 'https://novelgo.id';
        this.path = '/genre/page/';

        this.queryMangas = 'div.novel-item-content h3.novel-item-title a';
        this.novelContentQuery = 'div.noveils-chapter-wrapper div#chapter-post-content';
        this.novelObstaclesQuery = 'div.code-block';
    }

    async _getMangasFromPage(page) {
        const uri = new URL(this.path + page + '/', this.url);
        let request = new Request(uri, this.requestOptions);
        let data = await this.fetchDOM(request, this.queryMangas);
        return data.map(element => {
            return {
                id: this.getRootRelativeOrAbsoluteLink(element, request.url),
                title: element.text.trim()
            };
        });
    }

    async _getMangas() {
        let mangaList = [];
        for(let page = 1, run = true; run; page++) {
            let mangas = await this._getMangasFromPage(page);
            mangas.length > 0 ? mangaList.push(...mangas) : run = false;
        }
        return mangaList;
    }

    async _getChaptersFromJSON(page, id) {
        const uri = new URL('/wp-json/noveils/v1/chapters', this.url);
        uri.searchParams.set('paged', page);
        uri.searchParams.set('perpage', 250);
        uri.searchParams.set('category', id);
        let request = new Request(uri, this.requestOptions);
        let data = await this.fetchJSON(request);
        return data.map(element => {
            return {
                id: this.getRootRelativeOrAbsoluteLink(element.permalink, request.url),
                title: element.post_title.trim()
            };
        });
    }

    async _getChapters(manga) {
        const mangaId = manga.id.slice(7, -1);
        let chapterList = [];
        for (let page = 1, run = true; run; page++) {
            let chapters = await this._getChaptersFromJSON(page, mangaId);
            chapters.length > 0 ? chapterList.push(...chapters) : run = false;
        }
        return chapterList;
    }

    async _getPagesNovel(request) {
        return [ await Engine.Request.fetchNovel(request, this.novelContentQuery, { obstacles: this.novelObstaclesQuery }) ];
    }

    async _getPages(chapter) {
        const uri = new URL(chapter.id, this.url);
        let request = new Request(uri, this.requestOptions);
        return this._getPagesNovel(request);
    }
}
