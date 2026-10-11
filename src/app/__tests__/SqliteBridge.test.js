// Bookmark import backend: SQL over database bytes with Node's built-in SQLite,
// temp files cleaned up, exposed to the renderer on one IPC channel.
const { mockModule } = require('./support/mockRequire');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const electron = mockModule('electron', () => ({
    ipcMain: {
        handle: vi.fn(),
        on: vi.fn()
    }
}));
const SqliteBridge = require('../SqliteBridge');

const QUERY = 'SELECT `websitelink` AS `link`, `title` AS `mangaTitle` FROM `favorites` ORDER BY `title`';

function favoritesDatabase() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rakkomik-fmd-'));
    const file = path.join(directory, 'favorites.db');
    const database = new DatabaseSync(file);
    database.exec('CREATE TABLE favorites (websitelink TEXT, link TEXT, website TEXT, title TEXT)');
    const insert = database.prepare('INSERT INTO favorites VALUES (?, ?, ?, ?)');
    insert.run('mangadex.org/title/1', 'https://mangadex.org/title/1', 'MangaDex', 'Beta');
    insert.run('artemisnf/manga/one-piece', 'https://artemisnofansub.com/manga/one-piece', 'ArtemisNF', 'Alpha');
    database.close();
    const bytes = new Uint8Array(fs.readFileSync(file));
    fs.rmSync(directory, { recursive: true, force: true });
    return bytes;
}

function leftoverTempDirectories() {
    return fs.readdirSync(os.tmpdir()).filter(entry => entry.startsWith('rakkomik-sqlite-'));
}

