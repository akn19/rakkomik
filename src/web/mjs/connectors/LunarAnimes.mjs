import Connector from '../engine/Connector.mjs';
import Manga from '../engine/Manga.mjs';
import {
    sha256Bytes,
    base64ToBytes,
    bytesToBase64,
    bytesToUtf8,
    utf8ToBytes,
    aesCbcDecrypt,
} from '../engine/Crypto.mjs';

/*
 * Lunar (https://lunarx.to) protects the images of a chapter: a client component of the page of the chapter makes two seed
 * strings (its code runs in a window of the site), a token made from them names the chapter, and the answer is an encrypted
 * list of the images. The request of that list carries the proof of a key pair that the client makes up by itself (only that
 * one: a key that signed other requests gets fake images), and a Turnstile token from time to time. Some images come with a
 * veil: patches that cover the banners burned into them, drawn over the image as the reader of the site does.
 * This is the port of the extension of Keiyoushi (all/lunaranime: LunarAnime, LunarDecryptor, LunarSerenity, VeilInterceptor,
 * Dto, lunar-seed-runtime.js).
 */

const SEPARATOR = '\u0001';
const THUMBPRINT_SEPARATOR = '\u0002';
const ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const NONCE_LENGTH = 12;
const PROOF_HEADER = 'cant-catch-this-monkey';
// the images that are made up for a visitor who is not verified
const DECOY_PATH = '/api/cdn/p/';
// the pages between the pages (advertisements): a real list has them, a fake one has none
const INTERSTITIAL_PATH = '/api/manga/pg/';
// the vault answers 503 while it prepares a file: the reader of the site asks again after 600 ms, 1200 ms, ...
const RETRY_STEP = 600;
const PAGE_RETRIES = 4;
const VEIL_RETRIES = 3;
const DEFAULT_CLEARANCE_TTL = 300;
const CLEARANCE_MARGIN = 30;

// what the window of the check shows while it runs (the check is shown in it, and the visitor can do it there)
const CHECK_PAGE = (
    host,
) => `<!DOCTYPE html><html><head><meta charset="utf-8"><title>RakKomik: check of ${host}</title>
<style>
body { margin: 0; min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1em; font: 16px system-ui, sans-serif; background: #1b1b1b; color: #eee; }
p { max-width: 28em; margin: 0; text-align: center; }
</style></head><body>
<p>RakKomik does the check of ${host} that is needed to download the chapter.</p>
<div id="check"></div>
<p>This window closes when the check is done. If the check asks for something, do it here.</p>
</body></html>`;

// ============================== Encoding ===============================

