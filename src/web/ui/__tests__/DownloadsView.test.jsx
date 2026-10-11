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
