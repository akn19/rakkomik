// Crypto.mjs hashes in pure JavaScript (SHA-256 and MD5 are written out there, so that hot loops stay synchronous),
// which is exactly the kind of code that is right for the vectors of a standard and wrong at a length nobody tried: the
// padding changes at 55, 56 and 64 bytes. These tests check the helpers against Node's own implementations for all the
// lengths around those borders, on bytes that are the same on every run, and cover the guards of the AES helpers.
const nodeCrypto = require('node:crypto');

let C = null;

beforeAll(async () => {
    C = await import('../mjs/engine/Crypto.mjs');
});

// xorshift32: bytes without a pattern, but the same ones on every run
function bytes(length, seed = 1) {
    const out = new Uint8Array(length);
    let state = seed >>> 0 || 1;
    for (let index = 0; index < length; index++) {
        state = (state ^ (state << 13)) >>> 0;
        state = (state ^ (state >>> 17)) >>> 0;
        state = (state ^ (state << 5)) >>> 0;
        out[index] = state & 0xff;
    }
    return out;
}

const hash = (algorithm, data) => nodeCrypto.createHash(algorithm).update(Buffer.from(data)).digest('hex');

// the borders of the 64-byte blocks, where the padding of a message changes
const LENGTHS = [0, 1, 2, 3, 54, 55, 56, 57, 63, 64, 65, 119, 120, 121, 127, 128, 129, 191, 192, 1000, 4096, 100000];

