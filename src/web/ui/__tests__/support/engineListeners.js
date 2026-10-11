// Which listeners are on the fake engine's event targets at the moment: a view that subscribes and does not unsubscribe leaves
// entries behind when it goes away (or piles them up each time it is shown again).

/**
 * @param {EventTarget[]} emitters the event targets to watch (e.g. `engine.BookmarkManager`, `engine.ConnectorRegistry`)
 * @returns {object[]} the live list: an entry `{ emitter, type, listener }` per listener that was added and not removed yet
 */
export function trackListeners(emitters) {
    const live = [];
    for (const emitter of emitters) {
        const add = emitter.addEventListener.bind(emitter);
        const remove = emitter.removeEventListener.bind(emitter);
        vi.spyOn(emitter, 'addEventListener').mockImplementation((type, listener, options) => {
            live.push({ emitter, type, listener });
            add(type, listener, options);
        });
        vi.spyOn(emitter, 'removeEventListener').mockImplementation((type, listener, options) => {
            const index = live.findIndex(entry => entry.emitter === emitter && entry.type === type && entry.listener === listener);
            if (index > -1) {
                live.splice(index, 1);
            }
            remove(type, listener, options);
        });
    }
    return live;
}
