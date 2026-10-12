// The download queue: one queue for each connector (so a site is never hit by two jobs at once), a worker that looks at the queues
// every 250 ms, and the `updated` events that the UI listens to. The jobs are the real DownloadJob, the chapters are fakes
// that wait for the test to name their pages, so every job goes on exactly when the test wants it to.
let DownloadManager = null;
let Enums = null;
let Chapter = null;
let Manga = null;
let bridge = null;

beforeAll(async () => {
    DownloadManager = (await import('../mjs/engine/DownloadManager.mjs')).default;
    Enums = (await import('../mjs/engine/Enums.mjs')).default;
    Chapter = (await import('../mjs/engine/Chapter.mjs')).default;
    Manga = (await import('../mjs/engine/Manga.mjs')).default;
    bridge = await import('../ui/engine.js');
});

let managers = [];

beforeEach(() => {
    vi.useFakeTimers();
    managers = [];
    vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => new AbortController().signal);
    vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({
            status: 200,
            statusText: 'OK',
            blob: async () => new Blob(['page']),
        })),
    );
    globalThis.Engine = {
        Settings: {
            useSequentialMediaDownloads: { value: false },
            ignoreErrorOnDownload: { value: false },
            chapterFormat: { value: '.cbz' },
            novelFormat: { value: '.epub' },
        },
        Storage: { saveChapterPages: vi.fn(async () => undefined), sanatizePath: (title) => title },
    };
});

afterEach(() => {
    for (const manager of managers) {
        clearInterval(manager.worker);
    }
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete globalThis.Engine;
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.EventListener;
});

function createManager() {
    const manager = new DownloadManager();
    managers.push(manager);
    return manager;
}

function createConnector(id, overrides = {}) {
    return {
        id,
        label: `Connector ${id}`,
        isLocked: false,
        requestOptions: {},
        existingMangas: [],
        ...overrides,
    };
}

// a chapter that is told its pages by the test: `chapter.answer(error, pages)` is what the connector would do
function createChapter(connector, title, mangaTitle = `Manga of ${connector.id}`) {
    const chapter = {
        id: `/${title}`,
        title,
        status: 'available',
        statuses: [],
        manga: {
            title: mangaTitle,
            connector,
            updateStatus: vi.fn(),
            isChapterFileExisting: vi.fn(() => false),
        },
        setStatus: vi.fn((status) => {
            chapter.status = status;
            chapter.statuses.push(status);
        }),
        getPages: vi.fn((callback) => {
            chapter.answer = callback;
        }),
    };
    return chapter;
}

const tick = (ms) => vi.advanceTimersByTimeAsync(ms);

// the worker looks at the queues every 250 ms
const WORKER = 250;

async function succeed(chapter) {
    chapter.answer(null, [`https://img.test/${chapter.title}.jpg`]);
    await tick(10);
}

async function fail(chapter, error = new Error('no pages')) {
    chapter.answer(error, undefined);
    await tick(10);
}

function watch(manager) {
    const events = [];
    manager.addEventListener('updated', (event) =>
        events.push({
            type: event.type,
            job: event.detail,
            status: event.detail.status,
            progress: event.detail.progress,
        }),
    );
    return events;
}

describe('a new manager', () => {
    it('should have nothing in its queue and nothing to do', async () => {
        const manager = createManager();
        expect(manager.queue).toHaveLength(0);
        expect(Object.keys(manager.queue)).toEqual([]);
        await tick(10 * WORKER);
        expect(Object.keys(manager.queue)).toEqual([]);
    });

    it('should look at the queues four times a second', async () => {
        const manager = createManager();
        const connector = createConnector('site');
        const chapter = createChapter(connector, 'Chapter 1');
        manager.addDownload(chapter);
        await tick(WORKER - 1);
        expect(chapter.getPages).not.toHaveBeenCalled();
        await tick(1);
        expect(chapter.getPages).toHaveBeenCalledTimes(1);
    });
});

