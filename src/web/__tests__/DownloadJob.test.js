// One chapter on its way to the device: it asks the chapter for its pages, loads them (all at once or one after the other,
// with a pause that the connector asks for), hands them to the storage and reports status and progress through `updated`
// events. The manager gives the job a callback that frees the connector for the next job, so it has to be called once, on
// success and on every kind of failure.
let DownloadJob = null;

beforeAll(async () => {
    DownloadJob = (await import('../mjs/engine/DownloadJob.mjs')).default;
});

let timeouts = [];

beforeEach(() => {
    vi.useFakeTimers();
    timeouts = [];
    // the timeout of a page request is a timer of Node that the fake timers do not see: keep its signals in reach
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((delay) => {
        const controller = new AbortController();
        timeouts.push({ delay, controller });
        return controller.signal;
    });
    globalThis.Engine = {
        Settings: {
            useSequentialMediaDownloads: { value: false },
            ignoreErrorOnDownload: { value: false },
        },
        Storage: { saveChapterPages: vi.fn(async () => undefined) },
    };
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete globalThis.Engine;
});

const PAGES = ['https://img.test/1.jpg', 'https://img.test/2.jpg', 'https://img.test/3.jpg'];

function createChapter({ pages = PAGES, connector = {}, title = 'Chapter 1' } = {}) {
    const chapter = {
        id: '/c/1',
        title,
        status: 'available',
        manga: {
            title: 'One Piece',
            connector: {
                id: 'site',
                label: 'Site',
                requestOptions: {
                    method: 'GET',
                    headers: new Headers({ referer: 'https://site.test' }),
                },
                ...connector,
            },
            updateStatus: vi.fn(),
            isChapterFileExisting: vi.fn(() => false),
        },
        setStatus: vi.fn((status) => {
            chapter.status = status;
        }),
        getPages: vi.fn((callback) => callback(null, pages)),
    };
    return chapter;
}

// the answer to a request for a page; the blob is the one that must reach the storage
function answer(status = 200) {
    const blob = new Blob([`blob of status ${status}`]);
    return {
        status,
        statusText: status === 200 ? 'OK' : 'Failure',
        blob: vi.fn(async () => blob),
        body: blob,
    };
}

function stubFetch(handler = () => answer()) {
    const fetch = vi.fn(async (url, options) => handler(url, options));
    vi.stubGlobal('fetch', fetch);
    return fetch;
}

function watch(job) {
    const events = [];
    job.addEventListener('updated', (event) =>
        events.push({ detail: event.detail, status: job.status, progress: job.progress }),
    );
    return events;
}

// starts the job and lets it run to its end, the pauses in between included
async function run(job, directory = '') {
    const callback = vi.fn();
    job.downloadPages(directory, callback);
    await vi.runAllTimersAsync();
    return callback;
}

function mode(sequential) {
    Engine.Settings.useSequentialMediaDownloads.value = sequential;
}

const MODES = [
    ['all at once', false],
    ['one after the other', true],
];

describe('a new job', () => {
    it('should know what it downloads, and nothing has happened yet', () => {
        const chapter = createChapter();
        const job = new DownloadJob(chapter);
        expect(job.chapter).toBe(chapter);
        expect(job.labels).toEqual({ connector: 'Site', manga: 'One Piece', chapter: 'Chapter 1' });
        expect(job.status).toBeUndefined();
        expect(job.progress).toBe(0);
        expect(job.errors).toEqual([]);
        expect(typeof job.id).toBe('symbol');
    });

    it('should be a job of its own for the same chapter', () => {
        const chapter = createChapter();
        const first = new DownloadJob(chapter);
        const second = new DownloadJob(chapter);
        expect(first.id).not.toBe(second.id);
        expect(first.errors).not.toBe(second.errors);
    });

    it('should load its pages with the request options of the connector, or none', () => {
        const chapter = createChapter();
        expect(new DownloadJob(chapter).requestOptions).toBe(
            chapter.manga.connector.requestOptions,
        );
        const plain = createChapter({ connector: { requestOptions: undefined } });
        expect(new DownloadJob(plain).requestOptions).toEqual({});
    });

    it.each([
        [0, 'has no settings', undefined],
        [0, 'has settings without a throttle', { path: { value: '/x' } }],
        [500, 'asks for a pause of 500 milliseconds', { throttle: { value: 500 } }],
        [0, 'asks for no pause', { throttle: { value: 0 } }],
    ])(
        'should pause %i milliseconds between pages when the connector %s',
        (throttle, name, config) => {
            expect(new DownloadJob(createChapter({ connector: { config } })).throttle).toBe(
                throttle,
            );
        },
    );
});

