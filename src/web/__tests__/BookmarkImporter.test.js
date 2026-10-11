// FMD bookmark import: the SQLite file is handed to the main process as bytes
// (node:sqlite), the rows map to the bookmark keys of the engine.
let BookmarkImporter = null;

beforeAll(async () => {
    BookmarkImporter = (await import('../mjs/engine/BookmarkImporter.mjs')).default;
});

afterEach(() => {
    delete globalThis.window;
    vi.restoreAllMocks();
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

function database(name = 'favorites.db', type = '') {
    return new File([ new Uint8Array([ 0x53, 0x51, 0x4c, 0x69, 0x74, 0x65 ]) ], name, { type });
}

function importFavorites(rows) {
    favorites(rows);
    return new BookmarkImporter().importBookmarks(database());
}

describe('BookmarkImporter files', () => {
    it('should hand the bytes of the file over to the main process', async () => {
        const query = favorites([]);
        await new BookmarkImporter().importBookmarks(database());
        expect(Array.from(query.mock.calls[0][0])).toEqual([ 0x53, 0x51, 0x4c, 0x69, 0x74, 0x65 ]);
    });

    it('should accept the mime type of SQLite for a file with any name', async () => {
        const query = favorites([]);
        await expect(new BookmarkImporter().importBookmarks(database('favorites', 'application/x-sqlite3'))).resolves.toEqual([]);
        expect(query).toHaveBeenCalledTimes(1);
    });

    it('should need at least two bytes', async () => {
        const query = favorites([]);
        await expect(new BookmarkImporter().importBookmarks(new File([ new Uint8Array(1) ], 'favorites.db'))).rejects.toThrow('Invalid file size: 1');
        await expect(new BookmarkImporter().importBookmarks(new File([ new Uint8Array(2) ], 'favorites.db'))).resolves.toEqual([]);
        expect(query).toHaveBeenCalledTimes(1);
    });

    it.each([
        [ 'a text file', 'notes.txt', 'text/plain', "File type 'text/plain' is not supported!" ],
        [ 'a file without a type', 'favorites.sqlite', '', "File type '' is not supported!" ],
        [ 'a name that only contains the extension', 'favorites.db.bak', '', "File type '' is not supported!" ]
    ])('should refuse %s', async (name, fileName, type, message) => {
        const query = favorites([]);
        await expect(new BookmarkImporter().importBookmarks(database(fileName, type))).rejects.toThrow(message);
        expect(query).not.toHaveBeenCalled();
    });

    it('should pass on the failure of the main process to read the database', async () => {
        const query = favorites([]);
        query.mockRejectedValue(new Error('file is not a database'));
        await expect(new BookmarkImporter().importBookmarks(database())).rejects.toThrow('file is not a database');
    });

    // the file systems of Windows and macOS do not tell the cases apart, and the system gives the file no mime type
    it.each(['FAVORITES.DB', 'Favorites.Db', 'favorites.dB'])('should accept the extension whatever its case: %s', async (name) => {
        const query = favorites([]);
        await expect(new BookmarkImporter().importBookmarks(database(name))).resolves.toEqual([]);
        expect(query).toHaveBeenCalledTimes(1);
    });
});

describe('BookmarkImporter rows', () => {
    it('should keep the order of the rows and leave their titles alone', async () => {
        const bookmarks = await importFavorites([
            { link: 'example.org', manga: '/m/2', connectorTitle: 'Example <b>', mangaTitle: '進撃の巨人 & "friends"' },
            { link: 'example.org', manga: '/m/1', connectorTitle: 'Example <b>', mangaTitle: 'Alpha' },
            { link: 'example.org', manga: '/m/3', connectorTitle: '', mangaTitle: '' }
        ]);
        expect(bookmarks.map(bookmark => bookmark.key.manga)).toEqual([ '/m/2', '/m/1', '/m/3' ]);
        expect(bookmarks[0].title).toEqual({ connector: 'Example <b>', manga: '進撃の巨人 & "friends"' });
        expect(bookmarks[2].title).toEqual({ connector: '', manga: '' });
    });

    it('should import the same manga of two websites as two bookmarks', async () => {
        const bookmarks = await importFavorites([
            { link: 'site-a.org', manga: '/manga/x', connectorTitle: 'A', mangaTitle: 'X' },
            { link: 'site-b.org', manga: '/manga/x', connectorTitle: 'B', mangaTitle: 'X' }
        ]);
        expect(bookmarks.map(bookmark => bookmark.key)).toEqual([
            { connector: 'site-a.org', manga: '/manga/x' },
            { connector: 'site-b.org', manga: '/manga/x' }
        ]);
    });

    it.each([
        [ 'e-hentai', 'ehentai' ],
        [ 'mangaeden_it', 'mangaeden-it' ],
        [ 'webtoons', 'linewebtoon-en' ],
        [ 'readmangaru', 'readmanga' ],
        [ 'goodmanga', 'mangareader' ],
        [ 'mangabb', 'mangareader' ],
        [ 'mangapark', 'mangapark-en' ],
        [ 'mangaparkorg', 'mangapark' ],
        [ 'yuri-ism', 'yuriism' ]
    ])('should name the FMD website %s the connector %s', async (fmd, connector) => {
        const [ bookmark ] = await importFavorites([ { link: fmd, manga: '/m/1', connectorTitle: 'T', mangaTitle: 'M' } ]);
        expect(bookmark.key.connector).toBe(connector);
    });

    it.each([
        [ 'mangaeden_ithttps://www.mangaeden.com/it/it-manga/x/', 'mangaeden-it' ],
        [ 'mangaeden_ithttp://www.mangaeden.com/it/it-manga/x/', 'mangaeden-it' ],
        [ 'e-hentaihttps://e-hentai.org/g/1/2/', 'ehentai' ],
        [ 'example.orghttps://example.org/', 'example.org' ]
    ])('should drop the address that a bug of FMD appends to the website: %s', async (link, connector) => {
        const [ bookmark ] = await importFavorites([ { link, manga: '/m/1', connectorTitle: 'T', mangaTitle: 'M' } ]);
        expect(bookmark.key.connector).toBe(connector);
    });

    it.each([
        [ 'mangadex', '/title/1234/the-slug', '1234' ],
        [ 'mangadex', '/manga/1234', '1234' ],
        [ 'mangadex', 'https://mangadex.org/title/1234/', '1234' ],
        [ 'mangatube', '/series/some-series/the-manga', 'the-manga' ],
        [ 'mangarock', '/manga/mrs-serie-100', 'mrs-serie-100' ],
        [ 'other-site', '/series/some-series/the-manga', '/series/some-series/the-manga' ]
    ])('should convert the manga id of %s: %s becomes %s', async (link, manga, id) => {
        const [ bookmark ] = await importFavorites([ { link, manga, connectorTitle: 'T', mangaTitle: 'M' } ]);
        expect(bookmark.key.manga).toBe(id);
    });

    // MangaDex has used a UUID as the id of a manga since 2021, the connector uses the UUID alone
    it.each([
        [ 'mangadex', '/title/5b0ab2e5-1c26-4a68-a5ee-6c0e2f3a2f0e', '5b0ab2e5-1c26-4a68-a5ee-6c0e2f3a2f0e' ],
        [ 'mangadex', '/title/5b0ab2e5-1c26-4a68-a5ee-6c0e2f3a2f0e/the-slug', '5b0ab2e5-1c26-4a68-a5ee-6c0e2f3a2f0e' ],
        [ 'mangadex', 'https://mangadex.org/title/5b0ab2e5-1c26-4a68-a5ee-6c0e2f3a2f0e/', '5b0ab2e5-1c26-4a68-a5ee-6c0e2f3a2f0e' ],
        [ 'mangadex', '/manga/5b0ab2e5-1c26-4a68-a5ee-6c0e2f3a2f0e', '5b0ab2e5-1c26-4a68-a5ee-6c0e2f3a2f0e' ]
    ])('should convert the UUID of a manga of %s: %s becomes %s', async (link, manga, id) => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const [ bookmark ] = await importFavorites([ { link, manga, connectorTitle: 'MangaDex', mangaTitle: 'M' } ]);
        expect(bookmark.key).toEqual({ connector: 'mangadex', manga: id });
        expect(warn).not.toHaveBeenCalled();
    });
});

describe('BookmarkImporter favorites that cannot be converted', () => {
    const good = [
        { link: 'example.org', manga: '/manga/a', connectorTitle: 'Example', mangaTitle: 'A' },
        { link: 'example.org', manga: '/manga/b', connectorTitle: 'Example', mangaTitle: 'B' }
    ];

    // one favorite must not cost the user all the others, whatever is wrong with it
    it.each([
        [ 'an id that MangaDex does not have', { link: 'mangadex', manga: '/title/not-an-id' } ],
        [ 'a UUID that is cut short', { link: 'mangadex', manga: '/title/5b0ab2e5-1c26-4a68-a5ee' } ],
        [ 'a UUID with something behind it', { link: 'mangadex', manga: '/title/5b0ab2e5-1c26-4a68-a5ee-6c0e2f3a2f0eXX' } ],
        [ 'no id at all', { link: 'mangadex', manga: '/title/' } ],
        [ 'an address that is none', { link: 'example.org', manga: 'http://' } ],
        [ 'no website', { link: undefined, manga: '/manga/x' } ],
        [ 'nothing but a null row', null ]
    ])('should skip a favorite with %s, warn about it and import the others', async (name, broken) => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const row = broken && { connectorTitle: 'MangaDex', mangaTitle: 'Broken', ...broken };
        const bookmarks = await importFavorites([ good[0], row, good[1] ]);
        expect(bookmarks.map(bookmark => bookmark.title.manga)).toEqual([ 'A', 'B' ]);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0]).toContain('cannot be converted');
        expect(warn.mock.calls[0][1]).toBe(row);
    });

    it('should import nothing, and still not fail, when no favorite can be converted', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const rows = [ '/title/one', '/title/two', '/title/three' ].map(manga => ({ link: 'mangadex', manga, connectorTitle: 'MangaDex', mangaTitle: manga }));
        await expect(importFavorites(rows)).resolves.toEqual([]);
        expect(warn).toHaveBeenCalledTimes(3);
    });

    it('should not warn about favorites that can be converted', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        await expect(importFavorites(good)).resolves.toHaveLength(2);
        expect(warn).not.toHaveBeenCalled();
    });
});
