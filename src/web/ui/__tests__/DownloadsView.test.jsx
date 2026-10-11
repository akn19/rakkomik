import { act, fireEvent, screen, within } from '@testing-library/react';
import { subscribeDownloads } from '../engine.js';
import DownloadsView from '../views/Downloads.jsx';
import { addChapter, addManga, createConnector, createDownloadJob, installEngine } from './support/fakeEngine.js';
import { renderWithProviders } from './support/render.jsx';

let engine = null;
let site = null;
let manga = null;

function job(title, fields = {}) {
    const chapter = addChapter(manga, { title });
    return createDownloadJob(chapter, fields);
}

// puts jobs into the queue of the manager, where the view reads them from
function queued(...jobs) {
    engine.DownloadManager.queue[site.id] = jobs;
    return jobs;
}

function question() {
    return within(screen.getByText('Download again?').closest('.fixed'));
}

beforeEach(() => {
    site = createConnector({ id: 'site', label: 'Site' });
    manga = addManga(site, { title: 'Berserk' });
    engine = installEngine({ connectors: [site] });
});

describe('downloads view', () => {
    it('should say that the queue is empty, and count nothing', () => {
        renderWithProviders(<DownloadsView />, { selection: false });
        expect(screen.getByText('0 Download(s)')).toBeTruthy();
        expect(screen.getByText(/The queue is empty/)).toBeTruthy();
    });

    it('should show each job with its manga, chapter, website, status and progress', () => {
        queued(job('Chapter 1', { status: 'downloading', progress: 42.4 }), job('Chapter 2', { status: 'queued' }));
        renderWithProviders(<DownloadsView />, { selection: false });
        expect(screen.getByText('2 Download(s)')).toBeTruthy();
        expect(screen.queryByText(/The queue is empty/)).toBeNull();
        expect(screen.getByText('Chapter 1 — Site')).toBeTruthy();
        expect(screen.getByText('Chapter 2 — Site')).toBeTruthy();
        expect(screen.getAllByText('Berserk')).toHaveLength(2);
        expect(screen.getByText('Downloading')).toBeTruthy();
        expect(screen.getByText('Queued')).toBeTruthy();
        expect(screen.getByText('42%')).toBeTruthy();
        expect(screen.getByText('0%')).toBeTruthy();
    });

    it.each([[-20, '0%'], [150, '100%'], [undefined, '0%']])('should keep the bar of a progress of %s inside its track', (progress, width) => {
        queued(job('Chapter 1', { status: 'downloading', progress }));
        const { container } = renderWithProviders(<DownloadsView />, { selection: false });
        expect(container.querySelector('.bg-sky-500').style.width).toBe(width);
    });

    it('should show a status that it does not know as it is', () => {
        queued(job('Chapter 1', { status: 'paused' }));
        renderWithProviders(<DownloadsView />, { selection: false });
        expect(screen.getByRole('button', { name: 'paused' })).toBeTruthy();
    });

    it('should show why a job failed, and only then', () => {
        queued(
            job('Chapter 1', { status: 'failed', errors: [new Error('HTTP 404'), 'timeout'] }),
            job('Chapter 2', { status: 'downloading', errors: [new Error('retrying')] })
        );
        renderWithProviders(<DownloadsView />, { selection: false });
        const text = document.querySelector('.whitespace-pre-line');
        expect(text.textContent).toBe('HTTP 404\ntimeout');
        expect(document.querySelectorAll('.whitespace-pre-line')).toHaveLength(1);
    });

    it('should not ask anything when a job that is still running is clicked', () => {
        queued(job('Chapter 1', { status: 'downloading' }), job('Chapter 2', { status: 'queued' }));
        renderWithProviders(<DownloadsView />, { selection: false });
        fireEvent.click(screen.getByRole('button', { name: 'Downloading' }));
        fireEvent.click(screen.getByRole('button', { name: 'Queued' }));
        expect(screen.queryByText('Download again?')).toBeNull();
        expect(engine.DownloadManager.addDownload).not.toHaveBeenCalled();
    });

    it.each(['failed', 'completed'])('should ask before a %s job is downloaded again, and queue it when that is confirmed', status => {
        const [done] = queued(job('Chapter 1', { status }));
        renderWithProviders(<DownloadsView />, { selection: false });
        fireEvent.click(screen.getByRole('button', { name: status === 'failed' ? 'Failed' : 'Completed' }));
        expect(screen.getByText('"Chapter 1" will be queued again.')).toBeTruthy();
        expect(engine.DownloadManager.addDownload).not.toHaveBeenCalled();
        fireEvent.click(question().getByRole('button', { name: 'Download' }));
        expect(engine.DownloadManager.addDownload).toHaveBeenCalledExactlyOnceWith(done.chapter);
        expect(screen.getByText('Restarted download of "Chapter 1".')).toBeTruthy();
        expect(screen.queryByText('Download again?')).toBeNull();
    });

    it('should not queue a job again when that is declined', () => {
        queued(job('Chapter 1', { status: 'failed' }));
        renderWithProviders(<DownloadsView />, { selection: false });
        fireEvent.click(screen.getByRole('button', { name: 'Failed' }));
        fireEvent.click(question().getByRole('button', { name: 'Cancel' }));
        expect(screen.queryByText('Download again?')).toBeNull();
        expect(engine.DownloadManager.addDownload).not.toHaveBeenCalled();
    });

    it('should report that a job could not be queued again, and close the question', () => {
        queued(job('Chapter 1', { status: 'failed' }));
        engine.DownloadManager.addDownload.mockImplementationOnce(() => {
            throw new Error('no such chapter');
        });
        renderWithProviders(<DownloadsView />, { selection: false });
        fireEvent.click(screen.getByRole('button', { name: 'Failed' }));
        fireEvent.click(question().getByRole('button', { name: 'Download' }));
        expect(screen.getByText('Restart failed: no such chapter')).toBeTruthy();
        expect(screen.queryByText('Download again?')).toBeNull();
    });

    it('should follow the queue: a new job appears, and a job that completes goes', () => {
        const [running] = queued(job('Chapter 1', { status: 'downloading' }));
        renderWithProviders(<DownloadsView />, { selection: false });
        expect(screen.getByText('1 Download(s)')).toBeTruthy();
        const next = job('Chapter 2', { status: 'queued' });
        act(() => engine.DownloadManager.emit('updated', next));
        expect(screen.getByText('2 Download(s)')).toBeTruthy();
        expect(screen.getByText('Chapter 2 — Site')).toBeTruthy();
        running.status = 'completed';
        act(() => engine.DownloadManager.emit('updated', running));
        expect(screen.getByText('1 Download(s)')).toBeTruthy();
        expect(screen.queryByText('Chapter 1 — Site')).toBeNull();
    });

    it('should list the jobs that started before the view was opened, which the manager no longer holds in its queue', () => {
        // what the application does when it starts
        subscribeDownloads(() => undefined);
        const running = job('Chapter 1', { status: 'queued' });
        const broken = job('Chapter 2', { status: 'queued' });
        act(() => {
            engine.DownloadManager.emit('updated', running);
            engine.DownloadManager.emit('updated', broken);
            running.status = 'downloading';
            engine.DownloadManager.emit('updated', running);
            broken.status = 'failed';
            engine.DownloadManager.emit('updated', broken);
        });
        renderWithProviders(<DownloadsView />, { selection: false });
        expect(screen.getByText('2 Download(s)')).toBeTruthy();
        expect(screen.getByText('Downloading')).toBeTruthy();
        expect(screen.getByText('Failed')).toBeTruthy();
    });

    it('should stop listening to the manager when it goes away', () => {
        const { unmount } = renderWithProviders(<DownloadsView />, { selection: false });
        const removeEventListener = vi.spyOn(engine.DownloadManager, 'removeEventListener');
        unmount();
        expect(removeEventListener).toHaveBeenCalledExactlyOnceWith('updated', expect.any(Function));
    });
});

