import WordPressMangastream from './templates/WordPressMangastream.mjs';

export default class Luvyaa extends WordPressMangastream {
    constructor() {
        super();
        super.id = 'luvyaa';
        super.label = 'Luvyaa';
        this.tags = ['manga', 'webtoon', 'indonesian'];
        this.url = 'https://v5.luvyaa.co';
        this.path = '/manga/list-mode/';
    }
}
