import { getEngine } from './engine.js';
import { isNovelPage, readNovelPage, serializeNovel } from '../mjs/engine/Novel.mjs';

export { isNovelPage };

// what an illustration may be loaded from: sites, images inside of the text and the files of an e-book that was opened
const PROTOCOLS = ['http:', 'https:', 'data:', 'file:'];

// markup in a document that is inert: nothing in it loads or runs
function parse(markup) {
    return new DOMParser().parseFromString(`<body>${markup}</body>`, 'text/html').body;
}

/**
 * The text of a novel page as markup that is safe to show. The page is cleaned up once more, because a page can come from
 * an e-book of the user: only the few tags of a chapter stay, and no attributes but the ones of an illustration.
 * @param {string} page a novel page of the page list of a chapter
 * @returns {string}
 */
export function novelMarkup(page) {
    return serializeNovel(parse(readNovelPage(page)), { protocols: PROTOCOLS });
}

/**
 * @param {string} page a novel page of the page list of a chapter
 * @param {number} [length] the number of characters to keep
 * @returns {string} the beginning of the text of the page: what is shown of it, without the markup, in one line
 */
export function novelExcerpt(page, length = 200) {
    return parse(novelMarkup(page)).textContent.replace(/\s+/g, ' ').trim().slice(0, length);
}

/**
 * @returns {{ background: string, text: string }} the colours the user chose for novels (setting "Light/Dark mode for Novels")
 */
export function novelColors() {
    try {
        return getEngine().Settings.NovelColorProfile();
    } catch {
        // a settings file that holds a profile which does not exist (any more)
        return { background: 'white', text: 'black' };
    }
}