describe('canceling downloads in the view', () => {
    const cancelButtons = () => screen.queryAllByTitle('Cancel this download');
    const cancelAllButton = () => screen.getByTitle('Cancel all downloads');
    const toast = text => screen.getByText(text).closest('.pointer-events-auto');
    // the question that is asked before all the downloads are stopped
    const cancelQuestion = () => within(screen.getByText('Cancel all downloads?').closest('.fixed'));

    it('should offer to cancel the jobs that wait or run, and no others', () => {
        queued(
            job('Chapter 1', { status: 'downloading' }),
            job('Chapter 2', { status: 'queued' }),
            job('Chapter 3', { status: 'failed' }),
            job('Chapter 4', { status: 'completed' }),
            job('Chapter 5', { status: 'paused' })
        );
        renderWithProviders(<DownloadsView />, { selection: false });
        expect(cancelButtons()).toHaveLength(2);
        // each one sits in the card of its own job
        const owners = cancelButtons().map(button => button.parentElement.closest('[title]').getAttribute('title'));
        expect(owners).toEqual(['Site\nBerserk\nChapter 1', 'Site\nBerserk\nChapter 2']);
    });

    it('should cancel the job of its card, and only that one', () => {
        const [first, second] = queued(job('Chapter 1', { status: 'downloading' }), job('Chapter 2', { status: 'queued' }));
        renderWithProviders(<DownloadsView />, { selection: false });
        fireEvent.click(cancelButtons()[1]);
        expect(engine.DownloadManager.cancel).toHaveBeenCalledExactlyOnceWith(second);
        expect(toast('Canceled "Chapter 2".').className).toMatch(/green/);
        expect(first.status).toBe('downloading');
        expect(screen.getByText('1 Download(s)')).toBeTruthy();
        expect(screen.queryByText('Chapter 2 — Site')).toBeNull();
        expect(screen.getByText('Chapter 1 — Site')).toBeTruthy();
    });

    it('should not ask anything before a single download is canceled', () => {
        queued(job('Chapter 1', { status: 'queued' }));
        renderWithProviders(<DownloadsView />, { selection: false });
        fireEvent.click(cancelButtons()[0]);
        expect(screen.queryByText('Cancel all downloads?')).toBeNull();
        expect(engine.DownloadManager.cancel).toHaveBeenCalledTimes(1);
    });

    it('should say so when the download cannot be stopped any more, and keep it in the list', () => {
        const [writing] = queued(job('Chapter 1', { status: 'downloading' }));
        engine.DownloadManager.cancel.mockReturnValueOnce(false);
        renderWithProviders(<DownloadsView />, { selection: false });
        fireEvent.click(cancelButtons()[0]);
        expect(toast('"Chapter 1" cannot be canceled any more.').className).not.toMatch(/red|green/);
        expect(writing.status).toBe('downloading');
        expect(screen.getByText('1 Download(s)')).toBeTruthy();
    });

    it('should report a download that could not be canceled', () => {
        queued(job('Chapter 1', { status: 'queued' }));
        engine.DownloadManager.cancel.mockImplementationOnce(() => {
            throw new Error('no manager');
        });
        renderWithProviders(<DownloadsView />, { selection: false });
        fireEvent.click(cancelButtons()[0]);
        expect(toast('Cancel failed: no manager').className).toMatch(/red/);
        expect(screen.getByText('1 Download(s)')).toBeTruthy();
    });

    it.each([
        ['there are no downloads', []],
        ['only downloads that are over are left', [{ status: 'failed' }, { status: 'completed' }]]
    ])('should not offer to cancel all when %s', (_, fields) => {
        queued(...fields.map((entry, index) => job(`Chapter ${index + 1}`, entry)));
        renderWithProviders(<DownloadsView />, { selection: false });
        expect(cancelAllButton().disabled).toBe(true);
        fireEvent.click(cancelAllButton());
        expect(screen.queryByText('Cancel all downloads?')).toBeNull();
    });

    it('should ask before it cancels all, and count only the downloads that it will stop', () => {
        queued(
            job('Chapter 1', { status: 'downloading' }),
            job('Chapter 2', { status: 'queued' }),
            job('Chapter 3', { status: 'failed' })
        );
        renderWithProviders(<DownloadsView />, { selection: false });
        expect(cancelAllButton().disabled).toBe(false);
        fireEvent.click(cancelAllButton());
        expect(screen.getByText('2 download(s) that wait or run will be stopped.')).toBeTruthy();
        expect(engine.DownloadManager.cancelAll).not.toHaveBeenCalled();
    });

    it('should cancel all the downloads that wait or run when that is confirmed, and leave the ones that are over', () => {
        const [running, waiting, failed] = queued(
            job('Chapter 1', { status: 'downloading' }),
            job('Chapter 2', { status: 'queued' }),
            job('Chapter 3', { status: 'failed' })
        );
        renderWithProviders(<DownloadsView />, { selection: false });
        fireEvent.click(cancelAllButton());
        fireEvent.click(cancelQuestion().getByRole('button', { name: 'Cancel downloads' }));
        expect(engine.DownloadManager.cancelAll).toHaveBeenCalledTimes(1);
        expect(toast('Canceled 2 download(s).').className).toMatch(/green/);
        expect(screen.queryByText('Cancel all downloads?')).toBeNull();
        expect([running.status, waiting.status, failed.status]).toEqual(['canceled', 'canceled', 'failed']);
        // only the failed job is left, and there is nothing more to cancel
        expect(screen.getByText('1 Download(s)')).toBeTruthy();
        expect(screen.getByText('Chapter 3 — Site')).toBeTruthy();
        expect(cancelAllButton().disabled).toBe(true);
    });

    it('should keep every download when the question is declined', () => {
        const jobs = queued(job('Chapter 1', { status: 'downloading' }), job('Chapter 2', { status: 'queued' }));
        renderWithProviders(<DownloadsView />, { selection: false });
        fireEvent.click(cancelAllButton());
        fireEvent.click(cancelQuestion().getByRole('button', { name: 'Keep them' }));
        expect(screen.queryByText('Cancel all downloads?')).toBeNull();
        expect(engine.DownloadManager.cancelAll).not.toHaveBeenCalled();
        expect(jobs.map(entry => entry.status)).toEqual(['downloading', 'queued']);
        expect(screen.getByText('2 Download(s)')).toBeTruthy();
    });

    it('should say so when the downloads were over before they could be canceled', () => {
        queued(job('Chapter 1', { status: 'downloading' }));
        engine.DownloadManager.cancelAll.mockReturnValueOnce(0);
        renderWithProviders(<DownloadsView />, { selection: false });
        fireEvent.click(cancelAllButton());
        fireEvent.click(cancelQuestion().getByRole('button', { name: 'Cancel downloads' }));
        expect(toast('No download was left to cancel.').className).not.toMatch(/red|green/);
    });

    it('should report that the downloads could not be canceled', () => {
        queued(job('Chapter 1', { status: 'downloading' }));
        engine.DownloadManager.cancelAll.mockImplementationOnce(() => {
            throw new Error('no manager');
        });
        renderWithProviders(<DownloadsView />, { selection: false });
        fireEvent.click(cancelAllButton());
        fireEvent.click(cancelQuestion().getByRole('button', { name: 'Cancel downloads' }));
        expect(toast('Cancel failed: no manager').className).toMatch(/red/);
        expect(screen.queryByText('Cancel all downloads?')).toBeNull();
    });

    it('should drop a download as soon as the engine cancels it, whoever asked for it, and follow the buttons with it', () => {
        const [running, waiting] = queued(job('Chapter 1', { status: 'downloading' }), job('Chapter 2', { status: 'queued' }));
        renderWithProviders(<DownloadsView />, { selection: false });
        waiting.status = 'canceled';
        act(() => engine.DownloadManager.emit('updated', waiting));
        expect(screen.getByText('1 Download(s)')).toBeTruthy();
        expect(cancelButtons()).toHaveLength(1);
        expect(cancelAllButton().disabled).toBe(false);
        running.status = 'completed';
        act(() => engine.DownloadManager.emit('updated', running));
        expect(screen.getByText('0 Download(s)')).toBeTruthy();
        expect(screen.getByText(/The queue is empty/)).toBeTruthy();
        expect(cancelAllButton().disabled).toBe(true);
    });

    it('should stop offering to cancel a job that failed in the meantime', () => {
        const [running] = queued(job('Chapter 1', { status: 'downloading' }));
        renderWithProviders(<DownloadsView />, { selection: false });
        expect(cancelButtons()).toHaveLength(1);
        running.status = 'failed';
        act(() => engine.DownloadManager.emit('updated', running));
        expect(cancelButtons()).toHaveLength(0);
        expect(cancelAllButton().disabled).toBe(true);
    });
});