describe('SHA-256', () => {
    it.each(LENGTHS)('should hash %d bytes like Node', length => {
        const data = bytes(length, length + 1);
        expect(C.sha256Hex(data)).toBe(hash('sha256', data));
    });

    it('should know the empty message', () => {
        expect(C.sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    });

    it('should hash a text as the bytes of its UTF-8, not as UTF-16 code units', () => {
        const text = 'Grüße, 漫画 🌸';
        expect(C.sha256Hex(text)).toBe(hash('sha256', Buffer.from(text, 'utf8')));
    });

    it('should leave the bytes that it is given as they were', () => {
        const data = bytes(200, 7);
        const copy = data.slice();
        C.sha256Bytes(data);
        expect(data).toEqual(copy);
    });

    it('should give 32 bytes, and the same ones every time', () => {
        const first = C.sha256Bytes('abc');
        expect(first).toHaveLength(32);
        expect(C.sha256Bytes('abc')).toEqual(first);
    });
});

describe('MD5', () => {
    it.each(LENGTHS)('should hash %d bytes like Node', length => {
        const data = bytes(length, length + 3);
        expect(C.bytesToHex(C.md5Bytes(data))).toBe(hash('md5', data));
    });

    it('should know the vectors of RFC 1321', () => {
        expect(C.bytesToHex(C.md5Bytes(''))).toBe('d41d8cd98f00b204e9800998ecf8427e');
        expect(C.bytesToHex(C.md5Bytes('abc'))).toBe('900150983cd24fb0d6963f7d28e17f72');
        expect(C.bytesToHex(C.md5Bytes('message digest'))).toBe('f96b697d7cb7938d525a2f31aaf161d0');
    });

    it('should hash a text as the bytes of its UTF-8', () => {
        const text = 'Grüße, 漫画 🌸';
        expect(C.bytesToHex(C.md5Bytes(text))).toBe(hash('md5', Buffer.from(text, 'utf8')));
    });
});

describe('SHA-512', () => {
    it.each([0, 1, 111, 112, 127, 128, 129, 1000])('should hash %d bytes like Node', async length => {
        const data = bytes(length, length + 5);
        await expect(C.sha512Hex(data)).resolves.toBe(hash('sha512', data));
    });

    it('should hash a text like Node, and the empty text too', async () => {
        await expect(C.sha512Hex('')).resolves.toBe(hash('sha512', ''));
        await expect(C.sha512Hex('漫画')).resolves.toBe(hash('sha512', Buffer.from('漫画')));
    });
});

describe('HMAC-SHA-256', () => {
    // RFC 4231 test cases 1, 2 and 6 (the last one with a key that is longer than a block)
    it.each([
        ['case 1', Uint8Array.from({ length: 20 }, () => 0x0b), 'Hi There', 'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7'],
        ['case 2', 'Jefe', 'what do ya want for nothing?', '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843'],
        ['case 6', Uint8Array.from({ length: 131 }, () => 0xaa), 'Test Using Larger Than Block-Size Key - Hash Key First', '60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54']
    ])('should know the vector of RFC 4231 %s', async (name, key, data, expected) => {
        await expect(C.hmacSha256Hex(data, key)).resolves.toBe(expected);
    });

    it('should accept the data and the key as bytes or as text, with the same result', async () => {
        const data = bytes(300, 11);
        const key = bytes(40, 12);
        const expected = nodeCrypto.createHmac('sha256', Buffer.from(key)).update(Buffer.from(data)).digest('hex');
        await expect(C.hmacSha256Hex(data, key)).resolves.toBe(expected);
        const text = 'a message with ümlauts';
        const secret = 'a s3cret';
        await expect(C.hmacSha256Hex(text, secret)).resolves.toBe(nodeCrypto.createHmac('sha256', secret).update(text).digest('hex'));
        await expect(C.hmacSha256Hex(C.utf8ToBytes(text), C.utf8ToBytes(secret))).resolves.toBe(await C.hmacSha256Hex(text, secret));
    });

    it('should give another result for another key', async () => {
        expect(await C.hmacSha256Hex('data', 'one')).not.toBe(await C.hmacSha256Hex('data', 'two'));
    });
});

describe('AES-CBC', () => {
    const iv = bytes(16, 21);

    it.each([[0], [1], [15], [17], [23], [31], [33], [64]])('should refuse a key of %d bytes when decrypting', async length => {
        await expect(C.aesCbcDecrypt(bytes(32, 5), bytes(length, 6), iv)).rejects.toThrow('Invalid AES key length (must be 16/24/32 bytes)!');
    });

    it.each([[0], [1], [15], [17], [32]])('should refuse an IV of %d bytes when decrypting', async length => {
        await expect(C.aesCbcDecrypt(bytes(32, 5), bytes(32, 6), bytes(length, 7))).rejects.toThrow('Invalid AES-CBC IV length (must be 16 bytes)!');
    });

    it.each([[16, 'aes-128-cbc'], [24, 'aes-192-cbc'], [32, 'aes-256-cbc']])('should encrypt with a key of %d bytes like Node, and decrypt it again', async (size, algorithm) => {
        const key = bytes(size, size);
        const plain = bytes(100, 31);
        const cipher = await C.aesCbcEncrypt(plain, key, iv);
        const node = nodeCrypto.createCipheriv(algorithm, Buffer.from(key), Buffer.from(iv));
        expect(Buffer.from(cipher).equals(Buffer.concat([node.update(Buffer.from(plain)), node.final()]))).toBe(true);
        expect(await C.aesCbcDecrypt(cipher, key, iv)).toEqual(plain);
    });

    it('should pad a message that is a whole number of blocks with a block of its own', async () => {
        const cipher = await C.aesCbcEncrypt(bytes(32, 1), bytes(16, 2), iv);
        expect(cipher).toHaveLength(48);
    });

    it('should not decrypt with another key', async () => {
        const cipher = await C.aesCbcEncrypt(C.utf8ToBytes('a message of some length'), bytes(32, 1), iv);
        await expect(C.aesCbcDecrypt(cipher, bytes(32, 2), iv)).rejects.toBeDefined();
    });

    it('should not decrypt something that is no cipher text', async () => {
        await expect(C.aesCbcDecrypt(bytes(17, 1), bytes(16, 2), iv)).rejects.toBeDefined();
    });
});

describe('the OpenSSL envelope', () => {
    // EVP_BytesToKey with MD5 and one round, written independently of Crypto.mjs on top of Node
    function derive(passphrase, salt) {
        let block = Buffer.alloc(0);
        let derived = Buffer.alloc(0);
        while (derived.length < 48) {
            block = nodeCrypto.createHash('md5').update(Buffer.concat([block, Buffer.from(passphrase), salt])).digest();
            derived = Buffer.concat([derived, block]);
        }
        return { key: derived.subarray(0, 32), iv: derived.subarray(32, 48) };
    }

    function encrypt(plain, passphrase, salt) {
        const { key, iv } = derive(passphrase, salt);
        const cipher = nodeCrypto.createCipheriv('aes-256-cbc', key, iv);
        return Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    }

    it('should decrypt what OpenSSL writes: "Salted__", eight bytes of salt, the cipher text', async () => {
        const salt = Buffer.from('0102030405060708', 'hex');
        const envelope = Buffer.concat([Buffer.from('Salted__'), salt, encrypt('pass: wörd', 'open sesame', salt)]);
        await expect(C.opensslAesDecrypt(envelope.toString('base64'), 'open sesame')).resolves.toBe('pass: wörd');
    });

    it('should decrypt a cipher text without a salt, which the old settings files hold', async () => {
        const cipher = encrypt('old secret', 'HakuNeko!', Buffer.alloc(0));
        await expect(C.opensslAesDecrypt(cipher.toString('base64'), 'HakuNeko!')).resolves.toBe('old secret');
    });

    it('should write an envelope that OpenSSL itself could read', async () => {
        const envelope = Buffer.from(await C.opensslAesEncrypt('proxy:päss-ü', 'HakuNeko!'), 'base64');
        expect(envelope.subarray(0, 8).toString()).toBe('Salted__');
        const salt = envelope.subarray(8, 16);
        const { key, iv } = derive('HakuNeko!', salt);
        const decipher = nodeCrypto.createDecipheriv('aes-256-cbc', key, iv);
        expect(Buffer.concat([decipher.update(envelope.subarray(16)), decipher.final()]).toString('utf8')).toBe('proxy:päss-ü');
    });

    it('should use another salt every time, so that the same password is not written the same way twice', async () => {
        const first = await C.opensslAesEncrypt('same', 'key');
        const second = await C.opensslAesEncrypt('same', 'key');
        expect(first).not.toBe(second);
        await expect(C.opensslAesDecrypt(first, 'key')).resolves.toBe('same');
        await expect(C.opensslAesDecrypt(second, 'key')).resolves.toBe('same');
    });

    it.each([[''], ['x'], ['a'.repeat(16)], ['漫'.repeat(2000)]])('should roundtrip a text of %d characters', async text => {
        await expect(C.opensslAesDecrypt(await C.opensslAesEncrypt(text, 'k'), 'k')).resolves.toBe(text);
    });

    it('should not give the text back for another passphrase', async () => {
        const salt = Buffer.from('a1a2a3a4a5a6a7a8', 'hex');
        const envelope = Buffer.concat([Buffer.from('Salted__'), salt, encrypt('a secret of some length', 'right', salt)]);
        // with a wrong key the padding is nearly always invalid: for this fixed salt and text it is
        await expect(C.opensslAesDecrypt(envelope.toString('base64'), 'wrong')).rejects.toBeDefined();
    });
});

describe('the codecs, at their limits', () => {
    it('should encode a long byte array in Base64 like Node, although it is built in pieces', () => {
        for (const length of [0, 1, 2, 3, 0x7fff, 0x8000, 0x8001, 0x10000, 100000]) {
            const data = bytes(length, length + 1);
            expect(C.bytesToBase64(data)).toBe(Buffer.from(data).toString('base64'));
        }
    });

    it('should decode Base64 that is broken into lines or padded with spaces', () => {
        const data = bytes(100, 3);
        const wrapped = Buffer.from(data).toString('base64').replace(/(.{20})/g, '$1\r\n');
        expect(C.base64ToBytes(`  ${wrapped}  `)).toEqual(data);
    });

    it('should refuse Base64 that is none', () => {
        expect(() => C.base64ToBytes('not base64 !!')).toThrow();
    });

    it('should handle the empty array in every codec', () => {
        expect(C.bytesToHex(new Uint8Array(0))).toBe('');
        expect(C.hexToBytes('')).toEqual(new Uint8Array(0));
        expect(C.bytesToBase64(new Uint8Array(0))).toBe('');
        expect(C.base64ToBytes('')).toEqual(new Uint8Array(0));
        expect(C.bytesToUtf8(C.utf8ToBytes(''))).toBe('');
    });

    it('should refuse hex that is no text', () => {
        expect(() => C.hexToBytes(undefined)).toThrow('Invalid hex string!');
        expect(() => C.hexToBytes(12)).toThrow('Invalid hex string!');
        expect(() => C.hexToBytes('0g')).toThrow('Invalid hex string!');
    });

    it('should keep characters outside of the first plane through UTF-8', () => {
        const text = 'a🌸b漫c\u0000d';
        expect(C.bytesToUtf8(C.utf8ToBytes(text))).toBe(text);
        expect(C.utf8ToBytes('🌸')).toHaveLength(4);
    });
});