describe('isSame', () => {
    it('should be the job of the same chapter object', () => {
        const chapter = createChapter();
        const job = new DownloadJob(chapter);
        expect(job.isSame(new DownloadJob(chapter))).toBe(true);
        expect(job.isSame(job)).toBe(true);
    });

    it('should not be the job of another chapter, even with the same title', () => {
        const job = new DownloadJob(createChapter());
        expect(job.isSame(new DownloadJob(createChapter()))).toBe(false);
    });
});

describe('setStatus', () => {
    it('should give the status to the chapter, refresh the manga and tell about it', () => {
        const chapter = createChapter();
        const job = new DownloadJob(chapter);
        const events = watch(job);
        job.setStatus('queued');
        expect(job.status).toBe('queued');
        expect(chapter.setStatus).toHaveBeenCalledWith('queued');
        expect(chapter.status).toBe('queued');
        expect(chapter.manga.updateStatus).toHaveBeenCalledTimes(1);
        expect(events).toHaveLength(1);
        expect(events[0].detail).toBe(job);
    });

    it('should do nothing for the status that it has', () => {
        const chapter = createChapter();
        const job = new DownloadJob(chapter);
        job.setStatus('queued');
        const events = watch(job);
        job.setStatus('queued');
        expect(chapter.setStatus).toHaveBeenCalledTimes(1);
        expect(chapter.manga.updateStatus).toHaveBeenCalledTimes(1);
        expect(events).toEqual([]);
    });

    it('should tell about every change', () => {
        const job = new DownloadJob(createChapter());
        const events = watch(job);
        for (const status of ['queued', 'downloading', 'failed', 'queued']) {
            job.setStatus(status);
        }
        expect(events.map((event) => event.status)).toEqual([
            'queued',
            'downloading',
            'failed',
            'queued',
        ]);
    });
});

describe('setProgress', () => {
    it('should keep the progress and tell about a change', () => {
        const job = new DownloadJob(createChapter());
        const events = watch(job);
        job.setProgress(25);
        job.setProgress(25);
        job.setProgress(50);
        expect(job.progress).toBe(50);
        expect(events.map((event) => event.progress)).toEqual([25, 50]);
        expect(events.every((event) => event.detail === job)).toBe(true);
    });

    it('should not touch the status of the chapter', () => {
        const chapter = createChapter();
        new DownloadJob(chapter).setProgress(10);
        expect(chapter.setStatus).not.toHaveBeenCalled();
    });
});