function base64UrlEncode(bytes) {
    return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * The decoding of Android: the padding is optional, any other character that is not of the alphabet is an error.
 */
function base64Decode(text) {
    const clean = String(text).replace(/\s+/g, '').replace(/=+$/, '');
    if (/[^A-Za-z0-9+/]/.test(clean) || clean.length % 4 === 1) {
        throw new Error('Invalid base64!');
    }
    return base64ToBytes(clean.padEnd(Math.ceil(clean.length / 4) * 4, '='));
}

function randomInt(bound) {
    return crypto.getRandomValues(new Uint32Array(1))[0] % bound;
}

function randomString(length, random) {
    let text = '';
    for (let index = 0; index < length; index++) {
        text += ALPHABET[random(ALPHABET.length)];
    }
    return text;
}

// ========================= Flight data of Next.js ==========================

const FLIGHT_PUSH = /self\.__next_f\.push\(\s*(\[[\s\S]*\])\s*\)\s*;?\s*$/;
const NEWLINE = 0x0a;
const COLON = 0x3a;
const COMMA = 0x2c;
const TEXT_ROW = 0x54;

/**
 * The rows of the flight data of a page, in their order: `<id>:<value>`, where a value is a line, or `T<length>,<text>`
 * with the length of the text in bytes of UTF-8. Every push is a slice of one stream, cut anywhere (often in the middle
 * of a row), so the slices are joined first: `[1, text]` carries text, `[3, base64]` bytes, the other kinds no data.
 * @param {string[]} scripts the text of the scripts of the page that have no source
 * @returns {{id: string, value: string}[]}
 */
export function flightRows(scripts) {
    const parts = [];
    for (const script of scripts.filter((text) => text.includes('self.__next_f.push'))) {
        try {
            const pushed = JSON.parse(FLIGHT_PUSH.exec(script.trim())[1]);
            if (pushed[0] === 1 && typeof pushed[1] === 'string') {
                parts.push(utf8ToBytes(pushed[1]));
            } else if (pushed[0] === 3 && typeof pushed[1] === 'string') {
                parts.push(base64ToBytes(pushed[1]));
            }
        } catch {
            /* a script of another kind */
        }
    }
    const bytes = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
    parts.reduce((offset, part) => {
        bytes.set(part, offset);
        return offset + part.length;
    }, 0);

    const rows = [];
    let position = 0;
    while (position < bytes.length) {
        if (bytes[position] === NEWLINE) {
            position++;
            continue;
        }
        const colon = bytes.indexOf(COLON, position);
        if (colon === -1) {
            break;
        }
        const id = bytesToUtf8(bytes.subarray(position, colon));
        position = colon + 1;
        let end;
        if (bytes[position] === TEXT_ROW) {
            const comma = bytes.indexOf(COMMA, position);
            const length = parseInt(bytesToUtf8(bytes.subarray(position + 1, comma)), 16);
            position = comma + 1;
            end = Math.min(bytes.length, position + (Number.isNaN(length) ? 0 : length));
        } else {
            end = bytes.indexOf(NEWLINE, position);
            end = end === -1 ? bytes.length : end;
        }
        rows.push({ id, value: bytesToUtf8(bytes.subarray(position, end)) });
        position = end;
    }
    return rows;
}

// ================================ Seeds ================================

/**
 * The props of an element of a client component (`["$", "$L<id>", key, props]`) that can be the seeds: texts only.
 */
function seedProps(element) {
    if (element.length !== 4 || element[0] !== '$') {
        return null;
    }
    if (typeof element[1] !== 'string' || !element[1].startsWith('$L')) {
        return null;
    }
    const props = element[3];
    if (props === null || typeof props !== 'object' || Array.isArray(props)) {
        return null;
    }
    const values = Object.values(props);
    return values.length > 0 && values.every((value) => typeof value === 'string') ? props : null;
}

function forEachSeedElement(element, visit) {
    if (Array.isArray(element)) {
        const props = seedProps(element);
        if (props) {
            visit(element[1].substring(2), props);
        }
        element.forEach((entry) => forEachSeedElement(entry, visit));
    } else if (element !== null && typeof element === 'object') {
        Object.values(element).forEach((entry) => forEachSeedElement(entry, visit));
    }
}

// the row of an id that is in effect at a row: the ids repeat across the flight streams of a page
function rowBefore(rows, id, index) {
    for (let at = index - 1; at >= 0; at--) {
        if (rows[at].id === id) {
            return { at, value: rows[at].value };
        }
    }
    return null;
}

/**
 * The client component of a reference: its row is `I[<module id>, [<chunks>], ...]`, and a chunk is a path or a reference
 * (`$<id>`) to a row that holds the path.
 */
function componentAt(rows, id, index, pageUrl) {
    const row = rowBefore(rows, id, index);
    if (!row || !row.value.startsWith('I[')) {
        return null;
    }
    let reference;
    try {
        reference = JSON.parse(row.value.substring(1));
    } catch {
        return null;
    }
    const chunkUrls = [];
    for (const chunk of reference[1] || []) {
        let path = chunk;
        if (chunk.startsWith('$')) {
            const holder = rowBefore(rows, chunk.substring(1), row.at);
            try {
                path = holder && JSON.parse(holder.value);
            } catch {
                path = null;
            }
        }
        if (typeof path !== 'string') {
            return null;
        }
        chunkUrls.push(new URL(path, pageUrl).href);
    }
    return { moduleId: reference[0], chunkUrls };
}

/**
 * The seeds come from a client component of the reader: it is given props under names that change with each response, and
 * its code makes the two seeds of them. These are the components of the page that are given texts only, each with its
 * code (module and chunks) and the props that it was given, the ones given the most first.
 * @param {{id: string, value: string}[]} rows the rows of the flight data of the page
 * @param {string} pageUrl the address of the page, that the paths of the chunks are relative to
 * @returns {{moduleId: *, chunkUrls: string[], candidates: Object<string, string>[]}[]}
 */
export function seedGroups(rows, pageUrl) {
    const groups = new Map();
    rows.forEach((row, index) => {
        if (!row.value.startsWith('[') && !row.value.startsWith('{')) {
            return;
        }
        let element;
        try {
            element = JSON.parse(row.value);
        } catch {
            return;
        }
        forEachSeedElement(element, (reference, props) => {
            const component = componentAt(rows, reference, index, pageUrl);
            if (!component) {
                return;
            }
            const key = JSON.stringify([component.moduleId, component.chunkUrls]);
            if (!groups.has(key)) {
                groups.set(key, { ...component, candidates: [] });
            }
            groups.get(key).candidates.push(props);
        });
    });
    const size = (group) =>
        group.candidates.reduce((sum, props) => sum + Object.keys(props).length, 0);
    return [...groups.values()].sort((a, b) => size(b) - size(a));
}

/**
 * Runs in a page of the site with the groups of `seedGroups`: it loads the chunks of a component into a registry of its
 * own (they register with TURBOPACK.push), runs the module of the component with what the code of a component needs,
 * calls it with each of the props, and takes the two texts that the component hands on as `(0, axis)` and `(1, pitch)`.
 * It answers `[axis, pitch]`, or `null`. The script of the extension of Keiyoushi (all/lunaranime, lunar-seed-runtime.js).
 */
export const SEED_RUNTIME = String.raw`(function (groups) {
    const registry = {};
    const cache = {};
    const captured = [null, null];
    const wrapped = new WeakSet();
    const loaded = new Set();
    let activeUrls = [];
    let activeIndex = -1;

    function record(args) {
        if (args.length >= 2 && typeof args[1] === 'string') {
            if (args[0] === 0) {
                captured[0] = args[1];
            } else if (args[0] === 1) {
                captured[1] = args[1];
            }
        }
    }

    function wrap(namespace) {
        if (!namespace || wrapped.has(namespace)) {
            return namespace;
        }
        wrapped.add(namespace);
        const keys = Object.keys(namespace);
        for (let i = 0; i < keys.length; i++) {
            const original = namespace[keys[i]];
            if (typeof original === 'function') {
                namespace[keys[i]] = new Proxy(original, {
                    apply(target, self, args) {
                        record(args);
                        return Reflect.apply(target, self, args);
                    },
                });
            }
        }
        return namespace;
    }

    function loadNext() {
        while (activeIndex >= 0) {
            const url = activeUrls[activeIndex];
            activeIndex -= 1;
            if (loaded.has(url)) {
                continue;
            }
            const xhr = new XMLHttpRequest();
            xhr.open('GET', url, false);
            xhr.send();
            if (xhr.status >= 200 && xhr.status < 300) {
                loaded.add(url);
                (0, eval)(xhr.responseText);
                return true;
            }
            return false;
        }
        return false;
    }

    function ensure(id) {
        while (!registry[id]) {
            if (!loadNext()) {
                return false;
            }
        }
        return true;
    }

    function standin(id) {
        return new Proxy(
            {},
            {
                get(target, name) {
                    if (typeof name !== 'string') {
                        return undefined;
                    }
                    if (/^use(Layout|Insertion)?Effect$/.test(name)) {
                        return (effect) => {
                            effect();
                        };
                    }
                    if (name === 'useMemo') {
                        return (fn) => fn();
                    }
                    if (name === 'useState') {
                        return (init) => [typeof init === 'function' ? init() : init, () => {}];
                    }
                    if (name === 'useRef') {
                        return (init) => ({ current: init });
                    }
                    if (/^use/.test(name) || name === 'memo' || name === 'forwardRef') {
                        return (value) => value;
                    }
                    if (ensure(id)) {
                        return importNs(id)[name];
                    }
                    return undefined;
                },
            },
        );
    }

    function run(id) {
        if (cache[id]) {
            return cache[id];
        }
        const factory = registry[id];
        if (!factory) {
            const empty = { esm: {}, cjs: undefined, usedS: false };
            cache[id] = empty;
            return empty;
        }
        const esm = {};
        let usedS = false;
        const moduleObject = { exports: {} };
        const current = {};
        cache[id] = current;
        const context = {
            i(dependency) {
                return importNs(dependency);
            },
            r(dependency) {
                ensure(dependency);
                const dep = run(dependency);
                return dep.usedS ? dep.esm : dep.cjs;
            },
            s(list) {
                usedS = true;
                for (let k = 0; k < list.length; k += 3) {
                    esm[list[k]] = list[k + 2];
                }
            },
            v(value) {
                moduleObject.exports = value;
            },
            e: globalThis,
            g: globalThis,
            A(dependency) {
                return {
                    then() {
                        return importNs(dependency);
                    },
                };
            },
            n: undefined,
            L: '',
        };
        factory(context, moduleObject, moduleObject);
        current.esm = esm;
        current.cjs = moduleObject.exports;
        current.usedS = usedS;
        return current;
    }

    function importNs(id) {
        if (!registry[id]) {
            return standin(id);
        }
        const module = run(id);
        if (module.usedS) {
            return wrap(module.esm);
        }
        const namespace = wrap(module.cjs);
        if (namespace && namespace.default === undefined) {
            namespace.default = namespace;
        }
        return namespace;
    }

    globalThis.TURBOPACK = {
        push(entry) {
            for (let k = 1; k < entry.length; k += 2) {
                registry[entry[k]] = entry[k + 1];
            }
        },
    };

    for (let g = 0; g < groups.length; g++) {
        const group = groups[g];
        activeUrls = group.chunkUrls;
        activeIndex = group.chunkUrls.length - 1;
        if (!ensure(group.moduleId)) {
            continue;
        }
        const component = run(group.moduleId).esm.default;
        if (typeof component !== 'function') {
            continue;
        }
        const candidates = group.candidates;
        for (let i = 0; i < candidates.length; i++) {
            captured[0] = null;
            captured[1] = null;
            try {
                component(candidates[i]);
            } catch (error) {
                continue;
            }
            if (captured[0] && captured[1]) {
                return [captured[0], captured[1]];
            }
        }
    }
    return null;
})`;

/**
 * The text of the scripts of a page that have no source. What is inside of a script is raw text, so it cannot hold a closing tag.
 * @param {string} html
 * @returns {string[]}
 */
export function inlineScripts(html) {
    return [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
        .filter(([, attributes]) => !/\ssrc\s*=/i.test(' ' + attributes))
        .map(([, , text]) => text);
}

// ============================ Token and session ============================

/**
 * The key of a token is blended from both seeds.
 */
function blendKey(axis, pitch) {
    const digest = sha256Bytes(axis + SEPARATOR + pitch);
    const size = Math.max(axis.length, pitch.length);
    return Array.from(
        { length: size },
        (_, index) =>
            (axis.charCodeAt(index % axis.length) ^
                pitch.charCodeAt(index % pitch.length) ^
                digest[index % 32] ^
                ((83 * index + 29) & 0xff)) &
            0xff,
    );
}

/**
 * The nonce of a token: it goes into the key of the answer (`unpackSession`) and into the check of the site.
 */
export function newNonce(random = randomInt) {
    return randomString(NONCE_LENGTH, random);
}

/**
 * `mint()` of the bundle of the site: a payload with the time that names the chapter, encrypted with a stream of the blended
 * key.
 * @param {{axis: string, pitch: string}} seeds
 * @param {string} slug
 * @param {string} chapter
 * @param {string} nonce see `newNonce`
 * @param {{now?: number, random?: function(number): number}} [options] a clock and a source of random numbers
 * @returns {string} the token
 */
export function mintToken(
    seeds,
    slug,
    chapter,
    nonce,
    { now = Date.now(), random = randomInt } = {},
) {
    const key = blendKey(seeds.axis, seeds.pitch);
    if (!key.length) {
        throw new Error('Failed to derive chapter key!');
    }
    const timestamp = Math.floor(now / 1000).toString(16);
    const payload = `${timestamp}|${nonce}|${slug}|${chapter}|${randomString(6, random)}`;
    const offset = random(256);
    const bytes = [offset];
    for (let index = 0; index < payload.length; index++) {
        bytes.push(
            (payload.charCodeAt(index) ^
                key[(index + offset) % key.length] ^
                ((offset + 83 * index) & 0xff)) &
                0xff,
        );
    }
    return base64UrlEncode(Uint8Array.from(bytes));
}

/**
 * The answer is AES-CBC (no vector) with a key from the first seed, the nonce of the token and, when the server wants it,
 * the thumbprint of the key of the proof.
 * @returns {Promise<string>} the JSON text
 */
export async function unpackSession(sessionData, seeds, nonce, thumbprint) {
    const cipher = base64Decode(sessionData.replace(/-/g, '+').replace(/_/g, '/'));
    const base = seeds.axis + SEPARATOR + nonce;
    for (const material of [base + THUMBPRINT_SEPARATOR + thumbprint, base]) {
        let plain;
        try {
            plain = bytesToUtf8(
                await aesCbcDecrypt(cipher, sha256Bytes(material), new Uint8Array(16)),
            );
        } catch {
            continue;
        }
        if (plain.startsWith('{') || plain.startsWith('[')) {
            return plain;
        }
    }
    throw new Error('Failed to decrypt chapter session data!');
}

// ================================= Proof =================================

/**
 * The key pair of the proof (the "Serenity" of the site) is made up by the client and never issued by the server. The
 * thumbprint (RFC 7638) of its public key is more key material for the session.
 */
export async function createProofKey() {
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, [
        'sign',
        'verify',
    ]);
    const { x, y } = await crypto.subtle.exportKey('jwk', pair.publicKey);
    return {
        privateKey: pair.privateKey,
        x,
        y,
        thumbprint: base64UrlEncode(
            sha256Bytes(`{"crv":"P-256","kty":"EC","x":"${x}","y":"${y}"}`),
        ),
    };
}

/**
 * A DPoP proof (JWT, ES256) for the request: it names the method and the address without the query.
 */
export async function createProof(key, method, url, now = Date.now()) {
    const target = new URL(url);
    const header = JSON.stringify({
        alg: 'ES256',
        typ: 'dpop+jwt',
        jwk: { kty: 'EC', crv: 'P-256', x: key.x, y: key.y },
    });
    const payload = JSON.stringify({
        htu: `${target.protocol}//${target.hostname}${target.pathname}`,
        htm: method.toUpperCase(),
        iat: Math.floor(now / 1000),
        jti: crypto.randomUUID(),
    });
    const input = `${base64UrlEncode(utf8ToBytes(header))}.${base64UrlEncode(utf8ToBytes(payload))}`;
    // WebCrypto signs as r and s one after the other, the form that JOSE wants (a DER sequence is what other APIs give)
    const signature = await crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        key.privateKey,
        utf8ToBytes(input),
    );
    return `${input}.${base64UrlEncode(new Uint8Array(signature))}`;
}