describe('addDownload', () => {
    it('should queue the chapter as a job that is queued, and tell about it', () => {
        const manager = createManager();
        const events = watch(manager);
        const connector = createConnector('site');
        const chapter = createChapter(connector, 'Chapter 1');

        manager.addDownload(chapter);

        const jobs = manager.queue.site;
        expect(jobs).toHaveLength(1);
        expect(jobs[0].chapter).toBe(chapter);
        expect(jobs[0].status).toBe('queued');
        expect(chapter.statuses).toEqual(['queued']);
        expect(chapter.manga.updateStatus).toHaveBeenCalledTimes(1);
        expect(events).toEqual([{ type: 'updated', job: jobs[0], status: 'queued', progress: 0 }]);
    });

    it('should not start the job at once, the worker does', () => {
        const manager = createManager();
        const chapter = createChapter(createConnector('site'), 'Chapter 1');
        manager.addDownload(chapter);
        expect(chapter.getPages).not.toHaveBeenCalled();
        expect(manager.queue.site.activeCount).toBe(0);
    });

    it('should queue the chapters of a connector one after the other, whatever their manga', () => {
        const manager = createManager();
        const connector = createConnector('site');
        const chapters = [
            createChapter(connector, 'Chapter 1', 'Manga A'),
            createChapter(connector, 'Chapter 1', 'Manga B'),
            createChapter(connector, 'Chapter 2', 'Manga A'),
        ];
        chapters.forEach((chapter) => manager.addDownload(chapter));
        expect(manager.queue.site.map((job) => job.chapter)).toEqual(chapters);
    });

    it('should keep a queue for each connector, told apart by the id', () => {
        const manager = createManager();
        const first = createConnector('site-a', { label: 'Same label' });
        const second = createConnector('site-b', { label: 'Same label' });
        manager.addDownload(createChapter(first, 'Chapter 1'));
        manager.addDownload(createChapter(second, 'Chapter 1'));
        manager.addDownload(createChapter(first, 'Chapter 2'));
        expect(Object.keys(manager.queue).sort()).toEqual(['site-a', 'site-b']);
        expect(manager.queue['site-a']).toHaveLength(2);
        expect(manager.queue['site-b']).toHaveLength(1);
    });

    it('should not queue a chapter that is queued already, and not tell about it again', () => {
        const manager = createManager();
        const events = watch(manager);
        const chapter = createChapter(createConnector('site'), 'Chapter 1');
        manager.addDownload(chapter);
        manager.addDownload(chapter);
        expect(manager.queue.site).toHaveLength(1);
        expect(events).toHaveLength(1);
        expect(chapter.statuses).toEqual(['queued']);
    });

    it('should tell about the jobs with a new event of its own for every listener', () => {
        const manager = createManager();
        const first = vi.fn();
        const second = vi.fn();
        manager.addEventListener('updated', first);
        manager.addEventListener('updated', second);
        manager.addDownload(createChapter(createConnector('site'), 'Chapter 1'));
        expect(first).toHaveBeenCalledTimes(1);
        expect(second).toHaveBeenCalledTimes(1);
        expect(first.mock.calls[0][0]).toBeInstanceOf(CustomEvent);
        expect(first.mock.calls[0][0].target).toBe(manager);
        expect(first.mock.calls[0][0].detail).toBe(second.mock.calls[0][0].detail);
    });
});

