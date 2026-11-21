import Connector from '../engine/Connector.mjs';
import Manga from '../engine/Manga.mjs';

export default class ShinigamiID extends Connector {
    constructor() {
        super();
        super.id = 'shinigamiid';
        super.label = 'Shinigami ID';
        this.tags = ['manga', 'manhua', 'manhwa', 'indonesian', 'scanlation'];
        this.url = 'https://s1.shinigami.mx';
        // the API moved with the site (it was api.shngm.io), as the extension of Keiyoushi has it since 2026-11-20
        this.apiUrl = 'https://api.shinigami.io/v1/';
        this.config = {
            url: {
                label: 'URL',
                description:
                    'This website changes their URL regularly.\nThis is the last known URL which can also be manually set by the user.',
                input: 'text',
                value: 'https://s1.shinigami.mx',
            },
        };
    }

    get url() {
        return this.config.url.value;
    }

    set url(value) {
        if (this.config && value) {
            this.config.url.value = value;
            Engine.Settings.save();
        }
    }

    canHandleURI(uri) {
        // the links of the earlier domains (09.shinigami.asia, ...) as well
        return /^https?:\/\/([a-z0-9-]+\.)?shinigami\.(mx|asia)$/.test(uri.origin);
    }

    async _initializeConnector() {
        let uri = new URL(this.url);
        let request = new Request(uri.href, this.requestOptions);
        this.url = await Engine.Request.fetchUI(request, 'window.location.origin');
        console.log(`Assigned URL '${this.url}' to ${this.label}`);
    }

    _apiRequest(path) {
        const request = new Request(new URL(path, this.apiUrl), this.requestOptions);
        request.headers.set('accept', 'application/json');
        return request;
    }

    async _getMangaFromURI(uri) {
        // the page of a series: /series/<id>
        const [, kind, id] = uri.pathname.split('/');
        if (kind !== 'series' || !id) {
            throw new Error(`This is no link of a series of ${this.label}: ${uri.href}`);
        }
        const { data } = await this.fetchJSON(this._apiRequest(`./manga/detail/${id}`));
        return new Manga(this, data.manga_id, data.title.trim());
    }

    async _getMangas() {
        const mangas = [];
        for (let offset = 0, more = true; more; offset += 100) {
            // the API takes three requests a second
            if (offset > 0) {
                await this.wait(350);
            }
            const { data, meta } = await this.fetchJSON(
                this._apiRequest(`./manga/list?offset=${offset}&limit=100`),
            );
            mangas.push(
                ...data.map((manga) => ({ id: manga.manga_id, title: manga.title.trim() })),
            );
            more = data.length > 0 && meta.has_next;
        }
        return mangas;
    }

    async _getChapters(manga) {
        // the chapters come in pages that a cursor leads through: 500 a page (12 when the request names no limit)
        const chapters = [];
        for (let cursor = null, more = true; more;) {
            const query = cursor ? `limit=500&cursor=${encodeURIComponent(cursor)}` : 'limit=500';
            const { data, meta } = await this.fetchJSON(
                this._apiRequest(`./chapter/${manga.id}/list?${query}`),
            );
            chapters.push(
                ...data.map((chapter) => ({
                    id: chapter.chapter_id,
                    title: ['Chapter', chapter.chapter_number, chapter.chapter_title]
                        .join(' ')
                        .trim(),
                })),
            );
            cursor = meta.next_cursor;
            more = data.length > 0 && meta.has_next && !!cursor;
        }
        return chapters;
    }

    async _getPages(chapter) {
        const { data } = await this.fetchJSON(this._apiRequest(`./chapter/detail/${chapter.id}`));
        return data.chapter.data.map(
            (image) => new URL(`${data.chapter.path}${image}`, data.base_url).href,
        );
    }
}
