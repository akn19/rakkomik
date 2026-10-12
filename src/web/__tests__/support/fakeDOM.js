// A just-enough DOM for the code that runs in a page but has to be tested in Node: elements and text nodes with the
// members `serializeNovel` and the novel script read. `parseHTML` builds a tree from simple markup (nested tags,
// quoted attributes, void elements, the common entities), `querySelector(All)` understands `tag`, `.class` and `#id`.
// Real elements are tested in the application itself (src/__tests__/App.e2e.mjs).
const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'source', 'wbr']);
const ENTITIES = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&nbsp;': ' ',
    '&#39;': "'",
};

function decode(value) {
    return value.replace(/&(?:amp|lt|gt|quot|nbsp|#39);/g, (entity) => ENTITIES[entity]);
}

function matches(element, selector) {
    if (selector.startsWith('.')) {
        return (element.attrs.class || '').split(/\s+/).includes(selector.slice(1));
    }
    if (selector.startsWith('#')) {
        return element.attrs.id === selector.slice(1);
    }
    return element.localName === selector;
}

function descendants(node) {
    return node.childNodes.flatMap((child) =>
        child.nodeType === 1 ? [child, ...descendants(child)] : [],
    );
}

function textOf(node) {
    return node.nodeType === 3 ? node.nodeValue : node.childNodes.map(textOf).join('');
}

export function createText(value, document) {
    return { nodeType: 3, nodeValue: value, ownerDocument: document };
}

export function createElement(name, attrs = {}, childNodes = [], document = undefined) {
    const element = {
        nodeType: 1,
        localName: name,
        nodeName: name.toUpperCase(),
        attrs,
        childNodes,
        ownerDocument: document,
        getAttribute: (key) => (Object.hasOwn(attrs, key) ? attrs[key] : null),
        querySelectorAll: (selector) => {
            if (selector.includes('!')) {
                throw new SyntaxError(`"${selector}" is not a valid selector`);
            }
            return selector
                .split(',')
                .flatMap((part) =>
                    descendants(element).filter((candidate) => matches(candidate, part.trim())),
                );
        },
        querySelector: (selector) => element.querySelectorAll(selector)[0] || null,
    };
    Object.defineProperty(element, 'textContent', { get: () => textOf(element) });
    return element;
}

/**
 * @param {string} markup the content of a page
 * @param {object} [options]
 * @param {string} [options.baseURI] address of the page
 * @param {function(object): object} [options.style] computed style of an element, e.g. `{ display: 'none' }`
 * @returns {{ document: object, body: object }} the document and its body, filled from the markup
 */
export function parseHTML(markup, options = {}) {
    const document = {
        baseURI:
            options.baseURI === undefined
                ? 'https://novels.example/series/1/chapter-1'
                : options.baseURI,
        defaultView: options.style
            ? {
                  getComputedStyle: (element) => ({
                      display: 'block',
                      visibility: 'visible',
                      ...options.style(element),
                  }),
              }
            : undefined,
    };
    const body = createElement('body', {}, [], document);
    const stack = [body];
    const token =
        /<!--[\s\S]*?-->|<\/([a-zA-Z0-9]+)\s*>|<([a-zA-Z0-9]+)((?:\s+[a-zA-Z0-9:_-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)/g;
    for (let match = token.exec(markup); match; match = token.exec(markup)) {
        const [whole, closing, opening, source, selfClosing, text] = match;
        const parent = stack[stack.length - 1];
        if (text !== undefined) {
            parent.childNodes.push(createText(decode(text), document));
        } else if (opening) {
            const attrs = {};
            for (const attribute of source.matchAll(
                /([a-zA-Z0-9:_-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g,
            )) {
                attrs[attribute[1]] = decode(attribute[2] ?? attribute[3] ?? attribute[4] ?? '');
            }
            const element = createElement(opening.toLowerCase(), attrs, [], document);
            parent.childNodes.push(element);
            if (!selfClosing && !VOID.has(element.localName)) {
                stack.push(element);
            }
        } else if (closing && !whole.startsWith('<!--')) {
            const index = stack.findLastIndex((entry) => entry.localName === closing.toLowerCase());
            if (index > 0) {
                stack.length = index;
            }
        }
    }
    document.querySelector = (selector) => body.querySelector(selector);
    return { document, body };
}
