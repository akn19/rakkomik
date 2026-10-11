// @vitest-environment happy-dom
// The ComicInfo.xml that is stored with every chapter of a CBZ archive (Storage._saveChapterPagesCBZ). Comic readers and
// library managers parse it, so the document has to stay well-formed whatever the titles of a site contain.
let ComicInfoGenerator = null;

beforeAll(async () => {
    ComicInfoGenerator = (await import('../mjs/engine/ComicInfoGenerator.mjs')).default;
});

const HEADER = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<ComicInfo xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
];

function create(series, title, pagesCount) {
    return new ComicInfoGenerator().createComicInfoXML(series, title, pagesCount);
}

// the characters that XML 1.0 allows (https://www.w3.org/TR/xml/#charsets), a lone surrogate is none of them
const NOT_AN_XML_CHARACTER = /[^\t\n\r\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/u;

function parse(xml) {
    const document = new DOMParser().parseFromString(xml, 'application/xml');
    expect(document.querySelector('parsererror')).toBeNull();
    return document;
}

// the parser of the DOM environment is lenient about a bare "&" or "<": the escaping itself is asserted on the text
function expectEntitiesOnly(xml) {
    for (const element of ['Title', 'Series']) {
        const text = new RegExp(`<${element}>([\\s\\S]*?)</${element}>`).exec(xml)[1];
        expect(text).not.toMatch(/[<>]/);
        expect(text).not.toMatch(/&(?!(?:amp|lt|gt|quot|apos);)/);
    }
}

describe('createComicInfoXML', () => {
    it('should write the title, the series and the page count in the document of the ComicInfo schema', () => {
        expect(create('One Piece', 'Chapter 1', 12)).toBe([
            ...HEADER,
            '    <Title>Chapter 1</Title>',
            '    <Series>One Piece</Series>',
            '    <PageCount>12</PageCount>',
            '</ComicInfo>'
        ].join('\n'));
    });

    it('should take the series first and the title second, the way Storage hands over the manga and the chapter', () => {
        const document = parse(create('The Manga', 'The Chapter', 3));
        expect(document.querySelector('Series').textContent).toBe('The Manga');
        expect(document.querySelector('Title').textContent).toBe('The Chapter');
    });

    it('should keep the elements in the order of the ComicInfo schema', () => {
        const document = parse(create('S', 'T', 1));
        expect(document.documentElement.tagName).toBe('ComicInfo');
        expect(Array.from(document.documentElement.children).map(element => element.tagName)).toEqual(['Title', 'Series', 'PageCount']);
    });

    it('should declare the encoding that the archive stores: UTF-8', () => {
        expect(create('S', 'T', 1).startsWith('<?xml version="1.0" encoding="utf-8"?>\n')).toBe(true);
    });

    it('should write empty elements for empty names', () => {
        const xml = create('', '', 0);
        expect(xml).toContain('    <Title></Title>\n    <Series></Series>\n    <PageCount>0</PageCount>\n');
        const document = parse(xml);
        expect(document.querySelector('Title').textContent).toBe('');
        expect(document.querySelector('Series').textContent).toBe('');
    });

    it.each([
        ['an ampersand', '&', '&amp;'],
        ['a less-than sign', '<', '&lt;'],
        ['a greater-than sign', '>', '&gt;'],
        ['a double quote', '"', '&quot;'],
        ['a single quote', '\'', '&apos;']
    ])('should escape %s in the title and in the series', (name, character, entity) => {
        const xml = create(`a${character}b`, `c${character}d`, 1);
        expect(xml).toContain(`<Title>c${entity}d</Title>`);
        expect(xml).toContain(`<Series>a${entity}b</Series>`);
    });

    it('should escape every occurrence and escape the ampersand of an entity that is already in the name', () => {
        expect(create('S', '<<&&>> &amp; "\'"\'', 1)).toContain('<Title>&lt;&lt;&amp;&amp;&gt;&gt; &amp;amp; &quot;&apos;&quot;&apos;</Title>');
    });

    it('should not let a name open an element of its own', () => {
        const document = parse(create('<Series>Fake</Series>', '</Title><PageCount>999</PageCount><Title>', 5));
        expect(Array.from(document.documentElement.children).map(element => element.tagName)).toEqual(['Title', 'Series', 'PageCount']);
        expect(document.querySelector('PageCount').textContent).toBe('5');
        expect(document.querySelector('Series').textContent).toBe('<Series>Fake</Series>');
    });

    it.each([
        ['a title that is plain text', 'Fate/stay night: Heaven\'s Feel'],
        ['Japanese', '第1話 日本語のタイトル'],
        ['accents and a right-to-left script', 'Éclair à la crème / مرحبا'],
        ['an emoji, which is a surrogate pair', 'Chapter 7 😀 finale'],
        ['line breaks and tabs', 'line one\nline two\n\tindented'],
        ['markup of a CDATA section', 'a <![CDATA[b]]> c ]]> d'],
        ['a very long title', 'x & y '.repeat(5000)]
    ])('should give a parser back %s unchanged', (name, text) => {
        const xml = create(text, text, 1);
        expectEntitiesOnly(xml);
        const document = parse(xml);
        expect(document.querySelector('Title').textContent).toBe(text);
        expect(document.querySelector('Series').textContent).toBe(text);
    });

    it('should leave characters beyond ASCII as they are, the declared encoding holds them', () => {
        expect(create('日本語', 'Ünïcödé 😀', 1)).toContain('<Title>Ünïcödé 😀</Title>\n    <Series>日本語</Series>');
    });

    it('should write the page count as a number', () => {
        expect(create('S', 'T', 100000)).toContain('<PageCount>100000</PageCount>');
    });

    it('should not share anything between two documents', () => {
        const generator = new ComicInfoGenerator();
        const first = generator.createComicInfoXML('A', 'B', 1);
        expect(generator.createComicInfoXML('C', 'D', 2)).not.toContain('A');
        expect(generator.createComicInfoXML('A', 'B', 1)).toBe(first);
    });

    // NOTE: Storage hands over '' for a missing name (default parameters), the generator itself expects strings
    it('should refuse a name that is no string, instead of writing "undefined" into the archive', () => {
        expect(() => create(undefined, 'T', 1)).toThrow(TypeError);
        expect(() => create('S', null, 1)).toThrow(TypeError);
    });

    // XML 1.0 forbids control characters even as entities: one in a title would make the whole ComicInfo.xml unreadable
    it('should not write a character that XML 1.0 forbids', () => {
        const xml = create('Series\u0000\u0008\u000b\u000c\u001f\ufffe', 'Title\u0001\u001e\uffff\ud800', 1);
        expect(xml).not.toMatch(NOT_AN_XML_CHARACTER);
        // what is left is the text: the characters that are allowed stay, the lone surrogate becomes the replacement character
        expect(xml).toContain('<Series>Series</Series>');
        expect(xml).toContain('<Title>Title\ufffd</Title>');
    });

    it('should keep the control characters that XML allows, and the characters beside the ones that it forbids', () => {
        const document = parse(create('tab\there\nnew line', 'C1 \u0085 \u009f, private \ue000, last \ufffd, 😀', 1));
        expect(document.querySelector('Series').textContent).toBe('tab\there\nnew line');
        expect(document.querySelector('Title').textContent).toBe('C1 \u0085 \u009f, private \ue000, last \ufffd, 😀');
    });
});

describe('escapeXML', () => {
    it('should return a text without special characters as it is', () => {
        const generator = new ComicInfoGenerator();
        expect(generator.escapeXML('')).toBe('');
        expect(generator.escapeXML('Plain text 123 / - _ : ; , . ! ?')).toBe('Plain text 123 / - _ : ; , . ! ?');
    });

    it('should escape all five characters in one text', () => {
        expect(new ComicInfoGenerator().escapeXML('<a href="x">Tom & Jerry\'s</a>')).toBe('&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&apos;s&lt;/a&gt;');
    });
});
