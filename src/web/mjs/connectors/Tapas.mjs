import Connector from '../engine/Connector.mjs';
import Manga from '../engine/Manga.mjs';

export default class Tapas extends Connector {

    constructor() {
        super();
        super.id = 'tapas';
        super.label = 'Tapas';
        this.tags = [ 'webtoon', 'english', 'novel' ];
        this.url = 'https://tapas.io';
        this.apiUrl = 'https://story-api.tapas.io/cosmos/api/v1/landing';
        this.requestOptions.headers.set('x-cookie', 'adjustedBirthDate=1990-01-01');
    }

    async _getMangaFromURI(uri) {
        const seriesId = (await this.fetchDOM(new Request(uri), 'meta[property="al:android:url"]'))[0].content.replace(/\/info$/, '').split('/').pop();
        let data = (await this.fetchJSON(new Request(new URL(`${this.url}/series/${seriesId}?`, this.URI), {
            headers: {
                Accept: 'application/json, text/javascript, */*;',
                'Content-type': 'application/x-www-form-urlencoded; charset=UTF-8'
            }
        }))).data;
        return new Manga(this, data.id.toString(), data.title.trim());
    }

    async _getMangas() {
        let mangaList = [];
        for(let page = 1, run = true; run; page++) {
            let mangas = await this._getMangasFromPage(page);
            mangas.length > 0 ? mangaList.push(...mangas) : run = false;
        }
        return mangaList;
    }

    async _getMangasFromPage(page) {

        const uri = new URL(`${this.apiUrl}/genre?category_type=COMIC&size=200&page=${page}`);
        const request = new Request(uri, this.requestOptions);
        request.headers.set('Accept', 'application/json, text/javascript, */*;');

        const response = await this.fetchJSON(request, this.requestOptions);

        return response.data.items.map(element => {
            return {
                id: element.seriesId,
                title: element.title
            };
        });
    }

    async _getChapters(manga) {
        const chapterList = [];
        for(let page = 1, run = true; run; page++) {
            const chapters = await this._getChaptersFromPage(manga, page);
            chapters.length > 0 ? chapterList.push(...chapters) : run = false;
        }
        return chapterList;
    }

    async _getChaptersFromPage(manga, page) {
        const request = new Request(new URL(`${this.url}/series/${manga.id}/episodes?page=${page}`), this.requestOptions);
        const response = await this.fetchJSON(request);

        return response.data.episodes.map(element => {
            return {
                id: `/episode/${element.id}`,
                title: element.title
            };
        });
    }

    async _getPagesManga(chapter) {
        let request = new Request(new URL(chapter.id, this.url), this.requestOptions);
        let data = await this.fetchDOM(request, 'div.viewer > article > source.content__img');
        return data.map(image => this.getAbsolutePath(image.dataset.src, request.url));
    }

    async _getPages(chapter) {
        let uri = new URL(chapter.id, this.url);
        uri.searchParams.set('style', 'list');
        let request = new Request(uri, this.requestOptions);
        let data = await this.fetchDOM(request, '.ep-epub-contents');
        return data.length > 0 ? this._getPagesNovel(request) : this._getPagesManga(chapter);
    }

    async _getPagesNovel(request) {
        return [ await Engine.Request.fetchNovel(request, '.ep-epub-content') ];
    }
}
