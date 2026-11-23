// Lunar (lunarx.to): the flight data of the page of a chapter and the client component that makes the seeds of it (run by
// the script of the site, here against a chunk of Turbopack that does what the code of the site does), the token and the
// session of the chapter, the proof of the key pair that goes with the request of the list of the images only, the veils of
// the pages, and the connector as a whole against a site that does its side of all this. The rest is written independently
// of the connector, after the extension of Keiyoushi (all/lunaranime) and with `node:crypto`, so that a mistake of the
// connector cannot be a mistake of the test.

const nodeCrypto = require('node:crypto');

let Lunar = null;

beforeAll(async () => {
    Lunar = await import('../mjs/connectors/LunarAnimes.mjs');
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete globalThis.Engine;
});

// ================================ the world of the site ================================

const SEPARATOR = '\u0001';
const THUMBPRINT_SEPARATOR = '\u0002';
const ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

// text is hashed as UTF-8, like toByteArray() of Kotlin does
const sha256 = (data) => nodeCrypto.createHash('sha256').update(data).digest();
const base64Url = (bytes) => Buffer.from(bytes).toString('base64url');
const fromBase64Url = (text) => Buffer.from(text, 'base64url');

// seeds with characters that are more than ASCII, as the bytes of the page are
const SEEDS = { axis: 'k3Zq9xW1ébT7ÿmPaR2sD', pitch: 'Qe5\u0080Lw8YhN4ÃuJc6VgB1oXzF' };

// ============================== the flight data of Next.js ==============================

const row = (id, value) => `${id}:${JSON.stringify(value)}\n`;
const element = (reference, props) => ['$', `$L${reference}`, null, props];
const script = (rows) => `self.__next_f.push(${JSON.stringify([1, rows])})`;

function page(rows, { before = '' } = {}) {
    return (
        '<!DOCTYPE html><html><head><script>(self.__next_f=self.__next_f||[]).push([0])</script>' +
        before +
        '</head><body><script src="/_next/static/app.js" async></script>' +
        `<script>${script(rows)}</script></body></html>`
    );
}

// ============================ the code of the site ============================

// The client component that makes the seeds (module 5) and the module that it hands them to (9), in a chunk of Turbopack,
// as the code of the site has them: the component makes the seeds of the props that the real page gives it, and fails for
// the decoys. The page names the chunk through a row that holds its path, and a second chunk of the component.
const SEED_MODULE = 5;
const CHUNK = '/_next/static/chunks/seed-0a1b.js';
const OTHER_CHUNK = '/_next/static/chunks/other-2c3d.js';

function seedChunk() {
    return `(globalThis.TURBOPACK = globalThis.TURBOPACK || []).push(["seed",
        ${SEED_MODULE}, (e, m) => {
            const store = e.i(9);
            e.s(['default', 0, (props) => {
                if (props.kind !== 'reader') { throw new Error('a decoy'); }
                store.put(0, props.left + props.right);
                store.put(1, props.pitch);
            }]);
        },
        9, (e, m) => { e.s(['put', 0, (index, value) => value]); }
    ]);`;
}

// the props of the page: the real ones carry the seeds, cut apart, and the decoys have the same names
const realProps = (seeds) => ({
    kind: 'reader',
    left: seeds.axis.slice(0, 5),
    right: seeds.axis.slice(5),
    pitch: seeds.pitch,
});
const decoyProps = { kind: 'banner', left: 'x', right: 'y', pitch: 'z' };

// the rows of the page of a chapter: the path of the chunk, the client reference of the component, a decoy and the reader
function chapterRows(seeds) {
    return (
        row(1, CHUNK) +
        `2:I[${SEED_MODULE},["$1","${OTHER_CHUNK}"],"default"]\n` +
        row(3, element(2, decoyProps)) +
        row(4, ['$', 'div', null, { children: [element(2, realProps(seeds))] }])
    );
}

/**
 * The script of the connector run as a window of the site runs it: `XMLHttpRequest` gives the chunks of `chunks`
 * (address -> text), any other address answers 404.
 */
function runInPage(code, chunks) {
    class Request {
        open(method, url) {
            this.url = url;
        }
        send() {
            const text = chunks[this.url];
            this.status = text === undefined ? 404 : 200;
            this.responseText = text || '';
        }
    }
    const before = globalThis.XMLHttpRequest;
    globalThis.XMLHttpRequest = Request;
    try {
        return (0, eval)(code);
    } finally {
        globalThis.XMLHttpRequest = before;
        delete globalThis.TURBOPACK;
    }
}

const siteChunks = () => ({
    [`https://lunarx.to${CHUNK}`]: seedChunk(),
    [`https://lunarx.to${OTHER_CHUNK}`]:
        '(globalThis.TURBOPACK = globalThis.TURBOPACK || []).push(["other"]);',
});

// ================================== the token ==================================

// `mint()` of the bundle of the site, after LunarDecryptor.kt
function referenceKey(seeds) {
    const digest = sha256(seeds.axis + SEPARATOR + seeds.pitch);
    return Array.from(
        { length: Math.max(seeds.axis.length, seeds.pitch.length) },
        (_, index) =>
            (seeds.axis.charCodeAt(index % seeds.axis.length) ^
                seeds.pitch.charCodeAt(index % seeds.pitch.length) ^
                digest[index % 32] ^
                ((83 * index + 29) & 0xff)) &
            0xff,
    );
}

function referenceToken(seeds, slug, chapter, { now, nonce, tail, offset }) {
    const key = referenceKey(seeds);
    const payload = `${Math.floor(now / 1000).toString(16)}|${nonce}|${slug}|${chapter}|${tail}`;
    const bytes = [offset];
    [...payload].forEach((char, index) => {
        bytes.push(
            (char.charCodeAt(0) ^
                key[(index + offset) % key.length] ^
                ((offset + 83 * index) & 0xff)) &
                0xff,
        );
    });
    return base64Url(Buffer.from(bytes));
}

/** What the server does with a token: the payload that it names. */
function readToken(seeds, token) {
    const key = referenceKey(seeds);
    const [offset, ...bytes] = fromBase64Url(token);
    const text = bytes
        .map((byte, index) =>
            String.fromCharCode(
                byte ^ key[(index + offset) % key.length] ^ ((offset + 83 * index) & 0xff),
            ),
        )
        .join('');
    const [timestamp, nonce, slug, chapter, tail] = text.split('|');
    return { timestamp: parseInt(timestamp, 16), nonce, slug, chapter, tail };
}

function encryptSession(json, seeds, nonce, thumbprint) {
    const material =
        seeds.axis +
        SEPARATOR +
        nonce +
        (thumbprint === undefined ? '' : THUMBPRINT_SEPARATOR + thumbprint);
    const cipher = nodeCrypto.createCipheriv('aes-256-cbc', sha256(material), Buffer.alloc(16));
    return Buffer.concat([cipher.update(json, 'utf8'), cipher.final()]).toString('base64url');
}

// ================================== the proof ==================================

