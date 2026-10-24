import Connector from '../engine/Connector.mjs';
import Manga from '../engine/Manga.mjs';

export default class Voratoon extends Connector {
    constructor() {
        super();
        super.id = 'voratoon';
        super.label = 'Voratoon';
        this.tags = ['manga', 'manhwa', 'manhua', 'indonesian'];
        this.config = {
            url: {
                label: 'URL',
                description: `This website changes its domain regularly.\nThis is the default URL which can also be manually set by the user.`,
                input: 'text',
                value: 'https://voratoon.co',
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

    get api() {
        // a proxy on the host of the website (the API had a host of its own, api.voratoon.com)
        return this.url + '/api/proxy/';
    }

    canHandleURI(uri) {
        // the links of the earlier domains (v1, v2, ... of voratoon.com) as well
        return uri.origin === this.url || /^https?:\/\/v\d+\.voratoon\.com$/.test(uri.origin);
    }

    _applyURL() {
        this.requestOptions.headers.set('x-referer', this.url + '/');
        this.requestOptions.headers.set('x-origin', this.url);
    }

    /**
     * The proxy answers 403 until the website has set its cookie (vt_proxy): the home page sets it, then the request is
     * sent once more. The proxy wants the requests of the website itself (same origin).
     */
    async fetchAPI(path, retry = true) {
        const request = new Request(new URL(path, this.api), this.requestOptions);
        request.headers.set('accept', 'application/json');
        request.headers.set('x-sec-fetch-site', 'same-origin');
        const response = await this._countedFetch(request);
        if (response.status === 403 && retry) {
            await this._countedFetch(new Request(this.url + '/', this.requestOptions));
            return this.fetchAPI(path, false);
        }
        if (response.status !== 200) {
            throw new Error(
                `Failed to receive content from "${request.url}" (status: ${response.status}) - ${response.statusText}`,
            );
        }
        return response.json();
    }

    async _getMangaFromURI(uri) {
        const slug = uri.pathname.split('/').pop();
        const data = await this.fetchAPI(`series/${slug}`);
        return new Manga(this, data.data.data.slug, data.data.data.title.trim());
    }

    async _getMangas() {
        let mangaList = [];
        for (let page = 1, run = true; run; page++) {
            // the proxy takes three requests a second
            if (page > 1) {
                await this.wait(350);
            }
            const { mangas, lastPage } = await this._getMangasFromPage(page);
            mangaList.push(...mangas);
            run = mangas.length > 0 && page < lastPage;
        }
        return mangaList;
    }

    async _getMangasFromPage(page) {
        // a page has at most 100 series
        const data = await this.fetchAPI(`series?take=100&page=${page}&includeMeta=true`);
        return {
            mangas: data.data.map((series) => {
                return {
                    id: series.data.slug,
                    title: series.data.title.trim(),
                };
            }),
            // without the meta data the pages run until one is empty
            lastPage: data.meta?.lastPage ?? Infinity,
        };
    }

    async _getChapters(manga) {
        const data = await this.fetchAPI(`series/${manga.id}/chapters`);
        return data.data.map((entry) => {
            return {
                id: entry.data.index,
                title: [`Chapter ${entry.data.index}`, entry.data.title || ''].join(' ').trim(),
            };
        });
    }

    async _getPages(chapter) {
        const data = await this.fetchAPI(`series/${chapter.manga.id}/chapters/${chapter.id}`);
        return data.data.data.images;
    }
}
