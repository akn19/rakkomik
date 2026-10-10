import Connector from '../engine/Connector.mjs';
import Manga from '../engine/Manga.mjs';

export default class Mangaz extends Connector {

    constructor() {
        super();
        super.id = 'mangaz';
        super.label = 'Manga Library Z (マンガ図書館Z)';
        this.tags = ['manga', 'japanese'];
        this.url = 'https://www.mangaz.com';
    }

    async _getMangas() {
        let mangaList = [];
        for(let page = 0, run = true; run; page++) {
            let mangas = await this._getMangasFromPage(page);
            mangas.length > 0 ? mangaList.push(...mangas) : run = false;
        }
        return mangaList;
    }

    async _getMangasFromPage(page) {
        const request = new Request(new URL('/title/addpage_renewal?query=&page='+page, this.url), {
            method:'GET',
            headers: {
                'X-Requested-With': 'XMLHttpRequest'
            }
        });
        const data = await this.fetchDOM(request, 'h4 > a');
        return data.map(element => {
            return {
                id: this.getRootRelativeOrAbsoluteLink(element, request.url),
                title: element.text.trim()
            };
        });
    }

    async _getMangaFromURI(uri) {
        const request = new Request(uri, this.requestOptions);
        const data = await this.fetchDOM(request, 'li.title');
        const id = uri.pathname + uri.search;
        const title = data[0].textContent.trim();
        return new Manga(this, id, title);
    }

    async _getPages(chapter) {
        // the viewer scrambles every image into crops, `scramble` tells how to put them back
        const script = `
            new Promise(resolve => {
                const jNamespace = JCOMI.namespace("JCOMI.document");
                const jDocument = jNamespace.getDoc();
                const enc = jDocument.Location.enc ? 'enc' : 'anne';
                const imgs = jNamespace.getOrders().map(ele => {
                    const img = jNamespace.getLocationDirAnne(enc) + ele.name + "?" + jDocument.verkey;
                    return { img, scrambleData: ele.scramble };
                });
                resolve(imgs);
            });
        `;
        const request = new Request(new URL(chapter.id, this.url), this.requestOptions);
        const data = await Engine.Request.fetchUI(request, script, 2500);
        return data.map(({ img, scrambleData }) => this.createConnectorURI({
            url: this.getAbsolutePath(img, request.url),
            scramble: scrambleData
        }));
    }

    async _handleConnectorURI(payload) {
        const response = await fetch(new Request(payload.url, this.requestOptions));
        const blob = await response.blob();
        if(!payload.scramble || !payload.scramble.crops) {
            const data = await this._blobToBuffer(blob);
            this._applyRealMime(data);
            return data;
        }
        const { crops, h, w } = payload.scramble;
        const image = await createImageBitmap(blob);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        for(const crop of crops) {
            ctx.drawImage(image, crop.x2, crop.y2, crop.w, crop.h, crop.x, crop.y, crop.w, crop.h);
        }
        const descrambled = await new Promise(resolve => {
            canvas.toBlob(resolve, Engine.Settings.recompressionFormat.value, parseFloat(Engine.Settings.recompressionQuality.value) / 100);
        });
        return this._blobToBuffer(descrambled);
    }

    async _getChapters(manga) {
        const request = new Request(new URL(manga.id, this.url), this.requestOptions);
        const data = await this.fetchDOM(request, 'body');
        return data[0].querySelector("li.item") ? [...data[0].querySelectorAll("li.item")].map(ele => {
            return{
                id:ele.querySelector('button').dataset['url'].replace('navi', 'virgo/view'),
                title:ele.querySelector('span').textContent.trim()
            };
        }): [{
            id:data[0].querySelector('button').dataset['url'].replace('navi', 'virgo/view'),
            title:manga.title
        }];
    }
}
