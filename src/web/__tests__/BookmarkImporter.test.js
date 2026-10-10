// FMD bookmark import: the SQLite file is handed to the main process as bytes
// (node:sqlite), the rows map to HakuNeko bookmark keys.
let BookmarkImporter = null;

beforeAll(async () => {
    BookmarkImporter = (await import('../mjs/engine/BookmarkImporter.mjs')).default;
});

afterEach(() => {
    delete globalThis.window;
});

function favorites(rows) {
    const query = vi.fn(async () => rows);
    globalThis.window = { hakuneko: { sqlite: { query } } };
    return query;
}

describe('BookmarkImporter', () => {
    it('should query the favorites through the main process and map the rows', async () => {
        const query = favorites([
            { link: 'artemisnf/manga/one-piece', manga: 'https://artemisnofansub.com/manga/one-piece', connectorTitle: 'ArtemisNF', mangaTitle: 'One Piece' },
            { link: 'example.org/manga/x', manga: 'https://example.org/manga/x?lang=en', connectorTitle: 'Example', mangaTitle: 'X' }
        ]);
        const file = new File([ new Uint8Array([ 0x53, 0x51, 0x4c, 0x69 ]) ], 'favorites.db', { type: 'application/x-sqlite3' });
        const bookmarks = await new BookmarkImporter().importBookmarks(file);
        expect(query).toHaveBeenCalledTimes(1);
        expect(query.mock.calls[0][0]).toBeInstanceOf(Uint8Array);
        expect(query.mock.calls[0][1]).toContain('FROM `favorites`');
        expect(bookmarks).toEqual([
            // FMD website ids are mapped to connector ids, manga ids keep the path only
            { key: { connector: 'artemisnofansub', manga: '/manga/one-piece' }, title: { connector: 'ArtemisNF', manga: 'One Piece' } },
            { key: { connector: 'example.org', manga: '/manga/x' }, title: { connector: 'Example', manga: 'X' } }
        ]);
    });

    it('should accept the .db extension without a mime type', async () => {
        favorites([]);
        const file = new File([ new Uint8Array(16) ], 'favorites.db');
        await expect(new BookmarkImporter().importBookmarks(file)).resolves.toEqual([]);
    });

    it('should reject unsupported and empty files', async () => {
        const query = favorites([]);
        await expect(new BookmarkImporter().importBookmarks(new File([ 'text' ], 'notes.txt', { type: 'text/plain' }))).rejects.toThrow(/not supported/);
        await expect(new BookmarkImporter().importBookmarks(new File([], 'favorites.db'))).rejects.toThrow(/Invalid file size/);
        expect(query).not.toHaveBeenCalled();
    });
});