/** What the API does with the header of the proof, after RFC 9449 and RFC 7638. */
function readProof(request) {
    const jwt = request.headers.get('cant-catch-this-monkey');
    if (!jwt) {
        return null;
    }
    const [header64, payload64, signature64] = jwt.split('.');
    const header = JSON.parse(fromBase64Url(header64).toString());
    const payload = JSON.parse(fromBase64Url(payload64).toString());
    const key = nodeCrypto.createPublicKey({ key: header.jwk, format: 'jwk' });
    const url = new URL(request.url);
    const { crv, kty, x, y } = header.jwk;
    return {
        header,
        payload,
        signed: nodeCrypto.verify(
            'sha256',
            Buffer.from(`${header64}.${payload64}`),
            { key, dsaEncoding: 'ieee-p1363' },
            fromBase64Url(signature64),
        ),
        signatureLength: fromBase64Url(signature64).length,
        target: `${url.protocol}//${url.host}${url.pathname}`,
        thumbprint: base64Url(sha256(JSON.stringify({ crv, kty, x, y }))),
        x,
    };
}

// ===================================== tests =====================================

describe('the scripts of a page', () => {
    it('should give the text of the scripts that have no source, whatever the case and the attributes', () => {
        const html =
            '<script>one</script><SCRIPT type="module">two</SCRIPT><script src="/a.js"></script>' +
            '<script async src = "/b.js">ignored</script><script data-src="x" id=\'c\'>three</script>' +
            '<script\n>four\nlines</script>';
        expect(Lunar.inlineScripts(html)).toEqual(['one', 'two', 'three', 'four\nlines']);
    });

    it('should give nothing for a page without scripts', () => {
        expect(Lunar.inlineScripts('<html><body>no</body></html>')).toEqual([]);
    });
});

describe('the flight data of Next.js', () => {
    it('should read the rows of the page, a text row by the length of its bytes in UTF-8', () => {
        const rows =
            row(1, ['$', 'div', null, {}]) +
            `2:T9,${'日本語'}` +
            `3:T6,${'😀'}ab\n` +
            '4:I[7,["/a.js"],"default"]\n' +
            row('a', 'text');
        expect(Lunar.flightRows([script(rows)])).toEqual([
            { id: '1', value: '["$","div",null,{}]' },
            { id: '2', value: '日本語' },
            { id: '3', value: '😀ab' },
            { id: '4', value: 'I[7,["/a.js"],"default"]' },
            { id: 'a', value: '"text"' },
        ]);
    });

    it('should join the pushes before it reads the rows: a row can be cut anywhere, also in text that comes as base64', () => {
        const rows = chapterRows(SEEDS);
        const cut = rows.length - 40;
        const tail = Buffer.from(rows.slice(cut)).toString('base64');
        expect(
            Lunar.flightRows([
                'self.__next_f.push([0])',
                script(rows.slice(0, 25)),
                script(rows.slice(25, cut)),
                `self.__next_f.push(${JSON.stringify([2, 'not of the stream'])})`,
                `self.__next_f.push(${JSON.stringify([3, tail])})`,
                'window.x = 1',
                'self.__next_f.push(oops)',
            ]),
        ).toEqual(Lunar.flightRows([script(rows)]));
    });

    it('should name the client components that are given texts only, with their chunks and props, the most props first', () => {
        const rows = Lunar.flightRows(Lunar.inlineScripts(page(chapterRows(SEEDS))));
        const groups = Lunar.seedGroups(rows, 'https://lunarx.to/manga/the-cliff/1?lang=en');
        expect(groups).toEqual([
            {
                moduleId: SEED_MODULE,
                chunkUrls: [`https://lunarx.to${CHUNK}`, `https://lunarx.to${OTHER_CHUNK}`],
                candidates: [decoyProps, realProps(SEEDS)],
            },
        ]);
    });

    it('should take the reference that is in effect at the row, as the ids repeat across the flight streams', () => {
        const rows = Lunar.flightRows([
            script(
                '2:I[11,["/first.js"],"default"]\n' +
                    row(3, element(2, { a: 'one' })) +
                    '2:I[12,["/second.js"],"default"]\n' +
                    row(4, element(2, { b: 'two', c: 'three' })),
            ),
        ]);
        const groups = Lunar.seedGroups(rows, 'https://lunarx.to/manga/x/1');
        expect(groups.map((group) => [group.moduleId, group.chunkUrls, group.candidates])).toEqual([
            [12, ['https://lunarx.to/second.js'], [{ b: 'two', c: 'three' }]],
            [11, ['https://lunarx.to/first.js'], [{ a: 'one' }]],
        ]);
    });

    it('should leave out elements that are no client components, props that are not all texts, and references that it cannot find', () => {
        const rows = Lunar.flightRows([
            script(
                '2:I[11,["/a.js"],"default"]\n' +
                    row(3, ['$', 'div', null, { a: 'html' }]) +
                    row(4, element(2, { count: 3 })) +
                    row(5, element(2, {})) +
                    row(6, element(9, { a: 'no reference' })) +
                    row(7, element(3, { a: 'no client reference' })) +
                    '8:I[11,["$99"],"default"]\n' +
                    row(9, element(8, { a: 'a chunk that names no row' })) +
                    '10:{"broken"\n',
            ),
        ]);
        expect(Lunar.seedGroups(rows, 'https://lunarx.to/')).toEqual([]);
    });
});

describe('the code of the site that makes the seeds', () => {
    const groups = () =>
        Lunar.seedGroups(
            Lunar.flightRows([script(chapterRows(SEEDS))]),
            'https://lunarx.to/manga/the-cliff/1',
        );

    it('should run the component with its props and take what it hands on: the decoys fail, the reader gives the seeds', () => {
        const pair = runInPage(
            `(${Lunar.SEED_RUNTIME})(${JSON.stringify(groups())})`,
            siteChunks(),
        );
        expect(pair).toEqual([SEEDS.axis, SEEDS.pitch]);
    });

    it('should give nothing when no component makes the seeds, or its code cannot be loaded', () => {
        const decoys = groups().map((group) => ({ ...group, candidates: [decoyProps] }));
        expect(
            runInPage(`(${Lunar.SEED_RUNTIME})(${JSON.stringify(decoys)})`, siteChunks()),
        ).toBeNull();
        expect(runInPage(`(${Lunar.SEED_RUNTIME})(${JSON.stringify(groups())})`, {})).toBeNull();
    });
});