// ================================= Veil =================================

const VEIL_NUMBER = (text) => {
    const value = Number(text);
    if (text === undefined || text === '' || !Number.isFinite(value)) {
        throw new Error('Failed to parse page veil!');
    }
    return value;
};

/**
 * The veil of a page is an SVG of the size of the page with patches: images (base64) at their place. It is made by the
 * server, so its attributes are read as they come.
 * @param {string} svg
 * @returns {{width: number, height: number, patches: {x: number, y: number, width: number, height: number, bytes: Uint8Array}[]}|null}
 */
export function parseVeil(svg) {
    const attributes = (tag) =>
        Object.fromEntries(
            [...tag.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)].map(([, name, value]) => [name, value]),
        );
    const root = /<svg\b[^>]*>/i.exec(svg);
    if (!root) {
        return null;
    }
    const size = attributes(root[0]);
    return {
        width: VEIL_NUMBER(size.width),
        height: VEIL_NUMBER(size.height),
        patches: [...svg.matchAll(/<image\b[^>]*>/gi)].map(([tag]) => {
            const patch = attributes(tag);
            const href = patch['xlink:href'] || patch.href || '';
            return {
                x: VEIL_NUMBER(patch.x),
                y: VEIL_NUMBER(patch.y),
                width: VEIL_NUMBER(patch.width),
                height: VEIL_NUMBER(patch.height),
                bytes: base64ToBytes(href.substring(href.indexOf('base64,') + 7)),
            };
        }),
    };
}

