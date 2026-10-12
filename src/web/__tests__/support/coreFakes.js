// Helpers for the tests of the core classes of the engine (Connector, Manga, Chapter, Request).
//
// Stand-ins for what the core classes reach through globals: `Engine.Storage`,
// `Engine.Settings`, `document` and `EventListener`. They keep the shapes of the real ones (see Storage.mjs,
// Settings.mjs and Enums.mjs): a directory is an array that holds the names of its entries as keys, reading something
// that is not there rejects, and the lists of mangas travel through JSON like they do through the files.

/**
 * What Storage hands out for a directory: an array that holds the names of the entries as keys (`list[name] === true`).
 * @param {...string} names the entries of the directory
 */
function directoryListing(...names) {
    const list = [];
    for (const name of names) {
        list[name] = true;
    }
    return list;
}

function missing(what) {
    return Object.assign(new Error(`ENOENT: no such file or directory, open '${what}'`), {
        code: 'ENOENT',
    });
}

/**
 * @param {object} options
 * @param {function} options.Storage the class of the engine: its `sanatizePath` is used as it is, for the given platform
 * @param {string} [options.platform] the platform the titles are sanitized for
 * @param {string} [options.chapterFormat] value of the setting: 'img', '.cbz' or '.epub'
 * @param {string} [options.novelFormat] value of the setting: '.epub' or '.pdf'
 * @param {string} [options.chapterTitleFormat] value of the setting
 * @returns {{ Storage: object, Settings: object }} the value for the global `Engine`; set `Storage.existingMangas` and
 *     `Storage.existingChapters` to the entries of the directories (`null`: the directory does not exist yet)
 */
function createEngine({
    Storage,
    platform = 'linux',
    chapterFormat = 'img',
    novelFormat = '.epub',
    chapterTitleFormat = '',
}) {
    const files = new Map();
    return {
        Storage: {
            existingMangas: directoryListing(),
            existingChapters: directoryListing(),
            sanatizePath: (title) => Storage.prototype.sanatizePath.call({ platform }, title),
            saveMangaList: vi.fn(async (connectorID, mangas) => {
                files.set('mangas.' + connectorID, JSON.stringify(mangas));
            }),
            loadMangaList: vi.fn(async (connectorID) => {
                if (!files.has('mangas.' + connectorID)) {
                    throw missing('mangas.' + connectorID);
                }
                return JSON.parse(files.get('mangas.' + connectorID));
            }),
            getExistingMangaTitles: vi.fn(async function () {
                if (!this.existingMangas) {
                    throw missing('connector directory');
                }
                return Object.assign([], this.existingMangas);
            }),
            getExistingChapterTitles: vi.fn(async function () {
                if (!this.existingChapters) {
                    throw missing('manga directory');
                }
                return Object.assign([], this.existingChapters);
            }),
            loadChapterPages: vi.fn(async () => {
                throw missing('chapter');
            }),
        },
        Settings: {
            chapterTitleFormat: { value: chapterTitleFormat },
            chapterFormat: { value: chapterFormat },
            novelFormat: { value: novelFormat },
        },
    };
}

/**
 * Put the globals of the page in place (undo with `vi.unstubAllGlobals()`).
 * @param {object} options
 * @param {object} options.engine see `createEngine`
 * @param {object} options.EventListener the names of the events of the page (Enums.EventListener)
 * @returns {{ document: EventTarget, events: Array<{ type: string, detail: * }> }} the events that reached the document
 */
function installPage({ engine, EventListener }) {
    const document = new EventTarget();
    const events = [];
    for (const type of Object.values(EventListener)) {
        document.addEventListener(type, (event) =>
            events.push({ type: event.type, detail: event.detail }),
        );
    }
    vi.stubGlobal('document', document);
    vi.stubGlobal('EventListener', EventListener);
    vi.stubGlobal('Engine', engine);
    return { document, events };
}

/**
 * For `toThrow`: matches the whole message, not a part of it (the messages are shown to the user).
 * @param {string} message
 * @returns {RegExp}
 */
function exactly(message) {
    return new RegExp('^' + message.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$');
}

module.exports = { directoryListing, createEngine, installPage, exactly };