describe('the token of a chapter', () => {
    // the numbers that the random generator gives, in the order that Kotlin asks for them: the tail, the offset
    const scripted = (values) => {
        let index = 0;
        return (bound) => values[index++] % bound;
    };
    const NONCE = 'abcZABwxy9el';
    const TAIL = [5, 15, 25, 35, 45, 55];
    const text = (indexes) => indexes.map((index) => ALPHABET[index]).join('');

    it('should make the token that the reference makes, from the same time, nonce and offset', () => {
        const now = Date.UTC(2026, 9, 19, 12, 0, 0, 999);
        const token = Lunar.mintToken(SEEDS, 'the-cliff', '1.5', NONCE, {
            now,
            random: scripted([...TAIL, 200]),
        });
        expect(token).toBe(
            referenceToken(SEEDS, 'the-cliff', '1.5', {
                now,
                nonce: NONCE,
                tail: text(TAIL),
                offset: 200,
            }),
        );
    });

    it('should name the chapter, the time and the nonce in a payload that the server can read', () => {
        const now = Date.UTC(2026, 9, 19, 12, 0, 0);
        const token = Lunar.mintToken(SEEDS, 'sea-song', '12', NONCE, { now });
        expect(readToken(SEEDS, token)).toEqual({
            timestamp: Math.floor(now / 1000),
            nonce: NONCE,
            slug: 'sea-song',
            chapter: '12',
            tail: expect.stringMatching(/^[a-zA-Z0-9]{6}$/),
        });
    });

    it('should make nonces of twelve characters of the alphabet, a new one every time', () => {
        const first = Lunar.newNonce();
        expect(first).toMatch(/^[a-zA-Z0-9]{12}$/);
        expect(Lunar.newNonce()).not.toBe(first);
        expect(Lunar.newNonce(scripted([0, 1, 2, 25, 26, 27, 51, 52, 53, 61, 30, 40]))).toBe(
            text([0, 1, 2, 25, 26, 27, 51, 52, 53, 61, 30, 40]),
        );
    });

    it('should use the clock of the machine, in the alphabet of URLs', () => {
        const token = Lunar.mintToken(SEEDS, 'a', '1', NONCE);
        expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
        expect(Math.abs(readToken(SEEDS, token).timestamp - Date.now() / 1000)).toBeLessThan(5);
    });

    it('should make a token that only the seeds of the page can read', () => {
        const token = Lunar.mintToken(SEEDS, 'a', '1', NONCE);
        expect(readToken({ axis: SEEDS.axis, pitch: 'other' }, token).slug).not.toBe('a');
    });

    it('should keep the offset at any value, also when the bytes of the payload would be more than 255', () => {
        for (const offset of [0, 1, 255]) {
            const token = Lunar.mintToken(SEEDS, 'x', '9', NONCE, {
                random: scripted([...TAIL, offset]),
            });
            expect(fromBase64Url(token)[0]).toBe(offset);
            expect(readToken(SEEDS, token)).toMatchObject({
                slug: 'x',
                chapter: '9',
                nonce: NONCE,
            });
        }
    });
});

describe('the session of a chapter', () => {
    const IMAGES = JSON.stringify({
        data: { images: ['https://a.test/1.png'] },
        cache_status: 'fresh',
        cache_ttl: 120,
    });

    it('should decrypt what the server made with the thumbprint of the key of the proof', async () => {
        const data = encryptSession(IMAGES, SEEDS, 'nonce1234567', 'thumb-print');
        await expect(Lunar.unpackSession(data, SEEDS, 'nonce1234567', 'thumb-print')).resolves.toBe(
            IMAGES,
        );
    });

    it('should decrypt what the server made without it, when the server does not ask for it', async () => {
        const data = encryptSession(IMAGES, SEEDS, 'nonce1234567');
        await expect(Lunar.unpackSession(data, SEEDS, 'nonce1234567', 'thumb-print')).resolves.toBe(
            IMAGES,
        );
    });

    it('should take the alphabet of the standard as well as the one of URLs, and the padding or not', async () => {
        const data = encryptSession(IMAGES, SEEDS, 'n', 't');
        const standard = Buffer.from(data, 'base64url').toString('base64');
        expect(standard).toMatch(/[+/=]|^[A-Za-z0-9]+$/);
        await expect(Lunar.unpackSession(standard, SEEDS, 'n', 't')).resolves.toBe(IMAGES);
        await expect(Lunar.unpackSession(data + '==', SEEDS, 'n', 't')).resolves.toBe(IMAGES);
    });

    it('should decrypt a list as well as an object', async () => {
        const data = encryptSession('[1,2]', SEEDS, 'n', 't');
        await expect(Lunar.unpackSession(data, SEEDS, 'n', 't')).resolves.toBe('[1,2]');
    });

    it.each([
        ['another nonce', (data) => Lunar.unpackSession(data, SEEDS, 'other', 't')],
        [
            'other seeds',
            (data) => Lunar.unpackSession(data, { axis: 'other', pitch: SEEDS.pitch }, 'n', 't'),
        ],
        [
            'a text that is no JSON',
            () =>
                Lunar.unpackSession(encryptSession('plain text', SEEDS, 'n', 't'), SEEDS, 'n', 't'),
        ],
        [
            'data that are no multiple of a block',
            () => Lunar.unpackSession('AAAA', SEEDS, 'n', 't'),
        ],
    ])('should refuse the session with %s', async (name, unpack) => {
        const data = encryptSession(IMAGES, SEEDS, 'n', 't');
        await expect(unpack(data)).rejects.toThrow('Failed to decrypt chapter session data!');
    });

    it('should refuse data that are no base64', async () => {
        await expect(Lunar.unpackSession('not base64 !', SEEDS, 'n', 't')).rejects.toThrow(
            'Invalid base64!',
        );
    });
});

describe('the proof of the key', () => {
    it('should make a key whose thumbprint is the one of RFC 7638', async () => {
        const key = await Lunar.createProofKey();
        const proof = readProof(
            new Request('https://api.lunarx.to/x', {
                headers: {
                    'cant-catch-this-monkey': await Lunar.createProof(
                        key,
                        'GET',
                        'https://api.lunarx.to/x',
                    ),
                },
            }),
        );
        expect(proof.thumbprint).toBe(key.thumbprint);
        expect(proof.x).toBe(key.x);
        expect(key.thumbprint).toMatch(/^[A-Za-z0-9_-]{43}$/);
        // the private key does not leave the key pair
        await expect(crypto.subtle.exportKey('jwk', key.privateKey)).rejects.toThrow();
    });

    it('should sign the method and the address without the query, with ES256, as a JWT of DPoP', async () => {
        const key = await Lunar.createProofKey();
        const now = Date.UTC(2026, 9, 19, 12, 0, 5);
        const jwt = await Lunar.createProof(
            key,
            'post',
            'https://api.lunarx.to:8443/api/manga/r/token_abc?language=de#x',
            now,
        );
        const proof = readProof(
            new Request('https://api.lunarx.to/x', { headers: { 'cant-catch-this-monkey': jwt } }),
        );
        expect(proof.signed).toBe(true);
        expect(proof.signatureLength).toBe(64);
        expect(proof.header).toEqual({
            alg: 'ES256',
            typ: 'dpop+jwt',
            jwk: { kty: 'EC', crv: 'P-256', x: key.x, y: key.y },
        });
        expect(proof.payload).toEqual({
            htu: 'https://api.lunarx.to/api/manga/r/token_abc',
            htm: 'POST',
            iat: Math.floor(now / 1000),
            jti: expect.stringMatching(
                /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
            ),
        });
    });

    it('should make another identifier and another signature for every proof', async () => {
        const key = await Lunar.createProofKey();
        const [first, second] = await Promise.all([
            Lunar.createProof(key, 'GET', 'https://api.lunarx.to/a'),
            Lunar.createProof(key, 'GET', 'https://api.lunarx.to/a'),
        ]);
        expect(first).not.toBe(second);
    });

    it('should make another key pair each time', async () => {
        const [first, second] = [await Lunar.createProofKey(), await Lunar.createProofKey()];
        expect(first.thumbprint).not.toBe(second.thumbprint);
        expect(first.x).not.toBe(second.x);
    });
});

// ================================ the connector ================================

// the chunks of the code of the site that the window of the seeds is given (see stubEngine)
let currentChunks = {};