describe('the worker', () => {
    it('should download the chapter of a job: downloading while it runs, completed when it is done', async () => {
        const manager = createManager();
        const events = watch(manager);
        const chapter = createChapter(createConnector('site'), 'Chapter 1');
        manager.addDownload(chapter);
        const [job] = manager.queue.site;

        await tick(WORKER);
        expect(job.status).toBe('downloading');
        expect(chapter.status).toBe('downloading');
        expect(manager.queue.site).toHaveLength(0);

        await succeed(chapter);

        expect(job.status).toBe('completed');
        expect(job.progress).toBe(100);
        expect(chapter.statuses).toEqual(['queued', 'downloading', 'completed']);
        expect(Engine.Storage.saveChapterPages).toHaveBeenCalledTimes(1);
        expect(Engine.Storage.saveChapterPages.mock.calls[0][0]).toBe(chapter);
        expect(events.every((event) => event.job === job && event.type === 'updated')).toBe(true);
        expect(
            events
                .map((event) => event.status)
                .filter((status, index, all) => status !== all[index - 1]),
        ).toEqual(['queued', 'downloading', 'completed']);
        expect(events.at(-1)).toMatchObject({ status: 'completed', progress: 100 });
        const progress = events.map((event) => event.progress);
        expect(progress).toEqual([...progress].sort((a, b) => a - b));
    });

    it('should download the chapters of one connector one after the other, in the order they were added', async () => {
        const manager = createManager();
        const connector = createConnector('site');
        const [first, second, third] = ['Chapter 1', 'Chapter 2', 'Chapter 3'].map((title) =>
            createChapter(connector, title),
        );
        [first, second, third].forEach((chapter) => manager.addDownload(chapter));

        await tick(WORKER);
        expect([first, second, third].map((chapter) => chapter.status)).toEqual([
            'downloading',
            'queued',
            'queued',
        ]);

        // however long the first one takes, the others wait
        await tick(10 * 60 * 1000);
        expect(second.getPages).not.toHaveBeenCalled();
        expect(third.getPages).not.toHaveBeenCalled();

        await succeed(first);
        await tick(WORKER);
        expect([first, second, third].map((chapter) => chapter.status)).toEqual([
            'completed',
            'downloading',
            'queued',
        ]);

        await fail(second);
        await tick(WORKER);
        expect([first, second, third].map((chapter) => chapter.status)).toEqual([
            'completed',
            'failed',
            'downloading',
        ]);

        await succeed(third);
        expect(third.status).toBe('completed');
        expect(manager.queue.site).toHaveLength(0);
    });

    it('should queue what is added while a job runs behind the jobs that wait, in the order they were added', async () => {
        const manager = createManager();
        const connector = createConnector('site');
        const [first, second, third, fourth] = [
            'Chapter 1',
            'Chapter 2',
            'Chapter 3',
            'Chapter 4',
        ].map((title) => createChapter(connector, title));
        manager.addDownload(first);
        manager.addDownload(second);
        await tick(WORKER);
        manager.addDownload(third);
        await tick(WORKER);
        manager.addDownload(fourth);
        expect(manager.queue.site.map((job) => job.chapter)).toEqual([second, third, fourth]);

        for (const chapter of [first, second, third, fourth]) {
            await tick(WORKER);
            expect(chapter.status).toBe('downloading');
            await succeed(chapter);
        }
        expect([first, second, third, fourth].map((chapter) => chapter.status)).toEqual(
            Array(4).fill('completed'),
        );
    });

    it('should download for several connectors at the same time', async () => {
        const manager = createManager();
        const a = createChapter(createConnector('site-a'), 'Chapter 1');
        const b = createChapter(createConnector('site-b'), 'Chapter 1');
        const a2 = createChapter(createConnector('site-a'), 'Chapter 2');
        [a, b, a2].forEach((chapter) => manager.addDownload(chapter));

        await tick(WORKER);

        expect([a.status, b.status, a2.status]).toEqual(['downloading', 'downloading', 'queued']);
    });

    it('should leave a locked connector alone and start its job when the lock is gone', async () => {
        const manager = createManager();
        const locked = createConnector('locked', { isLocked: Symbol('lock') });
        const free = createConnector('free');
        const waiting = createChapter(locked, 'Chapter 1');
        const running = createChapter(free, 'Chapter 1');
        manager.addDownload(waiting);
        manager.addDownload(running);

        await tick(5 * WORKER);
        expect(waiting.status).toBe('queued');
        expect(running.status).toBe('downloading');

        locked.isLocked = false;
        await tick(WORKER);
        expect(waiting.status).toBe('downloading');
    });

    it('should only look at the lock before it starts a job', async () => {
        const manager = createManager();
        const connector = createConnector('site');
        const chapter = createChapter(connector, 'Chapter 1');
        manager.addDownload(chapter);
        await tick(WORKER);
        connector.isLocked = Symbol('lock');
        await succeed(chapter);
        expect(chapter.status).toBe('completed');
    });

    it('should start the next job of a connector after a job that failed', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const manager = createManager();
        const connector = createConnector('site');
        const first = createChapter(connector, 'Chapter 1');
        const second = createChapter(connector, 'Chapter 2');
        manager.addDownload(first);
        manager.addDownload(second);
        await tick(WORKER);
        await fail(first, new Error('login required'));
        expect(first.status).toBe('failed');

        await tick(WORKER);

        expect(second.status).toBe('downloading');
    });

    it('should not start a job twice, however often it looks', async () => {
        const manager = createManager();
        const chapter = createChapter(createConnector('site'), 'Chapter 1');
        manager.addDownload(chapter);
        await tick(20 * WORKER);
        expect(chapter.getPages).toHaveBeenCalledTimes(1);
    });

    it('should have nothing left to do when the queues are empty', async () => {
        const manager = createManager();
        const chapter = createChapter(createConnector('site'), 'Chapter 1');
        manager.addDownload(chapter);
        await tick(WORKER);
        await succeed(chapter);
        const events = watch(manager);
        await tick(60 * 1000);
        expect(events).toEqual([]);
        expect(manager.queue.site).toHaveLength(0);
    });

    describe('when the chapter throws instead of answering', () => {
        function throwing(connector, title, error = new Error('the connector is broken')) {
            const chapter = createChapter(connector, title);
            chapter.getPages = vi.fn(() => {
                throw error;
            });
            return chapter;
        }

        it('should fail the job with the error, write it to the log and go on with the next job', async () => {
            const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
            const manager = createManager();
            const events = watch(manager);
            const connector = createConnector('site');
            const failure = new Error('the connector is broken');
            const broken = throwing(connector, 'Chapter 1', failure);
            const next = createChapter(connector, 'Chapter 2');
            manager.addDownload(broken);
            manager.addDownload(next);
            const [job] = manager.queue.site;

            await tick(WORKER);

            expect(job.status).toBe('failed');
            expect(job.errors).toEqual([failure]);
            expect(broken.statuses).toEqual(['queued', 'downloading', 'failed']);
            expect(log).toHaveBeenCalledWith(failure);
            expect(
                events.filter((event) => event.job === job).map((event) => event.status),
            ).toEqual(['queued', 'downloading', 'failed']);

            // the connector is free again, the failure does not stop the jobs behind it
            await tick(WORKER);
            expect(next.status).toBe('downloading');
            await succeed(next);
            expect(next.status).toBe('completed');
        });

        it('should keep the connector free for every one of many failures in a row', async () => {
            vi.spyOn(console, 'error').mockImplementation(() => undefined);
            const manager = createManager();
            const connector = createConnector('site');
            const broken = Array.from({ length: 5 }, (value, index) =>
                throwing(connector, `Chapter ${index}`),
            );
            const last = createChapter(connector, 'Chapter 9');
            [...broken, last].forEach((chapter) => manager.addDownload(chapter));

            await tick(10 * WORKER);

            expect(broken.map((chapter) => chapter.status)).toEqual(Array(5).fill('failed'));
            expect(last.status).toBe('downloading');
        });

        it('should fail the job when the status of its chapter cannot be set', async () => {
            vi.spyOn(console, 'error').mockImplementation(() => undefined);
            const manager = createManager();
            const connector = createConnector('site');
            const chapter = createChapter(connector, 'Chapter 1');
            manager.addDownload(chapter);
            const [job] = manager.queue.site;
            const failure = new Error('cannot set the status');
            chapter.setStatus = vi.fn((status) => {
                if (status === 'downloading') {
                    throw failure;
                }
                chapter.status = status;
            });

            await tick(WORKER);

            expect(job.errors).toEqual([failure]);
            expect(job.status).toBe('failed');
            expect(chapter.getPages).not.toHaveBeenCalled();
        });
    });
});

