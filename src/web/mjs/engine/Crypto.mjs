/**
 * Native crypto helpers replacing `crypto-js` (Fase 2).
 *
 * Rules:
 * - Hashing is intentionally SYNCHRONOUS (compact pure-JS SHA-256) so hot call
 *   sites stay sync: proof-of-work loops (Bacami), per-image descramble
 *   (PixivComics). `crypto.subtle` would turn these into thousands of
 *   microtask hops.
 * - Bulk AES-CBC uses WebCrypto `subtle` (async) at the clean call sites.
 * - Password obfuscation in `Settings` keeps the historic CryptoJS/OpenSSL
 *   envelope (`Salted__` + MD5-based EVP_BytesToKey) so stored settings stay
 *   readable — no silent credential orphaning.
 */
const te = new TextEncoder();
const td = new TextDecoder();

export function utf8ToBytes(text) {
    return te.encode(text);
}

export function bytesToUtf8(bytes) {
    return td.decode(bytes);
}

export function bytesToHex(bytes) {
    return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function hexToBytes(hex) {
    if (typeof hex !== 'string' || hex.length % 2 !== 0 || /[^0-9a-fA-F]/.test(hex)) {
        throw new Error('Invalid hex string!');
    }
    let bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
}

export function bytesToBase64(bytes) {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
}

export function base64ToBytes(base64) {
    let cleaned = String(base64).replace(/\s+/g, '');
    let binary = atob(cleaned);
    let bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

// ---------------------------------------------------------------------------
// SHA-256 (sync, FIPS 180-4)
// ---------------------------------------------------------------------------
const SHA256_K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];

function sha256BytesSyncInternal(bytes) {
    let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
    let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
    let bitLen = bytes.length * 8;
    let paddedLen = (((bytes.length + 8) >> 6) + 1) << 6;
    let padded = new Uint8Array(paddedLen);
    padded.set(bytes);
    padded[bytes.length] = 0x80;
    let view = new DataView(padded.buffer);
    // NOTE: bit length fits into the low 32 bits for every realistic input here
    view.setUint32(paddedLen - 4, bitLen >>> 0);
    view.setUint32(paddedLen - 8, Math.floor(bitLen / 0x100000000));
    let w = new Int32Array(64);
    for (let chunk = 0; chunk < paddedLen; chunk += 64) {
        for (let i = 0; i < 16; i++) {
            w[i] = view.getInt32(chunk + i * 4);
        }
        for (let i = 16; i < 64; i++) {
            let s0 = (w[i - 15] >>> 7 | w[i - 15] << 25) ^ (w[i - 15] >>> 18 | w[i - 15] << 14) ^ w[i - 15] >>> 3;
            let s1 = (w[i - 2] >>> 17 | w[i - 2] << 15) ^ (w[i - 2] >>> 19 | w[i - 2] << 13) ^ w[i - 2] >>> 10;
            w[i] = w[i - 16] + s0 + w[i - 7] + s1 | 0;
        }
        let [a, b, c, d, e, f, g, h] = [h0, h1, h2, h3, h4, h5, h6, h7];
        for (let i = 0; i < 64; i++) {
            let S1 = (e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7);
            let ch = e & f ^ ~e & g;
            let t1 = h + S1 + ch + SHA256_K[i] + w[i] | 0;
            let S0 = (a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10);
            let maj = a & b ^ a & c ^ b & c;
            let t2 = S0 + maj | 0;
            h = g; g = f; f = e; e = d + t1 | 0; d = c; c = b; b = a; a = t1 + t2 | 0;
        }
        h0 = h0 + a | 0; h1 = h1 + b | 0; h2 = h2 + c | 0; h3 = h3 + d | 0;
        h4 = h4 + e | 0; h5 = h5 + f | 0; h6 = h6 + g | 0; h7 = h7 + h | 0;
    }
    let out = new Uint8Array(32);
    let outView = new DataView(out.buffer);
    [h0, h1, h2, h3, h4, h5, h6, h7].forEach((v, i) => outView.setInt32(i * 4, v));
    return out;
}

export function sha256Bytes(data) {
    return sha256BytesSyncInternal(typeof data === 'string' ? utf8ToBytes(data) : data);
}

export function sha256Hex(data) {
    return bytesToHex(sha256Bytes(data));
}

export async function hmacSha256Hex(data, key) {
    const keyBytes = typeof key === 'string' ? utf8ToBytes(key) : key;
    const cryptoKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const bytes = typeof data === 'string' ? utf8ToBytes(data) : data;
    const signature = await crypto.subtle.sign('HMAC', cryptoKey, bytes);
    return bytesToHex(new Uint8Array(signature));
}

export async function sha512Hex(data) {
    let bytes = typeof data === 'string' ? utf8ToBytes(data) : data;
    let digest = await crypto.subtle.digest('SHA-512', bytes);
    return bytesToHex(new Uint8Array(digest));
}

// ---------------------------------------------------------------------------
// MD5 (sync, RFC 1321) — only for the OpenSSL EVP_BytesToKey KDF below
// ---------------------------------------------------------------------------
function md5BytesSyncInternal(bytes) {
    const s = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
    const K = [];
    for (let i = 0; i < 64; i++) {
        K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0;
    }
    let bitLen = bytes.length * 8;
    let paddedLen = (((bytes.length + 8) >> 6) + 1) << 6;
    let padded = new Uint8Array(paddedLen);
    padded.set(bytes);
    padded[bytes.length] = 0x80;
    let view = new DataView(padded.buffer);
    view.setUint32(paddedLen - 8, bitLen >>> 0, true);
    view.setUint32(paddedLen - 4, Math.floor(bitLen / 0x100000000), true);
    let [a0, b0, c0, d0] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
    for (let chunk = 0; chunk < paddedLen; chunk += 64) {
        let M = [];
        for (let i = 0; i < 16; i++) {
            M[i] = view.getUint32(chunk + i * 4, true);
        }
        let [A, B, C, D] = [a0, b0, c0, d0];
        for (let i = 0; i < 64; i++) {
            let F, g;
            if (i < 16) {
                F = B & C | ~B & D; g = i;
            } else if (i < 32) {
                F = D & B | ~D & C; g = (5 * i + 1) % 16;
            } else if (i < 48) {
                F = B ^ C ^ D; g = (3 * i + 5) % 16;
            } else {
                F = C ^ (B | ~D); g = 7 * i % 16;
            }
            F = (F + A + K[i] + M[g]) >>> 0;
            A = D; D = C; C = B;
            B = (B + ((F << s[i] | F >>> 32 - s[i]) >>> 0)) >>> 0;
        }
        a0 = a0 + A >>> 0; b0 = b0 + B >>> 0; c0 = c0 + C >>> 0; d0 = d0 + D >>> 0;
    }
    let out = new Uint8Array(16);
    let outView = new DataView(out.buffer);
    [a0, b0, c0, d0].forEach((v, i) => outView.setUint32(i * 4, v, true));
    return out;
}

export function md5Bytes(data) {
    return md5BytesSyncInternal(typeof data === 'string' ? utf8ToBytes(data) : data);
}

function evpBytesToKey(passwordBytes, saltBytes, keySize, ivSize) {
    let derived = new Uint8Array(0);
    let block = new Uint8Array(0);
    while (derived.length < keySize + ivSize) {
        let input = new Uint8Array(block.length + passwordBytes.length + saltBytes.length);
        input.set(block);
        input.set(passwordBytes, block.length);
        input.set(saltBytes, block.length + passwordBytes.length);
        block = md5BytesSyncInternal(input);
        let next = new Uint8Array(derived.length + block.length);
        next.set(derived);
        next.set(block, derived.length);
        derived = next;
    }
    return { key: derived.slice(0, keySize), iv: derived.slice(keySize, keySize + ivSize) };
}

// ---------------------------------------------------------------------------
// AES-CBC via WebCrypto (async, clean call sites)
// ---------------------------------------------------------------------------
async function importAesKey(keyBytes) {
    return crypto.subtle.importKey('raw', keyBytes, { name: 'AES-CBC' }, false, ['encrypt', 'decrypt']);
}

export async function aesCbcDecrypt(cipherBytes, keyBytes, ivBytes) {
    if (![16, 24, 32].includes(keyBytes.length)) {
        throw new Error('Invalid AES key length (must be 16/24/32 bytes)!');
    }
    if (ivBytes.length !== 16) {
        throw new Error('Invalid AES-CBC IV length (must be 16 bytes)!');
    }
    let key = await importAesKey(keyBytes);
    let plain = await crypto.subtle.decrypt({ name: 'AES-CBC', iv: ivBytes }, key, cipherBytes);
    return new Uint8Array(plain);
}

export async function aesCbcEncrypt(plainBytes, keyBytes, ivBytes) {
    let key = await importAesKey(keyBytes);
    let cipher = await crypto.subtle.encrypt({ name: 'AES-CBC', iv: ivBytes }, key, plainBytes);
    return new Uint8Array(cipher);
}

// ---------------------------------------------------------------------------
// OpenSSL-compatible envelope (CryptoJS.AES <=> `Salted__` + base64)
// ---------------------------------------------------------------------------
const OPENSSL_MAGIC = 'Salted__';

export async function opensslAesEncrypt(plainText, passphrase) {
    let salt = crypto.getRandomValues(new Uint8Array(8));
    let passwordBytes = utf8ToBytes(passphrase);
    let { key, iv } = evpBytesToKey(passwordBytes, salt, 32, 16);
    let cipherBytes = await aesCbcEncrypt(utf8ToBytes(plainText), key, iv);
    let out = new Uint8Array(16 + cipherBytes.length);
    out.set(utf8ToBytes(OPENSSL_MAGIC));
    out.set(salt, 8);
    out.set(cipherBytes, 16);
    return bytesToBase64(out);
}

export async function opensslAesDecrypt(base64Cipher, passphrase) {
    let raw = base64ToBytes(base64Cipher);
    let salt;
    let cipherBytes;
    if (raw.length >= 16 && bytesToUtf8(raw.slice(0, 8)) === OPENSSL_MAGIC) {
        salt = raw.slice(8, 16);
        cipherBytes = raw.slice(16);
    } else {
        // Historic CryptoJS fallback: un-salted body decrypted with empty-salt KDF
        salt = new Uint8Array(0);
        cipherBytes = raw;
    }
    let passwordBytes = utf8ToBytes(passphrase);
    let { key, iv } = evpBytesToKey(passwordBytes, salt, 32, 16);
    let plainBytes = await aesCbcDecrypt(cipherBytes, key, iv);
    return bytesToUtf8(plainBytes);
}
