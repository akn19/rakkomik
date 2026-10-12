// happy-dom has no layout engine: every element is 0 x 0, so a virtual list would draw no rows at all. `setLayout` gives
// every element the size that a test needs.
export const DEFAULT_LAYOUT = { width: 900, height: 600 };

export function setLayout({ width, height } = DEFAULT_LAYOUT) {
    for (const [name, value] of [
        ['offsetWidth', width],
        ['clientWidth', width],
        ['offsetHeight', height],
        ['clientHeight', height],
    ]) {
        Object.defineProperty(HTMLElement.prototype, name, {
            configurable: true,
            get: () => value,
        });
    }
}
