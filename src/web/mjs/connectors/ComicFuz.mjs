import Connector from '../engine/Connector.mjs';
import { loadProtobuf } from '../engine/Protobuf.mjs';
import Manga from '../engine/Manga.mjs';
import { hexToBytes, aesCbcDecrypt } from '../engine/Crypto.mjs';

export default class ComicFuz extends Connector {

    constructor() {
        super();
        super.id = 'comicfuz';
        super.label = 'COMIC FUZ';
        this.tags = ['manga', 'japanese'];
        this.url = 'https://comic-fuz.com';
        this.apiUrl = 'https://api.comic-fuz.com';
        this.imgUrl = 'https://img.comic-fuz.com';
        this.protoTypes = '/mjs/connectors/ComicFuz.proto';
    }

    async _getMangaFromURI(uri) {
        const id = uri.pathname.split('/').pop();
        const data = await this._fetchMangaDetail(id);
        return new Manga(this, id, data.manga.title);
    }

    async _getMangas() {
        const uri = new URL('v1/mangas_by_day_of_week', this.apiUrl);
        const requestType = 'ComicFuz.MangasByDayOfWeekRequest';
        const responseType = 'ComicFuz.MangasByDayOfWeekResponse';
        const payload = {
            deviceInfo: {
                deviceType: 2
            },
            dayOfWeek: 0
        };
        const request = await this._createPROTORequest(uri, requestType, payload);
        const data = await this.fetchPROTO(request, this.protoTypes, responseType);
        return data.mangas;
    }

    async _getChapters(manga) {
        const data = await this._fetchMangaDetail(manga.id);
        const chapters = [];
        data.chapters.forEach(chapterGroup => {
            chapters.push(...chapterGroup.chapters);
        });
        return chapters;
    }

    async _getPages(chapter) {
        const uri = new URL('v1/manga_viewer', this.apiUrl);
        const requestType = 'ComicFuz.MangaViewerRequest';
        const responseType = 'ComicFuz.MangaViewerResponse';
        const payload = {
            deviceInfo: {
                deviceType: 2
            },
            chapterId: chapter.id,
            useTicket: false,
            consumePoint: {
                event: 0,
                paid: 0
            }
        };
        const request = await this._createPROTORequest(uri, requestType, payload);
        let data;
        try {
            data = await this.fetchPROTO(request, this.protoTypes, responseType);
        } catch (error) {
            throw new Error(`The chapter '${chapter.title}' is neither public, nor purchased!`);
        }
        return data.pages
            .filter(page => page.image && page.image.imageUrl)
            .map(page => this.createConnectorURI(page.image));
    }

    async _handleConnectorURI(payload) {
        const uri = new URL(payload.imageUrl, this.imgUrl);
        const request = new Request(uri, this.requestOptions);
        const response = await fetch(request);
        let buffer = await response.arrayBuffer();
        if (payload.encryptionKey) {
            const key = hexToBytes(payload.encryptionKey);
            const iv = hexToBytes(payload.iv);
            const decrypted = await aesCbcDecrypt(new Uint8Array(buffer), key, iv);
            buffer = {
                mimeType: response.headers.get('content-type'),
                data: decrypted
            };
        } else {
            buffer = {
                mimeType: response.headers.get('content-type'),
                data: new Uint8Array(buffer)
            };
        }
        this._applyRealMime(buffer);
        return buffer;

    }

    async _createPROTORequest(uri, rootType, payload) {
        const root = await (await loadProtobuf()).load(this.protoTypes);
        const messageType = root.lookupType(rootType);
        const message = messageType.encode(payload);
        return new Request(uri, {
            ...this.requestOptions,
            body: message.finish(),
            method: 'POST'
        });
    }

    async _fetchMangaDetail(id) {
        const uri = new URL('v1/manga_detail', this.apiUrl);
        const requestType = 'ComicFuz.MangaDetailRequest';
        const responseType = 'ComicFuz.MangaDetailResponse';
        const payload = {
            deviceInfo: {
                deviceType: 2,
            },
            mangaId: id
        };
        const request = await this._createPROTORequest(uri, requestType, payload);
        return this.fetchPROTO(request, this.protoTypes, responseType);
    }
}
