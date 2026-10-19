// Lunar (lunarx.to): the seeds that the page of a chapter hands out, the token and the session of the chapter, the proof
// of the key pair that goes with every request to the API, and the connector as a whole against a site that does its side
// of all this. The recorded props are the ones that the real page sent on 2026-10-19: the token made from the seeds that
// they hold was accepted by the real server. The rest is written independently of the connector, after the extension of
// Keiyoushi (all/lunaranime) and with `node:crypto`, so that a mistake of the connector cannot be a mistake of the test.

// the props of the reader that the real page sent: one set that holds the seeds and one decoy, that has the same shape
const RECORDED = {
    real: {
        bhchw: 'da31fd9c58e9695b5bc4c98c394d1d00cf141f6dfbdb67cda522a8d9e80a816256ca34ba0eeb8a51cfe53d2cdb5e4258737dee9db0d1a6f50e633c7648a7688a972922cc788b8e3749c1e677159922db87e7de01f29127ae001e777968ec25df2814ee46fe5c79a438ffac96',
        uvgpx: '616ce0086e89855ba3c7cc1d792740b08cc965abba19c1b32cbc9ceef15452c6fd3f5ade1d9911c08b47b3097ea615ed66cd8ab599116164ae02112dad854ad17bb1ba6901fdb416d46a19e9a7943bfbce735848600646579795999f628eced87413c9294ea5682f25011b25',
        dphyjdffuz:
            '6dc754851cfbc1c0c30dade3a6de0ff576e233dc91606f910b4b3cf8149b8ef81bcba24cc269da3581c559541009253720cd02bb7090cf6e134cfa4f41d93052cab892aae56ec610cdec0234a971e58f7c16f9dd6e16af558582609b433d8d50b45a681cef3fa2978b63eb69',
        ilopmo: 'b883f7e26cf8d6f78bd3fbc18ba43295edf0ccf7c284d8b19d71bc3bd4659ce0db0dfdca5f758ed583d04e16a0fc45c285f7fd02e445f70570e3d2974b01b8ee37a990bfd5f76c532548cf3623495f8b6304301cf7ebd77ec22c67e4100cd5511175b3d5a6dfdfaf6bd6e8',
        safkebpl:
            'b25bc4aa49f1191cfe140bc58183b3f33d4a488da1b5c6a25623ba00e6fa50be8a94e9582b4ba079c896a5658d2c95d5012d0b956abd045c855a895a47a0f16dcc5da89f8f418b2a6effd60820ddf6dc295054dd6553692f44581afba461a1ef870b79f4584b019713bc7',
        ufynclz: '=kM/AQDaWTqxqzQXmRM5caLUJQny435st1Qccj6kw62Dg0YoWGQORJn2lOOTzwEO',
    },
    decoy: {
        urcdfd: '0c62af8b5b20c73125a83d0db60d4211fe827f7c68c4c67e2c640a66100a9db71dae76ab7a1cb4b1adb5498b468a44278f838902211f',
        psxtqfquy:
            '26e1836698e2616845a61ed8398a629d049b6840f4b06833dcf1e1f86f91f8bff5a21f6073ff6c95abe70753a204f87be455efd81cfd',
        othwwlfjos:
            '937b84959d3399aaf83e670ea23034285594da8750a20a19151b61c5902c8bc46f5f4bb1a9bec0466292c0c0ce4828a94148b466fb0c',
        rcagjuabjed:
            'f05f8be0e352042361a50a1392e7fe4512d648fc873ea3c50ba2f3a1aa10a0934bfafcac9e2da7bbf9c26a6c4e05394497ce504ae916',
        rpehqxkvh:
            '9c1dc88427d54d92cc4d579f09765cc5d3d86cace54736d2a8e663a99197769324f0abd2d97bdd90620df72030abdb5e0cae22031724',
        kwlfiokl:
            '96df1e3948990618e08a59e276e8f2983e416a751e6761abbff7144cc3bcba5b647df18c19ea21fad9ac7ff2e4c0a3ffb7b694b59',
        svqtmfrbj:
            '0abde533a46cfb38eeb341f0c7103304b7efb0823e8466e99811a0f6b8f62d1df17346379457b73317ce4399a899ab15b538337afcbd41',
        gpyaymspku:
            'r+87Co1Ybuqxh/iFgF4oCPRLCh3np+YBiM0aZer5KQSAuNIp4TAJQRz0M6vF8BRNq799B9CEw8rhj2FeUI46NOPC8xVnm38v',
    },
    seeds: {
        axis: '9MbRt2wELLNpyssYQuJwpVi8V9oC5qtfN3Qe0LdIA0e8FZpLFPlLQk2dibuPUqFR8',
        pitch: 'SK40gohxA3fbP6CHCeVU6GnatOGKM92L1JXaLlYkkZ1emwhp9eT3iDYunveYdceyldKGH',
    },
};

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
const latin1 = (text) => Array.from(text, (char) => char.charCodeAt(0));