/**
 * The patches of a veil drawn over the banners burned into the page, scaled from the size of the veil to the size of the
 * image, as the reader of the site does. The result is a JPEG.
 * @param {Blob} image
 * @param {ReturnType<typeof parseVeil>} veil
 * @returns {Promise<Blob>}
 */
export async function drawVeil(image, veil) {
    const page = await createImageBitmap(image);
    const canvas = new OffscreenCanvas(page.width, page.height);
    const context = canvas.getContext('2d');
    context.drawImage(page, 0, 0);
    const scaleX = page.width / veil.width;
    const scaleY = page.height / veil.height;
    for (const patch of veil.patches) {
        const bitmap = await createImageBitmap(new Blob([patch.bytes]));
        context.drawImage(
            bitmap,
            patch.x * scaleX,
            patch.y * scaleY,
            patch.width * scaleX,
            patch.height * scaleY,
        );
    }
    return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
}

// ================================ Connector ================================

export default class LunarAnimes extends Connector {
    constructor() {
        super();
        super.id = 'lunaranimes';
        super.label = 'Lunar Animes';
        this.tags = ['manga', 'manhwa', 'manhua', 'multi-lingual', 'aggregator'];
        this.url = 'https://lunarx.to';
        this.apiUrl = 'https://api.lunarx.to';
        this.cdnUrl = 'https://vault.lunarx.to';
        this.requestOptions.headers.set('x-referer', this.url + '/');

        // the key of the proof, made when it is needed and made again when the server turns it down
        this._proofKey = undefined;
        // what the server knows about a manga after a verification: the thumbprint of the key and when it ends
        this._clearances = new Map();
        this._siteKey = undefined;
        // the chapters that run together are asked one after the other, so that a verification is shared
        this._turn = Promise.resolve();
        // keiyoushi: rateLimit(2) for the host of the API, rateLimit(4) for the CDN
        this._limits = {
            api: { perSecond: 2, starts: [], gate: Promise.resolve() },
            cdn: { perSecond: 4, starts: [], gate: Promise.resolve() },
        };
    }