describe('SqliteBridge', () => {
    it('should run a query over database bytes and return rows keyed by column name', async () => {
        const rows = await SqliteBridge.query(favoritesDatabase(), QUERY);
        expect(rows).toEqual([
            { link: 'artemisnf/manga/one-piece', mangaTitle: 'Alpha' },
            { link: 'mangadex.org/title/1', mangaTitle: 'Beta' }
        ]);
    });

    it('should reject bytes that are not a database and leave no temp directory behind', async () => {
        const before = leftoverTempDirectories();
        await expect(SqliteBridge.query(new Uint8Array([ 1, 2, 3, 4 ]), QUERY)).rejects.toThrow();
        expect(leftoverTempDirectories()).toEqual(before);
    });

    it('should answer the renderer over IPC', async () => {
        new SqliteBridge({ warn: vi.fn() }).register();
        const [ channel, handler ] = electron.ipcMain.handle.mock.calls[0];
        expect(channel).toBe('rakkomik:sqlite:query');
        const rows = await handler({}, favoritesDatabase(), 'SELECT COUNT(*) AS count FROM favorites');
        expect(rows).toEqual([ { count: 2 } ]);
    });
    describe('query()', () => {
        // the bytes of a database that was built with the statements
        function databaseOf(statements, rows = []) {
            const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rakkomik-fmd-'));
            const file = path.join(directory, 'built.db');
            const database = new DatabaseSync(file);
            for (const statement of statements) {
                database.exec(statement);
            }
            for (const [sql, ...values] of rows) {
                database.prepare(sql).run(...values);
            }
            database.close();
            const bytes = new Uint8Array(fs.readFileSync(file));
            fs.rmSync(directory, { recursive: true, force: true });
            return bytes;
        }

        it('should answer the types of SQLite as the renderer can use them', async () => {
            const bytes = databaseOf(
                ['CREATE TABLE t (i INTEGER, r REAL, s TEXT, b BLOB, n)'],
                [['INSERT INTO t VALUES (?, ?, ?, ?, ?)', 42, 1.5, 'caf\u00e9 \u6f2b\u753b \ud83d\ude42', new Uint8Array([0, 1, 255]), null]]
            );
            const [row] = await SqliteBridge.query(bytes, 'SELECT * FROM t');
            expect(row.i).toBe(42);
            expect(row.r).toBe(1.5);
            expect(row.s).toBe('caf\u00e9 \u6f2b\u753b \ud83d\ude42');
            expect([...row.b]).toEqual([0, 1, 255]);
            expect(row.n).toBeNull();
        });

        it('should answer no rows as an empty array', async () => {
            const bytes = databaseOf(['CREATE TABLE t (i INTEGER)']);
            await expect(SqliteBridge.query(bytes, 'SELECT * FROM t')).resolves.toEqual([]);
        });

        it('should open an empty database, which is what an empty file is', async () => {
            await expect(SqliteBridge.query(new Uint8Array(0), 'SELECT 1 AS one')).resolves.toEqual([{ one: 1 }]);
            await expect(SqliteBridge.query(new Uint8Array(0), 'SELECT * FROM favorites')).rejects.toThrow(/no such table/);
        });

        it('should answer many rows', async () => {
            const bytes = databaseOf(['CREATE TABLE t (i INTEGER)', 'WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 20000) INSERT INTO t SELECT i FROM n']);
            const rows = await SqliteBridge.query(bytes, 'SELECT i FROM t ORDER BY i DESC');
            expect(rows).toHaveLength(20000);
            expect(rows[0]).toEqual({ i: 20000 });
            expect(rows[19999]).toEqual({ i: 1 });
        });

        it('should take the bytes of a Buffer as well', async () => {
            const bytes = Buffer.from(databaseOf(['CREATE TABLE t (i INTEGER)', 'INSERT INTO t VALUES (7)']));
            await expect(SqliteBridge.query(bytes, 'SELECT i FROM t')).resolves.toEqual([{ i: 7 }]);
        });

        it.each([
            ['an insert', "INSERT INTO t VALUES (2, 'x')"],
            ['an update', "UPDATE t SET s = 'changed'"],
            ['a delete', 'DELETE FROM t'],
            ['a drop', 'DROP TABLE t'],
            ['a create', 'CREATE TABLE other (x)'],
            ['a pragma that writes', 'PRAGMA user_version = 5']
        ])('should refuse %s: the database it is given is read-only', async (_, sql) => {
            const before = leftoverTempDirectories();
            const bytes = databaseOf(['CREATE TABLE t (i INTEGER, s TEXT)', "INSERT INTO t VALUES (1, 'a')"]);
            await expect(SqliteBridge.query(bytes, sql)).rejects.toThrow(/readonly/);
            expect(leftoverTempDirectories()).toEqual(before);
        });

        it('should not give an attached database a place to be created', async () => {
            const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rakkomik-fmd-'));
            try {
                const target = path.join(directory, 'attached.db');
                await expect(SqliteBridge.query(new Uint8Array(0), `ATTACH DATABASE '${target.replaceAll("'", "''")}' AS other`)).rejects.toThrow();
                expect(fs.existsSync(target)).toBe(false);
            } finally {
                fs.rmSync(directory, { recursive: true, force: true });
            }
        });

        // NOTE: only the first statement is compiled, the rest of the text is dropped without an error, so a second
        // statement is not run (and not reported either). The documentation asks for a single statement.
        it('should run the first statement of several and leave out the rest', async () => {
            const bytes = databaseOf(['CREATE TABLE t (i INTEGER)', 'INSERT INTO t VALUES (1)']);
            await expect(SqliteBridge.query(bytes, 'SELECT i FROM t; DROP TABLE t')).resolves.toEqual([{ i: 1 }]);
        });

        it.each([
            ['a syntax error', 'selct 1', /syntax error/],
            ['an unknown table', 'SELECT * FROM nowhere', /no such table/],
            ['an unknown column', 'SELECT missing_column FROM t', /no such column/],
            ['an empty statement', '', /./],
            ['only a comment', '-- nothing to run', /./]
        ])('should reject %s and leave no temp directory behind', async (_, sql, message) => {
            const before = leftoverTempDirectories();
            const bytes = databaseOf(['CREATE TABLE t (i INTEGER)']);
            await expect(SqliteBridge.query(bytes, sql)).rejects.toThrow(message);
            expect(leftoverTempDirectories()).toEqual(before);
        });

        it.each([
            ['no bytes', undefined],
            ['a text', 'SELECT 1'],
            ['a number', 12]
        ])('should reject %s and leave no temp directory behind', async (_, bytes) => {
            const before = leftoverTempDirectories();
            await expect(SqliteBridge.query(bytes, 'SELECT 1')).rejects.toThrow();
            expect(leftoverTempDirectories()).toEqual(before);
        });

        it.each([
            ['answers', 'SELECT i FROM t'],
            ['fails', 'SELECT nothing_here FROM t']
        ])('should close the database when the query %s, as a file that is open cannot be removed on Windows', async (_, sql) => {
            const bytes = databaseOf(['CREATE TABLE t (i INTEGER)', 'INSERT INTO t VALUES (1)']);
            const close = vi.spyOn(DatabaseSync.prototype, 'close');
            try {
                await SqliteBridge.query(bytes, sql).catch(() => undefined);
                expect(close).toHaveBeenCalledTimes(1);
            } finally {
                close.mockRestore();
            }
        });

        it('should keep concurrent queries apart', async () => {
            const databases = [1, 2, 3, 4, 5].map(value => databaseOf(['CREATE TABLE t (i INTEGER)', `INSERT INTO t VALUES (${value})`]));
            const answers = await Promise.all(databases.map(bytes => SqliteBridge.query(bytes, 'SELECT i FROM t')));
            expect(answers).toEqual([[{ i: 1 }], [{ i: 2 }], [{ i: 3 }], [{ i: 4 }], [{ i: 5 }]]);
        });

        it('should give back the rows even when the temp directory cannot be removed afterwards', async () => {
            const before = leftoverTempDirectories();
            const bytes = databaseOf(['CREATE TABLE t (i INTEGER)', 'INSERT INTO t VALUES (1)']);
            vi.spyOn(fs.promises, 'rm').mockRejectedValueOnce(Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' }));
            try {
                await expect(SqliteBridge.query(bytes, 'SELECT i FROM t')).resolves.toEqual([{ i: 1 }]);
            } finally {
                vi.restoreAllMocks();
                // the removal that failed in the test is made here
                for (const name of leftoverTempDirectories().filter(entry => !before.includes(entry))) {
                    fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true });
                }
            }
        });

        it('should not keep what a query saw: the next one starts from its own bytes', async () => {
            const first = databaseOf(['CREATE TABLE t (i INTEGER)', 'INSERT INTO t VALUES (1)']);
            const second = databaseOf(['CREATE TABLE other (i INTEGER)']);
            await SqliteBridge.query(first, 'SELECT i FROM t');
            await expect(SqliteBridge.query(second, 'SELECT i FROM t')).rejects.toThrow(/no such table/);
        });
    });

    describe('register()', () => {
        it('should answer one channel, with the arguments the renderer gives, and fail with the error of the query', async () => {
            electron.ipcMain.handle.mockClear();
            new SqliteBridge({ warn: vi.fn() }).register();
            expect(electron.ipcMain.handle).toHaveBeenCalledTimes(1);
            const [channel, handler] = electron.ipcMain.handle.mock.calls[0];
            expect(channel).toBe('rakkomik:sqlite:query');
            await expect(handler({}, new Uint8Array(0), 'selct 1')).rejects.toThrow(/syntax error/);
        });
    });
});