// seeds with characters that are more than ASCII, as the bytes of the page are
const SEEDS = { axis: 'k3Zq9xW1ébT7ÿmPaR2sD', pitch: 'Qe5\u0080Lw8YhN4ÃuJc6VgB1oXzF' };

// ============================== the hiding of the seeds ==============================

const PROGRAM = [
    [0, 0x5a],
    [4, 0],
    [2, 3],
    [1, 0x11],
    [5, 0x23],
    [6, 0],
    [3, 0],
    [7, 0x80],
];

// What the page does to a byte that it hides: the steps of the program, each the reverse of what the reader of the seeds
// does with it (that is why the program is run from its first step here and from its last one there).
function hide(operation, argument, value, index, state) {
    switch (operation) {
        case 0:
            return value ^ argument;
        case 1:
            return (value + argument) & 0xff;
        case 2: {
            const shift = argument & 7 || 1;
            return ((value << shift) | (value >>> (8 - shift))) & 0xff;
        }
        case 3:
            return ((value & 15) << 4) | (value >>> 4);
        case 4:
            return value ^ state;
        case 5:
            return value ^ ((index * (1 | argument) + argument) & 0xff);
        case 6:
            return ~value & 0xff;
        default:
            return (argument - value) & 0xff;
    }
}

function nameHash(name) {
    let hash = 0;
    for (const char of name) {
        hash = (31 * hash + char.charCodeAt(0)) & 0xff;
    }
    return hash;
}

/**
 * The props of the reader that hold the seeds: the bytes are chained to each other and to a generator of numbers, hidden by
 * the program and cut into the props that the header names; the header is masked with a key that comes from the name of
 * its own prop, and written backwards in base64.
 */
function encodeSeedProps(
    seeds,
    {
        program = PROGRAM,
        seed = 0x2b,
        multiplier = 0x45,
        increment = 0x1f,
        headerName = 'hdr',
        names = ['pa', 'pb', 'pc'],
        version = '3',
        magic = [167, 62, 145],
        lengths = [seeds.axis.length, seeds.pitch.length],
    } = {},
) {
    const plain = [
        ...magic,
        lengths[0] >> 8,
        lengths[0] & 255,
        lengths[1] >> 8,
        lengths[1] & 255,
        ...latin1(seeds.axis),
        ...latin1(seeds.pitch),
    ];
    let state = seed & 0xff;
    let previous = 0;
    const cipher = plain.map((byte, index) => {
        state = (state * multiplier + increment) & 0xff;
        let value = byte;
        for (const [operation, argument] of program) {
            value = hide(operation, argument, value, index, state);
        }
        const current = value ^ previous;
        previous = current;
        return current;
    });
    const hex = cipher.map((byte) => byte.toString(16).padStart(2, '0')).join('');
    const size = Math.ceil(hex.length / names.length / 2) * 2;
    const props = {};
    names.forEach((name, index) => {
        props[name] = hex.slice(index * size, (index + 1) * size);
    });
    const header = [
        version,
        seed.toString(16),
        multiplier.toString(16),
        increment.toString(16),
        program
            .map(
                ([operation, argument]) =>
                    operation.toString(16) + argument.toString(16).padStart(2, '0'),
            )
            .join(''),
        names.join('.'),
    ].join('|');
    const masked = Buffer.from(
        latin1(header).map((code, index) => code ^ ((nameHash(headerName) + 37 * index) & 0xff)),
    );
    props[headerName] = [...masked.toString('base64')].reverse().join('');
    return props;
}

