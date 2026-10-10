// comix.to image protection: XOR encryption of the first bytes and tile scrambling.
// The reference generators below follow HaruNeko's Comix.ts independently of the connector code.
let Comix = null;

beforeAll(async () => {
    Comix = await import('../mjs/connectors/ComixTo.mjs');
});

function webp(size) {
    const bytes = new Uint8Array(size);
    bytes.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
    for (let index = 12; index < size; index++) {
        bytes[index] = index * 7 & 0xFF;
    }
    return bytes;
}

function xorShiftKeystream(key, count, highByte) {
    let state = key | 0;
    return Array.from({ length: count }, () => {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        return highByte ? state >>> 24 : state & 0xFF;
    });
}

function lcgKeystream(key, count) {
    return Array.from({ length: count }, () => {
        key = key * 1000005 + 1234567891 >> 0;
        return key >>> 24;
    });
}

function encrypt(plain, keystream, limit) {
    const bytes = plain.slice();
    for (let index = 0; index < Math.min(limit, bytes.length); index++) {
        bytes[index] ^= keystream[index];
    }
    return bytes;
}

// Seeded Fisher-Yates, returned inversed (HaruNeko Comix.ts / Keiyoushi Descrambler.kt).
// The LCG uses exact unsigned 32-bit arithmetic (BigInt), as the Kotlin extension does; HaruNeko
// keeps the LCG state as an untruncated double, which only matches for the first step.
function referenceSequence(init, salt, algorithm, count) {
    const inits = { '03632': 58414, '02900': 117532 };
    let seed = (inits[init] ?? 0) ^ salt;
    if (algorithm === '3') {
        seed |= 1;
    }
    let state = seed;
    let big = BigInt(seed >>> 0);
    const next = algorithm === '3'
        ? () => {
            state ^= state << 13;
            state ^= state >>> 17;
            state ^= state << 5;
            return state >>> 0;
        }
        : () => {
            big = (big * 1664525n + 1013904223n) & 0xFFFFFFFFn;
            return Number(big);
        };
    const indices = [...new Array(Math.max(1, count)).keys()];
    for (let current = indices.length - 1; current > 0; current--) {
        const random = next() % (current + 1);
        [indices[current], indices[random]] = [indices[random], indices[current]];
    }
    const inverse = new Array(count);
    for (let index = 0; index < indices.length; index++) {
        inverse[indices[index]] = index;
    }
    return inverse;
}

describe('comix.to image decryption', () => {
    const plain = webp(256);

    it('should decrypt XorShift32 (high byte) with the odd seed', () => {
        const key = 123456790;
        const encrypted = encrypt(plain, xorShiftKeystream(key | 1, 256, true), 100);
        expect(Array.from(Comix.decryptImage(encrypted, key, 100))).toEqual(Array.from(plain));
    });

    it('should decrypt XorShift32 (low byte)', () => {
        const key = 987654321;
        const encrypted = encrypt(plain, xorShiftKeystream(key, 256, false), 64);
        expect(Array.from(Comix.decryptImage(encrypted, key, 64))).toEqual(Array.from(plain));
    });

    it('should decrypt the LCG variant', () => {
        const key = 424242;
        const encrypted = encrypt(plain, lcgKeystream(key, 256), 128);
        expect(Array.from(Comix.decryptImage(encrypted, key, 128))).toEqual(Array.from(plain));
    });

    it('should only touch the announced number of bytes', () => {
        const key = 31337;
        const encrypted = encrypt(plain, xorShiftKeystream(key | 1, 256, true), 32);
        const decrypted = Comix.decryptImage(encrypted, key, 32);
        expect(Array.from(decrypted.slice(32))).toEqual(Array.from(plain.slice(32)));
    });

    it('should refuse data that does not decrypt to an image', () => {
        expect(Comix.decryptImage(new Uint8Array(64).fill(7), 1234, 64)).toBeUndefined();
    });
});

describe('comix.to tile scrambling', () => {
    it.each([
        ['03632', 1234, '3'],
        ['02900', 99, '3'],
        ['', 777, '3'],
        ['03632', 1234, '1'],
        ['02900', 5, '2'],
        ['unknown', 424242, '']
    ])('should match the reference order for hash "%s", seed %i, algorithm "%s"', (hash, seed, algorithm) => {
        expect(Comix.scrambleOrder(25, hash, seed, algorithm)).toEqual(referenceSequence(hash, seed, algorithm, 25));
    });

    it('should return a permutation for any grid size', () => {
        for (const count of [1, 4, 9, 25, 36]) {
            const order = Comix.scrambleOrder(count, '03632', 4711, '3');
            expect([...order].sort((a, b) => a - b)).toEqual([...new Array(count).keys()]);
        }
    });
});
