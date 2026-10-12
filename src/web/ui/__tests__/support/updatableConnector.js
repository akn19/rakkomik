// A connector that updates its manga list the way Connector.updateMangas of the engine does (src/web/mjs/engine/Connector.mjs):
// the update runs until the test ends it, `updateProgress` is set while it runs and cleared BEFORE the answer, and a second
// request for an update while one is running is dropped without any answer (the engine just returns).
import { createConnector } from './fakeEngine.js';

// like the engine's Manga, a class instance: the query cache shares plain objects structurally, but never these
class FakeManga extends EventTarget {
    constructor(connector, id, title) {
        super();
        this.connector = connector;
        this.id = id;
        this.title = title;
        this.chapters = [];
        this.getChapters = vi.fn((callback) => callback(null, this.chapters));
    }
}

/**
 * @param {object} connector the website the manga belongs to
 * @param {string} id the id of the manga at that website
 * @param {string} title
 * @returns {object} a manga as the engine hands it out
 */
export function createManga(connector, id, title) {
    return new FakeManga(connector, id, title);
}

/**
 * A list that an update brings: one manga per title, with the ids `<connector id>-1`, `<connector id>-2`, ...
 */
export function makeMangas(connector, titles) {
    return titles.map((title, index) =>
        createManga(connector, `${connector.id}-${index + 1}`, title),
    );
}

/**
 * @param {object} [fields] fields of the connector, see createConnector
 * @returns {object} the connector, with `finishUpdate(mangas)` and `failUpdate(error)` to end the update that was asked for
 */
export function createUpdatableConnector(fields = {}) {
    let answer = null;
    const connector = createConnector({
        ...fields,
        updateMangas: vi.fn((callback) => {
            if (connector.updateProgress) {
                return;
            }
            connector.updateProgress = { requests: 0, startedAt: Date.now() };
            answer = callback;
        }),
    });
    connector.finishUpdate = (mangas) => {
        connector.updateProgress = undefined;
        connector.mangas = mangas;
        answer(null, mangas);
    };
    // the engine answers `(error, undefined)`; an empty list is an error without an error object: `(undefined, undefined)`
    connector.failUpdate = (error) => {
        connector.updateProgress = undefined;
        answer(error, undefined);
    };
    return connector;
}