describe('downloadPages of a chapter that is found', () => {
    it.each(MODES)(
        'should load the pages %s, save them in their order and complete',
        async (name, sequential) => {
            mode(sequential);
            const answers = PAGES.map(() => answer());
            const fetch = stubFetch((url) => answers[PAGES.indexOf(url)]);
            const chapter = createChapter();
            const job = new DownloadJob(chapter);
            const events = watch(job);

            const callback = await run(job);

            expect(fetch.mock.calls.map((call) => call[0])).toEqual(PAGES);
            expect(Engine.Storage.saveChapterPages).toHaveBeenCalledTimes(1);
            const [savedChapter, saved] = Engine.Storage.saveChapterPages.mock.calls[0];
            expect(savedChapter).toBe(chapter);
            expect(saved).toHaveLength(3);
            saved.forEach((blob, index) => expect(blob).toBe(answers[index].body));
            expect(job.status).toBe('completed');
            expect(job.progress).toBe(100);
            expect(job.errors).toEqual([]);
            expect(chapter.status).toBe('completed');
            expect(callback).toHaveBeenCalledTimes(1);
            // downloading first, completed last, and the progress is full when the chapter is completed
            expect(events[0].status).toBe('downloading');
            expect(events.at(-1)).toMatchObject({ status: 'completed', progress: 100 });
            expect(events.every((event) => event.detail === job)).toBe(true);
        },
    );

    // the share of each page is added up, which is not exact for every number of pages (6 pages end at 100.00000000000001)
    it.each(MODES)(
        'should end at exactly 100, however many pages the chapter has, pages %s',
        async (name, sequential) => {
            mode(sequential);
            for (const count of [6, 7, 17, 30, 120]) {
                stubFetch();
                const pages = Array.from(
                    { length: count },
                    (value, index) => `https://img.test/${index}.jpg`,
                );
                const job = new DownloadJob(createChapter({ pages }));
                await run(job);
                expect(job.status, `${count} pages`).toBe('completed');
                expect(job.progress, `${count} pages`).toBe(100);
            }
        },
    );

    it('should be downloading while it asks the chapter for its pages', () => {
        const chapter = createChapter();
        let statusWhileAsking = null;
        chapter.getPages = vi.fn(() => {
            statusWhileAsking = chapter.status;
        });
        const job = new DownloadJob(chapter);
        job.downloadPages('', vi.fn());
        expect(statusWhileAsking).toBe('downloading');
        expect(job.status).toBe('downloading');
    });

    it.each(MODES)(
        'should load the pages with the request options of the connector %s',
        async (name, sequential) => {
            mode(sequential);
            const fetch = stubFetch();
            const chapter = createChapter({ pages: [PAGES[0]] });
            await run(new DownloadJob(chapter));
            const options = fetch.mock.calls[0][1];
            expect(options.method).toBe('GET');
            expect(options.headers).toBe(chapter.manga.connector.requestOptions.headers);
            expect(options.signal).toBeInstanceOf(AbortSignal);
        },
    );

    it('should bring the pages in the order of the chapter when the answers come in another order', async () => {
        const answers = PAGES.map(() => answer());
        const gates = PAGES.map(() => Promise.withResolvers());
        stubFetch(async (url) => {
            await gates[PAGES.indexOf(url)].promise;
            return answers[PAGES.indexOf(url)];
        });
        const job = new DownloadJob(createChapter());
        const callback = vi.fn();
        job.downloadPages('', callback);
        await vi.advanceTimersByTimeAsync(500);
        gates[2].resolve();
        gates[0].resolve();
        await vi.advanceTimersByTimeAsync(0);
        gates[1].resolve();
        await vi.runAllTimersAsync();
        const saved = Engine.Storage.saveChapterPages.mock.calls[0][1];
        saved.forEach((blob, index) => expect(blob).toBe(answers[index].body));
        expect(callback).toHaveBeenCalledTimes(1);
    });

    it('should report the share of the pages that are loaded', async () => {
        const gates = PAGES.map(() => Promise.withResolvers());
        stubFetch(async (url) => {
            await gates[PAGES.indexOf(url)].promise;
            return answer();
        });
        const job = new DownloadJob(createChapter());
        job.downloadPages('', vi.fn());
        await vi.advanceTimersByTimeAsync(500);
        expect(job.progress).toBe(0);
        gates[1].resolve();
        await vi.advanceTimersByTimeAsync(0);
        expect(job.progress).toBeCloseTo(100 / 3, 5);
        gates[0].resolve();
        await vi.advanceTimersByTimeAsync(0);
        expect(job.progress).toBeCloseTo(200 / 3, 5);
        gates[2].resolve();
        await vi.runAllTimersAsync();
        expect(job.progress).toBe(100);
    });

    it('should start the pages of a chapter 50 milliseconds apart when the connector asks for no pause', async () => {
        const fetch = stubFetch();
        const job = new DownloadJob(createChapter());
        job.downloadPages('', vi.fn());
        await vi.advanceTimersByTimeAsync(0);
        expect(fetch).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(49);
        expect(fetch).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(fetch).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(50);
        expect(fetch).toHaveBeenCalledTimes(3);
    });

    it('should start the pages of a chapter as far apart as the connector asks', async () => {
        const fetch = stubFetch();
        const job = new DownloadJob(
            createChapter({ connector: { config: { throttle: { value: 200 } } } }),
        );
        job.downloadPages('', vi.fn());
        await vi.advanceTimersByTimeAsync(199);
        expect(fetch).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(fetch).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(200);
        expect(fetch).toHaveBeenCalledTimes(3);
    });

    it('should not wait for a page before it asks for the next one when all pages load at once', async () => {
        const fetch = stubFetch(() => new Promise(() => undefined));
        const job = new DownloadJob(createChapter());
        job.downloadPages('', vi.fn());
        await vi.advanceTimersByTimeAsync(100);
        expect(fetch).toHaveBeenCalledTimes(3);
        expect(job.status).toBe('downloading');
    });

    it('should ask for a page only when the page before it is done when they load one after the other', async () => {
        mode(true);
        const gates = PAGES.map(() => Promise.withResolvers());
        const fetch = stubFetch(async (url) => {
            await gates[PAGES.indexOf(url)].promise;
            return answer();
        });
        const job = new DownloadJob(createChapter());
        job.downloadPages('', vi.fn());
        await vi.advanceTimersByTimeAsync(10000);
        expect(fetch).toHaveBeenCalledTimes(1);
        gates[0].resolve();
        await vi.advanceTimersByTimeAsync(10000);
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(job.progress).toBeCloseTo(100 / 3, 5);
        gates[1].resolve();
        gates[2].resolve();
        await vi.runAllTimersAsync();
        expect(fetch).toHaveBeenCalledTimes(3);
        expect(job.status).toBe('completed');
    });

    it('should pause before every page, the first one included, when they load one after the other', async () => {
        mode(true);
        const fetch = stubFetch();
        const job = new DownloadJob(
            createChapter({ connector: { config: { throttle: { value: 300 } } } }),
        );
        job.downloadPages('', vi.fn());
        await vi.advanceTimersByTimeAsync(299);
        expect(fetch).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(fetch).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(299);
        expect(fetch).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(fetch).toHaveBeenCalledTimes(2);
    });
});