describe('a chapter that is queued again', () => {
    it('should be a new job, so a job that failed can be restarted', async () => {
        const manager = createManager();
        const events = watch(manager);
        const chapter = createChapter(createConnector('site'), 'Chapter 1');
        manager.addDownload(chapter);
        const [failedJob] = manager.queue.site;
        await tick(WORKER);
        await fail(chapter);
        expect(failedJob.status).toBe('failed');

        manager.addDownload(chapter);

        const [retry] = manager.queue.site;
        expect(retry).not.toBe(failedJob);
        expect(retry.isSame(failedJob)).toBe(true);
        expect(retry.status).toBe('queued');
        expect(failedJob.status).toBe('failed');
        expect(chapter.status).toBe('queued');
        expect(events.at(-1)).toMatchObject({ job: retry, status: 'queued' });

        await tick(WORKER);
        await succeed(chapter);
        expect(retry.status).toBe('completed');
        expect(chapter.statuses).toEqual([
            'queued',
            'downloading',
            'failed',
            'queued',
            'downloading',
            'completed',
        ]);
    });

    // NOTE: the chapter keeps the list of its pages after a failure, so a restart loads the same addresses again and does not ask
    // the connector for new ones; a site that lets the addresses of its pages expire is not helped by a restart
    it('should load the pages that the chapter found for the first attempt again, when the first attempt failed', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        globalThis.document = new EventTarget();
        globalThis.EventListener = Enums.EventListener;
        const getPageList = vi.fn((manga, chapter, callback) =>
            callback(null, [`https://img.test/${getPageList.mock.calls.length}.jpg`]),
        );
        const connector = createConnector('site', {
            initialize: async () => undefined,
            _getPageList: getPageList,
        });
        const manga = new Manga(connector, '/m/1', 'Manga', 'available');
        const chapter = new Chapter(manga, '/c/1', 'Chapter 1', 'en', 'available');
        fetch.mockResolvedValueOnce({
            status: 403,
            statusText: 'Forbidden',
            blob: async () => new Blob(['denied']),
        });
        const manager = createManager();

        manager.addDownload(chapter);
        await tick(WORKER);
        await tick(1000);
        expect(chapter.status).toBe('failed');

        manager.addDownload(chapter);
        await tick(WORKER);
        await tick(1000);

        expect(chapter.status).toBe('completed');
        expect(getPageList).toHaveBeenCalledTimes(1);
        expect(fetch.mock.calls.map((call) => call[0])).toEqual([
            'https://img.test/1.jpg',
            'https://img.test/1.jpg',
        ]);
    });

    it('should be a new job after it completed, so a chapter can be downloaded again', async () => {
        const manager = createManager();
        const chapter = createChapter(createConnector('site'), 'Chapter 1');
        manager.addDownload(chapter);
        await tick(WORKER);
        await succeed(chapter);
        manager.addDownload(chapter);
        expect(manager.queue.site).toHaveLength(1);
        expect(manager.queue.site[0].status).toBe('queued');
    });
});

