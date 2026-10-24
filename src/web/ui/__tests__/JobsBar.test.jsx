import { act, fireEvent, screen, within } from '@testing-library/react';
import JobsBar from '../jobs.jsx';
import {
    addChapter,
    addManga,
    createConnector,
    createDownloadJob,
    installEngine,
} from './support/fakeEngine.js';
import { renderWithProviders } from './support/render.jsx';

let engine = null;
let site = null;
let manga = null;

function job(title, fields = {}) {
    return createDownloadJob(addChapter(manga, { title }), fields);
}

function queued(...jobs) {
    engine.DownloadManager.queue[site.id] = jobs;
    return jobs;
}

function openList() {
    fireEvent.click(screen.getByTitle('Toggle download list'));
}

beforeEach(() => {
    site = createConnector({ id: 'site', label: 'Site' });
    manga = addManga(site, { title: 'Berserk' });
    engine = installEngine({ connectors: [site] });
});

describe('download bar', () => {
    it('should count the downloads, and keep the list closed until it is asked for', () => {
        queued(job('Chapter 1', { status: 'downloading' }), job('Chapter 2', { status: 'queued' }));
        renderWithProviders(<JobsBar />, { selection: false });
        expect(screen.getByText('2 Download(s)')).toBeTruthy();
        expect(screen.queryByText('Chapter 1')).toBeNull();
    });

    it('should open and close the list with its button', () => {
        queued(job('Chapter 1', { status: 'downloading' }));
        renderWithProviders(<JobsBar />, { selection: false });
        openList();
        expect(screen.getByText('Chapter 1')).toBeTruthy();
        openList();
        expect(screen.queryByText('Chapter 1')).toBeNull();
    });

    it('should say that there are no downloads when the list is opened without any', () => {
        renderWithProviders(<JobsBar />, { selection: false });
        expect(screen.getByText('0 Download(s)')).toBeTruthy();
        openList();
        expect(screen.getByText('No downloads.')).toBeTruthy();
    });

    it('should show the website, manga and chapter of each job, and the progress of it', () => {
        queued(job('Chapter 1', { status: 'downloading', progress: 30 }));
        const { container } = renderWithProviders(<JobsBar />, { selection: false });
        openList();
        const cells = [...container.querySelectorAll('tbody tr td')].map(
            (cell) => cell.textContent,
        );
        expect(cells.slice(1, 4)).toEqual(['Site', 'Berserk', 'Chapter 1']);
        expect(container.querySelector('tbody tr').getAttribute('title')).toBe(
            'Site\nBerserk\nChapter 1',
        );
        const progress = container.querySelector('tbody tr td:nth-child(5)');
        expect(progress.textContent).toBe('30%');
        expect(progress.querySelector('[aria-hidden] > span').style.width).toBe('30%');
    });

    it('should show the errors of a job in the tooltip of its button, with the hint to download again', () => {
        queued(
            job('Chapter 1', {
                status: 'failed',
                errors: [new Error('HTTP 404'), new Error('timeout')],
            }),
        );
        renderWithProviders(<JobsBar />, { selection: false });
        openList();
        // not `getByTitle`: it folds the line breaks of the text into spaces
        expect(document.querySelector('tbody tr td:first-child button').getAttribute('title')).toBe(
            'Click to re-download\nError: HTTP 404\nError: timeout',
        );
    });

    it.each([
        ['queued', 'Queued'],
        ['downloading', 'Downloading'],
    ])(
        'should show the status of a job that is %s as an icon, and not as a button to download again',
        (status, name) => {
            queued(job('Chapter 1', { status }));
            renderWithProviders(<JobsBar />, { selection: false });
            openList();
            const cell = document.querySelector('tbody tr td:first-child');
            expect(cell.querySelector('button')).toBeNull();
            expect(within(cell).getByRole('img', { name })).toBeTruthy();
        },
    );

    it.each(['failed', 'completed'])(
        'should download a %s job again when its button is clicked',
        (status) => {
            const [done] = queued(job('Chapter 1', { status }));
            renderWithProviders(<JobsBar />, { selection: false });
            openList();
            fireEvent.click(document.querySelector('tbody tr td:first-child button'));
            expect(engine.DownloadManager.addDownload).toHaveBeenCalledExactlyOnceWith(
                done.chapter,
            );
        },
    );

    it('should offer no button to a job that is still running', () => {
        queued(job('Chapter 1', { status: 'downloading' }), job('Chapter 2', { status: 'queued' }));
        renderWithProviders(<JobsBar />, { selection: false });
        openList();
        expect(document.querySelectorAll('tbody tr td:first-child button')).toHaveLength(0);
        expect(engine.DownloadManager.addDownload).not.toHaveBeenCalled();
    });

    it('should report that a job could not be started again', () => {
        queued(job('Chapter 1', { status: 'failed' }));
        engine.DownloadManager.addDownload.mockImplementationOnce(() => {
            throw new Error('queue is locked');
        });
        renderWithProviders(<JobsBar />, { selection: false });
        openList();
        fireEvent.click(document.querySelector('tbody tr td:first-child button'));
        expect(screen.getByText('Restart failed: queue is locked')).toBeTruthy();
    });

    it('should draw no button for a status that it does not know', () => {
        queued(job('Chapter 1', { status: 'paused' }));
        renderWithProviders(<JobsBar />, { selection: false });
        openList();
        expect(screen.getByText('Chapter 1')).toBeTruthy();
        expect(document.querySelector('tbody tr td:first-child button')).toBeNull();
    });

    it('should follow the manager: new jobs are counted, completed ones are not', () => {
        const [running] = queued(job('Chapter 1', { status: 'downloading' }));
        renderWithProviders(<JobsBar />, { selection: false });
        const next = job('Chapter 2', { status: 'queued' });
        act(() => engine.DownloadManager.emit('updated', next));
        expect(screen.getByText('2 Download(s)')).toBeTruthy();
        running.status = 'completed';
        act(() => engine.DownloadManager.emit('updated', running));
        expect(screen.getByText('1 Download(s)')).toBeTruthy();
    });

    it('should replace a failed job by the one that retries the same chapter', () => {
        const [failed] = queued(job('Chapter 1', { status: 'failed' }));
        renderWithProviders(<JobsBar />, { selection: false });
        const retry = createDownloadJob(failed.chapter, { status: 'queued' });
        act(() => engine.DownloadManager.emit('updated', retry));
        expect(screen.getByText('1 Download(s)')).toBeTruthy();
        openList();
        expect(document.querySelectorAll('tbody tr')).toHaveLength(1);
    });
});

