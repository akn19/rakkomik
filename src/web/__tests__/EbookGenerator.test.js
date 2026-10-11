// The documents of an EPUB: the pages of a comic (an image per page) and, for novels, the text of a chapter.
const { expectWellFormed } = require('./support/wellFormed.js');

let EbookGenerator = null;

beforeAll(async () => {
    EbookGenerator = (await import('../mjs/engine/EbookGenerator.mjs')).default;
});

const TITLE = 'Tom & Jerry <3 "Dust" / Chapter 1';
const ESCAPED = 'Tom &amp; Jerry &lt;3 &quot;Dust&quot; / Chapter 1';

describe('escaping for XML', () => {
    it('should escape what XML reserves, the ampersand first', () => {
        expect(EbookGenerator.escapeXML('a & b < c > d "e" &amp; \'f\'')).toBe('a &amp; b &lt; c &gt; d &quot;e&quot; &amp;amp; \'f\'');
    });

    it('should accept what is no text', () => {
        expect(EbookGenerator.escapeXML(undefined)).toBe('undefined');
        expect(EbookGenerator.escapeXML(12)).toBe('12');
    });
});

describe('EPUB of the pages of a comic', () => {
    const pages = [{ img: '001.png', xhtml: '0.xhtml', mime: 'image/png' }];

    it('should escape the title in the package and the table of contents', () => {
        const opf = EbookGenerator.createContentOPF('uid', TITLE, pages);
        const ncx = EbookGenerator.createTocNCX('uid', TITLE, pages);
        expect(opf).toContain(`<dc:title>${ESCAPED}</dc:title>`);
        expect(ncx).toContain(`<text>${ESCAPED}</text>`);
        expectWellFormed(opf);
        expectWellFormed(ncx);
    });

    it('should escape the name of a page', () => {
        const xhtml = EbookGenerator.createPageXHTML('a&b "1".png');
        expect(xhtml).toContain('<title>a&amp;b &quot;1&quot;.png</title>');
        expect(xhtml).toContain('<img alt="a&amp;b &quot;1&quot;.png" src="../img/a&amp;b &quot;1&quot;.png"/>');
    });

    it('should stay the same for plain names', () => {
        expect(EbookGenerator.createPageXHTML('001.png')).toContain('<img alt="001.png" src="../img/001.png"/>');
        expect(EbookGenerator.createContentOPF('uid', 'Manga / Chapter 1', pages)).toContain('<dc:title>Manga / Chapter 1</dc:title>');
    });
});

