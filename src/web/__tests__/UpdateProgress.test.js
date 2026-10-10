// What the user interface shows of a manga list update: the engine's counters as text.
let progress = null;
let bridge = null;

beforeAll(async () => {
    progress = await import('../ui/updateProgress.js');
    bridge = await import('../ui/engine.js');
});

afterEach(() => {
    vi.useRealTimers();
});

describe('describeUpdateProgress', () => {
    it('should name the requests and the time', () => {
        expect(progress.describeUpdateProgress({ requests: 12, seconds: 65 })).toBe('12 requests · 1:05');
        expect(progress.describeUpdateProgress({ requests: 1, seconds: 3 })).toBe('1 request · 0:03');
    });

    it('should show only the time while no request completed yet', () => {
        expect(progress.describeUpdateProgress({ requests: 0, seconds: 5 })).toBe('0:05');
    });

    it('should keep counting minutes past the hour', () => {
        expect(progress.describeUpdateProgress({ requests: 400, seconds: 3725 })).toBe('400 requests · 62:05');
    });

    it('should say nothing without progress', () => {
        expect(progress.describeUpdateProgress(undefined)).toBe('');
    });
});

describe('updateMessage', () => {
    it('should put the task before its progress', () => {
        expect(progress.updateMessage({ requests: 12, seconds: 65 })).toBe('Updating… 12 requests · 1:05');
        expect(progress.updateMessage(undefined)).toBe('Updating…');
    });
});

describe('getUpdateProgress', () => {
    it('should read the counters of the connector and the seconds since the start', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-10-11T12:00:10Z'));
        const connector = { updateProgress: { requests: 7, startedAt: new Date('2026-10-11T12:00:05.900Z').getTime() } };
        expect(bridge.getUpdateProgress(connector)).toEqual({ requests: 7, seconds: 4 });
    });

    it('should be undefined for a connector that is not updating', () => {
        expect(bridge.getUpdateProgress({ updateProgress: undefined })).toBeUndefined();
        expect(bridge.getUpdateProgress({})).toBeUndefined();
        expect(bridge.getUpdateProgress(undefined)).toBeUndefined();
    });
});
