import Connector from '../engine/Connector.mjs';
import Manga from '../engine/Manga.mjs';

/*
 * comix.to protects its API with a request signature and encrypted responses, and the scheme
 * changes from time to time. So the connector does not re-implement it: a hidden window opens a
 * page of the site, finds the site's own API clients in the (already loaded) bundles and calls them
 * there (same approach as the web-view fallback of the Keiyoushi extension and HaruNeko's DRM provider).
 * Images may be XOR encrypted and/or tile scrambled, announced by `X-Enc-*` / `X-Scramble-*` headers.
 */

const SCRAMBLE_INITS = { '03632': 58414, '02900': 117532 };

// Finds the manga API client (`list`, `chapters`, ...) and the generic HTTP client (`get`, `post`, ...) of the site.
const DISCOVER_SCRIPT = `
    const mainSrc = document.querySelector('script[type=module][src*="/dist/main-"]').src;
    const mainJavaScript = await (await fetch(mainSrc)).text();
    const bundleFiles = Array.from(mainJavaScript.matchAll(/from\\s*["']\\.\\/([^"']+\\.js)["']/g), match => match[1]);
    const importBundle = new Function('url', 'return import(url)');
    let mangaApi = null;
    let http = null;
    for (const bundleFile of bundleFiles) {
        let bundle;
        try {
            bundle = await importBundle(new URL(bundleFile, mainSrc).href);
        } catch (error) {
            continue;
        }
        for (const value of Object.values(bundle)) {
            if (value && typeof value === 'object') {
                if (typeof value.chapters === 'function' && typeof value.list === 'function') {
                    mangaApi = value;
                }
                if (typeof value.get === 'function' && typeof value.post === 'function' && typeof value.patch === 'function') {
                    http = value;
                }
            }
        }
    }
    if (!mangaApi || !http) {
        throw new Error('Could not find the API clients of the website!');
    }
`;

function hasImageSignature(bytes) {
    const webp = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
    const jpeg = bytes[0] === 0xFF && bytes[1] === 0xD8;
    const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47;
    return bytes.length >= 12 && (webp || jpeg || png);
}

function xorShift32(state) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state | 0;
}

function decryptWithXorShift32(encrypted, key, limit, highByte) {
    const bytes = new Uint8Array(encrypted);
    let state = key | 0;
    for(let index = 0; index < Math.min(bytes.length, limit); index++) {
        state = xorShift32(state);
        bytes[index] ^= highByte ? state >>> 24 : state & 0xFF;
    }
    return bytes;
}

function decryptWithLCG(encrypted, key, limit) {
    const bytes = new Uint8Array(encrypted);
    for(let index = 0; index < Math.min(bytes.length, limit); index++) {
        key = Math.imul(key, 1000005) + 1234567891 | 0;
        bytes[index] ^= key >>> 24;
    }
    return bytes;
}

/**
 * Decrypt the first `limit` bytes of an image; the algorithm is not always announced, so the
 * variants are tried until the result looks like an image.
 */
export function decryptImage(encrypted, key, limit) {
    const decryptions = [
        () => decryptWithXorShift32(encrypted, key | 1, limit, true),
        () => decryptWithXorShift32(encrypted, key, limit, true),
        () => decryptWithXorShift32(encrypted, key | 1, limit, false),
        () => decryptWithXorShift32(encrypted, key, limit, false),
        () => decryptWithLCG(encrypted, key | 1, limit),
        () => decryptWithLCG(encrypted, key, limit)
    ];
    for(const decrypt of decryptions) {
        const bytes = decrypt();
        if(hasImageSignature(bytes)) {
            return bytes;
        }
    }
    return undefined;
}

/**
 * Tile order of a scrambled image: `order[destination] = source` (a seeded Fisher-Yates shuffle, inversed).
 */
export function scrambleOrder(count, hash, seedModifier, algorithm) {
    const salt = (SCRAMBLE_INITS[hash] || 0) ^ seedModifier;
    const xorShift = algorithm === '3';
    let state = xorShift ? salt | 1 : salt;
    const indices = Array.from({ length: Math.max(1, count) }, (_, index) => index);
    for(let current = indices.length - 1; current > 0; current--) {
        if(xorShift) {
            state = xorShift32(state);
        } else {
            state = Math.imul(state, 1664525) + 1013904223 | 0;
        }
        const random = (state >>> 0) % (current + 1);
        [indices[current], indices[random]] = [indices[random], indices[current]];
    }
    const inverse = new Array(count);
    indices.forEach((source, destination) => {
        inverse[source] = destination;
    });
    return inverse;
}

export default class ComixTo extends Connector {

    constructor() {
        super();
        super.id = 'comixto';
        super.label = 'Comix (.to)';
        this.tags = [ 'manga', 'manhwa', 'manhua', 'english' ];
        this.url = 'https://comix.to';
    }

    canHandleURI(uri) {
        return /^https?:\/\/comix\.to/.test(uri.href);
    }

