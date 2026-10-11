import WordPressMangastream from './templates/WordPressMangastream.mjs';
//template/theme LightNovel, basically WordPressMangastreamNovel
export default class KolNovel extends WordPressMangastream {

    constructor() {
        super();
        super.id = 'kolnovel';
        super.label = 'Kol Novel (ملوك الروايات)';
        this.tags = [ 'manga', 'webtoon', 'arabic' ];
        this.url = 'https://kolnovel.com';

        this.queryChapters = 'div.eplister ul li a';
        this.queryChaptersTitle = 'div:not(.epl-date)';
        this.path = '/series/list-mode/';

        this.novelContentQuery = 'div.epwrapper div[itemprop="text"]';
        this.novelObstaclesQuery = 'div[class]';
    }

    async _getChapters(manga) {
        let request = new Request(new URL(manga.id, this.url), this.requestOptions);
        let data = await this.fetchDOM(request, this.queryChapters);
        return data.map(element => {
            this.adLinkDecrypt(element);
            const title = this.queryChaptersTitle ? [...element.querySelectorAll(this.queryChaptersTitle)].map(ele => ele.textContent).join(' ') : element.text;
            return {
                id: this.getRootRelativeOrAbsoluteLink(element, request.url),
                title: title.replace(manga.title, '').trim()
            };
        });
    }

    async _getPages(chapter) {
        let uri = new URL(chapter.id, this.url);
        uri.searchParams.set('style', 'list');
        let request = new Request(uri, this.requestOptions);
        let data = await this.fetchDOM(request, this.novelContentQuery);
        return data.length > 0 ? this._getPagesNovel(request) : super._getPages(chapter);
    }

    async _getPagesNovel(request) {
        return [ await Engine.Request.fetchNovel(request, 'div.epcontent', { obstacles: this.novelObstaclesQuery }) ];
    }
}