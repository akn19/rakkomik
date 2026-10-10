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
    return fs.readdirSync(os.tmpdir()).filter(entry => entry.startsWith('hakuneko-sqlite-'));
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
        expect(channel).toBe('hakuneko:sqlite:query');
        const rows = await handler({}, favoritesDatabase(), 'SELECT COUNT(*) AS count FROM favorites');
        expect(rows).toEqual([ { count: 2 } ]);
    });
});