// What the site does, as far as the connector sees it: the pages, the API with the proof on the list of the images, the
// check of Cloudflare that is accepted when its token is one of the tokens that the stub of the check made, the pages
// between the pages and the veils of the list, and the vault, which answers 503 while it prepares a file.
function createSite({
    ttl = 300,
    images = null,
    veils = null,
    mangas = [],
    rejectProofs = 0,
    decoys = 0,
    busy = 0,
    pointsLocked = false,
    seeds = SEEDS,
} = {}) {
    currentChunks = siteChunks();
    const site = {
        tainted: new Set(),
        busy,
        veilRequests: [],
        log: [],
        viewed: new Set(),
        unlocked: new Set(),
        cleared: new Set(),
        thumbprints: [],
        attempts: [],
        tokens: [],
        languages: [],
        challenges: [],
        turnstileHeaders: [],
        rejectProofs,
        decoys,
        pointsLocked,
        referers: [],
        accepts: [],
    };
    const jsonResponse = (value, status = 200) =>
        new Response(JSON.stringify(value), {
            status,
            headers: { 'content-type': 'application/json' },
        });
    const listOfImages = (slug, chapter) =>
        images
            ? images
            : [1, 2, 3].map(
                  (number) => `https://vault.lunarx.to/cdn/${slug}/${chapter}/${number}.png`,
              );

    site.handle = async (request) => {
        const url = new URL(request.url);
        site.log.push(`${request.method} ${url.host}${url.pathname}`);
        if (url.host === 'lunarx.to') {
            const [, , slug, chapter] = url.pathname.split('/');
            site.pages = [...(site.pages || []), `${slug}/${chapter}?${url.searchParams}`];
            const html = page(chapterRows(seeds));
            return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
        }
        if (url.host === 'vault.lunarx.to' || url.host === 'img.other.test') {
            site.referers.push(request.headers.get('x-referer'));
            site.accepts.push(request.headers.get('accept'));
            if (url.host === 'vault.lunarx.to' && site.busy > 0) {
                site.busy--;
                return new Response('preparing', { status: 503 });
            }
            if (url.pathname.endsWith('/missing.png')) {
                return new Response('no', { status: 404, statusText: 'Not Found' });
            }
            return new Response(new Uint8Array([137, 80, 78, 71, 1]), {
                headers: { 'content-type': 'image/png' },
            });
        }
        // the API: the reader signs the list of the images only, and a key that signed anything else gets fake images
        const path = url.pathname;
        const proof = readProof(request);
        if (!path.startsWith('/api/manga/r/') && proof) {
            site.tainted.add(proof.thumbprint);
        }
        if (path.startsWith('/api/manga/veil/')) {
            site.veilRequests.push(path);
            return new Response(
                '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="400" height="600">' +
                    '<image x="10" y="20" width="100" height="50" xlink:href="data:image/png;base64,UEFUQ0g="/></svg>',
                { headers: { 'content-type': 'image/svg+xml' } },
            );
        }
        if (path === '/api/captcha/config') {
            return jsonResponse({ manga_turnstile_sitekey: 'KEY-OF-THE-SITE' });
        }
        if (path === '/api/manga/search') {
            const pageNumber = Number(url.searchParams.get('page'));
            return jsonResponse({
                manga: mangas.slice((pageNumber - 1) * 30, pageNumber * 30),
                page: pageNumber,
                total_pages: Math.ceil(mangas.length / 30),
            });
        }
        if (path.startsWith('/api/manga/title/')) {
            const slug = path.split('/').pop();
            const found = mangas.find((manga) => manga.slug === slug);
            return found ? jsonResponse({ manga: found }) : jsonResponse({ error: 'no' }, 404);
        }
        if (path.startsWith('/api/manga/password/info/')) {
            return jsonResponse(
                site.passwords || { has_series_password: false, chapter_passwords: [] },
            );
        }
        if (path.startsWith('/api/manga/chapter-lock/')) {
            site.unlocked.add(path.split('/').pop());
            return jsonResponse({ locked: false });
        }
        if (path === '/api/manga/chapter/view') {
            const { slug, chapter, language } = JSON.parse(await request.text());
            site.viewed.add(`${slug}/${chapter}/${language}`);
            return jsonResponse({ success: true });
        }
        if (path.startsWith('/api/manga/r/')) {
            site.attempts.push(proof && proof.x);
            const valid =
                proof &&
                proof.signed &&
                proof.header.alg === 'ES256' &&
                proof.header.typ === 'dpop+jwt' &&
                proof.payload.htm === request.method &&
                proof.payload.htu === proof.target;
            if (!valid || site.rejectProofs > 0) {
                site.rejectProofs = Math.max(0, site.rejectProofs - 1);
                return new Response('Please validate your session first', { status: 403 });
            }
            site.thumbprints.push(proof.thumbprint);
            if (site.pointsLocked) {
                return jsonResponse({ is_points_locked: true, message: 'Unlock with points' }, 403);
            }
            const read = readToken(seeds, path.split('/').pop());
            const language = url.searchParams.get('language');
            site.languages.push(language);
            site.tokens.push(read);
            const challenge = request.headers.get('Catch-Me-If-You-Can-Monkey');
            site.turnstileHeaders.push([challenge, request.headers.get('Which-Monkey')]);
            // a token of the check is made for the nonce of the token of the chapter (cData of the check)
            if (
                challenge &&
                request.headers.get('Which-Monkey') === 'turnstile' &&
                challenge === `check-${challenge.split('-')[1].split(':')[0]}:${read.nonce}`
            ) {
                site.challenges.push(challenge);
                site.cleared.add(`${proof.thumbprint}/${read.slug}`);
            }
            const real =
                site.cleared.has(`${proof.thumbprint}/${read.slug}`) &&
                site.unlocked.has(read.slug) &&
                !site.tainted.has(proof.thumbprint) &&
                site.decoys-- <= 0;
            // a real list has a page between the pages (an advertisement), and the veils go with the pages
            const pages = listOfImages(read.slug, read.chapter);
            const list = real
                ? [pages[0], 'https://api.lunarx.to/api/manga/pg/ad-1', ...pages.slice(1)]
                : [1, 2].map((number) => `https://api.lunarx.to/api/cdn/p/fake${number}.png`);
            const veil = real && veils ? [veils[0], null, ...veils.slice(1)] : undefined;
            const session = JSON.stringify({
                data: { images: list },
                slug: real ? read.slug : 'unknown',
                veil,
                cache_status: real ? 'fresh' : 'revalidate',
                cache_ttl: real ? ttl : undefined,
            });
            return jsonResponse({
                data: {
                    images: [],
                    session_data: encryptSession(session, seeds, read.nonce, proof.thumbprint),
                },
            });
        }
        if (/^\/api\/manga\/[^/]+$/.test(path)) {
            return jsonResponse({ data: site.chapters });
        }
        return new Response('not found', { status: 404, statusText: 'Not Found' });
    };
    vi.stubGlobal(
        'fetch',
        vi.fn(async (input, init) => site.handle(new Request(input, init))),
    );
    return site;
}

// the check of Cloudflare: a window that gives a token, and the engine that opens it
function stubEngine() {
    let count = 0;
    const fetchBrowser = vi.fn(async (request, preload, code) => {
        const nonce = /cData: "([^"]*)"/.exec(code)[1];
        return `check-${++count}:${nonce}`;
    });
    // the window of the seeds runs the script of the connector with the code of the site
    const fetchUI = vi.fn(async (request, code) => runInPage(code, currentChunks));
    globalThis.Engine = { Request: { fetchBrowser, fetchUI } };
    return { fetchBrowser, fetchUI };
}