describe('downloadPages that fail', () => {
    function failures() {
        return vi.spyOn(console, 'error').mockImplementation(() => undefined);
    }

    // the last page fails: pages that are still on their way after a failure add to the progress (see the BUG below)
    it.each(MODES)(
        'should fail the job when a page answers with an error status, pages %s',
        async (name, sequential) => {
            mode(sequential);
            const log = failures();
            stubFetch((url) => answer(url === PAGES[2] ? 404 : 200));
            const job = new DownloadJob(createChapter());
            const events = watch(job);

            const callback = await run(job);

            expect(job.status).toBe('failed');
            expect(job.progress).toBe(100);
            expect(job.errors).toHaveLength(1);
            expect(job.errors[0]).toBeInstanceOf(Error);
            expect(job.errors[0].message).toContain(PAGES[2]);
            expect(job.errors[0].message).toContain('404');
            expect(job.errors[0].message).toContain('Failure');
            expect(Engine.Storage.saveChapterPages).not.toHaveBeenCalled();
            expect(callback).toHaveBeenCalledTimes(1);
            expect(log).toHaveBeenCalledWith(job.errors[0], PAGES);
            expect(events.at(-1)).toMatchObject({ status: 'failed', progress: 100 });
            expect(events.map((event) => event.status)).not.toContain('completed');
        },
    );

    // only the status 200 is a page, everything else is the answer of a server that has no page to give
    describe.each(MODES)('with the pages loaded %s', (name, sequential) => {
        it.each([204, 206, 304, 403, 404, 410, 429, 500, 503])(
            'should fail the job for the status %i of a page',
            async (status) => {
                mode(sequential);
                failures();
                stubFetch(() => answer(status));
                const job = new DownloadJob(createChapter({ pages: [PAGES[0]] }));
                await run(job);
                expect(job.status).toBe('failed');
                expect(job.errors[0].message).toContain(`${status}`);
            },
        );
    });

    it.each(MODES)(
        'should load the pages in spite of their status when the errors are to be ignored, pages %s',
        async (name, sequential) => {
            mode(sequential);
            Engine.Settings.ignoreErrorOnDownload.value = true;
            const answers = PAGES.map((page, index) => answer(index === 1 ? 500 : 200));
            stubFetch((url) => answers[PAGES.indexOf(url)]);
            const job = new DownloadJob(createChapter());

            const callback = await run(job);

            expect(job.status).toBe('completed');
            expect(job.errors).toEqual([]);
            const saved = Engine.Storage.saveChapterPages.mock.calls[0][1];
            expect(saved.map((blob) => blob.size)).toEqual(answers.map((item) => item.body.size));
            expect(callback).toHaveBeenCalledTimes(1);
        },
    );

    it.each(MODES)(
        'should fail the job when a request fails, pages %s',
        async (name, sequential) => {
            mode(sequential);
            failures();
            stubFetch(() => {
                throw new TypeError('Failed to fetch');
            });
            const job = new DownloadJob(createChapter());
            const callback = await run(job);
            expect(job.status).toBe('failed');
            expect(job.errors).toHaveLength(1);
            expect(job.errors[0].message).toBe('Failed to fetch');
            expect(callback).toHaveBeenCalledTimes(1);
        },
    );

    it('should fail the job when the body of a page cannot be read', async () => {
        failures();
        stubFetch(() => ({
            status: 200,
            statusText: 'OK',
            blob: async () => Promise.reject(new Error('stream broke')),
        }));
        const job = new DownloadJob(createChapter({ pages: [PAGES[0]] }));
        const callback = await run(job);
        expect(job.status).toBe('failed');
        expect(job.errors[0].message).toBe('stream broke');
        expect(callback).toHaveBeenCalledTimes(1);
    });

    it.each(MODES)(
        'should fail the job when the storage cannot save the chapter, pages %s',
        async (name, sequential) => {
            mode(sequential);
            const log = failures();
            stubFetch();
            const failure = new Error('ENOSPC: no space left on device');
            Engine.Storage.saveChapterPages.mockRejectedValue(failure);
            const job = new DownloadJob(createChapter());
            const callback = await run(job);
            expect(job.errors).toEqual([failure]);
            expect(job.status).toBe('failed');
            expect(job.progress).toBe(100);
            expect(log).toHaveBeenCalledWith(failure, PAGES);
            expect(callback).toHaveBeenCalledTimes(1);
        },
    );

    it('should fail the job when the storage throws instead of rejecting', async () => {
        failures();
        stubFetch();
        const failure = new Error('Unsupported output format: .zip');
        Engine.Storage.saveChapterPages.mockImplementation(() => {
            throw failure;
        });
        const job = new DownloadJob(createChapter());
        const callback = await run(job);
        expect(job.errors).toEqual([failure]);
        expect(job.status).toBe('failed');
        expect(callback).toHaveBeenCalledTimes(1);
    });

    it.each(MODES)(
        'should not wait for ever for a page that does not answer, pages %s',
        async (name, sequential) => {
            mode(sequential);
            failures();
            const stalled = new Error('The operation was aborted due to timeout');
            stubFetch(
                (url, options) =>
                    new Promise((resolve, reject) => {
                        options.signal.addEventListener('abort', () => reject(stalled));
                    }),
            );
            const job = new DownloadJob(createChapter({ pages: [PAGES[0]] }));
            const callback = vi.fn();
            job.downloadPages('', callback);
            await vi.advanceTimersByTimeAsync(1000);
            expect(callback).not.toHaveBeenCalled();

            // the signal of the request is the timeout of two minutes
            expect(timeouts).toHaveLength(1);
            expect(timeouts[0].delay).toBeGreaterThan(0);
            expect(timeouts[0].delay).toBeLessThanOrEqual(10 * 60 * 1000);
            timeouts[0].controller.abort();
            await vi.runAllTimersAsync();

            expect(job.status).toBe('failed');
            expect(job.errors).toEqual([stalled]);
            expect(callback).toHaveBeenCalledTimes(1);
        },
    );

    it('should fail the job with the error of the chapter when it cannot name its pages', async () => {
        const chapter = createChapter();
        const failure = new Error('login required');
        chapter.getPages = vi.fn((callback) => callback(failure, undefined));
        const fetch = stubFetch();
        const job = new DownloadJob(chapter);
        const events = watch(job);
        const callback = vi.fn();

        job.downloadPages('', callback);

        expect(job.errors).toEqual([failure]);
        expect(job.status).toBe('failed');
        expect(job.progress).toBe(100);
        expect(chapter.status).toBe('failed');
        expect(events[0].status).toBe('downloading');
        expect(events.at(-1)).toMatchObject({ status: 'failed', progress: 100 });
        expect(fetch).not.toHaveBeenCalled();
        expect(Engine.Storage.saveChapterPages).not.toHaveBeenCalled();
        expect(callback).toHaveBeenCalledTimes(1);
    });

    it('should fail the job when the chapter answers with pages and an error', () => {
        const chapter = createChapter();
        const failure = new Error('partial');
        chapter.getPages = vi.fn((callback) => callback(failure, PAGES));
        const job = new DownloadJob(chapter);
        const callback = vi.fn();
        job.downloadPages('', callback);
        expect(job.errors).toEqual([failure]);
        expect(job.status).toBe('failed');
        expect(callback).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['nothing', undefined],
        ['null', null],
        ['an empty string', ''],
        ['a text', 'https://img.test/1.jpg'],
        ['an object', { 0: PAGES[0], length: 1 }],
    ])(
        'should fail the job with an error about the page list when the chapter answers %s',
        (name, pages) => {
            const chapter = createChapter();
            chapter.getPages = vi.fn((callback) => callback(null, pages));
            const fetch = stubFetch();
            const job = new DownloadJob(chapter);
            const callback = vi.fn();
            job.downloadPages('', callback);
            expect(job.errors).toHaveLength(1);
            expect(job.errors[0].message).toBe('Page list is empty');
            expect(job.status).toBe('failed');
            expect(job.progress).toBe(100);
            expect(fetch).not.toHaveBeenCalled();
            expect(callback).toHaveBeenCalledTimes(1);
        },
    );

    it('should fail the job when the chapter has no pages', async () => {
        failures();
        stubFetch();
        const job = new DownloadJob(createChapter({ pages: [] }));
        await run(job);
        expect(job.status).toBe('failed');
        expect(job.errors.map((error) => error.message)).toEqual(['Page list is empty']);
        expect(Engine.Storage.saveChapterPages).not.toHaveBeenCalled();
    });

    it('should call back when the chapter answers only later', async () => {
        const chapter = createChapter();
        let answerLater = null;
        chapter.getPages = vi.fn((callback) => {
            answerLater = callback;
        });
        stubFetch();
        const job = new DownloadJob(chapter);
        const callback = vi.fn();
        job.downloadPages('', callback);
        await vi.advanceTimersByTimeAsync(10000);
        expect(job.status).toBe('downloading');
        expect(callback).not.toHaveBeenCalled();
        answerLater(null, [PAGES[0]]);
        await vi.runAllTimersAsync();
        expect(job.status).toBe('completed');
        expect(callback).toHaveBeenCalledTimes(1);
    });
});

