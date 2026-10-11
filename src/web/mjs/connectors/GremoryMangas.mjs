import WordPressMangastream from './templates/WordPressMangastream.mjs';

export default class GremoryMangas extends WordPressMangastream {

    constructor() {
        super();
        super.id = 'gremorymangas';
        super.label = 'GremoryMangas';
        this.tags = ['spanish', 'scanlation', 'webtoon'];
        this.url = 'https://gremorymangas.com';
        this.path = '/manga/list-mode/';
        this.novelContent = 'div#readerarea.rdminimal';
        //this.novelObstaclesQuery = 'img[src*="Logo-Tsundoku"]';
    }
    async _getPages(chapter) {
        let request = new Request(new URL(chapter.id, this.url), this.requestOptions);
        let data = await this.fetchDOM(request, 'div#readerarea.rdminimal');
        //reader for novel have this class. When its a manga there is no class at all so we call super.
        if (data.length == 0) {
            return await super._getPages(chapter);
        }
        return [ await Engine.Request.fetchNovel(request, this.novelContent) ];
    }
}