function createConnector() {
    const connector = new Lunar.default();
    connector.wait = vi.fn(async () => undefined);
    return connector;
}

const chapterOf = (slug, number, lang = 'en', locked = false) => ({
    id: JSON.stringify({ slug, chapter: number, lang, locked }),
});

const payloadOf = (uri) =>
    JSON.parse(Buffer.from(new URL(uri).searchParams.get('payload'), 'base64').toString());

describe('LunarAnimes', () => {
    it('should be the connector of the site, which takes its pages and no others', () => {
        const connector = createConnector();
        expect(connector.id).toBe('lunaranimes');
        expect(connector.url).toBe('https://lunarx.to');
        for (const href of [
            'https://lunarx.to/manga/the-cliff',
            'https://lunarx.to/manga/the-cliff/3?lang=en',
            'https://lunaranime.ru/manga/x',
        ]) {
            expect(connector.canHandleURI(new URL(href))).toBe(true);
        }
        for (const href of [
            'https://lunarx.to/',
            'https://lunarx.to/novel/x',
            'https://example.org/manga/x',
        ]) {
            expect(connector.canHandleURI(new URL(href))).toBe(false);
        }
    });

    it('should not open the page of the site in a window to get going: the page takes that for a blocked extension', async () => {
        const { fetchBrowser } = stubEngine();
        const connector = createConnector();
        await connector.initialize();
        expect(connector.initialized).toBe(true);
        expect(globalThis.Engine.Request.fetchUI).not.toHaveBeenCalled();
        expect(fetchBrowser).not.toHaveBeenCalled();
    });

    describe('the mangas', () => {
        const mangas = Array.from({ length: 65 }, (_, index) => ({
            slug: `manga-${index}`,
            title: `Manga ${index}`,
        }));

        it('should list the mangas of all the pages of the search, without the proof, two requests in a second', async () => {
            const site = createSite({ mangas });
            const connector = createConnector();
            const list = await connector._getMangas();
            expect(list).toHaveLength(65);
            expect(list[0]).toEqual({ id: 'manga-0', title: 'Manga 0' });
            expect(list[64]).toEqual({ id: 'manga-64', title: 'Manga 64' });
            expect(site.log).toEqual([
                'GET api.lunarx.to/api/manga/search',
                'GET api.lunarx.to/api/manga/search',
                'GET api.lunarx.to/api/manga/search',
            ]);
            const request = fetch.mock.calls[0][0];
            expect(request.url).toBe(
                'https://api.lunarx.to/api/manga/search?page=1&limit=30&sort=relevance',
            );
            expect(request.headers.get('x-referer')).toBe('https://lunarx.to/');
            expect(request.headers.has('cant-catch-this-monkey')).toBe(false);
        });

        it('should count the requests of the update of the list', async () => {
            createSite({ mangas });
            const connector = createConnector();
            connector.isUpdating = true;
            await connector._getMangas();
            expect(connector.updateProgress.requests).toBe(3);
        });

        it('should fail with the status when the search is refused', async () => {
            vi.stubGlobal(
                'fetch',
                vi.fn(async () => new Response('', { status: 500, statusText: 'Server Error' })),
            );
            await expect(createConnector()._getMangas()).rejects.toThrow(
                'Failed to receive content from "https://api.lunarx.to/api/manga/search?page=1&limit=30&sort=relevance" (status: 500) - Server Error',
            );
        });

        it('should take a manga from the address of its page, or of one of its chapters', async () => {
            createSite({ mangas });
            const connector = createConnector();
            // a manga that is made looks at the titles on the device, and tells the document: there are none here
            connector.existingMangas = undefined;
            for (const href of [
                'https://lunarx.to/manga/manga-7',
                'https://lunarx.to/manga/manga-7/12?lang=de',
            ]) {
                const manga = await connector._getMangaFromURI(new URL(href));
                expect([manga.id, manga.title]).toEqual(['manga-7', 'Manga 7']);
            }
        });

        it('should call a manga by its slug when the site does not tell its title', async () => {
            createSite({ mangas });
            const connector = createConnector();
            connector.existingMangas = undefined;
            const manga = await connector._getMangaFromURI(
                new URL('https://lunarx.to/manga/unknown-one'),
            );
            expect([manga.id, manga.title]).toEqual(['unknown-one', 'unknown-one']);
        });
    });

    describe('the chapters', () => {
        function chapters(passwords) {
            const site = createSite();
            site.chapters = [
                { chapter: '3', chapter_title: '', language: 'en' },
                { chapter: '2.0', chapter_title: 'The Fall', language: 'en' },
                { chapter: '1.00', chapter_title: 'Chapter 1: Start', language: 'de' },
                { chapter: '1', chapter_title: 'Volume 1', language: 'en' },
                { chapter: '0.5', chapter_title: 'Ch.0.5 Preview', language: 'en' },
                { chapter: '4.50', chapter_title: null, language: 'fr' },
            ];
            site.passwords = passwords;
            return createConnector()._getChapters({ id: 'the-cliff' });
        }

        it('should name the chapters, oldest first, in the language that they are in', async () => {
            const list = await chapters({
                has_series_password: false,
                chapter_passwords: [
                    { chapter_number: '2.0', language: null },
                    { chapter_number: '1.00', language: 'de' },
                    { chapter_number: '3', language: 'fr' },
                ],
            });
            expect(list.map((chapter) => chapter.title)).toEqual([
                'Chapter 4.50',
                'Ch.0.5 Preview',
                'Volume 1',
                '🔒 Chapter 1: Start',
                '🔒 Chapter 2: The Fall',
                'Chapter 3',
            ]);
            expect(list.map((chapter) => chapter.language)).toEqual([
                'fr',
                'en',
                'en',
                'de',
                'en',
                'en',
            ]);
        });

        it('should hold in the id what the pages need, and whether the chapter is locked', async () => {
            const list = await chapters({
                has_series_password: false,
                chapter_passwords: [{ chapter_number: '1.00', language: 'de' }],
            });
            expect(JSON.parse(list[3].id)).toEqual({
                slug: 'the-cliff',
                chapter: '1.00',
                lang: 'de',
                locked: true,
            });
            expect(JSON.parse(list[2].id)).toEqual({
                slug: 'the-cliff',
                chapter: '1',
                lang: 'en',
                locked: false,
            });
        });

        it('should lock every chapter of a series that has a password', async () => {
            const list = await chapters({ has_series_password: true, chapter_passwords: [] });
            expect(list.every((chapter) => chapter.title.startsWith('🔒 '))).toBe(true);
            expect(list.every((chapter) => JSON.parse(chapter.id).locked)).toBe(true);
        });
    });

    describe('the pages of a chapter', () => {
        it('should hand over the images of the chapter once the check of the site is done', async () => {
            const site = createSite();
            const { fetchBrowser, fetchUI } = stubEngine();
            const connector = createConnector();
            const uris = await connector._getPages(chapterOf('the-cliff', '1'));
            expect(uris.map((uri) => payloadOf(uri))).toEqual(
                [1, 2, 3].map((number) => ({
                    url: `https://vault.lunarx.to/cdn/the-cliff/1/${number}.png`,
                    referer: 'https://lunarx.to/',
                })),
            );
            expect(uris[0]).toMatch(/^connector:\/\/lunaranimes\/?\?payload=/);
            expect(site.pages).toEqual(['the-cliff/1?lang=en']);
            expect(site.tokens[0]).toMatchObject({ slug: 'the-cliff', chapter: '1' });
            expect(site.languages).toEqual([null]);
            // the check is made in a window of the site that runs none of its scripts, as the site shows, with what it needs
            expect(fetchBrowser).toHaveBeenCalledTimes(1);
            const [request, preload, code, preferences, timeout] = fetchBrowser.mock.calls[0];
            expect(request.url).toBe('https://lunarx.to/manifest.json');
            expect(preload).toBeUndefined();
            expect(code).toContain('"KEY-OF-THE-SITE"');
            expect(code).toContain('challenges.cloudflare.com/turnstile/v0/api.js');
            // the check is the one of the reader, for the token of this chapter
            expect(code).toContain("action: 'read'");
            expect(code).toContain(`cData: ${JSON.stringify(site.tokens[0].nonce)}`);
            expect(preferences).toEqual({ webSecurity: true, images: true, show: true });
            expect(timeout).toBe(90000);
            expect(site.turnstileHeaders).toEqual([
                [`check-1:${site.tokens[0].nonce}`, 'turnstile'],
            ]);
            // the seeds are made by the code of the site, in a window of the site that runs none of its pages
            expect(fetchUI).toHaveBeenCalledTimes(1);
            const [seedsRequest, seedsCode, seedsTimeout] = fetchUI.mock.calls[0];
            expect(seedsRequest.url).toBe('https://lunarx.to/manifest.json');
            expect(seedsCode.startsWith(`(${Lunar.SEED_RUNTIME})(`)).toBe(true);
            expect(seedsTimeout).toBe(15000);
        });

        it('should leave out the pages between the pages, and give a page its veil from the API', async () => {
            createSite({ veils: [null, '/api/manga/veil/2.svg', ''] });
            stubEngine();
            const uris = await createConnector()._getPages(chapterOf('the-cliff', '1'));
            expect(uris.map((uri) => payloadOf(uri))).toEqual([
                {
                    url: 'https://vault.lunarx.to/cdn/the-cliff/1/1.png',
                    referer: 'https://lunarx.to/',
                },
                {
                    url: 'https://vault.lunarx.to/cdn/the-cliff/1/2.png',
                    referer: 'https://lunarx.to/',
                    veil: 'https://api.lunarx.to/api/manga/veil/2.svg',
                },
                {
                    url: 'https://vault.lunarx.to/cdn/the-cliff/1/3.png',
                    referer: 'https://lunarx.to/',
                },
            ]);
        });

        it('should say that a chapter is unlocked with ad points', async () => {
            createSite({ pointsLocked: true });
            stubEngine();
            await expect(createConnector()._getPages(chapterOf('the-cliff', '1'))).rejects.toThrow(
                'This chapter is unlocked with ad points: log in on the website and unlock it there.',
            );
        });

        it('should say that it found no seeds when the code of the site makes none', async () => {
            createSite();
            stubEngine().fetchUI.mockResolvedValue(null);
            await expect(createConnector()._getPages(chapterOf('the-cliff', '1'))).rejects.toThrow(
                'Failed to find payload seeds!',
            );
        });

        it('should open the lock of the chapter before the images are asked for (they are fake without it), and count the view after', async () => {
            const site = createSite();
            stubEngine();
            await createConnector()._getPages(chapterOf('the-cliff', '1'));
            const asked = site.log.filter((entry) => entry.includes('/api/'));
            expect(asked.slice(0, 2)).toEqual([
                'GET api.lunarx.to/api/manga/chapter-lock/the-cliff',
                'GET api.lunarx.to/api/captcha/config',
            ]);
            expect(asked[2]).toMatch(/^GET api\.lunarx\.to\/api\/manga\/r\/[A-Za-z0-9_-]+$/);
            expect(asked[3]).toBe('POST api.lunarx.to/api/manga/chapter/view');
            expect(asked).toHaveLength(4);
            expect([...site.viewed]).toEqual(['the-cliff/1/en']);
        });

        it('should ask for the language when it is not English, in the address of the page and of the API', async () => {
            const site = createSite();
            stubEngine();
            const uris = await createConnector()._getPages(chapterOf('the-cliff', '2.5', 'pt-br'));
            expect(site.pages).toEqual(['the-cliff/2.5?lang=pt-br']);
            expect(site.languages).toEqual(['pt-br']);
            expect(site.tokens[0]).toMatchObject({ slug: 'the-cliff', chapter: '2.5' });
            expect(uris).toHaveLength(3);
        });

        it('should sign the request of the list of the images only: a key that signed anything else gets fake images', async () => {
            const site = createSite();
            stubEngine();
            await createConnector()._getPages(chapterOf('the-cliff', '1'));
            for (const [request] of fetch.mock.calls) {
                const url = new URL(request.url);
                expect(request.headers.has('cant-catch-this-monkey')).toBe(
                    url.pathname.startsWith('/api/manga/r/'),
                );
            }
            expect(site.tainted.size).toBe(0);
        });

        it('should make the check once for the chapters of a manga, and again for the ones of another', async () => {
            createSite();
            const { fetchBrowser } = stubEngine();
            const connector = createConnector();
            await connector._getPages(chapterOf('the-cliff', '1'));
            await connector._getPages(chapterOf('the-cliff', '2'));
            await connector._getPages(chapterOf('the-cliff', '3', 'de'));
            expect(fetchBrowser).toHaveBeenCalledTimes(1);
            await connector._getPages(chapterOf('sea-song', '1'));
            expect(fetchBrowser).toHaveBeenCalledTimes(2);
        });

        it('should make the check once for chapters that are asked for at the same time', async () => {
            createSite();
            const { fetchBrowser } = stubEngine();
            const connector = createConnector();
            const lists = await Promise.all(
                ['1', '2', '3', '4'].map((number) =>
                    connector._getPages(chapterOf('the-cliff', number)),
                ),
            );
            expect(lists.every((list) => list.length === 3)).toBe(true);
            expect(fetchBrowser).toHaveBeenCalledTimes(1);
        });

        // the clearance is renewed by every chapter that was done, so each moment is tried after one chapter only
        it.each([
            ['the server says 100 seconds', 100, 69, 71],
            ['the server says nothing', undefined, 269, 271],
        ])(
            'should make the check again when the clearance has run out, 30 seconds before the end that the server gives (%s)',
            async (name, ttl, before, after) => {
                for (const [seconds, calls] of [
                    [before, 1],
                    [after, 2],
                ]) {
                    vi.useFakeTimers({ toFake: ['Date'] });
                    vi.setSystemTime(Date.UTC(2026, 9, 19, 12, 0, 0));
                    createSite({ ttl });
                    const { fetchBrowser } = stubEngine();
                    const connector = createConnector();
                    await connector._getPages(chapterOf('the-cliff', '1'));
                    vi.setSystemTime(Date.UTC(2026, 9, 19, 12, 0, seconds));
                    await connector._getPages(chapterOf('the-cliff', '2'));
                    expect(fetchBrowser).toHaveBeenCalledTimes(calls);
                }
            },
        );

        it('should keep the clearance going with every chapter that is done', async () => {
            vi.useFakeTimers({ toFake: ['Date'] });
            vi.setSystemTime(Date.UTC(2026, 9, 19, 12, 0, 0));
            createSite({ ttl: 100 });
            const { fetchBrowser } = stubEngine();
            const connector = createConnector();
            await connector._getPages(chapterOf('the-cliff', '1'));
            for (let minute = 1; minute <= 5; minute++) {
                vi.setSystemTime(Date.UTC(2026, 9, 19, 12, 0, minute * 60));
                await connector._getPages(chapterOf('the-cliff', String(minute + 1)));
            }
            expect(fetchBrowser).toHaveBeenCalledTimes(1);
        });

        it('should make a new key pair and the check again when the server asks for it with fake images', async () => {
            const site = createSite({ decoys: 1 });
            const { fetchBrowser } = stubEngine();
            const uris = await createConnector()._getPages(chapterOf('the-cliff', '1'));
            expect(uris).toHaveLength(3);
            expect(fetchBrowser).toHaveBeenCalledTimes(2);
            expect(site.challenges.map((challenge) => challenge.split(':')[0])).toEqual([
                'check-1',
                'check-2',
            ]);
            // each check was made for the token that it went with
            expect(site.challenges.map((challenge) => challenge.split(':')[1])).toEqual(
                site.tokens.slice(-2).map((token) => token.nonce),
            );
            // the first answer was made for the first key, the second one for another key
            const keys = site.thumbprints.filter(
                (thumbprint, index, all) => all.indexOf(thumbprint) === index,
            );
            expect(keys).toHaveLength(2);
            expect(site.thumbprints.at(-1)).toBe(keys[1]);
        });

        it('should give up when the images are still fake after the second check', async () => {
            createSite({ decoys: 5 });
            const { fetchBrowser } = stubEngine();
            await expect(createConnector()._getPages(chapterOf('the-cliff', '1'))).rejects.toThrow(
                'Could not load images. The check of the site was not accepted.',
            );
            expect(fetchBrowser).toHaveBeenCalledTimes(2);
        });

        it('should not count a chapter that was given up as cleared', async () => {
            const site = createSite({ decoys: 2 });
            const { fetchBrowser } = stubEngine();
            const connector = createConnector();
            await expect(connector._getPages(chapterOf('the-cliff', '1'))).rejects.toThrow(
                'Could not load images',
            );
            site.decoys = 0;
            await connector._getPages(chapterOf('the-cliff', '2'));
            expect(fetchBrowser).toHaveBeenCalledTimes(3);
        });

        it('should make a new key pair, once, when the server turns the proof down', async () => {
            const site = createSite({ rejectProofs: 1 });
            stubEngine();
            const uris = await createConnector()._getPages(chapterOf('the-cliff', '1'));
            expect(uris).toHaveLength(3);
            // the request of the list was sent again, with a proof of a key pair that is new, and the new one was kept
            const lists = fetch.mock.calls
                .map(([request]) => request.url)
                .filter((url) => url.includes('/api/manga/r/'));
            expect(lists).toHaveLength(2);
            expect(lists[0]).toBe(lists[1]);
            expect(site.attempts[0]).toBeDefined();
            expect(site.attempts[1]).not.toBe(site.attempts[0]);
            expect(new Set(site.attempts).size).toBe(2);
        });

        it('should say that the server turned the proof down, when it does so again', async () => {
            createSite({ rejectProofs: 100 });
            stubEngine();
            await expect(createConnector()._getPages(chapterOf('the-cliff', '1'))).rejects.toThrow(
                '(status: 403)',
            );
        });

        it('should not do anything for a chapter that is locked', async () => {
            createSite();
            const { fetchBrowser } = stubEngine();
            await expect(
                createConnector()._getPages(chapterOf('the-cliff', '1', 'en', true)),
            ).rejects.toThrow('Chapter is password-protected and cannot be downloaded.');
            expect(fetch).not.toHaveBeenCalled();
            expect(fetchBrowser).not.toHaveBeenCalled();
        });

        it('should say when the page of the chapter cannot be fetched, or holds no seeds', async () => {
            stubEngine();
            vi.stubGlobal(
                'fetch',
                vi.fn(async () => new Response('', { status: 404, statusText: 'Not Found' })),
            );
            await expect(createConnector()._getPages(chapterOf('the-cliff', '1'))).rejects.toThrow(
                'Failed to fetch chapter page: 404 Not Found',
            );
            vi.stubGlobal(
                'fetch',
                vi.fn(async () => new Response('<html><body>no flight data</body></html>')),
            );
            await expect(createConnector()._getPages(chapterOf('the-cliff', '1'))).rejects.toThrow(
                'Failed to find payload seeds!',
            );
        });

        it('should say that the window of the check was closed, when it is', async () => {
            createSite();
            const { fetchBrowser } = stubEngine();
            fetchBrowser.mockRejectedValue(
                new Error(
                    'Error invoking remote method \'rakkomik:fetch\': Error: The window for "https://lunarx.to/manifest.json" was closed before the page finished loading!',
                ),
            );
            await expect(createConnector()._getPages(chapterOf('the-cliff', '1'))).rejects.toThrow(
                'The window of the check of the site was closed before the check was done!',
            );
        });

        it('should pass on what is wrong with the check, and ask for no more chapters after it', async () => {
            const site = createSite();
            const { fetchBrowser } = stubEngine();
            fetchBrowser.mockRejectedValueOnce(
                new Error('The check of the site failed (code: 600010)'),
            );
            const connector = createConnector();
            await expect(connector._getPages(chapterOf('the-cliff', '1'))).rejects.toThrow(
                '(code: 600010)',
            );
            expect(site.challenges).toEqual([]);
            // the next chapter does not wait for the failure of the one before
            await expect(connector._getPages(chapterOf('the-cliff', '2'))).resolves.toHaveLength(3);
        });

        it.each([[''], [undefined], [null], [7]])(
            'should not take %j for a token of the check',
            async (value) => {
                createSite();
                stubEngine().fetchBrowser.mockResolvedValue(value);
                await expect(
                    createConnector()._getPages(chapterOf('the-cliff', '1')),
                ).rejects.toThrow('The check of the site gave no token!');
            },
        );

        it('should take the key of the check that the site names, once, and say so when it names none', async () => {
            const site = createSite();
            stubEngine();
            const connector = createConnector();
            await connector._getPages(chapterOf('the-cliff', '1'));
            await connector._getPages(chapterOf('other', '1'));
            expect(connector._siteKey).toBe('KEY-OF-THE-SITE');
            expect(site.log.filter((entry) => entry.includes('captcha'))).toHaveLength(1);
            const other = createConnector();
            vi.stubGlobal(
                'fetch',
                vi.fn(
                    async () =>
                        new Response(JSON.stringify({ reader_primary_sitekey: 'OLD' }), {
                            headers: { 'content-type': 'application/json' },
                        }),
                ),
            );
            await expect(other._loadSiteKey()).rejects.toThrow(
                'The site gave no key for its check!',
            );
        });

        it('should keep the referrer of the page of the chapter for an image that is not on the CDN of the site', async () => {
            createSite({
                images: ['https://img.other.test/a.png', 'https://vault.lunarx.to/cdn/b.png'],
            });
            stubEngine();
            const uris = await createConnector()._getPages(chapterOf('the-cliff', '1', 'de'));
            expect(uris.map((uri) => payloadOf(uri).referer)).toEqual([
                'https://lunarx.to/manga/the-cliff/1?lang=de',
                'https://lunarx.to/',
            ]);
        });
    });

    describe('the images', () => {
        it('should fetch an image with the referrer of the payload, and the types that a browser takes', async () => {
            const site = createSite();
            const connector = createConnector();
            const image = await connector._handleConnectorURI({
                url: 'https://vault.lunarx.to/cdn/a/1.png',
                referer: 'https://lunarx.to/',
            });
            expect(image.mimeType).toBe('image/png');
            expect(Array.from(image.data)).toEqual([137, 80, 78, 71, 1]);
            expect(site.referers).toEqual(['https://lunarx.to/']);
            expect(site.accepts).toEqual([
                'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
            ]);
        });

        it('should refuse an image that the server does not give', async () => {
            createSite();
            await expect(
                createConnector()._handleConnectorURI({
                    url: 'https://vault.lunarx.to/cdn/missing.png',
                    referer: 'https://lunarx.to/',
                }),
            ).rejects.toThrow(
                'Failed to receive content from "https://vault.lunarx.to/cdn/missing.png" (status: 404) - Not Found',
            );
        });

        it('should wait when more than four images are asked for in a second, the images of the CDN only', async () => {
            vi.useFakeTimers({ toFake: ['Date'] });
            vi.setSystemTime(Date.UTC(2026, 9, 19, 12, 0, 0));
            createSite();
            const connector = createConnector();
            const get = (url) =>
                connector._handleConnectorURI({ url, referer: 'https://lunarx.to/' });
            for (const name of ['a', 'b', 'c', 'd', 'e']) {
                await get(`https://img.other.test/${name}.png`);
            }
            expect(connector.wait).not.toHaveBeenCalled();
            for (const number of [1, 2, 3, 4]) {
                await get(`https://vault.lunarx.to/cdn/${number}.png`);
            }
            expect(connector.wait).not.toHaveBeenCalled();
            await get('https://vault.lunarx.to/cdn/5.png');
            expect(connector.wait).toHaveBeenCalledTimes(1);
            expect(connector.wait).toHaveBeenCalledWith(1000);
        });

        it('should ask the vault again while it prepares a file, 600 ms longer each time', async () => {
            createSite({ busy: 2 });
            const connector = createConnector();
            const image = await connector._handleConnectorURI({
                url: 'https://vault.lunarx.to/cdn/a/1.png',
                referer: 'https://lunarx.to/',
            });
            expect(Array.from(image.data)).toEqual([137, 80, 78, 71, 1]);
            expect(connector.wait.mock.calls).toEqual([[600], [1200]]);
        });

        it('should give up on a file that the vault keeps preparing', async () => {
            createSite({ busy: 10 });
            const connector = createConnector();
            await expect(
                connector._handleConnectorURI({
                    url: 'https://vault.lunarx.to/cdn/a/1.png',
                    referer: 'https://lunarx.to/',
                }),
            ).rejects.toThrow('(status: 503)');
            expect(connector.wait).toHaveBeenCalledTimes(4);
        });

        it('should draw the patches of the veil over the page, scaled to its size, and give a JPEG', async () => {
            const site = createSite();
            const drawn = [];
            const bitmaps = [];
            vi.stubGlobal(
                'createImageBitmap',
                vi.fn(async (blob) => {
                    const bytes = new Uint8Array(await blob.arrayBuffer());
                    const bitmap = { width: 800, height: 1200, bytes: Array.from(bytes) };
                    bitmaps.push(bitmap);
                    return bitmap;
                }),
            );
            vi.stubGlobal(
                'OffscreenCanvas',
                class {
                    constructor(width, height) {
                        this.size = [width, height];
                    }
                    getContext() {
                        return { drawImage: (...args) => drawn.push(args) };
                    }
                    async convertToBlob(options) {
                        this.options = options;
                        return new Blob([new Uint8Array([255, 216, 255])], { type: options.type });
                    }
                },
            );
            const image = await createConnector()._handleConnectorURI({
                url: 'https://vault.lunarx.to/cdn/a/2.png',
                referer: 'https://lunarx.to/',
                veil: 'https://api.lunarx.to/api/manga/veil/2.svg',
            });
            expect(site.veilRequests).toEqual(['/api/manga/veil/2.svg']);
            expect(image.mimeType).toBe('image/jpeg');
            expect(Array.from(image.data)).toEqual([255, 216, 255]);
            // the page, then the patch of the veil (400 x 600) at its place on the page (800 x 1200)
            expect(bitmaps[1].bytes).toEqual(Array.from(Buffer.from('PATCH')));
            expect(drawn).toEqual([
                [bitmaps[0], 0, 0],
                [bitmaps[1], 20, 40, 200, 100],
            ]);
        });

        it('should read a veil, and refuse one with a number that it cannot read', () => {
            const veil = Lunar.parseVeil(
                '<svg width="800" height="1200"><image x="1.5" y="2" width="3" height="4" href="data:image/png;base64,AQID"/>' +
                    '<image x="0" y="0" width="1" height="1" xlink:href="data:image/webp;base64,BAU="/></svg>',
            );
            expect({
                ...veil,
                patches: veil.patches.map((patch) => ({
                    ...patch,
                    bytes: Array.from(patch.bytes),
                })),
            }).toEqual({
                width: 800,
                height: 1200,
                patches: [
                    { x: 1.5, y: 2, width: 3, height: 4, bytes: [1, 2, 3] },
                    { x: 0, y: 0, width: 1, height: 1, bytes: [4, 5] },
                ],
            });
            expect(Lunar.parseVeil('not an svg')).toBeNull();
            expect(() => Lunar.parseVeil('<svg width="a" height="1"></svg>')).toThrow(
                'Failed to parse page veil!',
            );
        });
    });

    describe('the limit of requests', () => {
        it('should let two requests through in a second, and wait for the rest of the second for the third', async () => {
            vi.useFakeTimers({ toFake: ['Date'] });
            vi.setSystemTime(Date.UTC(2026, 9, 19, 12, 0, 0));
            const connector = createConnector();
            await connector._throttle();
            vi.setSystemTime(Date.UTC(2026, 9, 19, 12, 0, 0, 300));
            await connector._throttle();
            expect(connector.wait).not.toHaveBeenCalled();
            vi.setSystemTime(Date.UTC(2026, 9, 19, 12, 0, 0, 400));
            await connector._throttle();
            expect(connector.wait).toHaveBeenCalledWith(600);
            vi.setSystemTime(Date.UTC(2026, 9, 19, 12, 0, 2));
            await connector._throttle();
            await connector._throttle();
            expect(connector.wait).toHaveBeenCalledTimes(1);
        });

        it('should put the requests that are made at the same time in a line', async () => {
            createSite({ mangas: [{ slug: 'a', title: 'A' }] });
            const connector = createConnector();
            const waits = [];
            connector.wait = vi.fn(async (time) => waits.push(time));
            await Promise.all([1, 2, 3, 4, 5].map(() => connector._throttle()));
            expect(waits).toHaveLength(3);
        });
    });
});
