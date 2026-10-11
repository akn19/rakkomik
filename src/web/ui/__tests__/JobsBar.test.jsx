import { act, fireEvent, screen } from '@testing-library/react';
import JobsBar from '../jobs.jsx';
import { addChapter, addManga, createConnector, createDownloadJob, installEngine } from './support/fakeEngine.js';
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
        const cells = [...container.querySelectorAll('tbody tr td')].map(cell => cell.textContent);
        expect(cells.slice(1, 4)).toEqual(['Site', 'Berserk', 'Chapter 1']);
        expect(container.querySelector('tbody tr').getAttribute('title')).toBe('Site\nBerserk\nChapter 1');
        expect(container.querySelector('tbody tr td:last-child').getAttribute('style')).toMatch(/30%/);
    });

    it('should show the errors of a job in the tooltip of its button, with the hint to download again', () => {
        queued(job('Chapter 1', { status: 'failed', errors: [new Error('HTTP 404'), new Error('timeout')] }));
        renderWithProviders(<JobsBar />, { selection: false });
        openList();
        // not `getByTitle`: it folds the line breaks of the text into spaces
        expect(document.querySelector('tbody tr td:first-child button').getAttribute('title')).toBe('Click to re-download\nError: HTTP 404\nError: timeout');
    });

    it('should give no hint to download again while a job has no error to show', () => {
        queued(job('Chapter 1', { status: 'queued' }));
        renderWithProviders(<JobsBar />, { selection: false });
        openList();
        expect(document.querySelector('tbody tr td:first-child button').getAttribute('title')).toBe('');
    });

    it.each(['failed', 'completed'])('should download a %s job again when its button is clicked', status => {
        const [done] = queued(job('Chapter 1', { status }));
        renderWithProviders(<JobsBar />, { selection: false });
        openList();
        fireEvent.click(document.querySelector('tbody tr td:first-child button'));
        expect(engine.DownloadManager.addDownload).toHaveBeenCalledExactlyOnceWith(done.chapter);
    });

    it('should leave a job that is still running alone when its button is clicked', () => {
        queued(job('Chapter 1', { status: 'downloading' }), job('Chapter 2', { status: 'queued' }));
        renderWithProviders(<JobsBar />, { selection: false });
        openList();
        document.querySelectorAll('tbody tr td:first-child button').forEach(button => fireEvent.click(button));
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
