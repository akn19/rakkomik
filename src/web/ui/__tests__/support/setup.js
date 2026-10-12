// A DOM without a layout engine: what the components ask the browser for is answered here. Every element is
// 900 x 600 (see layout.js), so a virtual list draws rows; the tests that depend on other sizes call `setLayout`.
import { vi } from 'vitest';
import { notifyManager } from '@tanstack/react-query';
import { DEFAULT_LAYOUT, setLayout } from './layout.js';

// TanStack Query hands the result of a query to React with `setTimeout(0)`, and `act` of React ends with `setImmediate`.
// Which of the two comes first depends on the machine, so a view that shows the data of a query right after
// `await act(...)` showed it on one machine and not on another: CI saw "Loading pages …" in the reader after the
// pages had been answered. As a microtask the notification always comes before `act` ends.
notifyManager.setScheduler((callback) => queueMicrotask(callback));

class NoObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
}

globalThis.ResizeObserver ??= NoObserver;
globalThis.IntersectionObserver ??= NoObserver;
Element.prototype.scrollIntoView ??= vi.fn();
Element.prototype.scrollTo ??= vi.fn();

beforeEach(() => {
    setLayout(DEFAULT_LAYOUT);
});

// nothing of one test may reach the next: the globals that the interface reads, the stored choices, the address
afterEach(() => {
    vi.useRealTimers();
    delete window.Engine;
    delete window.hakuneko;
    window.localStorage.clear();
    window.location.hash = '';
});
