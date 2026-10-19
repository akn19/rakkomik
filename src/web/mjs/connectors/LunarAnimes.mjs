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
 * Lunar (https://lunarx.to) protects the images of a chapter: the page of the chapter hands out two seed strings, a token
 * made from them names the chapter, and the answer is an encrypted list of the images. The proof of a key pair that the
 * client makes up by itself goes with every request to the API, and a Turnstile token is needed from time to time.
 * This is the port of the extension of Keiyoushi (all/lunaranime: LunarAnime, LunarDecryptor, LunarSerenity, LunarAnimeDto).
 */

const SEPARATOR = '\u0001';
const THUMBPRINT_SEPARATOR = '\u0002';
const ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const NONCE_LENGTH = 12;
const PROOF_HEADER = 'cant-catch-this-monkey';
// the images that are made up for a visitor who is not verified
const DECOY_PATH = '/api/cdn/p/';
const FALLBACK_SITE_KEY = '0x4AAAAAAEweOgJ6zfOKhkgq';
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

const HEADER_SIZE = 7;
const HEADER_FIELDS = 6;
const HEADER_VERSION = '3';
const MAX_OPCODE = 7;
const MAGIC = [167, 62, 145];

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

/**
 * Like Kotlin's String.toIntOrNull(radix): an optional sign and the digits, nothing when it is no 32 bit number.
 */
function toIntOrNull(text, radix) {
    const digits = radix === 16 ? '[0-9a-fA-F]' : '[0-9]';
    if (!new RegExp(`^[+-]?${digits}+$`).test(text)) {
        return null;
    }
    const value = parseInt(text, radix);
    return value >= -2147483648 && value <= 2147483647 ? value : null;
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

// ================================ Seeds ================================

function latin1(bytes, offset, length) {
    return String.fromCharCode(...bytes.slice(offset, offset + length));
}

/**
 * The header prop is masked with a rolling key that comes from its own name: it tells how the other props are put
 * together (a seed, the factors of a generator of numbers, the steps of a small program and the names of the props).
 */
function parseSeedHeader(name, value) {
    let decoded;
    try {
        decoded = base64Decode([...value].reverse().join(''));
    } catch {
        return null;
    }
    let nameHash = 0;
    for (const char of name) {
        nameHash = (31 * nameHash + char.charCodeAt(0)) & 0xff;
    }
    const parts = Array.from(decoded, (byte, index) =>
        String.fromCharCode(byte ^ ((nameHash + 37 * index) & 0xff)),
    )
        .join('')
        .split('|');
    if (parts.length !== HEADER_FIELDS || parts[0] !== HEADER_VERSION) {
        return null;
    }
    const seed = toIntOrNull(parts[1], 16);
    const multiplier = toIntOrNull(parts[2], 16);
    const increment = toIntOrNull(parts[3], 16);
    if (seed === null || multiplier === null || increment === null) {
        return null;
    }
    const programText = parts[4];
    if (!programText || programText.length % 3 !== 0) {
        return null;
    }
    const program = [];
    for (let index = 0; index < programText.length; index += 3) {
        const operation = toIntOrNull(programText.substring(index, index + 1), 16);
        const argument = toIntOrNull(programText.substring(index + 1, index + 3), 16);
        if (operation === null || argument === null || operation > MAX_OPCODE) {
            return null;
        }
        program.push([operation, argument]);
    }
    const names = parts[5].split('.').filter((entry) => entry);
    if (!names.length) {
        return null;
    }
    return { seed, multiplier, increment, program, names };
}

function runProgram(program, value, index, state) {
    let number = value & 0xff;
    for (const [operation, argument] of [...program].reverse()) {
        switch (operation) {
            case 0:
                number ^= argument;
                break;
            case 1:
                number -= argument;
                break;
            case 2: {
                const shift = argument & 7 || 1;
                number = ((number & 0xff) >>> shift) | (number << (8 - shift));
                break;
            }
            case 3:
                number = ((number & 15) << 4) | ((number & 0xff) >>> 4);
                break;
            case 4:
                number ^= state;
                break;
            case 5:
                number ^= (index * (1 | argument) + argument) & 0xff;
                break;
            case 6:
                number = ~number;
                break;
            default:
                number = argument - number;
        }
        number &= 0xff;
    }
    return number;
}

/**
 * The named props make up one hex string. Each byte of it is chained to the one before and to a generator of numbers
 * that the header names, and then it is run backwards through the program of the header.
 */
function decodeSeedBytes(header, props) {
    const hex = header.names.map((entry) => props[entry] ?? '').join('');
    if (hex.length < 2 || hex.length % 2 !== 0) {
        return null;
    }
    const bytes = [];
    let state = header.seed & 0xff;
    let previous = 0;
    for (let index = 0; index < hex.length; index += 2) {
        const current = toIntOrNull(hex.substring(index, index + 2), 16);
        if (current === null) {
            return null;
        }
        state = (Math.imul(state, header.multiplier) + header.increment) & 0xff;
        bytes.push(runProgram(header.program, current ^ previous, index / 2, state));
        previous = current;
    }
    return bytes;
}

/**
 * Several decoy sets of props are drawn next to the real one: a decoy fails to make a header, or misses the magic bytes.
 * @param {Object<string, string>} props
 * @returns {{axis: string, pitch: string}|null}
 */
export function decodeSeeds(props) {
    for (const [name, value] of Object.entries(props)) {
        const header = parseSeedHeader(name, value);
        const bytes = header && decodeSeedBytes(header, props);
        if (!bytes || bytes.length < HEADER_SIZE) {
            continue;
        }
        if (MAGIC.some((magic, index) => bytes[index] !== magic)) {
            return null;
        }
        const axisLength = (bytes[3] << 8) | bytes[4];
        const pitchLength = (bytes[5] << 8) | bytes[6];
        if (
            axisLength <= 0 ||
            pitchLength <= 0 ||
            HEADER_SIZE + axisLength + pitchLength > bytes.length
        ) {
            return null;
        }
        return {
            axis: latin1(bytes, HEADER_SIZE, axisLength),
            pitch: latin1(bytes, HEADER_SIZE + axisLength, pitchLength),
        };
    }
    return null;
}

function isSeedProps(element) {
    return (
        element !== null &&
        typeof element === 'object' &&
        !Array.isArray(element) &&
        Object.keys(element).length > 0 &&
        Object.values(element).every((value) => typeof value === 'string') &&
        decodeSeeds(element) !== null
    );
}

// ========================= Flight data of Next.js ==========================

const FLIGHT_PUSH = /self\.__next_f\.push\(\s*(\[[\s\S]*\])\s*\)\s*;?\s*$/;

/**
 * The value at the start of the text and the position behind it: found only when it is made of JSON.
 */
function parseJsonAt(text, start) {
    let depth = 0;
    let inString = false;
    let escape = false;
    let index = start;
    while (index < text.length) {
        const char = text[index++];
        if (escape) {
            escape = false;
            continue;
        }
        if (char === '\\' && inString) {
            escape = true;
            continue;
        }
        if (char === '"') {
            inString = !inString;
            continue;
        }
        if (inString) {
            continue;
        }
        if (char === '{' || char === '[') {
            depth++;
        } else if ((char === '}' || char === ']') && --depth === 0) {
            return parseJsonSafe(text.substring(start, index), index);
        }
        if (depth === 0 && /\s/.test(char)) {
            return parseJsonSafe(text.substring(start, index - 1), index);
        }
    }
    return { found: false, end: index };
}

function parseJsonSafe(text, end) {
    try {
        return { found: true, value: JSON.parse(text), end };
    } catch {
        return { found: false, end };
    }
}

/**
 * The rows of the flight data of one push: `<id>:<JSON>` for a model, `<id>:T<length>,<text>` for a long text, where the
 * length is the one of the text in UTF-8.
 */
function readFlightRows(body, chunks, models) {
    const payloads = [];
    let position = 0;
    while (position < body.length) {
        const colon = body.indexOf(':', position);
        if (colon === -1) {
            break;
        }
        const id = body.substring(position, colon);
        if (!/^[0-9a-fA-F]+$/.test(id)) {
            position++;
            continue;
        }
        position = colon + 1;
        if (position >= body.length) {
            break;
        }
        if (body[position] === 'T') {
            position++;
            const comma = body.indexOf(',', position);
            const length = comma === -1 ? null : toIntOrNull(body.substring(position, comma), 16);
            if (length === null) {
                break;
            }
            position = comma + 1;
            const start = position;
            let bytes = 0;
            while (position < body.length && bytes < length) {
                const code = body.charCodeAt(position);
                if (code < 0x80) {
                    bytes += 1;
                } else if (code < 0x800) {
                    bytes += 2;
                } else if (code >= 0xd800 && code <= 0xdbff) {
                    // a character of two halves is four bytes, and the second half is taken along
                    bytes += 4;
                    position++;
                } else {
                    bytes += 3;
                }
                position++;
            }
            const text = body.substring(start, position);
            chunks.set(id, text);
            const parsed = parseJsonSafe(text, position);
            if (parsed.found) {
                payloads.push(parsed.value);
            }
        } else {
            const parsed = parseJsonAt(body, position);
            if (parsed.found) {
                payloads.push(parsed.value);
                models.set(id, parsed.value);
            }
            position = parsed.end;
        }
    }
    return payloads;
}

function walkReference(value, segment) {
    if (Array.isArray(value)) {
        // an element of React is ["$", type, key, props]
        if (value.length >= 4 && value[0] === '$') {
            const named = { type: 1, key: 2, props: 3 }[segment];
            if (named !== undefined) {
                return value[named];
            }
        }
        const index = toIntOrNull(segment, 10);
        return index === null ? undefined : value[index];
    }
    if (value !== null && typeof value === 'object') {
        return value[segment];
    }
    return undefined;
}

function resolveModel(reference, chunks, models, resolving) {
    const segments = reference.split(':');
    const id = segments[0];
    if (segments.length === 1 && chunks.has(id)) {
        return chunks.get(id);
    }
    if (resolving.has(id) || !models.has(id)) {
        return undefined;
    }
    const guard = new Set(resolving).add(id);
    let value = models.get(id);
    for (const segment of segments.slice(1)) {
        if (typeof value === 'string' && value.startsWith('$')) {
            value = resolveReferences(value, chunks, models, guard);
        }
        value = walkReference(value, segment);
        if (value === undefined) {
            return undefined;
        }
    }
    return resolveReferences(value, chunks, models, guard);
}

function resolveEntries(id, chunks, models, resolving, asMap) {
    const entries = models.get(id);
    if (resolving.has(id) || !Array.isArray(entries)) {
        return undefined;
    }
    const resolved = resolveReferences(entries, chunks, models, new Set(resolving).add(id));
    if (!asMap) {
        return resolved;
    }
    return Object.fromEntries(
        resolved
            .filter((pair) => Array.isArray(pair) && pair.length === 2)
            .map(([key, value]) => [String(key), value]),
    );
}

/**
 * What the markers of React Flight stand for: an escaped dollar sign, `undefined`, a date, a big number, a map, a set, and
 * the reference to a model or to a text that was outlined into a row of its own.
 */
function resolveReferences(element, chunks, models, resolving = new Set()) {
    if (Array.isArray(element)) {
        return element.map((entry) => resolveReferences(entry, chunks, models, resolving));
    }
    if (element !== null && typeof element === 'object') {
        return Object.fromEntries(
            Object.entries(element).map(([key, value]) => [
                key,
                resolveReferences(value, chunks, models, resolving),
            ]),
        );
    }
    if (typeof element !== 'string' || !element.startsWith('$') || element.length < 2) {
        return element;
    }
    if (element === '$undefined') {
        return null;
    }
    if (['$Infinity', '$-Infinity', '$NaN', '$-0'].includes(element)) {
        return element.substring(1);
    }
    let resolved;
    switch (element[1]) {
        case '$':
        case 'D':
        case 'n':
            return element.substring(element[1] === '$' ? 1 : 2);
        case 'Q':
            resolved = resolveEntries(element.substring(2), chunks, models, resolving, true);
            break;
        case 'W':
            resolved = resolveEntries(element.substring(2), chunks, models, resolving, false);
            break;
        case 'L':
        case '@':
            resolved = resolveModel(element.substring(2), chunks, models, resolving);
            break;
        default:
            resolved = resolveModel(element.substring(1), chunks, models, resolving);
    }
    return resolved === undefined ? element : resolved;
}

function findInPayload(payload, predicate) {
    if (payload === null || typeof payload !== 'object') {
        return undefined;
    }
    if (predicate(payload)) {
        return payload;
    }
    for (const child of Array.isArray(payload) ? payload : Object.values(payload)) {
        const found = findInPayload(child, predicate);
        if (found !== undefined) {
            return found;
        }
    }
    return undefined;
}

/**
 * The seeds are no field of their own: they arrive as the props of a component of the reader, under names that change with
 * each response, in the flight data that Next.js puts into the scripts of the page.
 * @param {string[]} scripts the text of the scripts of the page that have no source
 * @returns {{axis: string, pitch: string}}
 */
export function extractSeeds(scripts) {
    const chunks = new Map();
    const models = new Map();
    const payloads = [];
    for (const script of scripts.filter((text) => text.includes('self.__next_f.push'))) {
        try {
            const pushed = JSON.parse(FLIGHT_PUSH.exec(script)[1]);
            if (typeof pushed[1] === 'string') {
                payloads.push(...readFlightRows(pushed[1], chunks, models));
            }
        } catch {
            /* a script of another kind */
        }
    }
    for (const payload of payloads) {
        const props = findInPayload(resolveReferences(payload, chunks, models), isSeedProps);
        if (props) {
            return decodeSeeds(props);
        }
    }
    throw new Error('Failed to find payload seeds!');
}

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
 * `mint()` of the bundle of the site: a payload with the time that names the chapter, encrypted with a stream of the blended
 * key. The nonce goes into the key of the answer, so the caller has to keep it for `unpackSession`.
 * @param {{axis: string, pitch: string}} seeds
 * @param {string} slug
 * @param {string} chapter
 * @param {{now?: number, random?: function(number): number}} [options] a clock and a source of random numbers
 * @returns {{token: string, nonce: string}}
 */
export function mintToken(seeds, slug, chapter, { now = Date.now(), random = randomInt } = {}) {
    const key = blendKey(seeds.axis, seeds.pitch);
    if (!key.length) {
        throw new Error('Failed to derive chapter key!');
    }
    const nonce = randomString(NONCE_LENGTH, random);
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
    return { token: base64UrlEncode(Uint8Array.from(bytes)), nonce };
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
        // keiyoushi: rateLimit(2) for the hosts of the API and the CDN
        this._starts = [];
        this._gate = Promise.resolve();
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
     * Two requests in a second, to the API and to the CDN.
     */
    _throttle() {
        const turn = this._gate.then(async () => {
            const now = Date.now();
            this._starts = this._starts.filter((start) => now - start < 1000);
            if (this._starts.length >= 2) {
                await this.wait(1000 - (now - this._starts[0]));
            }
            this._starts.push(Date.now());
        });
        this._gate = turn.catch(() => undefined);
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
     * A request to the API with the proof. When the server turns the key down (403 that says "validate") the site makes a new
     * key pair, and so does this: the request is sent once more.
     */
    async _api(url, { method = 'GET', body, headers = {} } = {}, again = true) {
        await this._throttle();
        const key = await this._ensureProofKey();
        const all = new Headers(this.requestOptions.headers);
        for (const [name, value] of Object.entries(headers)) {
            all.set(name, value);
        }
        all.set(PROOF_HEADER, await createProof(key, method, url));
        const response = await this._countedFetch(
            new Request(url, { ...this.requestOptions, method, headers: all, body }),
        );
        if (again && response.status === 403 && /validate/i.test(await response.clone().text())) {
            this._proofKey = undefined;
            return this._api(url, { method, body, headers }, false);
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
     * Required requests: without them the images that come back are fake.
     */
    async _viewChapter(slug, number, language) {
        for (const request of [
            [`${this.apiUrl}/api/manga/rating/status/${slug}/${number}`, {}],
            [
                `${this.apiUrl}/api/manga/chapter/view`,
                {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ slug, chapter: number, language }),
                },
            ],
        ]) {
            try {
                const response = await this._api(...request);
                await response.arrayBuffer();
            } catch {
                /* the answer does not matter, only that the site has been asked */
            }
        }
    }

    async _loadSiteKey() {
        if (!this._siteKey) {
            try {
                const config = await this._apiJSON(`${this.apiUrl}/api/captcha/config`);
                this._siteKey = config.reader_primary_sitekey || FALLBACK_SITE_KEY;
            } catch {
                this._siteKey = FALLBACK_SITE_KEY;
            }
        }
        return this._siteKey;
    }

    /**
     * The check of the site (Cloudflare Turnstile) runs in a window on a plain document of the site (its manifest): the pages of
     * the site take a window of this kind for one with an extension and show a page of their own instead. The window is shown
     * while it runs, because the check does not finish in a hidden one, and it keeps the web security and the images that the
     * check needs.
     * @returns {Promise<string>} the token of the check
     */
    async _solveTurnstile() {
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

    async _fetchChapter(seeds, slug, number, language, turnstileToken) {
        const { token, nonce } = mintToken(seeds, slug, number);
        const query = language === 'en' ? '' : `?language=${encodeURIComponent(language)}`;
        const headers = {};
        if (turnstileToken) {
            headers['Catch-Me-If-You-Can-Monkey'] = turnstileToken;
            headers['Which-Monkey'] = 'turnstile';
        }
        const answer = await this._apiJSON(`${this.apiUrl}/api/manga/r/${token}${query}`, {
            headers,
        });
        const sessionData = answer.data && answer.data.session_data;
        if (!sessionData) {
            throw new Error('session_data is empty');
        }
        const key = await this._ensureProofKey();
        return JSON.parse(await unpackSession(sessionData, seeds, nonce, key.thumbprint));
    }

    _needsRevalidation(result) {
        const images = (result.data && result.data.images) || [];
        // `every` is true for no images at all, which is as good as only fake ones
        return (
            result.cache_status === 'revalidate' ||
            images.every((image) => image.includes(DECOY_PATH))
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
        const seeds = extractSeeds(inlineScripts(await response.text()));

        const result = await this._inTurn(async () => {
            await this._viewChapter(slug, number, language);
            let answer = await this._fetchChapter(
                seeds,
                slug,
                number,
                language,
                (await this._hasClearance(slug)) ? null : await this._solveTurnstile(),
            );
            if (this._needsRevalidation(answer)) {
                this._clearances.delete(slug);
                this._proofKey = undefined;
                answer = await this._fetchChapter(
                    seeds,
                    slug,
                    number,
                    language,
                    await this._solveTurnstile(),
                );
            }
            if (this._needsRevalidation(answer)) {
                throw new Error('Could not load images. The check of the site was not accepted.');
            }
            await this._markCleared(slug, answer.cache_ttl);
            return answer;
        });

        const cdnHost = new URL(this.cdnUrl).host;
        return result.data.images.map((url) => {
            // the CDN wants the site as referrer, any other host the page of the chapter
            const referer = new URL(url).host === cdnHost ? this.url + '/' : chapterUrl;
            return this.createConnectorURI({ url, referer });
        });
    }

    async _handleConnectorURI(payload) {
        if (new URL(payload.url).host === new URL(this.cdnUrl).host) {
            await this._throttle();
        }
        const request = new Request(payload.url, this.requestOptions);
        request.headers.set('x-referer', payload.referer);
        request.headers.set(
            'Accept',
            'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        );
        const response = await fetch(request);
        if (!response.ok) {
            throw new Error(
                `Failed to receive content from "${payload.url}" (status: ${response.status}) - ${response.statusText}`,
            );
        }
        return this._blobToBuffer(await response.blob());
    }
}