describe('canceling downloads', () => {
    const cancelButtons = () => [...document.querySelectorAll('tbody tr td:last-child button')];
    const cancelAllButton = () => screen.getByTitle('Cancel all downloads');
    const toast = (text) => screen.getByText(text).closest('.pointer-events-auto');
    // the question that is asked before all the downloads are stopped
    const question = () => within(screen.getByText('Cancel all downloads?').closest('.fixed'));

    it('should offer to cancel the jobs that wait or run, and no others', () => {
        queued(
            job('Chapter 1', { status: 'downloading' }),
            job('Chapter 2', { status: 'queued' }),
            job('Chapter 3', { status: 'failed' }),
            job('Chapter 4', { status: 'completed' }),
            job('Chapter 5', { status: 'paused' }),
        );
        renderWithProviders(<JobsBar />, { selection: false });
        openList();
        const offered = [...document.querySelectorAll('tbody tr')].map(
            (row) => row.querySelector('td:last-child button') !== null,
        );
        expect(offered).toEqual([true, true, false, false, false]);
        expect(cancelButtons()[0].getAttribute('title')).toBe('Cancel this download');
    });

    it('should cancel the job of its row, and only that one', () => {
        const [first, second] = queued(
            job('Chapter 1', { status: 'downloading' }),
            job('Chapter 2', { status: 'queued' }),
        );
        renderWithProviders(<JobsBar />, { selection: false });
        openList();
        fireEvent.click(cancelButtons()[1]);
        expect(engine.DownloadManager.cancel).toHaveBeenCalledExactlyOnceWith(second);
        expect(toast('Canceled "Chapter 2".').className).toMatch(/green/);
        expect(first.status).toBe('downloading');
        expect(screen.getByText('1 Download(s)')).toBeTruthy();
        expect(screen.queryByText('Chapter 2')).toBeNull();
        expect(screen.getByText('Chapter 1')).toBeTruthy();
    });

    it('should not ask anything before a single download is canceled', () => {
        queued(job('Chapter 1', { status: 'queued' }));
        renderWithProviders(<JobsBar />, { selection: false });
        openList();
        fireEvent.click(cancelButtons()[0]);
        expect(screen.queryByText('Cancel all downloads?')).toBeNull();
        expect(engine.DownloadManager.cancel).toHaveBeenCalledTimes(1);
    });

    it('should say so when the download cannot be stopped any more, and keep it in the list', () => {
        const [writing] = queued(job('Chapter 1', { status: 'downloading' }));
        engine.DownloadManager.cancel.mockReturnValueOnce(false);
        renderWithProviders(<JobsBar />, { selection: false });
        openList();
        fireEvent.click(cancelButtons()[0]);
        expect(toast('"Chapter 1" cannot be canceled any more.').className).not.toMatch(
            /red|green/,
        );
        expect(writing.status).toBe('downloading');
        expect(screen.getByText('1 Download(s)')).toBeTruthy();
    });

    it('should report a download that could not be canceled', () => {
        queued(job('Chapter 1', { status: 'queued' }));
        engine.DownloadManager.cancel.mockImplementationOnce(() => {
            throw new Error('no manager');
        });
        renderWithProviders(<JobsBar />, { selection: false });
        openList();
        fireEvent.click(cancelButtons()[0]);
        expect(toast('Cancel failed: no manager').className).toMatch(/red/);
        expect(screen.getByText('1 Download(s)')).toBeTruthy();
    });

    it.each([
        ['there are no downloads', []],
        ['only downloads that are over are left', [{ status: 'failed' }, { status: 'completed' }]],
    ])('should not offer to cancel all when %s', (_, fields) => {
        queued(...fields.map((entry, index) => job(`Chapter ${index + 1}`, entry)));
        renderWithProviders(<JobsBar />, { selection: false });
        expect(cancelAllButton().disabled).toBe(true);
        fireEvent.click(cancelAllButton());
        expect(screen.queryByText('Cancel all downloads?')).toBeNull();
    });

    it('should ask before it cancels all, and count only the downloads that it will stop', () => {
        queued(
            job('Chapter 1', { status: 'downloading' }),
            job('Chapter 2', { status: 'queued' }),
            job('Chapter 3', { status: 'failed' }),
        );
        renderWithProviders(<JobsBar />, { selection: false });
        expect(cancelAllButton().disabled).toBe(false);
        fireEvent.click(cancelAllButton());
        expect(screen.getByText('2 download(s) that wait or run will be stopped.')).toBeTruthy();
        expect(engine.DownloadManager.cancelAll).not.toHaveBeenCalled();
    });

    it('should cancel all the downloads that wait or run when that is confirmed, and leave the ones that are over', () => {
        const [running, waiting, failed] = queued(
            job('Chapter 1', { status: 'downloading' }),
            job('Chapter 2', { status: 'queued' }),
            job('Chapter 3', { status: 'failed' }),
        );
        renderWithProviders(<JobsBar />, { selection: false });
        fireEvent.click(cancelAllButton());
        fireEvent.click(question().getByRole('button', { name: 'Cancel downloads' }));
        expect(engine.DownloadManager.cancelAll).toHaveBeenCalledTimes(1);
        expect(toast('Canceled 2 download(s).').className).toMatch(/green/);
        expect(screen.queryByText('Cancel all downloads?')).toBeNull();
        expect([running.status, waiting.status, failed.status]).toEqual([
            'canceled',
            'canceled',
            'failed',
        ]);
        // only the failed job is left, and there is nothing more to cancel
        expect(screen.getByText('1 Download(s)')).toBeTruthy();
        expect(cancelAllButton().disabled).toBe(true);
    });

    it('should keep every download when the question is declined', () => {
        const jobs = queued(
            job('Chapter 1', { status: 'downloading' }),
            job('Chapter 2', { status: 'queued' }),
        );
        renderWithProviders(<JobsBar />, { selection: false });
        fireEvent.click(cancelAllButton());
        fireEvent.click(question().getByRole('button', { name: 'Keep them' }));
        expect(screen.queryByText('Cancel all downloads?')).toBeNull();
        expect(engine.DownloadManager.cancelAll).not.toHaveBeenCalled();
        expect(jobs.map((entry) => entry.status)).toEqual(['downloading', 'queued']);
        expect(screen.getByText('2 Download(s)')).toBeTruthy();
    });

    it('should say so when the downloads were over before they could be canceled', () => {
        queued(job('Chapter 1', { status: 'downloading' }));
        engine.DownloadManager.cancelAll.mockReturnValueOnce(0);
        renderWithProviders(<JobsBar />, { selection: false });
        fireEvent.click(cancelAllButton());
        fireEvent.click(question().getByRole('button', { name: 'Cancel downloads' }));
        expect(toast('No download was left to cancel.').className).not.toMatch(/red|green/);
    });

    it('should report that the downloads could not be canceled', () => {
        queued(job('Chapter 1', { status: 'downloading' }));
        engine.DownloadManager.cancelAll.mockImplementationOnce(() => {
            throw new Error('no manager');
        });
        renderWithProviders(<JobsBar />, { selection: false });
        fireEvent.click(cancelAllButton());
        fireEvent.click(question().getByRole('button', { name: 'Cancel downloads' }));
        expect(toast('Cancel failed: no manager').className).toMatch(/red/);
        expect(screen.queryByText('Cancel all downloads?')).toBeNull();
    });

    it('should drop a download as soon as the engine cancels it, whoever asked for it, and follow the buttons with it', () => {
        const [running, waiting] = queued(
            job('Chapter 1', { status: 'downloading' }),
            job('Chapter 2', { status: 'queued' }),
        );
        renderWithProviders(<JobsBar />, { selection: false });
        waiting.status = 'canceled';
        act(() => engine.DownloadManager.emit('updated', waiting));
        expect(screen.getByText('1 Download(s)')).toBeTruthy();
        expect(cancelAllButton().disabled).toBe(false);
        running.status = 'completed';
        act(() => engine.DownloadManager.emit('updated', running));
        expect(screen.getByText('0 Download(s)')).toBeTruthy();
        expect(cancelAllButton().disabled).toBe(true);
    });

    it('should stop offering to cancel a job that failed in the meantime', () => {
        const [running] = queued(job('Chapter 1', { status: 'downloading' }));
        renderWithProviders(<JobsBar />, { selection: false });
        openList();
        expect(cancelButtons()).toHaveLength(1);
        running.status = 'failed';
        act(() => engine.DownloadManager.emit('updated', running));
        expect(cancelButtons()).toHaveLength(0);
        expect(cancelAllButton().disabled).toBe(true);
    });

    it('should list a chapter again when it is queued again after its download was canceled', () => {
        const [only] = queued(job('Chapter 1', { status: 'queued' }));
        renderWithProviders(<JobsBar />, { selection: false });
        openList();
        fireEvent.click(cancelButtons()[0]);
        expect(screen.getByText('0 Download(s)')).toBeTruthy();
        act(() => engine.DownloadManager.addDownload(only.chapter));
        expect(screen.getByText('1 Download(s)')).toBeTruthy();
        expect(screen.getByText('Chapter 1')).toBeTruthy();
    });
});

