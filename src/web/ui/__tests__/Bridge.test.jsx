// The rest of the engine bridge (engine.js), the parts that `UiBridge.test.js` does not reach: bookmarks and
// chaptermarks of a manga, the events of the page and of the main process, and the saving of settings. Here the page is
// real (happy-dom), so the events travel through a real `document` and `window`.
import * as bridge from '../engine.js';
import {
    addChapter,
    addManga,
    createConnector,
    createDownloadJob,
    installBridge,
    installEngine,
} from './support/fakeEngine.js';

let engine = null;
let site = null;
let manga = null;

beforeEach(() => {
    site = createConnector({ id: 'site', label: 'Site' });
    manga = addManga(site, { id: 'm1', title: 'Berserk' });
    engine = installEngine({ connectors: [site] });
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('the engine itself', () => {
    it('should hand out the engine of the page', () => {
        expect(bridge.getEngine()).toBe(engine);
    });

    it('should refuse, with a message that says what to do, when the engine is not there', () => {
        delete window.Engine;
        expect(() => bridge.getEngine()).toThrow(
            'Engine global is not available (loadEngine() must run before mount)!',
        );
    });

    it('should answer with empty values, and not fail, while there is no engine', async () => {
        delete window.Engine;
        expect(bridge.getEngineStatus()).toEqual({ connectors: 0, version: '' });
        expect(bridge.getDownloadJobs()).toEqual([]);
        expect(bridge.hasActiveDownloads()).toBe(false);
        expect(bridge.isMangaBookmarked(manga)).toBe(false);
        expect(bridge.getChaptermark(manga)).toBeNull();
        expect(bridge.isChapterMarked({}, {})).toBe(false);
        await expect(bridge.whenConnectorsReady()).resolves.toBeUndefined();
    });

    it('should report the version as empty, and the connectors as none, when the engine lacks them', () => {
        window.Engine = {};
        expect(bridge.getEngineStatus()).toEqual({ connectors: 0, version: '' });
        // a version that is only half there is no version
        window.Engine = { Connectors: [{}, {}], Version: { branch: { label: 'main' } } };
        expect(bridge.getEngineStatus()).toEqual({ connectors: 2, version: '' });
    });

    it('should not wait forever, or fail, when the connectors cannot be loaded', async () => {
        engine.ConnectorsReady = Promise.reject(new Error('no connectors'));
        await expect(bridge.whenConnectorsReady()).resolves.toBeUndefined();
    });
});

describe('bookmarks of a manga', () => {
    it('should tell a bookmarked manga from one that is not', () => {
        expect(bridge.isMangaBookmarked(manga)).toBe(false);
        engine.BookmarkManager.addBookmark(manga);
        expect(bridge.isMangaBookmarked(manga)).toBe(true);
    });

    it('should not mix up two websites that have a manga with the same id', () => {
        const other = createConnector({ id: 'other', label: 'Other' });
        const twin = addManga(other, { id: 'm1', title: 'Berserk (other)' });
        engine.BookmarkManager.addBookmark(manga);
        expect(bridge.isMangaBookmarked(twin)).toBe(false);
        expect(bridge.isMangaBookmarked(manga)).toBe(true);
    });

    it('should bookmark a manga that is not bookmarked, and remove the bookmark of one that is', () => {
        expect(bridge.toggleBookmark(manga)).toBe(true);
        expect(engine.BookmarkManager.addBookmark).toHaveBeenCalledExactlyOnceWith(manga);
        expect(bridge.isMangaBookmarked(manga)).toBe(true);
        expect(bridge.toggleBookmark(manga)).toBe(true);
        expect(engine.BookmarkManager.deleteBookmark).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({ key: { connector: 'site', manga: 'm1' } }),
        );
        expect(bridge.isMangaBookmarked(manga)).toBe(false);
    });

    it('should remove the bookmark of the right website only', () => {
        const other = createConnector({ id: 'other', label: 'Other' });
        const twin = addManga(other, { id: 'm1', title: 'Berserk (other)' });
        engine.BookmarkManager.addBookmark(twin);
        engine.BookmarkManager.addBookmark(manga);
        bridge.toggleBookmark(manga);
        expect(engine.BookmarkManager.bookmarks.map((bookmark) => bookmark.key.connector)).toEqual([
            'other',
        ]);
    });
});

describe('chaptermarks', () => {
    it('should find the mark of a manga, and nothing for a manga without one', () => {
        const chapter = addChapter(manga, { id: 'c1', title: 'Chapter 1' });
        expect(bridge.getChaptermark(manga)).toBeNull();
        bridge.markChapterRead(chapter);
        expect(bridge.getChaptermark(manga)).toMatchObject({
            chapterID: 'c1',
            chapterTitle: 'Chapter 1',
        });
        expect(bridge.getChaptermark(addManga(site, { id: 'm2', title: 'Akira' }))).toBeNull();
    });

    it('should tell whether a chapter is the marked one', () => {
        const first = addChapter(manga, { id: 'c1', title: 'Chapter 1' });
        const second = addChapter(manga, { id: 'c2', title: 'Chapter 2' });
        bridge.markChapterRead(first);
        const mark = bridge.getChaptermark(manga);
        expect(bridge.isChapterMarked(first, mark)).toBe(true);
        expect(bridge.isChapterMarked(second, mark)).toBe(false);
        expect(bridge.isChapterMarked(first, undefined)).toBe(false);
        expect(bridge.isChapterMarked(first, null)).toBe(false);
    });

    it('should mark an unmarked chapter, move the mark to another chapter, and unmark the marked one', () => {
        const first = addChapter(manga, { id: 'c1', title: 'Chapter 1' });
        const second = addChapter(manga, { id: 'c2', title: 'Chapter 2' });
        bridge.toggleChaptermark(first, bridge.getChaptermark(manga));
        expect(bridge.getChaptermark(manga).chapterID).toBe('c1');
        // another chapter: the mark moves, it is not removed
        bridge.toggleChaptermark(second, bridge.getChaptermark(manga));
        expect(bridge.getChaptermark(manga).chapterID).toBe('c2');
        // the marked chapter: the mark goes
        bridge.toggleChaptermark(second, bridge.getChaptermark(manga));
        expect(bridge.getChaptermark(manga)).toBeNull();
    });

    it('should never fail to record that a chapter was read, because reading must not break on it', () => {
        const chapter = addChapter(manga, { id: 'c1', title: 'Chapter 1' });
        engine.ChaptermarkManager.addChaptermark.mockImplementationOnce(() => {
            throw new Error('cannot save');
        });
        expect(() => bridge.markChapterRead(chapter)).not.toThrow();
        delete window.Engine;
        expect(() => bridge.markChapterRead(chapter)).not.toThrow();
    });

    it('should announce a change of the marks, until it is told to stop', () => {
        const chapter = addChapter(manga, { id: 'c1', title: 'Chapter 1' });
        const notify = vi.fn();
        const unsubscribe = bridge.subscribeChaptermarks(notify);
        bridge.markChapterRead(chapter);
        expect(notify).toHaveBeenCalledTimes(1);
        unsubscribe();
        bridge.deleteChaptermark(bridge.getChaptermark(manga));
        expect(notify).toHaveBeenCalledTimes(1);
    });

    it('should give a subscription that does nothing when there is no engine', () => {
        delete window.Engine;
        const unsubscribe = bridge.subscribeChaptermarks(vi.fn());
        expect(unsubscribe).toBeTypeOf('function');
        expect(() => unsubscribe()).not.toThrow();
    });
});

describe('status of a chapter', () => {
    it('should call the listener when the engine announces a change on the document, until it is told to stop', () => {
        const listener = vi.fn();
        const unsubscribe = bridge.subscribeChapterStatus(listener);
        document.dispatchEvent(new Event('onChapterStatusChanged'));
        expect(listener).toHaveBeenCalledTimes(1);
        // other events are not its business
        document.dispatchEvent(new Event('onSomethingElse'));
        expect(listener).toHaveBeenCalledTimes(1);
        unsubscribe();
        document.dispatchEvent(new Event('onChapterStatusChanged'));
        expect(listener).toHaveBeenCalledTimes(1);
    });
});

describe('the main process', () => {
    it('should pass the request to close the application on, until it is told to stop', () => {
        const main = installBridge();
        const listener = vi.fn();
        const unsubscribe = bridge.subscribeAppClose(listener);
        expect(main.on).toHaveBeenCalledExactlyOnceWith('close', listener);
        main.emit('close');
        expect(listener).toHaveBeenCalledTimes(1);
        unsubscribe();
        expect(main.off).toHaveBeenCalledExactlyOnceWith('close', listener);
        main.emit('close');
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it('should do nothing without a bridge, or with one that cannot listen', () => {
        expect(bridge.subscribeAppClose(vi.fn())()).toBeUndefined();
        window.hakuneko = { send: vi.fn() };
        expect(bridge.subscribeAppClose(vi.fn())()).toBeUndefined();
    });

    it('should not fail to stop listening when the bridge cannot do that', () => {
        window.hakuneko = { on: vi.fn() };
        const unsubscribe = bridge.subscribeAppClose(vi.fn());
        expect(() => unsubscribe()).not.toThrow();
    });

    it('should ask the main process to quit, and do nothing without one', () => {
        const main = installBridge();
        bridge.quitApp();
        expect(main.send).toHaveBeenCalledExactlyOnceWith('quit');
        delete window.hakuneko;
        expect(() => bridge.quitApp()).not.toThrow();
    });

    it('should open a link in a window of its own, without the rights of the application, and ignore an empty one', () => {
        const open = vi.spyOn(window, 'open').mockReturnValue(null);
        bridge.openExternalLink('https://example.test/page');
        expect(open).toHaveBeenCalledExactlyOnceWith(
            'https://example.test/page',
            '_blank',
            'nodeIntegration=no',
        );
        bridge.openExternalLink('');
        bridge.openExternalLink(undefined);
        expect(open).toHaveBeenCalledTimes(1);
    });
});

describe('choosing a file', () => {
    it('should give the first file that the user chose', async () => {
        const main = installBridge();
        main.dialog.showOpenDialog.mockResolvedValueOnce({
            canceled: false,
            filePaths: ['/a/one.db', '/a/two.db'],
        });
        await expect(bridge.browseFile()).resolves.toBe('/a/one.db');
        expect(main.dialog.showOpenDialog).toHaveBeenCalledExactlyOnceWith({
            properties: ['openFile'],
        });
    });

    it.each([
        ['the dialog was cancelled', { canceled: true, filePaths: ['/a/one.db'] }],
        ['nothing was chosen', { canceled: false, filePaths: [] }],
        ['the dialog gave no list', { canceled: false }],
        ['the dialog gave nothing', undefined],
    ])('should give nothing when %s', async (name, result) => {
        installBridge().dialog.showOpenDialog.mockResolvedValueOnce(result);
        await expect(bridge.browseFile()).resolves.toBeNull();
    });

    it('should give nothing without a bridge', async () => {
        await expect(bridge.browseFile()).resolves.toBeNull();
    });
});

describe('saving the settings', () => {
    function draft(...items) {
        return [
            {
                category: 'General',
                items: items.map(([input, value, extra]) => ({
                    ref: { input, value: 'old', ...extra },
                    value,
                })),
            },
        ];
    }

    it.each([
        ['a number that is typed as text', '12', { min: 1, max: 20 }, 12],
        ['a number below the minimum', 0, { min: 1, max: 20 }, 1],
        ['a number above the maximum', 99, { min: 1, max: 20 }, 20],
        ['a number on the minimum', 1, { min: 1, max: 20 }, 1],
        ['a number on the maximum', 20, { min: 1, max: 20 }, 20],
        ['a negative number without limits', '-5', {}, -5],
        ['a number with only a minimum', 0, { min: 3 }, 3],
        ['a number with only a maximum', 50, { max: 3 }, 3],
        ['a minimum of 0, which is a limit like any other', -4, { min: 0 }, 0],
        ['a decimal number', '2.5', {}, 2.5],
    ])('should save %s as the number %j', async (name, typed, limits, expected) => {
        const groups = draft(['numeric', typed, limits]);
        await bridge.saveSettingsDraft(groups);
        expect(groups[0].items[0].ref.value).toBe(expected);
    });

    it.each([[''], [undefined]])(
        'should leave an emptied number (%j) as it is instead of making it 0',
        async (value) => {
            const groups = draft(['numeric', value, { min: 1 }]);
            await bridge.saveSettingsDraft(groups);
            expect(groups[0].items[0].ref.value).toBe(value);
        },
    );

    it('should save the other kinds of settings as they are, even when they look like numbers', async () => {
        const groups = draft(
            ['text', '42'],
            ['password', 'p4ss'],
            ['checkbox', false],
            ['select', '.epub'],
            ['directory', '/a/b'],
        );
        await bridge.saveSettingsDraft(groups);
        expect(groups[0].items.map((item) => item.ref.value)).toEqual([
            '42',
            'p4ss',
            false,
            '.epub',
            '/a/b',
        ]);
    });

    it('should save every group, and tell the engine to store them, after all values were set', async () => {
        const groups = [
            { category: 'General', items: [{ ref: { input: 'text', value: 'a' }, value: 'b' }] },
            {
                category: 'Site',
                items: [{ ref: { input: 'checkbox', value: false }, value: true }],
            },
        ];
        engine.Settings.save.mockImplementationOnce(async () => {
            expect(groups.map((group) => group.items[0].ref.value)).toEqual(['b', true]);
        });
        await bridge.saveSettingsDraft(groups);
        expect(engine.Settings.save).toHaveBeenCalledTimes(1);
    });

    it('should pass the failure of the engine to the caller', async () => {
        engine.Settings.save.mockRejectedValueOnce(new Error('disk is full'));
        await expect(bridge.saveSettingsDraft(draft(['text', 'x']))).rejects.toThrow(
            'disk is full',
        );
    });

    describe('the manga directory after saving', () => {
        it('should answer nothing when the directory of the settings can take the chapters', async () => {
            engine.Settings.baseDirectory = { value: '/mnt/disk/mangas' };
            await expect(bridge.mangaDirectoryProblem()).resolves.toBeNull();
            expect(engine.Storage.checkDirectory).toHaveBeenCalledWith('/mnt/disk/mangas');
        });

        it('should say what is wrong with it, with the reason of the system', async () => {
            engine.Storage.checkDirectory.mockRejectedValueOnce(
                new Error("EACCES: permission denied, access '/mnt/disk/mangas'"),
            );
            await expect(bridge.mangaDirectoryProblem()).resolves.toBe(
                "Cannot access the manga directory!\n\nEACCES: permission denied, access '/mnt/disk/mangas'",
            );
        });
    });

    it('should draw the draft from the categories of the engine, with the values as they are now', () => {
        const ref = { input: 'text', label: 'Name', value: 'now' };
        engine.Settings.groups = [{ category: 'General', settings: [ref] }];
        const groups = bridge.getSettingsDraft();
        expect(groups).toEqual([{ category: 'General', items: [{ ref, value: 'now' }] }]);
        // a draft is a copy: editing it does not touch the setting before it is saved
        groups[0].items[0].value = 'edited';
        expect(ref.value).toBe('now');
    });
});

describe('the download queue', () => {
    it('should be empty when the manager has no queue', () => {
        engine.DownloadManager.queue = undefined;
        expect(bridge.getDownloadJobs()).toEqual([]);
        expect(bridge.hasActiveDownloads()).toBe(false);
    });

    it('should read the jobs of every connector, and ignore what is no list', () => {
        const queue = [];
        queue.site = [{ status: 'queued' }, { status: 'failed' }];
        queue.other = [{ status: 'downloading' }];
        queue.counter = 3;
        engine.DownloadManager.queue = queue;
        expect(bridge.getDownloadJobs().map((job) => job.status)).toEqual([
            'queued',
            'failed',
            'downloading',
        ]);
    });

    it.each([
        [['completed', 'failed'], false],
        [['completed', 'queued'], true],
        [['downloading'], true],
        [[], false],
    ])('should tell whether there is an active download in %j: %s', (statuses, active) => {
        engine.DownloadManager.queue.site = statuses.map((status) => ({ status }));
        expect(bridge.hasActiveDownloads()).toBe(active);
    });
});

// The manager takes a job out of its queue when the job starts, so the queue only holds what waits. A job that downloads,
// or one that failed, is known from the events of the manager, which the application follows from the moment it starts.
describe('the jobs that the queue does not hold', () => {
    function job(title, status) {
        return createDownloadJob(addChapter(manga, { title }), { status });
    }

    // the engine changes the job in place and announces it
    function announce(next, status) {
        next.status = status;
        engine.DownloadManager.emit('updated', next);
    }

    beforeEach(() => {
        // what the application does when it starts
        bridge.subscribeDownloads(() => undefined);
    });

    it('should count a job that downloads, although the manager took it out of its queue', () => {
        const running = job('Chapter 1', 'queued');
        announce(running, 'queued');
        announce(running, 'downloading');
        expect(engine.DownloadManager.queue).toHaveLength(0);
        expect(bridge.getDownloadJobs()).toEqual([running]);
        expect(bridge.hasActiveDownloads()).toBe(true);
    });

    it('should know the jobs that started before the view that asks for them was opened', () => {
        const first = job('Chapter 1', 'queued');
        const second = job('Chapter 2', 'queued');
        announce(first, 'queued');
        announce(second, 'queued');
        announce(first, 'downloading');
        expect(bridge.getDownloadJobs()).toEqual([first, second]);
    });

    it('should keep a failed job, which can be downloaded again, and replace it by its retry', () => {
        const failed = job('Chapter 1', 'queued');
        announce(failed, 'queued');
        announce(failed, 'downloading');
        announce(failed, 'failed');
        expect(bridge.getDownloadJobs()).toEqual([failed]);
        expect(bridge.hasActiveDownloads()).toBe(false);
        const retry = createDownloadJob(failed.chapter, { status: 'queued' });
        announce(retry, 'queued');
        expect(bridge.getDownloadJobs()).toEqual([retry]);
        expect(bridge.hasActiveDownloads()).toBe(true);
    });

    it('should drop a job that completed, and have nothing active after it', () => {
        const done = job('Chapter 1', 'queued');
        announce(done, 'queued');
        announce(done, 'downloading');
        announce(done, 'completed');
        expect(bridge.getDownloadJobs()).toEqual([]);
        expect(bridge.hasActiveDownloads()).toBe(false);
    });

    it('should hand out a new list when the jobs changed, and the same one while they did not', () => {
        const first = job('Chapter 1', 'queued');
        announce(first, 'queued');
        const list = bridge.getDownloadJobs();
        expect(bridge.getDownloadJobs()).toBe(list);
        announce(job('Chapter 2', 'queued'), 'queued');
        expect(bridge.getDownloadJobs()).not.toBe(list);
        // the list that was handed out is not changed behind the back of the view that holds it
        expect(list).toEqual([first]);
    });

    it('should follow the manager once, however many views subscribe', () => {
        const added = vi.spyOn(engine.DownloadManager, 'addEventListener');
        bridge.subscribeDownloads(() => undefined);
        bridge.subscribeDownloads(() => undefined);
        // the listeners of the views, but not another follower of the list
        expect(added).toHaveBeenCalledTimes(2);
        const running = job('Chapter 1', 'queued');
        announce(running, 'queued');
        expect(bridge.getDownloadJobs()).toEqual([running]);
    });

    it('should tell a listener about an event only after the list of the jobs took it in', () => {
        let seen = null;
        bridge.subscribeDownloads(() => {
            seen = bridge.getDownloadJobs().length;
        });
        announce(job('Chapter 1', 'queued'), 'queued');
        expect(seen).toBe(1);
    });
});

describe('searching local manga lists', () => {
    // the connectors of these tests are their own, not the one of the setup
    beforeEach(() => {
        engine.Connectors.splice(0);
    });

    it('should match on a part of a title, ignoring case and the spaces around the pattern', async () => {
        engine.Connectors.push({ id: 'one' }, { id: 'two' });
        engine.Storage.loadMangaList.mockImplementation(async (id) =>
            id === 'one' ? [{ title: 'ONE PIECE' }] : [{ title: 'Naruto' }],
        );
        await expect(bridge.findConnectorsByManga('  one pie ')).resolves.toEqual(['one']);
    });

    it('should skip a connector whose list cannot be read, and keep looking', async () => {
        engine.Connectors.push({ id: 'broken' }, { id: 'fine' });
        engine.Storage.loadMangaList.mockImplementation(async (id) => {
            if (id === 'broken') {
                throw new Error('no such file');
            }
            return [{ title: 'Berserk' }];
        });
        await expect(bridge.findConnectorsByManga('berserk')).resolves.toEqual(['fine']);
    });

    it('should list the connectors in the order of the registry', async () => {
        engine.Connectors.push({ id: 'b' }, { id: 'a' }, { id: 'c' });
        engine.Storage.loadMangaList.mockResolvedValue([{ title: 'Berserk' }]);
        await expect(bridge.findConnectorsByManga('berserk')).resolves.toEqual(['b', 'a', 'c']);
    });
});

describe('announcing the selection', () => {
    it.each([
        ['onSelectConnector', 'announceConnector'],
        ['onSelectManga', 'announceManga'],
    ])(
        'should tell the document, where the Discord presence listens, with %s',
        (name, announce) => {
            const listener = vi.fn();
            document.addEventListener(name, listener);
            const selected = { id: 'x', label: 'X' };
            bridge[announce](selected);
            document.removeEventListener(name, listener);
            expect(listener).toHaveBeenCalledTimes(1);
            expect(listener.mock.calls[0][0].detail).toBe(selected);
        },
    );

    it('should not mix the two events up', () => {
        const connector = vi.fn();
        document.addEventListener('onSelectConnector', connector);
        bridge.announceManga({ id: 'm' });
        document.removeEventListener('onSelectConnector', connector);
        expect(connector).not.toHaveBeenCalled();
    });
});