describe('EPUB of the text of a novel chapter', () => {
    const body = '<p>One &amp; two</p>\n<p><img src="../img/001.jpg" alt=""/></p>';

    it('should wrap the text in a page of its own, under a heading', () => {
        const xhtml = EbookGenerator.createNovelChapterXHTML(TITLE, 'Chapter 1: A & B', body, 'id');
        expect(xhtml.startsWith('<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html')).toBe(true);
        expect(xhtml).toContain('<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="id">');
        expect(xhtml).toContain(`<title>${ESCAPED}</title>`);
        expect(xhtml).toContain(`<body>\n<h1>Chapter 1: A &amp; B</h1>\n${body}\n</body>`);
        expect(xhtml).toContain('href="../css/style.css"');
        expectWellFormed(xhtml);
    });

    it('should escape the language', () => {
        expect(EbookGenerator.createNovelChapterXHTML('T', 'H', body, 'x"y')).toContain('xml:lang="x&quot;y"');
    });

    it('should list the chapter, the style and every illustration, and read the chapter only', () => {
        const opf = EbookGenerator.createNovelContentOPF('uid', TITLE, 'pt-BR', [{ name: '001.jpg', mime: 'image/jpeg' }, { name: '002.webp', mime: 'image/webp' }]);
        expect(opf).toContain(`<dc:title>${ESCAPED}</dc:title>`);
        expect(opf).toContain('<dc:language>pt-BR</dc:language>');
        expect(opf).not.toContain('UNDEFINED');
        expect(opf).toContain('<item id="XHTML_0" href="xhtml/chapter.xhtml" media-type="application/xhtml+xml"/>');
        expect(opf).toContain('<item id="style.css" href="css/style.css" media-type="text/css"/>');
        expect(opf).toContain('<item id="IMG_0" href="img/001.jpg" media-type="image/jpeg"/>');
        expect(opf).toContain('<item id="IMG_1" href="img/002.webp" media-type="image/webp"/>');
        expect(opf.match(/<itemref /g)).toHaveLength(1);
        expect(opf).toContain('<itemref idref="XHTML_0"/>');
        expectWellFormed(opf);
    });

    it('should be a package without illustrations too', () => {
        const opf = EbookGenerator.createNovelContentOPF('uid', 'T', 'und', []);
        expect(opf).not.toContain('IMG_');
        expectWellFormed(opf);
    });

    it('should point the table of contents at the chapter', () => {
        const ncx = EbookGenerator.createNovelTocNCX('uid', TITLE);
        expect(ncx.match(/<navPoint /g)).toHaveLength(1);
        expect(ncx).toContain('<content src="xhtml/chapter.xhtml"/>');
        expect(ncx).toContain(`<docTitle>\n        <text>${ESCAPED}</text>`);
        expect(ncx).toContain('<meta name="dtb:uid" content="uid"/>');
        expectWellFormed(ncx);
    });

    it('should keep the chapter where the package and the table of contents say it is', () => {
        expect(EbookGenerator.novelChapterPath).toBe('OEBPS/xhtml/chapter.xhtml');
        expect(EbookGenerator.createNovelContentOPF('uid', 'T', 'und', [])).toContain(`href="${EbookGenerator.novelChapterPath.replace('OEBPS/', '')}"`);
    });

    it('should style the text and keep the illustrations on the page', () => {
        const css = EbookGenerator.createNovelStyleCSS();
        expect(css).toMatch(/p \{\s+margin: 0 0 1em 0;\s+\}/);
        expect(css).toMatch(/img \{\s+max-width: 100%;\s+\}/);
    });
});

describe('page to print a novel chapter from', () => {
    const body = '<p>One &amp; two</p>\n<p><img src="data:image/png;base64,AAAA" alt=""/></p>';

    it('should hold the text under the heading, as a page of a book', () => {
        const html = EbookGenerator.createNovelPrintHTML(TITLE, 'Chapter 1: A & B', body, 'en');
        expect(html.startsWith('<!DOCTYPE html>\n<html lang="en">')).toBe(true);
        expect(html).toContain(`<title>${ESCAPED}</title>`);
        expect(html).toContain(`<body>\n<h1>Chapter 1: A &amp; B</h1>\n${body}\n</body>`);
        expect(html).toContain('@page { size: A5;');
        expectWellFormed(html);
    });

    it('should not be able to load anything but the illustrations it holds', () => {
        const html = EbookGenerator.createNovelPrintHTML('T', 'H', body, 'en');
        expect(html).toContain('<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; style-src \'unsafe-inline\'"/>');
        expect(html).not.toMatch(/<script|<link|@import|url\(/i);
    });
});

describe('the parts that every EPUB has', () => {
    it('should state the type of an EPUB in the mimetype file, exactly: readers compare it byte for byte', () => {
        expect(EbookGenerator.createMimetype()).toBe('application/epub+zip');
    });

    it('should tell readers where the package of the book is', () => {
        const container = EbookGenerator.createContainerXML();
        expectWellFormed(container);
        expect(container.startsWith('<?xml version="1.0" encoding="UTF-8" ?>')).toBe(true);
        expect(container).toContain('<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">');
        expect(container).toContain('<rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>');
    });

    it('should keep the images of a comic page inside of the page', () => {
        const css = EbookGenerator.createStyleCSS();
        expect(css).toMatch(/img\s*\{[^}]*max-height:\s*100%;[^}]*max-width:\s*100%;[^}]*\}/);
    });
});