// ============================== the flight data of Next.js ==============================

const row = (id, value) => `${id}:${JSON.stringify(value)}\n`;
const component = (props) => ['$', '$L1', null, props];
const script = (rows) => `self.__next_f.push(${JSON.stringify([1, rows])})`;

function page(rows, { before = '' } = {}) {
    return (
        '<!DOCTYPE html><html><head><script>(self.__next_f=self.__next_f||[]).push([0])</script>' +
        before +
        '</head><body><script src="/_next/static/app.js" async></script>' +
        `<script>${script(rows)}</script></body></html>`
    );
}

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

describe('the seeds of the page', () => {
    it('should find the seeds in the props that the real page sent, and not in a decoy', () => {
        expect(Lunar.decodeSeeds(RECORDED.real)).toEqual(RECORDED.seeds);
        expect(Lunar.decodeSeeds(RECORDED.decoy)).toBeNull();
    });

    it('should hand over bytes of any value as the characters of the seeds', () => {
        const props = encodeSeedProps(SEEDS);
        expect(Lunar.decodeSeeds(props)).toEqual(SEEDS);
        expect(latin1(SEEDS.axis + SEEDS.pitch).some((code) => code > 127)).toBe(true);
    });

    it.each([
        ['another seed of the generator', { seed: 0xfe }],
        [
            'a multiplier and an increment that run over',
            { multiplier: 0x7fffffff, increment: 0x7ffffff1 },
        ],
        ['a header prop that is not the first one', { headerName: 'zz' }],
        ['one prop that holds all of the bytes', { names: ['solo'] }],
        ['many props', { names: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }],
        ['a program of one step', { program: [[4, 0]] }],
        [
            'every step of the program',
            { program: [0, 1, 2, 3, 4, 5, 6, 7].map((step) => [step, 0x90 + step]) },
        ],
        ['a shift of 8 that is read as 1', { program: [[2, 8]] }],
    ])('should read the seeds from %s', (name, options) => {
        expect(Lunar.decodeSeeds(encodeSeedProps(SEEDS, options))).toEqual(SEEDS);
    });

    it('should read seeds of more than 255 characters, the lengths have two bytes', () => {
        const long = { axis: 'a'.repeat(300), pitch: 'b'.repeat(7) };
        expect(Lunar.decodeSeeds(encodeSeedProps(long))).toEqual(long);
    });

    it('should find the header among props that are noise', () => {
        const props = { first: 'zzzz', ...encodeSeedProps(SEEDS), last: '12' };
        expect(Lunar.decodeSeeds(props)).toEqual(SEEDS);
    });

    it.each([
        ['another version of the header', { version: '4' }],
        ['bytes that are no seeds', { magic: [1, 2, 3] }],
        [
            'a length that goes beyond the bytes',
            { lengths: [SEEDS.axis.length + 50, SEEDS.pitch.length] },
        ],
        ['a length of 0', { lengths: [0, SEEDS.pitch.length] }],
        ['a step that the program does not know', { program: [[8, 1]] }],
    ])('should find no seeds with %s', (name, options) => {
        expect(Lunar.decodeSeeds(encodeSeedProps(SEEDS, options))).toBeNull();
    });

    it('should find no seeds when the props it names are not there, or are cut in the middle of a byte', () => {
        const props = encodeSeedProps(SEEDS, { names: ['pa', 'pb'] });
        expect(Lunar.decodeSeeds({ ...props, pa: undefined })).toBeNull();
        expect(Lunar.decodeSeeds({ ...props, pb: props.pb.slice(0, -1) })).toBeNull();
        expect(Lunar.decodeSeeds({ ...props, pb: 'not hex!' })).toBeNull();
        expect(Lunar.decodeSeeds({})).toBeNull();
        expect(Lunar.decodeSeeds({ only: 'abc' })).toBeNull();
    });
});

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
    const real = encodeSeedProps(SEEDS);

    it('should find the seeds among the decoys of the real page', () => {
        const rows = row(2, component(RECORDED.decoy)) + row(3, component(RECORDED.real));
        expect(Lunar.extractSeeds(Lunar.inlineScripts(page(rows)))).toEqual(RECORDED.seeds);
    });

    it('should find them deep in the props of other components', () => {
        const rows = row(2, [
            '$',
            'div',
            null,
            { children: [['$', '$L9', null, { deep: { props: real } }]] },
        ]);
        expect(Lunar.extractSeeds([script(rows)])).toEqual(SEEDS);
    });

    it('should follow a prop that was moved out of the props into a text of its own', () => {
        const moved = { ...real, pa: '$7' };
        // the text counts the bytes that it has in UTF-8: the rows before it have more bytes than characters
        const rows =
            `3:T9,${'日本語'}\n` +
            `4:T6,${'😀'}ab\n` +
            `7:T${Buffer.byteLength(real.pa).toString(16)},${real.pa}\n` +
            row(8, component(moved));
        expect(Lunar.extractSeeds([script(rows)])).toEqual(SEEDS);
    });

    it('should follow a prop that is a reference to a model, and an escaped dollar sign', () => {
        const rows = row(5, real.pb) + row(6, component({ ...real, pb: '$5', note: '$$5' }));
        expect(Lunar.extractSeeds([script(rows)])).toEqual(SEEDS);
    });

    it('should not take props for the seeds when one of them is not a text, as `undefined` is not', () => {
        const rows =
            row(6, component({ ...real, gone: '$undefined' })) +
            row(7, component({ ...real, count: 3 }));
        expect(() => Lunar.extractSeeds([script(rows)])).toThrow('Failed to find payload seeds!');
    });

    it('should leave the rows alone that are no JSON, and the scripts that are no flight data', () => {
        const rows =
            'b:I["123",["a.js"],"default"]\nHL["/_next/a.css","style"]\n' +
            row(1, '$Sreact.fragment') +
            row(2, component(real));
        expect(
            Lunar.extractSeeds(['window.x = 1', 'self.__next_f.push(oops)', script(rows)]),
        ).toEqual(SEEDS);
    });

    it('should take the push of a script that comes later, and of a row that sits in the same text as a decoy', () => {
        expect(
            Lunar.extractSeeds([
                script(row(1, component(RECORDED.decoy))),
                script(row(2, component(real))),
            ]),
        ).toEqual(SEEDS);
    });

    it('should say that it found no seeds', () => {
        expect(() => Lunar.extractSeeds([])).toThrow('Failed to find payload seeds!');
        expect(() => Lunar.extractSeeds([script(row(1, component(RECORDED.decoy)))])).toThrow(
            'Failed to find payload seeds!',
        );
        expect(() => Lunar.extractSeeds([`self.__next_f.push([1, 5])`])).toThrow(
            'Failed to find payload seeds!',
        );
    });
});