describe('the user interface', () => {
    function bind(manager) {
        globalThis.window = { Engine: { DownloadManager: manager } };
    }

    it('should keep its list of jobs right: a job that fails stays, a job that completes goes, a restart replaces the failed one', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const manager = createManager();
        bind(manager);
        let list = [];
        const unsubscribe = bridge.subscribeDownloads((event) => {
            list = bridge.mergeDownloadJobs(list, event.detail);
        });
        const good = createChapter(createConnector('site-a'), 'Good');
        const bad = createChapter(createConnector('site-b'), 'Bad');

        manager.addDownload(good);
        manager.addDownload(bad);
        expect(list.map((job) => [job.labels.chapter, job.status])).toEqual([
            ['Good', 'queued'],
            ['Bad', 'queued'],
        ]);

        await tick(WORKER);
        expect(list.map((job) => job.status)).toEqual(['downloading', 'downloading']);

        await succeed(good);
        expect(list.map((job) => [job.labels.chapter, job.status])).toEqual([
            ['Bad', 'downloading'],
        ]);

        await fail(bad);
        expect(list.map((job) => [job.labels.chapter, job.status])).toEqual([['Bad', 'failed']]);
        const failedJob = list[0];

        // the restart of the UI
        bridge.restartChapterDownload(bad);
        expect(list).toHaveLength(1);
        expect(list[0]).not.toBe(failedJob);
        expect(list[0].status).toBe('queued');

        await tick(WORKER);
        await fail(bad, new Error('still no pages'));
        expect(list.map((job) => [job.labels.chapter, job.status])).toEqual([['Bad', 'failed']]);
        expect(list[0].errors.map((error) => error.message)).toEqual(['still no pages']);

        unsubscribe();
        manager.addDownload(good);
        expect(list).toHaveLength(1);
    });

    it('should find the jobs that wait in the queue', () => {
        const manager = createManager();
        bind(manager);
        manager.addDownload(createChapter(createConnector('site-a'), 'Chapter 1'));
        manager.addDownload(createChapter(createConnector('site-b'), 'Chapter 1'));
        manager.addDownload(createChapter(createConnector('site-a'), 'Chapter 2'));
        expect(
            bridge
                .getDownloadJobs()
                .map((job) => `${job.labels.connector}/${job.labels.chapter}`)
                .sort(),
        ).toEqual([
            'Connector site-a/Chapter 1',
            'Connector site-a/Chapter 2',
            'Connector site-b/Chapter 1',
        ]);
        expect(bridge.hasActiveDownloads()).toBe(true);
    });

    // NOTE: the chapter announces itself as selected whenever its pages are asked for, a download included, and DiscordPresence shows
    // a selected chapter as "Viewing ..." (Chapter.getPages)
    it('should announce the chapter as selected when a job asks for its pages, as it does when the chapter is opened', async () => {
        globalThis.document = new EventTarget();
        globalThis.EventListener = Enums.EventListener;
        const connector = createConnector('site', {
            initialize: async () => undefined,
            _getPageList: (manga, chapter, callback) => callback(null, ['https://img.test/1.jpg']),
        });
        const chapter = new Chapter(
            new Manga(connector, '/m/1', 'Manga', 'available'),
            '/c/1',
            'Chapter 1',
            'en',
            'available',
        );
        const selected = [];
        document.addEventListener('onSelectChapter', (event) => selected.push(event.detail));
        const manager = createManager();

        manager.addDownload(chapter);
        await tick(WORKER);
        await tick(1000);

        expect(selected).toEqual([chapter]);
    });

    it('should find nothing active when every job is done, and list the one that failed', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const manager = createManager();
        bind(manager);
        // the application subscribes when it starts, which is how the jobs are followed
        bridge.subscribeDownloads(() => undefined);
        const good = createChapter(createConnector('site-a'), 'Good');
        const bad = createChapter(createConnector('site-b'), 'Bad');
        manager.addDownload(good);
        manager.addDownload(bad);
        await tick(WORKER);
        await succeed(good);
        await fail(bad);
        expect(bridge.getDownloadJobs().map((job) => [job.labels.chapter, job.status])).toEqual([
            ['Bad', 'failed'],
        ]);
        expect(bridge.hasActiveDownloads()).toBe(false);
    });

    it('should announce the status of a chapter on the document, where the UI listens for it', async () => {
        globalThis.document = new EventTarget();
        globalThis.EventListener = Enums.EventListener;
        const connector = createConnector('site', {
            initialize: async () => undefined,
            _getPageList: (manga, chapter, callback) =>
                callback(null, ['https://img.test/1.jpg', 'https://img.test/2.jpg']),
        });
        const manga = new Manga(connector, '/m/1', 'Manga', 'available');
        const chapter = new Chapter(manga, '/c/1', 'Chapter 1', 'en', 'available');
        const seen = [];
        const unsubscribe = bridge.subscribeChapterStatus((event) =>
            seen.push([event.detail.title, event.detail.status]),
        );
        const manager = createManager();

        manager.addDownload(chapter);
        await tick(WORKER);
        await tick(1000);
        unsubscribe();

        expect(seen).toEqual([
            ['Chapter 1', 'queued'],
            ['Chapter 1', 'downloading'],
            ['Chapter 1', 'completed'],
        ]);
        expect(chapter.status).toBe('completed');
        expect(Engine.Storage.saveChapterPages).toHaveBeenCalledWith(chapter, expect.any(Array));
        expect(Engine.Storage.saveChapterPages.mock.calls[0][1]).toHaveLength(2);
    });

    // A job leaves the queue when it starts, so the UI cannot read what downloads from the queue: it follows the events from the
    // moment that the application starts (ui/engine.js), or closing the window while the last job downloads asked no confirmation
    it('should count a job that is downloading as an active download', async () => {
        const manager = createManager();
        bind(manager);
        bridge.subscribeDownloads(() => undefined);
        manager.addDownload(createChapter(createConnector('site'), 'Chapter 1'));
        await tick(WORKER);
        expect(manager.queue.site).toHaveLength(0);
        expect(bridge.hasActiveDownloads()).toBe(true);
    });

    // the same reason: a view that opens while a job downloads, or after one failed, starts from the list of the events
    it('should list the jobs that are downloading or failed for a view that opens later', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const manager = createManager();
        bind(manager);
        bridge.subscribeDownloads(() => undefined);
        const running = createChapter(createConnector('site-a'), 'Running');
        const broken = createChapter(createConnector('site-b'), 'Broken');
        manager.addDownload(running);
        manager.addDownload(broken);
        await tick(WORKER);
        await fail(broken);
        expect(
            bridge
                .getDownloadJobs()
                .map((job) => job.labels.chapter)
                .sort(),
        ).toEqual(['Broken', 'Running']);
    });
});

