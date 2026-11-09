import Connector from '../engine/Connector.mjs';
import Manga from '../engine/Manga.mjs';

/*
 * Kaguya ID: a Next.js site whose data comes from an API of its own (tsuki.kaguya.re): the list of the comics, a comic
 * with its chapters, and the images of a chapter, which the API delivers for signed tokens. The reader of the site asks
 * for the tokens of a chapter on the site itself (/api/reader/<chapter>/pages). Some chapters are for premium members
 * only and stay locked.
 */
export default class Kaguya extends Connector {
    constructor() {
        super();
        super.id = 'kaguya';
        super.label = 'Kaguya';
        this.tags = ['manga', 'webtoon', 'hentai', 'indonesian', 'scanlation'];
        this.api = 'https://tsuki.kaguya.re/api/v1';
        this.config = {
            url: {
                label: 'URL',
                description: `This website changes its domain regularly.\nThis is the default URL which can also be manually set by the user.`,
                input: 'text',
                value: 'https://01.kaguya.re',
            },
        };

        // the API and the images want the website as origin and referrer, which follows the setting
        Engine.Settings.addEventListener('loaded', this._applyURL.bind(this));
        Engine.Settings.addEventListener('saved', this._applyURL.bind(this));
        this._applyURL();
    }

    get url() {
        // an origin, without a slash at the end: canHandleURI compares it with the origin of a link
        return this.config.url.value.trim().replace(/\/+$/, '');
    }

    set url(value) {
        if (this.config && value) {
            this.config.url.value = value;
            Engine.Settings.save();
        }
    }

    canHandleURI(uri) {
        // the links of the earlier domains (02.kaguya.pro, ...) as well
        return uri.origin === this.url || /^https?:\/\/\d+\.kaguya\.(re|pro)$/.test(uri.origin);
    }

    _applyURL() {
        this.requestOptions.headers.set('x-referer', this.url + '/');
        this.requestOptions.headers.set('x-origin', this.url);
    }

    // the site needs no cookie of its pages
    async _initializeConnector() {}

    _apiRequest(path) {
        return new Request(new URL(path, this.api + '/'), this.requestOptions);
    }

    async _getMangas() {
        const mangas = [];
        for (let page = 1, last = 1; page <= last; page++) {
            const { data } = await this.fetchJSON(
                this._apiRequest(`comics?limit=100&page=${page}&sort=az`),
            );
            last = data.meta.totalPages;
            mangas.push(...data.data.map(({ slug, title }) => ({ id: slug, title: title.trim() })));
        }
        return mangas;
    }

    async _getChapters(manga) {
        const { data } = await this.fetchJSON(
            this._apiRequest(`comics/${encodeURIComponent(manga.id)}`),
        );
        return data.chapters.map(({ id, number, title, isLocked }) => ({
            id,
            title: [
                `Chapter ${number}`,
                title ? `- ${title.trim()}` : '',
                isLocked ? '[Premium]' : '',
            ]
                .filter(Boolean)
                .join(' '),
            language: '',
        }));
    }

    async _getPages(chapter) {
        // asked like the reader of the site asks, from the page of the chapter (same origin): a request from another
        // site gets only the first ten pages
        const request = new Request(
            new URL(`/api/reader/${chapter.id}/pages`, this.url),
            this.requestOptions,
        );
        request.headers.set(
            'x-referer',
            `${this.url}/comic/${chapter.manga.id}/chapter/${chapter.id}`,
        );
        request.headers.set('accept', '*/*');
        request.headers.set('content-type', 'application/json');
        request.headers.set('x-sec-fetch-site', 'same-origin');
        const response = await fetch(request);
        const answer = await response.json().catch(() => undefined);
        if (response.status === 403 || (answer && answer.data && answer.data.locked)) {
            throw new Error(`"${chapter.title}" is for the premium members of Kaguya only.`);
        }
        if (!response.ok || !answer || !answer.data) {
            throw new Error(
                `Failed to receive the pages of "${chapter.title}" (status: ${response.status})`,
            );
        }
        return [...answer.data.pages]
            .sort((a, b) => a.order - b.order)
            .map(
                ({ token }) =>
                    `${this.api}/media/chapter/deliver?token=${encodeURIComponent(token)}`,
            );
    }

    async _getMangaFromURI(uri) {
        // the page of a comic (/comic/<slug>) or of one of its chapters (/comic/<slug>/chapter/<id>)
        const [, kind, slug] = uri.pathname.split('/');
        if (kind !== 'comic' || !slug) {
            throw new Error(`This is no link of a comic of Kaguya: ${uri.href}`);
        }
        const { data } = await this.fetchJSON(
            this._apiRequest(`comics/${encodeURIComponent(slug)}`),
        );
        return new Manga(this, data.slug, data.title.trim());
    }
}