    canHandleURI(uri) {
        return /https?:\/\/(lunarx\.to|lunaranime\.ru)\/manga\/[^/]+/.test(uri.href);
    }

    /**
     * The page of the site is not loaded in a window to get the connector going, as the other connectors do: the API needs
     * nothing from it, and the page takes such a window for a browser with a blocked extension, shows a page that says so and
     * closes the window.
     */
    async _initializeConnector() {}

    // ============================== Requests ===============================

    /**
     * Two requests in a second to the API, four to the CDN.
     * @param {'api'|'cdn'} [host]
     */
    _throttle(host = 'api') {
        const limit = this._limits[host];
        const turn = limit.gate.then(async () => {
            const now = Date.now();
            limit.starts = limit.starts.filter((start) => now - start < 1000);
            if (limit.starts.length >= limit.perSecond) {
                await this.wait(1000 - (now - limit.starts[0]));
            }
            limit.starts.push(Date.now());
        });
        limit.gate = turn.catch(() => undefined);
        return turn;
    }

    _ensureProofKey() {
        if (!this._proofKey) {
            this._proofKey = createProofKey().catch((error) => {
                this._proofKey = undefined;
                throw error;
            });
        }
        return this._proofKey;
    }

    /**
     * A request to the API. Only the request of the list of the images carries the proof (`proof`), as in the reader of the
     * site: a key that signed other requests gets fake images. When the server turns the key down (403 that says
     * "validate") the site makes a new key pair, and so does this: the request is sent once more.
     */
    async _api(url, { method = 'GET', body, headers = {}, proof = false } = {}, again = true) {
        await this._throttle('api');
        const all = new Headers(this.requestOptions.headers);
        for (const [name, value] of Object.entries(headers)) {
            all.set(name, value);
        }
        if (proof) {
            all.set(PROOF_HEADER, await createProof(await this._ensureProofKey(), method, url));
        }
        const response = await this._countedFetch(
            new Request(url, { ...this.requestOptions, method, headers: all, body }),
        );
        if (
            proof &&
            again &&
            response.status === 403 &&
            /validate/i.test(await response.clone().text())
        ) {
            this._proofKey = undefined;
            return this._api(url, { method, body, headers, proof }, false);
        }
        return response;
    }