describe('canceling downloads', () => {
    // two chapters of one site: the first one runs (its pages are asked for), the second one waits behind it
    async function oneRunsOneWaits(manager, connector = createConnector('site')) {
        const running = createChapter(connector, 'Running');
        const waiting = createChapter(connector, 'Waiting');
        manager.addDownload(running);
        manager.addDownload(waiting);
        await tick(WORKER);
        return {
            running,
            waiting,
            runningJob: [...manager.running][0],
            waitingJob: manager.queue[connector.id][0],
        };
    }

    it('should know the jobs that run, which have left their queue, and the jobs that wait', async () => {
        const manager = createManager();
        const { runningJob, waitingJob } = await oneRunsOneWaits(manager);
        expect(manager.running.size).toBe(1);
        expect(manager.jobs).toEqual([waitingJob, runningJob]);
        await succeed(runningJob.chapter);
        await tick(10);
        expect(manager.running.has(runningJob)).toBe(false);
    });

    it('should take a job that waits out of its queue, and never start it', async () => {
        const manager = createManager();
        const events = watch(manager);
        const { running, waiting, waitingJob } = await oneRunsOneWaits(manager);
        expect(manager.cancel(waitingJob)).toBe(true);
        expect(manager.queue.site).toHaveLength(0);
        expect(waitingJob.status).toBe('canceled');
        expect(waiting.status).toBe('available');
        expect(
            events.filter((event) => event.job === waitingJob).map((event) => event.status),
        ).toEqual(['queued', 'canceled']);
        await succeed(running);
        await tick(10 * WORKER);
        expect(waiting.getPages).not.toHaveBeenCalled();
        expect(manager.queue.site.activeCount).toBe(0);
    });

    it('should stop a job that runs, give its place back, and let the next job of the site start', async () => {
        const manager = createManager();
        const { running, waiting, runningJob } = await oneRunsOneWaits(manager);
        expect(waiting.getPages).not.toHaveBeenCalled();
        expect(manager.cancel(runningJob)).toBe(true);
        expect(runningJob.status).toBe('canceled');
        expect(running.status).toBe('available');
        expect(manager.running.size).toBe(0);
        expect(manager.queue.site.activeCount).toBe(0);
        await tick(WORKER);
        expect(waiting.getPages).toHaveBeenCalledTimes(1);
        // what the connector answers later is not the business of the job any more
        await succeed(running);
        await tick(10 * WORKER);
        expect(fetch).not.toHaveBeenCalledWith(
            expect.stringContaining('Running'),
            expect.anything(),
        );
        expect(runningJob.status).toBe('canceled');
    });

    it('should say that it has nothing to stop for a job that it does not know, or that is over', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const manager = createManager();
        const stranger = createManager();
        const connector = createConnector('site');
        stranger.addDownload(createChapter(connector, 'Stranger'));
        expect(manager.cancel(stranger.queue.site[0])).toBe(false);
        expect(stranger.queue.site).toHaveLength(1);
        const chapter = createChapter(connector, 'Done');
        manager.addDownload(chapter);
        const job = manager.queue.site[0];
        await tick(WORKER);
        await succeed(chapter);
        await tick(100);
        expect(job.status).toBe('completed');
        expect(manager.cancel(job)).toBe(false);
    });

    it('should stop the download of a chapter wherever it is, and say so when there is none', async () => {
        const manager = createManager();
        const { running, waiting } = await oneRunsOneWaits(manager);
        expect(manager.cancelChapter(waiting)).toBe(true);
        expect(manager.cancelChapter(waiting)).toBe(false);
        expect(manager.cancelChapter(running)).toBe(true);
        expect(manager.cancelChapter(createChapter(createConnector('site'), 'Nobody asked'))).toBe(
            false,
        );
        expect(manager.jobs).toEqual([]);
    });

    it('should stop every download of every site, those that wait first, and start nothing afterwards', async () => {
        const manager = createManager();
        const events = watch(manager);
        const a = await oneRunsOneWaits(manager, createConnector('site-a'));
        const b = await oneRunsOneWaits(manager, createConnector('site-b'));
        expect(manager.cancelAll()).toBe(4);
        for (const job of [a.runningJob, a.waitingJob, b.runningJob, b.waitingJob]) {
            expect(job.status).toBe('canceled');
        }
        for (const chapter of [a.running, a.waiting, b.running, b.waiting]) {
            expect(chapter.status).toBe('available');
        }
        expect(manager.jobs).toEqual([]);
        expect(manager.queue['site-a'].activeCount).toBe(0);
        expect(manager.queue['site-b'].activeCount).toBe(0);
        // the waiting jobs were stopped before the running ones gave their places back: none of them got to start
        await tick(10 * WORKER);
        expect(a.waiting.getPages).not.toHaveBeenCalled();
        expect(b.waiting.getPages).not.toHaveBeenCalled();
        expect(events.filter((event) => event.status === 'canceled')).toHaveLength(4);
    });

    it('should have nothing to stop when nothing is downloaded', async () => {
        const manager = createManager();
        expect(manager.cancelAll()).toBe(0);
        const { runningJob } = await oneRunsOneWaits(manager);
        await succeed(runningJob.chapter);
        manager.queue.site.splice(0);
        await tick(100);
        expect(manager.cancelAll()).toBe(0);
    });

    it('should download a chapter again that was canceled, as a new job', async () => {
        const manager = createManager();
        const connector = createConnector('site');
        const chapter = createChapter(connector, 'Chapter 1');
        manager.addDownload(chapter);
        const first = manager.queue.site[0];
        manager.cancel(first);
        manager.addDownload(chapter);
        const second = manager.queue.site[0];
        expect(second).not.toBe(first);
        expect(second.status).toBe('queued');
        await tick(WORKER);
        await succeed(chapter);
        await tick(100);
        expect(second.status).toBe('completed');
        expect(first.status).toBe('canceled');
    });

    it('should leave no download in the list of the interface, and none active, once they are canceled', async () => {
        const manager = createManager();
        globalThis.window = { Engine: { DownloadManager: manager } };
        // what the application does when it starts
        bridge.subscribeDownloads(() => undefined);
        await oneRunsOneWaits(manager);
        expect(bridge.getDownloadJobs()).toHaveLength(2);
        expect(bridge.hasActiveDownloads()).toBe(true);
        manager.cancelAll();
        expect(bridge.getDownloadJobs()).toEqual([]);
        expect(bridge.hasActiveDownloads()).toBe(false);
    });
});
