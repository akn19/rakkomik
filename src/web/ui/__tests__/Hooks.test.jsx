import { act, renderHook } from '@testing-library/react';
import { useConnectors } from '../connectorsState.js';
import { useDownloadJobs } from '../downloads.js';
import {
    addChapter,
    addManga,
    createConnector,
    createDownloadJob,
    installEngine,
} from './support/fakeEngine.js';

describe('live list of connectors', () => {
    it('should be empty and not ready while there is no engine', () => {
        const { result } = renderHook(() => useConnectors());
        expect(result.current).toEqual({ connectors: [], ready: false });
    });

    it('should follow the registry while the connectors register, and know when it is complete', () => {
        const list = [createConnector({ id: 'a' })];
        const engine = installEngine({ connectors: list, ready: false });
        const { result } = renderHook(() => useConnectors());
        expect(result.current.connectors.map((connector) => connector.id)).toEqual(['a']);
        expect(result.current.ready).toBe(false);
        list.push(createConnector({ id: 'b' }));
        act(() => engine.ConnectorRegistry.emit('registered'));
        expect(result.current.connectors.map((connector) => connector.id)).toEqual(['a', 'b']);
        expect(result.current.ready).toBe(false);
        engine.ConnectorRegistry.isReady = true;
        act(() => engine.ConnectorRegistry.emit('ready'));
        expect(result.current.ready).toBe(true);
    });

    it('should keep the same snapshot while nothing changed, because a new one on every call would loop forever', () => {
        installEngine({ connectors: [createConnector({ id: 'a' })] });
        const { result, rerender } = renderHook(() => useConnectors());
        const first = result.current;
        rerender();
        rerender();
        expect(result.current).toBe(first);
    });

    it('should hand out a copy of the list, so that registering does not change what a view already holds', () => {
        const list = [createConnector({ id: 'a' })];
        const engine = installEngine({ connectors: list });
        const { result } = renderHook(() => useConnectors());
        const before = result.current.connectors;
        list.push(createConnector({ id: 'b' }));
        expect(before.map((connector) => connector.id)).toEqual(['a']);
        act(() => engine.ConnectorRegistry.emit('registered'));
        expect(result.current.connectors).not.toBe(before);
    });

    it('should treat an engine without a registry as complete', () => {
        const engine = installEngine({ connectors: [createConnector({ id: 'a' })] });
        delete engine.ConnectorRegistry;
        const { result } = renderHook(() => useConnectors());
        expect(result.current.ready).toBe(true);
        expect(result.current.connectors.map((connector) => connector.id)).toEqual(['a']);
    });

    it('should stop listening to the registry when it goes away', () => {
        const engine = installEngine({ connectors: [] });
        const removeEventListener = vi.spyOn(engine.ConnectorRegistry, 'removeEventListener');
        const { unmount } = renderHook(() => useConnectors());
        unmount();
        expect(removeEventListener.mock.calls.map(([event]) => event).sort()).toEqual([
            'ready',
            'registered',
        ]);
    });
});

describe('live list of downloads', () => {
    let engine = null;
    let manga = null;

    function job(title, fields) {
        return createDownloadJob(addChapter(manga, { title }), fields);
    }

    beforeEach(() => {
        const site = createConnector({ id: 'site', label: 'Site' });
        manga = addManga(site, { title: 'Berserk' });
        engine = installEngine({ connectors: [site] });
    });

    it('should start with the jobs that are in the queue', () => {
        const queued = job('Chapter 1', { status: 'queued' });
        engine.DownloadManager.queue.site = [queued];
        const { result } = renderHook(() => useDownloadJobs());
        expect(result.current).toEqual([queued]);
    });

    it('should be empty when there is no engine', () => {
        delete window.Engine;
        const { result } = renderHook(() => useDownloadJobs());
        expect(result.current).toEqual([]);
    });

    it('should add a job that is queued or downloading, and ignore one that is already done', () => {
        const { result } = renderHook(() => useDownloadJobs());
        const queued = job('Chapter 1', { status: 'queued' });
        const downloading = job('Chapter 2', { status: 'downloading' });
        const completed = job('Chapter 3', { status: 'completed' });
        const failed = job('Chapter 4', { status: 'failed' });
        for (const next of [queued, downloading, completed, failed]) {
            act(() => engine.DownloadManager.emit('updated', next));
        }
        expect(result.current).toEqual([queued, downloading]);
    });

    it('should drop a job that completes, and keep one whose progress changes', () => {
        const running = job('Chapter 1', { status: 'downloading' });
        engine.DownloadManager.queue.site = [running];
        const { result } = renderHook(() => useDownloadJobs());
        running.progress = 50;
        act(() => engine.DownloadManager.emit('updated', running));
        expect(result.current).toEqual([running]);
        running.status = 'completed';
        act(() => engine.DownloadManager.emit('updated', running));
        expect(result.current).toEqual([]);
    });

    it('should replace a failed job by the retry of the same chapter', () => {
        const failed = job('Chapter 1', { status: 'failed' });
        engine.DownloadManager.queue.site = [failed];
        const { result } = renderHook(() => useDownloadJobs());
        const retry = createDownloadJob(failed.chapter, { status: 'queued' });
        act(() => engine.DownloadManager.emit('updated', retry));
        expect(result.current).toEqual([retry]);
    });

    it('should stop listening to the manager when it goes away', () => {
        const removeEventListener = vi.spyOn(engine.DownloadManager, 'removeEventListener');
        const { unmount } = renderHook(() => useDownloadJobs());
        unmount();
        expect(removeEventListener).toHaveBeenCalledExactlyOnceWith(
            'updated',
            expect.any(Function),
        );
    });
});