    async _apiJSON(url, init) {
        const response = await this._api(url, init);
        if (!response.ok) {
            throw new Error(
                `Failed to receive content from "${url}" (status: ${response.status}) - ${response.statusText}`,
            );
        }
        return response.json();
    }

    // ============================== Mangas =================================

    async _getMangaFromURI(uri) {
        const segments = uri.pathname.split('/').filter(Boolean);
        const slug = segments[0] === 'manga' && segments[1] ? segments[1] : segments.pop();
        try {
            const { manga } = await this._apiJSON(`${this.apiUrl}/api/manga/title/${slug}`);
            return new Manga(this, slug, manga.title);
        } catch {
            return new Manga(this, slug, slug);
        }
    }

    async _getMangas() {
        const mangas = [];
        let page = 1;
        let totalPages = 1;
        do {
            const data = await this._apiJSON(
                `${this.apiUrl}/api/manga/search?page=${page}&limit=30&sort=relevance`,
            );
            mangas.push(...data.manga.map((entry) => ({ id: entry.slug, title: entry.title })));
            totalPages = data.total_pages || 1;
            page++;
        } while (page <= totalPages);
        return mangas;
    }

    // ============================== Chapters ===============================

    async _getChapters(manga) {
        const [passwordInfo, chapterList] = await Promise.all([
            this._apiJSON(`${this.apiUrl}/api/manga/password/info/${manga.id}`),
            this._apiJSON(`${this.apiUrl}/api/manga/${manga.id}`),
        ]);
        const hasSeriesPassword = !!passwordInfo.has_series_password;
        const chapterPasswords = passwordInfo.chapter_passwords || [];

        const chapters = chapterList.data.map((chapter) => {
            const language = chapter.language;
            const isLocked =
                hasSeriesPassword ||
                chapterPasswords.some(
                    (entry) =>
                        entry.chapter_number === chapter.chapter &&
                        (entry.language == null || entry.language === language),
                );

            const chapterName = chapter.chapter.replace(/\.00$/, '').replace(/\.0$/, '');
            const chapterNumber = `Chapter ${chapterName}`;
            const subject = chapter.chapter_title && chapter.chapter_title.trim();
            const lower = (subject || '').toLowerCase();
            let title;
            if (!subject) {
                title = chapterNumber;
            } else if (
                lower.includes(chapterNumber.toLowerCase()) ||
                lower.includes(`ch.${chapterName}`.toLowerCase()) ||
                lower.includes('volume') ||
                lower.includes('vol.')
            ) {
                title = subject;
            } else {
                title = `${chapterNumber}: ${subject}`;
            }

            return {
                id: JSON.stringify({
                    slug: manga.id,
                    chapter: chapter.chapter,
                    lang: language,
                    locked: isLocked,
                }),
                title: isLocked ? `🔒 ${title}` : title,
                language: language,
            };
        });
        return chapters.reverse();
    }

    // ================================ Pages ================================

    /**
     * A request whose answer does not matter, only that the site has been asked.
     */
    async _notify(url, init = {}) {
        try {
            const response = await this._api(url, init);
            await response.arrayBuffer();
        } catch {
            /* nothing to do */
        }
    }

    /**
     * Required before the list of the images is asked for: without it the list is fake.
     */
    _unlockChapter(slug) {
        return this._notify(`${this.apiUrl}/api/manga/chapter-lock/${slug}`);
    }

