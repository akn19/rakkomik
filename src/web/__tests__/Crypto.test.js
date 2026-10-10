// Regression tests for the native crypto helpers (Fase 2, crypto-js removal).
// Uses dynamic import() to load the ES module under test.
const nodeCrypto = require('node:crypto');

let C = null;

beforeAll(async () => {
    C = await import('../mjs/engine/Crypto.mjs');
});

// Artifact produced by the REMOVED crypto-js lib (git HEAD:src/web/js/crypto-js.min.js):
// CryptoJS.AES.encrypt('s3cr3t-proxy-pass', 'HakuNeko!').toString()
const LEGACY_SETTINGS_CIPHER = 'U2FsdGVkX1+2H+jIm2EC5urdVpARkobtrd+fUVnxvQ8D6LdEpCNqlP0I6QiihTFv';
// Artifact produced by the REMOVED crypto-js lib:
// CryptoJS.AES.encrypt(url, Utf8(AESKey), { iv: Utf8(Hex('')) }).toString()
const LEGACY_COMICO_CIPHER = '/A2jUn3zA+GxNY+Cu+V+Nwrq3yK1EqD2yHseFFcDbfU=';
const COMICO_KEY = 'a7fc9dc89f2c873d79397f8a0028a4cd';
const COMICO_URL = 'https://img.com/image.jpg';

function aesCbcEncryptNode(plainBytes, keyBytes, ivBytes, algo) {
    const cipher = nodeCrypto.createCipheriv(algo, Buffer.from(keyBytes), Buffer.from(ivBytes));
    return new Uint8Array(Buffer.concat([cipher.update(Buffer.from(plainBytes)), cipher.final()]));
}

describe('Crypto codecs', () => {
    it('should roundtrip UTF-8 (incl. non-ASCII) through Base64 like CryptoJS', () => {
        const payload = JSON.stringify({ url: 'https://exämple.com/ü?id=1&x=üñï' });
        expect(C.bytesToUtf8(C.base64ToBytes(C.bytesToBase64(C.utf8ToBytes(payload))))).toBe(payload);
    });

    it('should parse lowercase/uppercase hex identically', () => {
        expect(C.bytesToHex(C.hexToBytes('deadBEEF00'))).toBe('deadbeef00');
    });

    it('should reject malformed hex', () => {
        expect(() => C.hexToBytes('zz')).toThrow();
        expect(() => C.hexToBytes('abc')).toThrow();
    });
});