    /**
     * Run a script with `mangaApi` and `http` (the clients of the site) in a hidden window of the given page.
     */
    async _callSite(page, body, timeout) {
        const script = `(async () => { ${DISCOVER_SCRIPT} ${body} })()`;
        return Engine.Request.fetchUI(new Request(new URL(page, this.url), this.requestOptions), script, timeout || 120000);
    }

    _mangaHash(manga) {
        return manga.id.split('/')[2].split('-')[0];
    }

    async _getMangaFromURI(uri) {
        const id = '/' + uri.pathname.split('/').filter(Boolean).slice(0, 2).join('/');
        const request = new Request(new URL(id, this.url), this.requestOptions);
        const data = await this.fetchDOM(request, 'meta[property="og:title"]');
        return new Manga(this, id, data[0].content.trim());
    }

    async _getMangas() {
        return this._callSite('/', `
            const mangas = [];
            for (let page = 1; ; page++) {
                const { items, meta } = await mangaApi.list({ page, limit: 100 });
                mangas.push(...items.map(item => ({ id: item.url, title: item.title })));
                if (!items.length || !meta || !meta.hasNext) {
                    break;
                }
            }
            return mangas;
        `, 3600000);
    }

    async _getChapters(manga) {
        const hash = this._mangaHash(manga);
        const chapters = await this._callSite(manga.id, `
            const chapters = [];
            for (let page = 1; ; page++) {
                const { items, meta } = await mangaApi.chapters(${JSON.stringify(hash)}, { page, limit: 100, order: { number: 'desc' } });
                chapters.push(...items.map(({ id, number, name, group, url }) => ({ id, number, name, group: group && group.name, url })));
                if (!items.length || !meta || !meta.hasNext) {
                    break;
                }
            }
            return chapters;
        `, 600000);
        return chapters.map(({ id, number, name, group, url }) => ({
            id: url || `${manga.id}/${id}-chapter-${number}`,
            title: number + (name ? ` - ${name}` : '') + (group ? ` [${group}]` : '')
        }));
    }

    async _getPages(chapter) {
        const chapterId = chapter.id.match(/\/(\d+)-chapter-[^/]*$/)[1];
        const { baseUrl, items } = await this._callSite(chapter.id, `
            const { pages } = await http.get('/chapters/${chapterId}');
            return { baseUrl: pages.baseUrl || '', items: pages.items };
        `);
        const base = baseUrl.replace(/\/+$/, '');
        return items.map(({ url, s }) => {
            let link = /^https?:/.test(url) ? url : base + '/' + url.replace(/^\/+/, '');
            // V3 pages need the flag, so the server announces the scramble headers
            const isV3 = s === 1 || /[?&]v3(&|=|$)/.test(link);
            if(isV3 && !/[?&]v3(&|=|$)/.test(link)) {
                link += (link.includes('?') ? '&' : '?') + 'v3';
            }
            return this.createConnectorURI({ url: link, v3: isV3 });
        });
    }

    async _handleConnectorURI(payload) {
        // the image hosts (behind Cloudflare) block requests that carry a Referer or Origin
        const response = await fetch(new Request(payload.url, this.requestOptions));
        let bytes = new Uint8Array(await response.arrayBuffer());

        const encryptionSeed = parseInt(response.headers.get('X-Enc-Seed'), 10);
        const encryptionLimit = parseInt(response.headers.get('X-Enc-Len'), 10);
        if(encryptionSeed && encryptionLimit) {
            const decrypted = decryptImage(bytes, encryptionSeed, encryptionLimit);
            if(!decrypted) {
                throw new Error('Failed to decrypt the image!');
            }
            bytes = decrypted;
        }

        const grid = response.headers.get('X-Scramble-Grid');
        const algorithm = response.headers.get('X-Scramble-Algo');
        if(!grid || !algorithm) {
            const data = await this._blobToBuffer(new Blob([bytes], { type: response.headers.get('Content-Type') || '' }));
            this._applyRealMime(data);
            return data;
        }

        const [rows, columns] = grid.split('x').map(value => parseInt(value, 10));
        const image = await createImageBitmap(new Blob([bytes]));
        const tileWidth = Math.floor(image.width / columns);
        const tileHeight = Math.floor(image.height / rows);
        const order = scrambleOrder(rows * columns, (response.headers.get('X-Scramble-Hash') || '').trim(), parseInt(response.headers.get('X-Scramble-Seed'), 10) || 0, algorithm);
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0);
        order.forEach((source, destination) => {
            context.drawImage(
                image,
                source % columns * tileWidth, Math.floor(source / columns) * tileHeight, tileWidth, tileHeight,
                destination % columns * tileWidth, Math.floor(destination / columns) * tileHeight, tileWidth, tileHeight
            );
        });
        const blob = await new Promise(resolve => {
            canvas.toBlob(resolve, Engine.Settings.recompressionFormat.value, parseFloat(Engine.Settings.recompressionQuality.value) / 100);
        });
        return this._blobToBuffer(blob);
    }
}