describe('download bar for the keyboard and the screen reader', () => {
    it('should say on its toggle whether the list is open, and which element it opens', () => {
        queued(job('Chapter 1', { status: 'downloading' }));
        renderWithProviders(<JobsBar />, { selection: false });
        const toggle = screen.getByRole('button', { name: 'Show the download list' });
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        expect(toggle.getAttribute('aria-controls')).toBeNull();
        fireEvent.click(toggle);
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
        expect(screen.getByRole('button', { name: 'Hide the download list' })).toBe(toggle);
        expect(
            document.getElementById(toggle.getAttribute('aria-controls')).querySelector('table'),
        ).not.toBeNull();
    });

    it('should name the status, the progress and the cancel button of a job', () => {
        queued(
            job('Chapter 1', { status: 'failed', progress: 30, errors: [new Error('HTTP 404')] }),
            job('Chapter 2', { status: 'downloading', progress: 55.4 }),
        );
        renderWithProviders(<JobsBar />, { selection: false });
        openList();
        expect(
            screen.getByRole('button', { name: 'Failed (Error: HTTP 404): download again' }),
        ).toBeTruthy();
        expect(screen.getByRole('img', { name: 'Downloading' })).toBeTruthy();
        expect(
            [...document.querySelectorAll('tbody tr td:nth-child(5)')].map(
                (cell) => cell.textContent,
            ),
        ).toEqual(['30%', '55%']);
        expect(screen.getByRole('button', { name: 'Cancel the download of Chapter 2' }).title).toBe(
            'Cancel this download',
        );
    });

    it('should be a landmark with a counter that a screen reader follows', () => {
        queued(job('Chapter 1', { status: 'queued' }));
        renderWithProviders(<JobsBar />, { selection: false });
        expect(screen.getByRole('region', { name: 'Downloads' })).toBeTruthy();
        expect(screen.getByRole('status').textContent).toBe('1 Download(s)');
        expect(screen.getByRole('button', { name: 'Cancel all downloads' })).toBeTruthy();
    });
});