describe('the token of a chapter', () => {
    // the numbers that the random generator gives, in the order that Kotlin asks for them: the nonce, the tail, the offset
    const scripted = (values) => {
        let index = 0;
        return (bound) => values[index++] % bound;
    };
    const NONCE = [0, 1, 2, 25, 26, 27, 51, 52, 53, 61, 30, 40];
    const TAIL = [5, 15, 25, 35, 45, 55];
    const text = (indexes) => indexes.map((index) => ALPHABET[index]).join('');

    it('should make the token that the reference makes, from the same time, nonce and offset', () => {
        const now = Date.UTC(2026, 9, 19, 12, 0, 0, 999);
        const { token, nonce } = Lunar.mintToken(SEEDS, 'the-cliff', '1.5', {
            now,
            random: scripted([...NONCE, ...TAIL, 200]),
        });
        expect(nonce).toBe(text(NONCE));
        expect(token).toBe(
            referenceToken(SEEDS, 'the-cliff', '1.5', {
                now,
                nonce: text(NONCE),
                tail: text(TAIL),
                offset: 200,
            }),
        );
    });

    it('should name the chapter, the time and the nonce in a payload that the server can read', () => {
        const now = Date.UTC(2026, 9, 19, 12, 0, 0);
        const { token, nonce } = Lunar.mintToken(SEEDS, 'sea-song', '12', { now });
        expect(readToken(SEEDS, token)).toEqual({
            timestamp: Math.floor(now / 1000),
            nonce,
            slug: 'sea-song',
            chapter: '12',
            tail: expect.stringMatching(/^[a-zA-Z0-9]{6}$/),
        });
        expect(nonce).toMatch(/^[a-zA-Z0-9]{12}$/);
    });

    it('should use the clock of the machine and a new nonce for every token, in the alphabet of URLs', () => {
        const first = Lunar.mintToken(SEEDS, 'a', '1');
        const second = Lunar.mintToken(SEEDS, 'a', '1');
        expect(first.nonce).not.toBe(second.nonce);
        expect(first.token).toMatch(/^[A-Za-z0-9_-]+$/);
        expect(Math.abs(readToken(SEEDS, first.token).timestamp - Date.now() / 1000)).toBeLessThan(
            5,
        );
    });

    it('should make a token that only the seeds of the page can read', () => {
        const { token } = Lunar.mintToken(SEEDS, 'a', '1');
        expect(readToken({ axis: SEEDS.axis, pitch: 'other' }, token).slug).not.toBe('a');
    });

    it('should keep the offset at any value, also when the bytes of the payload would be more than 255', () => {
        for (const offset of [0, 1, 255]) {
            const { token, nonce } = Lunar.mintToken(SEEDS, 'x', '9', {
                random: scripted([...NONCE, ...TAIL, offset]),
            });
            expect(fromBase64Url(token)[0]).toBe(offset);
            expect(readToken(SEEDS, token)).toMatchObject({ slug: 'x', chapter: '9', nonce });
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

// What the site does, as far as the connector sees it: the pages, the API with its proof, the check of Cloudflare
// that is accepted when its token is one of the tokens that the stub of the check made, and the CDN.
function createSite({
    ttl = 300,
    images = null,
    mangas = [],
    rejectProofs = 0,
    decoys = 0,
    seeds = SEEDS,
} = {}) {
    const site = {
        log: [],
        viewed: new Set(),
        cleared: new Set(),
        thumbprints: [],
        attempts: [],
        tokens: [],
        languages: [],
        challenges: [],
        turnstileHeaders: [],
        rejectProofs,
        decoys,
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
            const props = encodeSeedProps(seeds);
            const html = page(
                row(2, component(RECORDED.decoy)) +
                    row(3, component(props)) +
                    row(4, component(RECORDED.decoy)),
            );
            return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
        }
        if (url.host === 'vault.lunarx.to' || url.host === 'img.other.test') {
            site.referers.push(request.headers.get('x-referer'));
            site.accepts.push(request.headers.get('accept'));
            if (url.pathname.endsWith('/missing.png')) {
                return new Response('no', { status: 404, statusText: 'Not Found' });
            }
            return new Response(new Uint8Array([137, 80, 78, 71, 1]), {
                headers: { 'content-type': 'image/png' },
            });
        }
        // the API
        const proof = readProof(request);
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
        const path = url.pathname;
        if (path === '/api/captcha/config') {
            return jsonResponse({ reader_primary_sitekey: 'KEY-OF-THE-SITE' });
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
        if (path.startsWith('/api/manga/rating/status/')) {
            return jsonResponse({ has_rated: false });
        }
        if (path === '/api/manga/chapter/view') {
            const { slug, chapter, language } = JSON.parse(await request.text());
            site.viewed.add(`${slug}/${chapter}/${language}`);
            return jsonResponse({ success: true });
        }
        if (path.startsWith('/api/manga/r/')) {
            const read = readToken(seeds, path.split('/').pop());
            const language = url.searchParams.get('language');
            site.languages.push(language);
            site.tokens.push(read);
            const challenge = request.headers.get('Catch-Me-If-You-Can-Monkey');
            site.turnstileHeaders.push([challenge, request.headers.get('Which-Monkey')]);
            if (
                challenge &&
                request.headers.get('Which-Monkey') === 'turnstile' &&
                /^check-\d+$/.test(challenge)
            ) {
                site.challenges.push(challenge);
                site.cleared.add(`${proof.thumbprint}/${read.slug}`);
            }
            const real =
                site.cleared.has(`${proof.thumbprint}/${read.slug}`) &&
                site.viewed.has(`${read.slug}/${read.chapter}/${language || 'en'}`) &&
                site.decoys-- <= 0;
            const list = real
                ? listOfImages(read.slug, read.chapter)
                : [1, 2].map((number) => `https://api.lunarx.to/api/cdn/p/fake${number}.png`);
            const session = JSON.stringify({
                data: { images: list },
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
    const fetchBrowser = vi.fn(async () => `check-${++count}`);
    globalThis.Engine = { Request: { fetchBrowser, fetchUI: vi.fn() } };
    return { fetchBrowser };
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

        it('should list the mangas of all the pages of the search, with the proof, two requests in a second', async () => {
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
            const { fetchBrowser } = stubEngine();
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
            expect(preferences).toEqual({ webSecurity: true, images: true, show: true });
            expect(timeout).toBe(90000);
            expect(site.turnstileHeaders).toEqual([['check-1', 'turnstile']]);
        });

        it('should ask the site to count the view before the images are asked for: the images are fake without it', async () => {
            const site = createSite();
            stubEngine();
            await createConnector()._getPages(chapterOf('the-cliff', '1'));
            const asked = site.log.filter((entry) => entry.includes('/api/'));
            expect(asked.slice(0, 3)).toEqual([
                'GET api.lunarx.to/api/manga/rating/status/the-cliff/1',
                'POST api.lunarx.to/api/manga/chapter/view',
                'GET api.lunarx.to/api/captcha/config',
            ]);
            expect(asked[3]).toMatch(/^GET api\.lunarx\.to\/api\/manga\/r\/[A-Za-z0-9_-]+$/);
            expect(asked).toHaveLength(4);
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

        it('should answer to the server with a proof on every request to the API, and with none to the page', async () => {
            createSite();
            stubEngine();
            await createConnector()._getPages(chapterOf('the-cliff', '1'));
            for (const [request] of fetch.mock.calls) {
                const url = new URL(request.url);
                expect(request.headers.has('cant-catch-this-monkey')).toBe(
                    url.host === 'api.lunarx.to',
                );
            }
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
            expect(site.challenges).toEqual(['check-1', 'check-2']);
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
            // the first request was sent again, with a proof of a key pair that is new, and the new one was kept
            expect(fetch.mock.calls[1][0].url).toBe(fetch.mock.calls[2][0].url);
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

        it('should take the key of the check that the site names, and the one that it knew before when it does not', async () => {
            const site = createSite();
            stubEngine();
            const connector = createConnector();
            await connector._getPages(chapterOf('the-cliff', '1'));
            expect(connector._siteKey).toBe('KEY-OF-THE-SITE');
            const other = createConnector();
            vi.stubGlobal(
                'fetch',
                vi.fn(async () => new Response('', { status: 500 })),
            );
            await expect(other._loadSiteKey()).resolves.toBe('0x4AAAAAAEweOgJ6zfOKhkgq');
            expect(site.log.filter((entry) => entry.includes('captcha'))).toHaveLength(1);
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

        it('should wait when more than two images are asked for in a second, the images of the CDN only', async () => {
            vi.useFakeTimers({ toFake: ['Date'] });
            vi.setSystemTime(Date.UTC(2026, 9, 19, 12, 0, 0));
            createSite();
            const connector = createConnector();
            const get = (url) =>
                connector._handleConnectorURI({ url, referer: 'https://lunarx.to/' });
            await get('https://img.other.test/a.png');
            await get('https://img.other.test/b.png');
            await get('https://img.other.test/c.png');
            expect(connector.wait).not.toHaveBeenCalled();
            await get('https://vault.lunarx.to/cdn/1.png');
            await get('https://vault.lunarx.to/cdn/2.png');
            expect(connector.wait).not.toHaveBeenCalled();
            await get('https://vault.lunarx.to/cdn/3.png');
            expect(connector.wait).toHaveBeenCalledTimes(1);
            expect(connector.wait).toHaveBeenCalledWith(1000);
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