describe('the pages of a chapter that already failed', () => {
    // the pages are loaded all at once, so the other pages are on their way when one of them fails: the code has a TODO for it
    function failFirstPage() {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        return stubFetch((url) => answer(url === PAGES[0] ? 404 : 200));
    }

    it('should not report progress for a job that failed', async () => {
        failFirstPage();
        const job = new DownloadJob(createChapter());
        const events = watch(job);
        job.downloadPages('', vi.fn());
        await vi.advanceTimersByTimeAsync(0);
        expect(job.status).toBe('failed');
        const count = events.length;

        await vi.advanceTimersByTimeAsync(1000);

        expect(job.progress).toBeLessThanOrEqual(100);
        expect(events).toHaveLength(count);
    });

    it('should not request the pages that are left once a page failed', async () => {
        const fetch = failFirstPage();
        const job = new DownloadJob(createChapter());
        job.downloadPages('', vi.fn());
        await vi.advanceTimersByTimeAsync(0);
        expect(job.status).toBe('failed');
        await vi.advanceTimersByTimeAsync(1000);
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('should call back once, even though several pages fail', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        stubFetch(() => answer(500));
        const job = new DownloadJob(createChapter());
        const callback = await run(job);
        expect(callback).toHaveBeenCalledTimes(1);
        expect(job.errors).toHaveLength(1);
    });
});

describe('canceling a job', () => {
    // a request that is answered when the test says so, and ends with the error of an abort when its signal is aborted
    function controlledFetch() {
        const requests = [];
        const fetch = vi.fn(
            (url, options) =>
                new Promise((resolve, reject) => {
                    options.signal.addEventListener('abort', () => reject(options.signal.reason), {
                        once: true,
                    });
                    requests.push({ url, signal: options.signal, answer: () => resolve(answer()) });
                }),
        );
        vi.stubGlobal('fetch', fetch);
        return { fetch, requests };
    }

    function queued(chapter = createChapter()) {
        const job = new DownloadJob(chapter);
        job.setStatus('queued');
        return job;
    }

    it('should stop a job that waits: it is canceled, nobody asks for its pages, and the chapter is available again', () => {
        const chapter = createChapter();
        const job = queued(chapter);
        expect(chapter.status).toBe('queued');
        const events = watch(job);
        expect(job.cancel()).toBe(true);
        expect(job.status).toBe('canceled');
        expect(chapter.status).toBe('available');
        expect(chapter.manga.updateStatus).toHaveBeenCalled();
        expect(events.map((event) => event.status)).toEqual(['canceled']);
        expect(chapter.getPages).not.toHaveBeenCalled();
    });

    it('should give back a chapter whose file is on the device (a download that was asked for again) as downloaded', () => {
        const chapter = createChapter();
        chapter.manga.isChapterFileExisting.mockReturnValue(true);
        const job = queued(chapter);
        job.cancel();
        expect(chapter.manga.isChapterFileExisting).toHaveBeenCalledWith(chapter);
        expect(chapter.status).toBe('completed');
    });

    it.each(MODES)(
        'should stop a job that loads its pages %s: the other pages are not asked for, nothing is written, and it is no failure',
        async (name, sequential) => {
            mode(sequential);
            const { fetch, requests } = controlledFetch();
            const job = new DownloadJob(createChapter());
            const events = watch(job);
            const callback = vi.fn();
            job.downloadPages('', callback);
            await vi.advanceTimersByTimeAsync(0);
            expect(fetch).toHaveBeenCalledTimes(1);
            expect(job.status).toBe('downloading');

            expect(job.cancel()).toBe(true);
            expect(requests[0].signal.aborted).toBe(true);
            const count = events.length;
            await vi.advanceTimersByTimeAsync(10000);

            expect(job.status).toBe('canceled');
            expect(job.errors).toEqual([]);
            expect(fetch).toHaveBeenCalledTimes(1);
            expect(Engine.Storage.saveChapterPages).not.toHaveBeenCalled();
            // nobody is told anything after the cancellation, the progress included
            expect(events).toHaveLength(count);
            expect(events[events.length - 1].status).toBe('canceled');
            expect(job.chapter.status).toBe('available');
            // the manager has its place back, once
            expect(callback).toHaveBeenCalledTimes(1);
        },
    );

    it('should stop requests that are on their way, the ones that were answered already included', async () => {
        const { fetch, requests } = controlledFetch();
        const job = new DownloadJob(createChapter());
        const callback = vi.fn();
        job.downloadPages('', callback);
        await vi.advanceTimersByTimeAsync(100);
        expect(fetch).toHaveBeenCalledTimes(3);
        requests[0].answer();
        await vi.advanceTimersByTimeAsync(0);
        expect(job.progress).toBeGreaterThan(0);
        const progress = job.progress;
        job.cancel();
        expect(requests.map((request) => request.signal.aborted)).toEqual([true, true, true]);
        await vi.advanceTimersByTimeAsync(1000);
        expect(job.progress).toBe(progress);
        expect(job.errors).toEqual([]);
    });

    it('should stop a job while the connector still collects the pages: the pages that arrive later are not downloaded', async () => {
        const chapter = createChapter();
        let answerLater = null;
        chapter.getPages = vi.fn((callback) => {
            answerLater = callback;
        });
        const fetch = stubFetch();
        const job = new DownloadJob(chapter);
        const callback = vi.fn();
        job.downloadPages('', callback);
        expect(job.cancel()).toBe(true);
        expect(callback).toHaveBeenCalledTimes(1);

        answerLater(null, PAGES);
        await vi.runAllTimersAsync();

        expect(fetch).not.toHaveBeenCalled();
        expect(job.status).toBe('canceled');
        expect(job.errors).toEqual([]);
        expect(Engine.Storage.saveChapterPages).not.toHaveBeenCalled();
        expect(callback).toHaveBeenCalledTimes(1);
    });

    it('should stop a job whose connector fails after the cancellation without calling it a failure', async () => {
        const chapter = createChapter();
        let answerLater = null;
        chapter.getPages = vi.fn((callback) => {
            answerLater = callback;
        });
        const job = new DownloadJob(chapter);
        const callback = vi.fn();
        job.downloadPages('', callback);
        job.cancel();
        answerLater(new Error('site is down'), undefined);
        await vi.runAllTimersAsync();
        expect(job.status).toBe('canceled');
        expect(job.errors).toEqual([]);
        expect(callback).toHaveBeenCalledTimes(1);
    });

    it('should write nothing when it is canceled while the last page arrives', async () => {
        const job = new DownloadJob(createChapter({ pages: [PAGES[0]] }));
        stubFetch(() => {
            const response = answer();
            response.blob = vi.fn(async () => {
                job.cancel();
                return new Blob(['page']);
            });
            return response;
        });
        const callback = vi.fn();
        job.downloadPages('', callback);
        await vi.runAllTimersAsync();
        expect(job.status).toBe('canceled');
        expect(Engine.Storage.saveChapterPages).not.toHaveBeenCalled();
        expect(callback).toHaveBeenCalledTimes(1);
    });

    it('should be too late once the pages are written: the job goes on and completes', async () => {
        let finishSaving = null;
        Engine.Storage.saveChapterPages = vi.fn(
            () =>
                new Promise((resolve) => {
                    finishSaving = resolve;
                }),
        );
        stubFetch();
        const job = new DownloadJob(createChapter({ pages: [PAGES[0]] }));
        const callback = vi.fn();
        job.downloadPages('', callback);
        await vi.advanceTimersByTimeAsync(100);
        expect(Engine.Storage.saveChapterPages).toHaveBeenCalledTimes(1);

        expect(job.cancel()).toBe(false);
        expect(job.status).toBe('downloading');
        finishSaving();
        await vi.runAllTimersAsync();
        expect(job.status).toBe('completed');
        expect(callback).toHaveBeenCalledTimes(1);
    });

    it('should leave a job alone that is over: completed or failed', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        stubFetch();
        const completed = new DownloadJob(createChapter());
        await run(completed);
        expect(completed.cancel()).toBe(false);
        expect(completed.status).toBe('completed');
        stubFetch(() => answer(500));
        const failed = new DownloadJob(createChapter());
        await run(failed);
        expect(failed.cancel()).toBe(false);
        expect(failed.status).toBe('failed');
    });

    it('should have nothing to stop in a job that was never queued or started, or that was stopped already', () => {
        const fresh = new DownloadJob(createChapter());
        expect(fresh.cancel()).toBe(false);
        expect(fresh.status).toBeUndefined();
        const job = queued();
        expect(job.cancel()).toBe(true);
        expect(job.cancel()).toBe(false);
    });
});
