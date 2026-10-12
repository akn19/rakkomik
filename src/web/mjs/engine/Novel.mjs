/*
 * Novels are text, never images. A chapter of a novel travels through the engine as one "novel page": a
 * well-formed XHTML fragment inside a `data:` URL. That keeps it where every page list expects a URL (the
 * download job, the reader preview) and lets `Storage` turn it into an EPUB or a PDF.
 */

const NOVEL_MIME = 'application/xhtml+xml';
const PAGE_PREFIX = `data:${NOVEL_MIME};charset=utf-8,`;
const IMAGE = /<img\b[^>]*>/g;
const IMAGE_SOURCE = /\ssrc="([^"]*)"/;

function escapeAttribute(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function unescapeAttribute(value) {
    return value
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');
}

/**
 * @param {string} xhtml the content of a chapter
 * @returns {string} the URL of the novel page
 */
export function createNovelPage(xhtml) {
    return PAGE_PREFIX + encodeURIComponent(xhtml);
}

/**
 * @param {*} page an entry of a page list
 * @returns {boolean} true for a novel page, false for anything else (e.g. the URL of an image)
 */
export function isNovelPage(page) {
    return typeof page === 'string' && page.startsWith(PAGE_PREFIX);
}

/**
 * @param {string} page the URL of a novel page
 * @returns {string} the XHTML fragment of the chapter
 */
export function readNovelPage(page) {
    if (!isNovelPage(page)) {
        throw new TypeError('The given page is not a novel page!');
    }
    return decodeURIComponent(page.slice(PAGE_PREFIX.length));
}

/**
 * @param {Blob} blob a downloaded page
 * @returns {boolean} true when the page was downloaded from a novel page URL
 */
export function isNovelBlob(blob) {
    return !!blob && typeof blob.type === 'string' && blob.type.startsWith(NOVEL_MIME);
}

/**
 * @param {string} xhtml the content of a chapter
 * @returns {string[]} the distinct addresses of the illustrations in the chapter
 */
export function listNovelImages(xhtml) {
    let sources = new Set();
    for (let tag of xhtml.match(IMAGE) || []) {
        let match = IMAGE_SOURCE.exec(tag);
        if (match) {
            sources.add(unescapeAttribute(match[1]));
        }
    }
    return [...sources];
}

/**
 * @param {string} xhtml the content of a chapter
 * @param {function(string): (string|undefined)} replace gets the address of an illustration and returns the one to
 *     use instead; an illustration without a replacement is removed from the chapter
 * @returns {string} the changed content
 */
export function replaceNovelImages(xhtml, replace) {
    return xhtml.replace(IMAGE, (tag) => {
        let match = IMAGE_SOURCE.exec(tag);
        let source = match ? replace(unescapeAttribute(match[1])) : undefined;
        return source ? tag.replace(IMAGE_SOURCE, () => ` src="${escapeAttribute(source)}"`) : '';
    });
}

/**
 * Turn the content of a web page into the XHTML of a chapter: paragraphs, headings, line breaks, emphasis, quotes,
 * lists, rules and illustrations. Everything else (scripts, styles, forms, advertisements, hidden text, attributes,
 * links) is dropped, so the result is well-formed by construction and safe to show or to print.
 *
 * It runs inside the hidden window that loaded the chapter (see `createNovelScript`) and in the reader, so it must
 * not refer to anything outside of itself, and it only relies on what a DOM node and a test double of it offer.
 *
 * @param {Element} root the element that holds the text of the chapter
 * @param {object} [options]
 * @param {string} [options.obstacles] selector of the elements inside of the root that are not part of the text
 * @param {string[]} [options.ignoredTexts] paragraphs that consist of one of these texts are not part of the text
 * @param {string[]} [options.protocols] protocols an illustration may be loaded with
 * @param {string} [options.baseURI] base of relative addresses, when the document of the root has none
 * @returns {string} the XHTML fragment, empty when there is neither text nor an illustration
 */
export function serializeNovel(root, options) {
    const settings = Object.assign(
        { obstacles: '', ignoredTexts: [], protocols: ['http:', 'https:', 'data:'] },
        options,
    );
    // dropped together with everything inside of them
    const skipped = new Set([
        'script',
        'style',
        'noscript',
        'template',
        'iframe',
        'object',
        'embed',
        'canvas',
        'svg',
        'math',
        'video',
        'audio',
        'source',
        'track',
        'map',
        'form',
        'input',
        'button',
        'select',
        'textarea',
        'nav',
        'aside',
        'ins',
        'head',
        'title',
        'link',
        'meta',
        'rt',
        'rp',
    ]);
    // kept, folded into the few tags every ebook reader knows
    const emphasis = {
        em: 'em',
        i: 'em',
        cite: 'em',
        dfn: 'em',
        var: 'em',
        strong: 'strong',
        b: 'strong',
        del: 'del',
        s: 'del',
        strike: 'del',
        code: 'code',
        kbd: 'code',
        samp: 'code',
        tt: 'code',
        sub: 'sub',
        sup: 'sup',
        small: 'small',
    };
    // only their content is kept
    const inline = new Set([
        'a',
        'abbr',
        'bdi',
        'bdo',
        'big',
        'data',
        'font',
        'label',
        'mark',
        'picture',
        'q',
        'ruby',
        'span',
        'time',
        'u',
        'wbr',
    ]);
    // sites swap the address of an image in once it comes into view: the placeholder in `src` is not the image
    const lazy = ['data-src', 'data-lazy-src', 'data-original', 'data-lazy'];
    const document = root.ownerDocument;
    const view = (document && document.defaultView) || undefined;
    const base = (document && document.baseURI) || settings.baseURI;
    const obstacles = new Set();
    if (settings.obstacles) {
        try {
            Array.from(root.querySelectorAll(settings.obstacles)).forEach((element) =>
                obstacles.add(element),
            );
        } catch {
            // a selector that does not parse excludes nothing
        }
    }

    const clean = (value) =>
        String(value)
            .toWellFormed()
            // eslint-disable-next-line no-control-regex
            .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '');
    const escapeText = (value) =>
        clean(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const escapeValue = (value) => escapeText(value).replace(/"/g, '&quot;');
    const visible = (markup) =>
        /<img\b/.test(markup) || markup.replace(/<[^>]*>/g, '').replace(/[\s ​-‍﻿]+/g, '') !== '';
    const tidy = (markup) => markup.replace(/^(?:\s|<br\/>)+|(?:\s|<br\/>)+$/g, '');

    const hidden = (element) => {
        let attribute = element.getAttribute('hidden');
        if (attribute !== null && attribute !== undefined) {
            return true;
        }
        if (!view || typeof view.getComputedStyle !== 'function') {
            return false;
        }
        try {
            let style = view.getComputedStyle(element);
            return style.display === 'none' || style.visibility === 'hidden';
        } catch {
            return false;
        }
    };

    const ignored = (element) => {
        return (
            settings.ignoredTexts.length > 0 &&
            settings.ignoredTexts.includes(String(element.textContent).replace(/\s+/g, ' ').trim())
        );
    };

    const image = (element) => {
        let width = parseInt(element.getAttribute('width'), 10);
        let height = parseInt(element.getAttribute('height'), 10);
        // tracking pixels
        if (width <= 2 || height <= 2) {
            return '';
        }
        let source = '';
        for (let name of lazy) {
            let value = element.getAttribute(name);
            if (value && value.trim()) {
                source = value.trim();
                break;
            }
        }
        source = source || (element.getAttribute('src') || '').trim();
        if (!source) {
            return '';
        }
        let address;
        try {
            address = new URL(source, base);
        } catch {
            return '';
        }
        if (
            !settings.protocols.includes(address.protocol) ||
            (address.protocol === 'data:' && !/^data:image\//i.test(address.href))
        ) {
            return '';
        }
        return `<img src="${escapeValue(address.href)}" alt="${escapeValue(element.getAttribute('alt') || '')}"/>`;
    };

    // the paragraphs of a run of text and inline elements; two line breaks in a row end a paragraph
    const flush = (state) => {
        let markup = state.inline;
        state.inline = '';
        markup
            .split(/(?:\s*<br\/>\s*){2,}/)
            .map(tidy)
            .filter(visible)
            .forEach((part) => state.out.push(`<p>${part}</p>`));
    };

    const walkChildren = (node, state, depth) => {
        for (let index = 0; index < node.childNodes.length; index++) {
            walk(node.childNodes[index], state, depth + 1);
        }
    };

    // the inline markup of the content of an element
    const collect = (node, depth, preformatted) => {
        let state = { out: [], inline: '', inlineOnly: true, preformatted: !!preformatted };
        walkChildren(node, state, depth);
        return state.inline;
    };

    // the block markup of the content of an element
    const flow = (node, depth) => {
        let state = { out: [], inline: '', inlineOnly: false, preformatted: false };
        walkChildren(node, state, depth);
        flush(state);
        return state.out;
    };

    const walk = (node, state, depth) => {
        // a document nested that deep is not a chapter
        if (depth > 200) {
            return;
        }
        if (node.nodeType === 3 || node.nodeType === 4) {
            let value = String(node.nodeValue);
            state.inline += escapeText(
                state.preformatted ? value : value.replace(/[ \t\r\n\f]+/g, ' '),
            );
            return;
        }
        if (node.nodeType !== 1) {
            return;
        }
        let name = String(node.localName || node.nodeName).toLowerCase();
        if (skipped.has(name) || obstacles.has(node) || hidden(node)) {
            return;
        }
        if (name === 'br') {
            state.inline += '<br/>';
            return;
        }
        if (name === 'img') {
            state.inline += image(node);
            return;
        }
        if (emphasis[name]) {
            let content = collect(node, depth, state.preformatted);
            if (visible(content)) {
                state.inline += `<${emphasis[name]}>${content}</${emphasis[name]}>`;
            } else if (/\s/.test(content)) {
                state.inline += ' ';
            }
            return;
        }
        if (inline.has(name)) {
            walkChildren(node, state, depth);
            return;
        }

        // everything else is a block: inside of a paragraph, a heading, ... it only separates words
        if (state.inlineOnly) {
            state.inline += ' ';
            walkChildren(node, state, depth);
            state.inline += ' ';
            return;
        }
        flush(state);
        if (name === 'hr') {
            state.out.push('<hr/>');
        } else if (name === 'p' || /^h[1-6]$/.test(name)) {
            let content = ignored(node) ? '' : tidy(collect(node, depth));
            if (visible(content)) {
                state.out.push(`<${name}>${content}</${name}>`);
            }
        } else if (name === 'pre') {
            let content = collect(node, depth, true);
            if (visible(content)) {
                state.out.push(`<pre>${content}</pre>`);
            }
        } else if (name === 'blockquote') {
            let content = flow(node, depth);
            if (content.length) {
                state.out.push(`<blockquote>${content.join('')}</blockquote>`);
            }
        } else if (name === 'ul' || name === 'ol') {
            let items = [];
            for (let index = 0; index < node.childNodes.length; index++) {
                let item = node.childNodes[index];
                if (
                    item.nodeType === 1 &&
                    String(item.localName || item.nodeName).toLowerCase() === 'li' &&
                    !obstacles.has(item) &&
                    !hidden(item)
                ) {
                    let content = flow(item, depth + 1);
                    if (content.length) {
                        items.push(`<li>${content.join('')}</li>`);
                    }
                }
            }
            if (items.length) {
                state.out.push(`<${name}>${items.join('')}</${name}>`);
            }
        } else {
            walkChildren(node, state, depth);
            flush(state);
        }
    };

    let state = { out: [], inline: '', inlineOnly: false, preformatted: false };
    walkChildren(root, state, 0);
    flush(state);
    return state.out.join('\n');
}

/**
 * Wait until the chapter is in the page, in the hidden window. Sites fill it in after the page loaded, so the text
 * is taken once it stopped growing (or when the time is up, as long as there is any).
 * Like `serializeNovel`, it is sent to the page as source code: it must not refer to anything outside of itself.
 */
function waitForNovel(serialize, parameters) {
    return new Promise((resolve, reject) => {
        const deadline = Date.now() + parameters.timeout;
        let previous = -1;
        const attempt = () => {
            let root = document.querySelector(parameters.content);
            let length = root ? root.textContent.trim().length : 0;
            let hasContent = length > 0 || !!(root && root.querySelector('img'));
            if (hasContent && (length === previous || Date.now() >= deadline)) {
                try {
                    let xhtml = serialize(root, {
                        obstacles: parameters.obstacles,
                        ignoredTexts: parameters.ignoredTexts,
                    });
                    if (xhtml) {
                        resolve(xhtml);
                    } else {
                        reject(new Error(`The novel content "${parameters.content}" has no text!`));
                    }
                } catch (error) {
                    reject(error);
                }
            } else if (Date.now() < deadline) {
                previous = length;
                setTimeout(attempt, 250);
            } else {
                reject(new Error(`The novel content "${parameters.content}" was not found!`));
            }
        };
        attempt();
    });
}

/**
 * @param {string} contentQuery selector of the element that holds the text of the chapter
 * @param {object} [options]
 * @param {string} [options.obstacles] selector of the elements inside of the content that are not part of the text
 * @param {string[]} [options.ignoredTexts] paragraphs that consist of one of these texts are not part of the text
 * @param {number} [options.timeout] how long [ms] to wait for the content to show up
 * @returns {string} script for the hidden window that resolves with the XHTML of the chapter
 */
export function createNovelScript(contentQuery, options = {}) {
    let parameters = {
        content: contentQuery,
        obstacles: options.obstacles || '',
        ignoredTexts: options.ignoredTexts || [],
        timeout: options.timeout || 10000,
    };
    return `(${waitForNovel})(${serializeNovel}, ${JSON.stringify(parameters)})`;
}
