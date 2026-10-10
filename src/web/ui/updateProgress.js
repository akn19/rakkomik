import React from 'react';
import { getUpdateProgress } from './engine.js';

const SAMPLE_INTERVAL = 500;

/**
 * Live progress of the manga list update of a connector, sampled twice a second.
 * The engine counts the requests a connector completed meanwhile (the total is not
 * known, so it is no percentage); `undefined` while the connector is not updating.
 * It follows the engine, so an update that was started elsewhere shows up as well.
 */
export function useUpdateProgress(connector) {
    const [progress, setProgress] = React.useState(undefined);
    React.useEffect(() => {
        if (!connector) {
            setProgress(undefined);
            return undefined;
        }
        const sample = () => setProgress(current => {
            const next = getUpdateProgress(connector);
            const unchanged = current === next || (current && next && current.requests === next.requests && current.seconds === next.seconds);
            return unchanged ? current : next;
        });
        sample();
        const timer = setInterval(sample, SAMPLE_INTERVAL);
        return () => clearInterval(timer);
    }, [connector]);
    return progress;
}

/**
 * `12 requests · 1:05`, `1 request · 0:03`, or just the time while no request completed yet.
 */
export function describeUpdateProgress(progress) {
    if (!progress) {
        return '';
    }
    const time = `${Math.floor(progress.seconds / 60)}:${String(progress.seconds % 60).padStart(2, '0')}`;
    if (!progress.requests) {
        return time;
    }
    return `${progress.requests} ${progress.requests === 1 ? 'request' : 'requests'} · ${time}`;
}

/**
 * The text of the status line: the task, followed by its progress when there is any.
 */
export function updateMessage(progress) {
    const text = describeUpdateProgress(progress);
    return text ? `Updating… ${text}` : 'Updating…';
}
