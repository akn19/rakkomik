import WordPressMangastream from './templates/WordPressMangastream.mjs';

export default class MiauScan extends WordPressMangastream {

    constructor() {
        super();
        super.id = 'miauscan';
        super.label = 'MiauScan';
        this.tags = [ 'manga', 'spanish', 'portuguese', 'scanlation' ];
        this.url = 'https://zonamiau.com';
        this.path = '/manga/list-mode/';

        this.novelContent = 'div#readerarea.rdminimal';
    }

    async _getPages(chapter) {
        let request = new Request(new URL(chapter.id, this.url), this.requestOptions);
        const data = await this.fetchDOM(request, 'div#readerarea.rdminimal');
        //reader for novel have this class. When its a manga there is no class at all so we call super.
        if (data.length == 0) {
            return (await super._getPages(chapter)).filter(image => !/dis2\.jpg/.test(image));
        }
        return [ await Engine.Request.fetchNovel(request, this.novelContent) ];
    }
}
