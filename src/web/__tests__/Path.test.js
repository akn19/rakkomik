// The renderer's path implementation must behave exactly like Node's `path.posix` /
// `path.win32` for the shapes of paths the engine produces (and a few nasty ones).
const nodePath = require('node:path');

let Path = null;

beforeAll(async () => {
    Path = await import('../mjs/engine/Path.mjs');
});

const COMMON = [
    '', '.', '..', '/', '//', '///', 'a', 'a/', 'a//b', '/a', '/a/', '/a/b/c', '/a/b/../c', 'a/../..', '../a', './a/./b/',
    '/a/b/c.txt', 'a.b.c', '.bashrc', '..a', 'a.', 'a..', '...', '.a.', '/a/b/.', 'a/b/..', '/..', '/../a', 'file.tar.gz',
    '/home/user/dir/file.txt', '/home/user/Mangas/One Piece/Chapter 1 - Romance Dawn/001.png', 'C:\\windows\\style', '/tmp/hakuneko/'
];

const WINDOWS = [
    'C:', 'C:\\', 'C:/', 'C:a', 'C:a\\b', 'C:\\a\\b', 'C:\\a\\..\\b', 'c:/a/b', 'C:\\a\\', 'C:\\Users\\me\\Mangas\\Title\\Ch 1\\001.png',
    '\\', '\\a', '\\\\', '\\\\server', '\\\\server\\', '\\\\server\\share', '\\\\server\\share\\', '\\\\server\\share\\dir\\file.txt',
    '\\\\\\a', '//server/share/x', 'a\\b\\c.txt', 'a/b\\c', 'D:\\..\\..\\x', 'C:\\a\\b\\..\\..\\..\\c', '\\\\?\\C:\\x'
];

const JOINS = [
    [], [ '' ], [ '', '' ], [ 'a', 'b' ], [ 'a/', 'b' ], [ '/a', 'b/' ], [ '', 'a' ], [ 'a', '', 'b' ], [ '..', 'a' ], [ '/', '..' ],
    [ 'a', '..', '..', 'b' ], [ '/tmp', 'hakuneko', 'page 1.png' ], [ '/cfg', 'hakuneko.' ], [ 'a/', '/b' ], [ '.', 'a' ], [ 'a', '.' ],
    [ 'C:', 'a' ], [ 'C:\\', 'a' ], [ 'C:\\a', '..', 'b' ], [ '\\\\server', 'share' ], [ '//server', 'share' ], [ '\\\\server\\share', 'dir' ],
    [ '\\\\server\\share\\', 'dir', 'file.txt' ], [ '\\', 'a' ], [ '//', 'a' ], [ '///', 'a' ], [ 'a\\', '\\b' ], [ 'C:\\Users\\me', 'Mangas', 'Title' ]
];

const SUFFIXES = [ undefined, '', '.txt', '.png', 'file.txt', '.gz', 'a', '/' ];

describe.each([
    [ 'posix', 'linux', nodePath.posix, COMMON ],
    [ 'win32', 'win32', nodePath.win32, [ ...COMMON, ...WINDOWS ] ]
])('%s', (name, platform, reference, corpus) => {
    let path = null;

    beforeAll(() => {
        path = Path.createPath(platform);
    });

    it('should expose the separator', () => {
        expect(path.sep).toBe(reference.sep);
    });

    it.each(corpus.map(entry => [ entry ]))('should normalize, split and parse %j like Node', entry => {
        expect(path.normalize(entry), 'normalize').toBe(reference.normalize(entry));
        expect(path.dirname(entry), 'dirname').toBe(reference.dirname(entry));
        expect(path.extname(entry), 'extname').toBe(reference.extname(entry));
        expect(path.parse(entry), 'parse').toEqual(reference.parse(entry));
        for (const suffix of SUFFIXES) {
            expect(path.basename(entry, suffix), `basename(${JSON.stringify(suffix)})`).toBe(reference.basename(entry, suffix));
        }
    });

    it.each(JOINS.map(parts => [ parts ]))('should join %j like Node', parts => {
        expect(path.join(...parts)).toBe(reference.join(...parts));
    });

    it('should reject arguments that are not strings', () => {
        expect(() => path.join('a', undefined)).toThrow(TypeError);
        expect(() => path.dirname(null)).toThrow(TypeError);
        expect(() => path.basename('a', 1)).toThrow(TypeError);
    });
});

describe('createPath', () => {
    it('should pick the flavour from the platform', () => {
        expect(Path.createPath('win32')).toBe(Path.win32);
        expect(Path.createPath('linux')).toBe(Path.posix);
        expect(Path.createPath('darwin')).toBe(Path.posix);
    });
});