describe('Crypto hashes', () => {
    it('should match NIST SHA-256(\"abc\")', () => {
        expect(C.sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    });

    it('should hash raw bytes like CryptoJS WordArray input', () => {
        expect(C.bytesToHex(C.sha256Bytes(new Uint8Array([1, 2, 3, 255]))))
            .toBe(nodeCrypto.createHash('sha256').update(Buffer.from([1, 2, 3, 255])).digest('hex'));
    });

    it('should match Node SHA-512', async () => {
        const input = 'freeforcxc2021reading';
        expect(await C.sha512Hex(input)).toBe(nodeCrypto.createHash('sha512').update(input).digest('hex'));
    });
});

describe('Crypto OpenSSL envelope (Settings passwords)', () => {
    it('should decrypt values written by the removed crypto-js lib', async () => {
        await expect(C.opensslAesDecrypt(LEGACY_SETTINGS_CIPHER, 'HakuNeko!')).resolves.toBe('s3cr3t-proxy-pass');
    });

    it('should roundtrip new values (Salted__ envelope)', async () => {
        const cipher = await C.opensslAesEncrypt('proxy:päss-ü', 'HakuNeko!');
        expect(cipher.startsWith('U2FsdGVkX1')).toBe(true); // 'Salted__' base64 magic
        await expect(C.opensslAesDecrypt(cipher, 'HakuNeko!')).resolves.toBe('proxy:päss-ü');
    });
});

describe('Crypto AES-CBC connector shapes', () => {
    it('should decrypt the legacy Comico ciphertext with a zero IV', async () => {
        const key = C.utf8ToBytes(COMICO_KEY);
        const iv = new Uint8Array(16);
        const cipher = C.base64ToBytes(LEGACY_COMICO_CIPHER);
        await expect(C.aesCbcDecrypt(cipher, key, iv).then(b => C.bytesToUtf8(b))).resolves.toBe(COMICO_URL);
        expect(C.bytesToUtf8(C.aesCbcDecryptSync(cipher, key, iv))).toBe(COMICO_URL);
    });

    it('should decrypt GManga-shaped payloads (base64 ct, hex key, base64 iv)', async () => {
        const sha = C.sha256Hex('some-o-string');
        const key = C.hexToBytes(sha);
        const iv = C.hexToBytes('30313233343536373839616263646566');
        const plain = JSON.stringify({ data: 'x', iv: 'y' });
        const cipher = aesCbcEncryptNode(C.utf8ToBytes(plain), key, iv, 'aes-256-cbc');
        const want = plain;
        expect(C.bytesToUtf8(await C.aesCbcDecrypt(cipher, key, iv))).toBe(want);
        expect(C.bytesToUtf8(C.aesCbcDecryptSync(cipher, key, iv))).toBe(want);
    });

    it('should decrypt CxC-shaped payloads (hex key/iv, base64 text)', async () => {
        const tokenHash = await C.sha512Hex('freeforcxc2021reading');
        const key = C.hexToBytes(tokenHash.substr(0, 64));
        const iv = C.hexToBytes(tokenHash.substr(30, 32));
        const plain = 'data:image/jpeg;base64,/9j/';
        const cipher = aesCbcEncryptNode(C.utf8ToBytes(plain), key, iv, 'aes-256-cbc');
        expect(C.bytesToUtf8(await C.aesCbcDecrypt(cipher, key, iv))).toBe(plain);
        expect(C.bytesToUtf8(C.aesCbcDecryptSync(cipher, key, iv))).toBe(plain);
    });

    it('should decrypt raw-buffer payloads (ComicFuz/mangaz shape)', async () => {
        const key = C.hexToBytes('00112233445566778899aabbccddeeff');
        const iv = C.hexToBytes('0102030405060708090a0b0c0d0e0f10');
        const plain = 'plaintext-block-160123456789abcdef';
        const cipher = aesCbcEncryptNode(C.utf8ToBytes(plain), key, iv, 'aes-128-cbc');
        expect(C.bytesToUtf8(await C.aesCbcDecrypt(cipher, key, iv))).toBe(plain);
        expect(C.bytesToUtf8(C.aesCbcDecryptSync(cipher, key, iv))).toBe(plain);
    });

    it('should match NIST SP 800-38A F.2.5 CBC-AES128 decrypt (sync)', () => {
        const key = C.hexToBytes('2b7e151628aed2a6abf7158809cf4f3c');
        const iv = C.hexToBytes('000102030405060708090a0b0c0d0e0f');
        const cipher = C.hexToBytes('7649abac8119b246cee98e9b12e9197d');
        // raw NIST vector carries no PKCS#7 padding: verify with ZeroPadding (no-op here)
        const out = C.aesCbcDecryptSync(cipher, key, iv, 'ZeroPadding');
        expect(C.bytesToHex(out)).toBe('6bc1bee22e409f96e93d7e117393172a');
    });
});

describe('LegacyCrypto adapter (obfuscated connectors)', () => {
    it('should behave like CryptoJS.SHA256().toString(Hex)', () => {
        const L = C.LegacyCrypto;
        expect(L.SHA256('abc').toString(L.enc.Hex)).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
        expect(L.SHA256('abc').toString()).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    });

    it('should decrypt OpenSSL passphrase payloads like CryptoJS.AES.decrypt', () => {
        const L = C.LegacyCrypto;
        expect(L.AES.decrypt(LEGACY_SETTINGS_CIPHER, 'HakuNeko!').toString(L.enc.Utf8)).toBe('s3cr3t-proxy-pass');
    });

    it('should decrypt explicit key/iv payloads like CryptoJS.AES.decrypt', () => {
        const L = C.LegacyCrypto;
        const out = L.AES.decrypt(LEGACY_COMICO_CIPHER, L.enc.Utf8.parse(COMICO_KEY), {
            iv: L.enc.Utf8.parse(L.enc.Hex.parse('')),
            mode: L.mode.CBC
        });
        expect(out.toString(L.enc.Utf8)).toBe(COMICO_URL);
    });

    it('should expose WordArray-compatible words/sigBytes', () => {
        const L = C.LegacyCrypto;
        const wa = L.lib.WordArray.create(new Uint8Array([1, 2, 3]));
        expect(wa.sigBytes).toBe(3);
        expect(Array.isArray(wa.words)).toBe(true);
        expect(C.bytesToHex(L.enc.Hex.parse('deadbeef').toBytes())).toBe('deadbeef');
    });
});