    /**
     * The view of the chapter, counted once its images arrived (as the reader of the site does).
     */
    _countView(slug, number, language) {
        return this._notify(`${this.apiUrl}/api/manga/chapter/view`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ slug, chapter: number, language }),
        });
    }

    /**
     * The seeds of a chapter: its page names the client components that are given texts only (`seedGroups`), and the code
     * of the site makes the seeds of them in a window of the site (`SEED_RUNTIME`), on a plain document (its manifest).
     * @param {string} html the page of the chapter
     * @param {string} pageUrl its address
     * @returns {Promise<{axis: string, pitch: string}>}
     */
    async _seeds(html, pageUrl) {
        const groups = seedGroups(flightRows(inlineScripts(html)), pageUrl);
        if (groups.length === 0) {
            throw new Error('Failed to find payload seeds!');
        }
        const request = new Request(this.url + '/manifest.json', this.requestOptions);
        const pair = await Engine.Request.fetchUI(
            request,
            `(${SEED_RUNTIME})(${JSON.stringify(groups)})`,
            15000,
        );
        if (!Array.isArray(pair) || !pair[0] || !pair[1]) {
            throw new Error('Failed to find payload seeds!');
        }
        return { axis: pair[0], pitch: pair[1] };
    }

    async _loadSiteKey() {
        if (!this._siteKey) {
            const config = await this._apiJSON(`${this.apiUrl}/api/captcha/config`);
            if (!config.manga_turnstile_sitekey) {
                throw new Error('The site gave no key for its check!');
            }
            this._siteKey = config.manga_turnstile_sitekey;
        }
        return this._siteKey;
    }

    /**
     * The check of the site (Cloudflare Turnstile) runs in a window on a plain document of the site (its manifest): the pages of
     * the site take a window of this kind for one with an extension and show a page of their own instead. The window is shown
     * while it runs, because the check does not finish in a hidden one, and it keeps the web security and the images that the
     * check needs. The token is bound to the nonce of the token of the chapter (action `read`), as in the reader of the site.
     * @param {string} nonce
     * @returns {Promise<string>} the token of the check
     */
    async _solveTurnstile(nonce) {
        const siteKey = await this._loadSiteKey();
        const script = `
            new Promise((resolve, reject) => {
                document.open();
                document.write(${JSON.stringify(CHECK_PAGE(new URL(this.url).host))});
                document.close();
                const render = () => {
                    try {
                        window.turnstile.render(document.getElementById('check'), {
                            sitekey: ${JSON.stringify(siteKey)},
                            action: 'read',
                            cData: ${JSON.stringify(nonce)},
                            appearance: 'always',
                            callback: (token) => resolve(token),
                            'error-callback': (code) => reject(new Error('The check of the site failed (code: ' + code + ')')),
                            'expired-callback': () => reject(new Error('The check of the site expired')),
                            'timeout-callback': () => reject(new Error('The check of the site timed out')),
                        });
                    } catch (error) {
                        reject(error);
                    }
                };
                if (window.turnstile) {
                    render();
                    return;
                }
                window.onRakKomikTurnstile = render;
                const loader = document.createElement('script');
                loader.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=onRakKomikTurnstile';
                loader.onerror = () => reject(new Error('The script of the check of the site could not be loaded'));
                document.head.appendChild(loader);
            })
        `;
        const request = new Request(this.url + '/manifest.json', this.requestOptions);
        const token = await Engine.Request.fetchBrowser(
            request,
            undefined,
            script,
            { webSecurity: true, images: true, show: true },
            90000,
        ).catch((error) => {
            if (/was closed before/.test(String(error))) {
                throw new Error(
                    'The window of the check of the site was closed before the check was done!',
                );
            }
            throw error;
        });
        if (typeof token !== 'string' || !token) {
            throw new Error('The check of the site gave no token!');
        }
        return token;
    }

    async _hasClearance(slug) {
        const clearance = this._clearances.get(slug);
        const key = await this._ensureProofKey();
        return (
            !!clearance &&
            clearance.thumbprint === key.thumbprint &&
            clearance.expiresAt > Date.now()
        );
    }

    async _markCleared(slug, ttl) {
        const key = await this._ensureProofKey();
        const seconds = Math.max(0, (ttl ?? DEFAULT_CLEARANCE_TTL) - CLEARANCE_MARGIN);
        this._clearances.set(slug, {
            thumbprint: key.thumbprint,
            expiresAt: Date.now() + seconds * 1000,
        });
    }

    async _fetchChapter(seeds, slug, number, language, withTurnstile) {
        const nonce = newNonce();
        const turnstileToken = withTurnstile ? await this._solveTurnstile(nonce) : null;
        // made after the check: a token made long before the request gets fake images
        const token = mintToken(seeds, slug, number, nonce);
        const query = language === 'en' ? '' : `?language=${encodeURIComponent(language)}`;
        const headers = {};
        if (turnstileToken) {
            headers['Catch-Me-If-You-Can-Monkey'] = turnstileToken;
            headers['Which-Monkey'] = 'turnstile';
        }
        const url = `${this.apiUrl}/api/manga/r/${token}${query}`;
        const response = await this._api(url, { headers, proof: true });
        if (!response.ok) {
            const refusal = await response
                .clone()
                .json()
                .catch(() => undefined);
            if (response.status === 403 && refusal && refusal.is_points_locked) {
                throw new Error(
                    'This chapter is unlocked with ad points: log in on the website and unlock it there.',
                );
            }
            throw new Error(
                `Failed to receive content from "${url}" (status: ${response.status}) - ${response.statusText}`,
            );
        }
        const answer = await response.json();
        const sessionData = answer.data && answer.data.session_data;
        if (!sessionData) {
            throw new Error('session_data is empty');
        }
        const key = await this._ensureProofKey();
        return JSON.parse(await unpackSession(sessionData, seeds, nonce, key.thumbprint));
    }

    /**
     * The pages of a list without the pages between them, each with its veil (the address of its patches, if any).
     */
    _realPages(result) {
        const veils = result.veil || [];
        return ((result.data && result.data.images) || [])
            .map((url, index) => ({ url, veil: veils[index] || undefined }))
            .filter(({ url }) => !url.includes(INTERSTITIAL_PATH));
    }

    /**
     * A fake list: the server wants the check again, names no manga, has none of the pages between the pages, or has only
     * made-up images (`every` is true for no images at all, which is as good as only fake ones).
     */
    _needsRevalidation(result) {
        const images = (result.data && result.data.images) || [];
        const pages = this._realPages(result);
        return (
            result.cache_status === 'revalidate' ||
            result.slug === 'unknown' ||
            pages.length === images.length ||
            pages.every(({ url }) => url.includes(DECOY_PATH))
        );
    }

    /**
     * One chapter after the other, so that the check of a manga is made once for the chapters that are asked together.
     */
    _inTurn(work) {
        const result = this._turn.then(work);
        this._turn = result.catch(() => undefined);
        return result;
    }

    async _getPages(chapter) {
        const { slug, chapter: number, lang: language, locked } = JSON.parse(chapter.id);
        if (locked) {
            throw new Error('Chapter is password-protected and cannot be downloaded.');
        }

        const chapterUrl = `${this.url}/manga/${slug}/${number}?lang=${language}`;
        const response = await fetch(new Request(chapterUrl, this.requestOptions));
        if (!response.ok) {
            throw new Error(
                `Failed to fetch chapter page: ${response.status} ${response.statusText}`,
            );
        }
        const seeds = await this._seeds(await response.text(), chapterUrl);

        const result = await this._inTurn(async () => {
            await this._unlockChapter(slug);
            let answer = await this._fetchChapter(
                seeds,
                slug,
                number,
                language,
                !(await this._hasClearance(slug)),
            );
            if (this._needsRevalidation(answer)) {
                this._clearances.delete(slug);
                this._proofKey = undefined;
                answer = await this._fetchChapter(seeds, slug, number, language, true);
            }
            if (this._needsRevalidation(answer)) {
                throw new Error('Could not load images. The check of the site was not accepted.');
            }
            await this._markCleared(slug, answer.cache_ttl);
            await this._countView(slug, number, language);
            return answer;
        });

        const cdnHost = new URL(this.cdnUrl).host;
        return this._realPages(result).map(({ url, veil }) => {
            // the CDN wants the site as referrer, any other host the page of the chapter
            const referer = new URL(url).host === cdnHost ? this.url + '/' : chapterUrl;
            const payload = { url, referer };
            if (veil) {
                payload.veil = new URL(veil, this.apiUrl).href;
            }
            return this.createConnectorURI(payload);
        });
    }

    /**
     * A file of the vault, asked again while it answers 503 (the reader of the site waits 600 ms, 1200 ms, ...).
     */
    async _fromVault(request, retries) {
        let response = await fetch(request.clone());
        for (let attempt = 0; attempt < retries && response.status === 503; attempt++) {
            await this.wait(RETRY_STEP * (attempt + 1));
            response = await fetch(request.clone());
        }
        return response;
    }

    async _handleConnectorURI(payload) {
        const cdn = new URL(payload.url).host === new URL(this.cdnUrl).host;
        let veil = null;
        if (payload.veil) {
            await this._throttle('api');
            const response = await this._fromVault(
                new Request(payload.veil, this.requestOptions),
                VEIL_RETRIES,
            );
            veil = response.ok ? parseVeil(await response.text()) : null;
        }
        if (cdn) {
            await this._throttle('cdn');
        }
        const request = new Request(payload.url, this.requestOptions);
        request.headers.set('x-referer', payload.referer);
        request.headers.set(
            'Accept',
            'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        );
        const response = await this._fromVault(request, cdn ? PAGE_RETRIES : 0);
        if (!response.ok) {
            throw new Error(
                `Failed to receive content from "${payload.url}" (status: ${response.status}) - ${response.statusText}`,
            );
        }
        const image = await response.blob();
        return this._blobToBuffer(veil ? await drawVeil(image, veil) : image);
    }
}
