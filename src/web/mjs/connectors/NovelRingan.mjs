import Connector from '../engine/Connector.mjs';
import Manga from '../engine/Manga.mjs';

export default class NovelRingan extends Connector {
    constructor() {
        super();
        super.id = 'novelringan';
        super.label = 'Novel Ringan';
        this.tags = ['novel', 'indonesian'];
        this.url = 'https://novelringan.com';

        this.novelContentQuery = 'div.entry-content';
    }

    async _getMangas() {
        let request = new Request(this.url + '/daftar-novel', this.requestOptions);
        let data = await this.fetchDOM(request, 'div.blix ul li a');
        return data.map(element => {
            return {
                id: this.getRootRelativeOrAbsoluteLink(element, this.url),
                title: element.text.trim(),
            };
        });
    }

    async _getChapters(manga) {
        let request = new Request(this.url + manga.id, this.requestOptions);
        let data = await this.fetchDOM(request, 'div.bxcl ul li a');
        return data.map(element => {
            return {
                id: this.getRootRelativeOrAbsoluteLink(element, this.url),
                title: element.text.trim(),
                language: '',
            };
        });
    }

    async _getPages(chapter) {
        let request = new Request(this.url + chapter.id, this.requestOptions);
        return [ await Engine.Request.fetchNovel(request, this.novelContentQuery) ];
    }

    async _getMangaFromURI(uri) {
        let request = new Request(uri, this.requestOptions);
        let data = await this.fetchDOM(request, 'h1.entry-title');
        let id = uri.pathname;
        let title = data[0].textContent.trim();

        return new Manga(this, id, title);
    }
}
