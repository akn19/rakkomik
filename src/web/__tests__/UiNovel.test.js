// What the reader shows of a novel page: the text, cleaned up once more (it can come from an e-book of the user), the
// beginning of it for the thumbnail, and the colours the user chose for novels.
const { parseHTML } = require('./support/fakeDOM.js');

let ui = null;
let Novel = null;

beforeAll(async () => {
    ui = await import('../ui/novel.js');
    Novel = await import('../mjs/engine/Novel.mjs');
});

afterEach(() => {
    vi.unstubAllGlobals();
    delete globalThis.window;
});

// DOMParser of the reader, on the test double of a DOM: the markup of a document that has a body
function stubDOMParser() {
    const parsed = vi.fn();
    vi.stubGlobal('DOMParser', class {
        parseFromString(markup, type) {
            parsed(markup, type);
            return parseHTML(markup.replace(/^<body>|<\/body>$/g, ''));
        }
    });
    return parsed;
}

describe('the text of a novel page in the reader', () => {
    it('should be the page that the engine calls a novel page', () => {
        expect(ui.isNovelPage).toBe(Novel.isNovelPage);
    });

    it('should be parsed in an inert document', () => {
        const parsed = stubDOMParser();
        ui.novelMarkup(Novel.createNovelPage('<p>Text</p>'));
        expect(parsed).toHaveBeenCalledWith('<body><p>Text</p></body>', 'text/html');
    });

    it('should show the paragraphs, the headings and the emphasis', () => {
        stubDOMParser();
        const page = Novel.createNovelPage('<h1>Chapter 1</h1>\n<p>Hello <em>brave</em> &amp; <strong>new</strong> world</p>');
        expect(ui.novelMarkup(page)).toBe('<h1>Chapter 1</h1>\n<p>Hello <em>brave</em> &amp; <strong>new</strong> world</p>');
    });

    it('should drop what is not the text of a chapter, though an e-book holds it', () => {
        stubDOMParser();
        const page = Novel.createNovelPage('<p onclick="steal()" style="color:red">Hi</p><script>alert(1)</script><iframe src="https://tracker.example"></iframe><p><a href="javascript:alert(1)">link</a></p>');
        expect(ui.novelMarkup(page)).toBe('<p>Hi</p>\n<p>link</p>');
    });

    it('should show the illustrations that come from a site, from the text itself or from the e-book that was opened', () => {
        stubDOMParser();
        const page = Novel.createNovelPage([
            '<p><img src="https://cdn.example/a.jpg" alt="A"/></p>',
            '<p><img src="data:image/png;base64,AAAA" alt=""/></p>',
            '<p><img src="file:///tmp/hakuneko/1.jpg?ts=1" alt="Opened"/></p>',
            '<p><img src="javascript:alert(1)" alt=""/></p>',
            '<p><img src="ftp://x.example/y.png" alt=""/></p>'
        ].join('\n'));
        expect(ui.novelMarkup(page)).toBe([
            '<p><img src="https://cdn.example/a.jpg" alt="A"/></p>',
            '<p><img src="data:image/png;base64,AAAA" alt=""/></p>',
            '<p><img src="file:///tmp/hakuneko/1.jpg?ts=1" alt="Opened"/></p>'
        ].join('\n'));
    });

    it('should refuse what is no novel page', () => {
        stubDOMParser();
        expect(() => ui.novelMarkup('https://cdn.example/1.jpg')).toThrow(TypeError);
    });
});

describe('the beginning of a novel page', () => {
    it('should be the text without the markup, in one line', () => {
        stubDOMParser();
        const page = Novel.createNovelPage('<h1>Chapter 1</h1>\n<p>It was  a dark\n and <em>stormy</em> night.</p>');
        expect(ui.novelExcerpt(page)).toBe('Chapter 1 It was a dark and stormy night.');
    });

    it('should be the text that is shown, not what the page only holds', () => {
        stubDOMParser();
        const page = Novel.createNovelPage('<p>Hello</p><script>window.pwned = true</script><style>p { color: red }</style><p onclick="x()">there &amp; then</p>');
        expect(ui.novelExcerpt(page)).toBe('Hello there & then');
    });

    it('should stop after the length it is given, 200 characters unless told otherwise', () => {
        stubDOMParser();
        const page = Novel.createNovelPage(`<p>${'word '.repeat(100)}</p>`);
        expect(ui.novelExcerpt(page)).toHaveLength(200);
        expect(ui.novelExcerpt(page, 12)).toBe('word word wo');
    });

    it('should be empty for a page without text', () => {
        stubDOMParser();
        expect(ui.novelExcerpt(Novel.createNovelPage('<p><img src="https://cdn.example/a.jpg" alt=""/></p>'))).toBe('');
    });
});

describe('the colours of a novel', () => {
    it('should be the ones the user chose', () => {
        globalThis.window = { Engine: { Settings: { NovelColorProfile: () => ({ background: 'black', text: 'white' }) } } };
        expect(ui.novelColors()).toEqual({ background: 'black', text: 'white' });
    });

    it('should be black on white when the profile is not there', () => {
        globalThis.window = { Engine: { Settings: { NovelColorProfile: () => {
            throw new TypeError("Cannot read properties of undefined (reading 'val')");
        } } } };
        expect(ui.novelColors()).toEqual({ background: 'white', text: 'black' });
    });

    it('should be black on white before the engine is there', () => {
        expect(ui.novelColors()).toEqual({ background: 'white', text: 'black' });
    });
});
