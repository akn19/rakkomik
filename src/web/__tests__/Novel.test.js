// A novel is text: its chapter is cleaned up into XHTML in the page it was loaded in, travels as a "novel page" and
// is stored as an EPUB or a PDF. The cleaning (`serializeNovel`) works on any DOM node; here it runs on the test
// double of support/fakeDOM.js, the real DOM is covered by the end-to-end tests.
const vm = require('node:vm');
const { createElement, createText, parseHTML } = require('./support/fakeDOM.js');
const { expectWellFormed } = require('./support/wellFormed.js');

let Novel = null;

beforeAll(async () => {
    Novel = await import('../mjs/engine/Novel.mjs');
});

afterEach(() => {
    vi.useRealTimers();
});

function serialize(markup, options, parseOptions) {
    const { body } = parseHTML(markup, parseOptions);
    return Novel.serializeNovel(body, options);
}

describe('novel pages', () => {
    const chapter = '<p>Tom &amp; Jerry — 100% #1 “novel”</p>\n<p>漢字 ½</p>';

    it('should carry a chapter as the URL of a page and read it back', () => {
        const page = Novel.createNovelPage(chapter);
        expect(page.startsWith('data:application/xhtml+xml;charset=utf-8,')).toBe(true);
        expect(Novel.isNovelPage(page)).toBe(true);
        expect(Novel.readNovelPage(page)).toBe(chapter);
    });

    it('should be fetchable as a page: only characters a URL allows', () => {
        expect(Novel.createNovelPage(chapter)).toMatch(/^data:[a-z+/]+;charset=utf-8,[A-Za-z0-9%\-_.!~*'()]*$/);
    });

    it('should tell novel pages from everything else a page list holds', () => {
        expect(Novel.isNovelPage('https://site.example/1.jpg')).toBe(false);
        expect(Novel.isNovelPage('data:image/png;base64,AAAA')).toBe(false);
        expect(Novel.isNovelPage('data:application/xhtml+xml;base64,AAAA')).toBe(false);
        expect(Novel.isNovelPage(undefined)).toBe(false);
        expect(Novel.isNovelPage({})).toBe(false);
    });

    it('should refuse to read a page that is no novel page', () => {
        expect(() => Novel.readNovelPage('https://site.example/1.jpg')).toThrow(TypeError);
    });

    it('should recognise a downloaded novel page by its type', () => {
        expect(Novel.isNovelBlob(new Blob(['<p/>'], { type: 'application/xhtml+xml;charset=utf-8' }))).toBe(true);
        expect(Novel.isNovelBlob(new Blob(['<p/>'], { type: 'application/xhtml+xml' }))).toBe(true);
        expect(Novel.isNovelBlob(new Blob(['x'], { type: 'image/png' }))).toBe(false);
        expect(Novel.isNovelBlob(new Blob(['x']))).toBe(false);
        expect(Novel.isNovelBlob(undefined)).toBe(false);
    });
});

describe('novel illustrations', () => {
    const chapter = [
        '<p>One</p>',
        '<p><img src="https://cdn.example/a.jpg?x=1&amp;y=&quot;2&quot;" alt="A"/></p>',
        '<p><img src="https://cdn.example/b.png" alt=""/><img src="https://cdn.example/a.jpg?x=1&amp;y=&quot;2&quot;" alt="again"/></p>'
    ].join('\n');

    it('should list each illustration once, as the address it was loaded from', () => {
        expect(Novel.listNovelImages(chapter)).toEqual(['https://cdn.example/a.jpg?x=1&y="2"', 'https://cdn.example/b.png']);
        expect(Novel.listNovelImages('<p>No pictures</p>')).toEqual([]);
    });

    it('should replace the address of every illustration and escape the new one', () => {
        const result = Novel.replaceNovelImages(chapter, source => source.endsWith('b.png') ? '../img/002.png' : '../img/001.jpg?a=1&b=2');
        expect(result).toContain('<img src="../img/001.jpg?a=1&amp;b=2" alt="A"/>');
        expect(result).toContain('<img src="../img/002.png" alt=""/>');
        expect(result).toContain('<img src="../img/001.jpg?a=1&amp;b=2" alt="again"/>');
        expect(result).not.toContain('cdn.example');
    });

    it('should keep a replacement as it is, whatever characters it holds', () => {
        expect(Novel.replaceNovelImages('<img src="a" alt=""/>', () => 'x$&y')).toBe('<img src="x$&amp;y" alt=""/>');
    });

    it('should remove the illustrations that have no replacement', () => {
        const result = Novel.replaceNovelImages(chapter, source => source.endsWith('b.png') ? undefined : '../img/001.jpg');
        expect(result).not.toContain('b.png');
        expect(result.match(/<img\b/g)).toHaveLength(2);
        expect(result).toContain('<p>One</p>');
    });

    it('should not take the source of another attribute', () => {
        expect(Novel.listNovelImages('<img data-src="https://cdn.example/x.png" alt=""/>')).toEqual([]);
    });
});

describe('serializing the text of a chapter', () => {
    it('should keep paragraphs, headings and emphasis', () => {
        expect(serialize('<h2>Chapter 1</h2><p>Hello <em>brave</em> <b>new</b> <i>world</i>.</p><p>Second</p>'))
            .toBe('<h2>Chapter 1</h2>\n<p>Hello <em>brave</em> <strong>new</strong> <em>world</em>.</p>\n<p>Second</p>');
    });

    it('should fold the emphasis elements into the ones every ebook reader knows', () => {
        expect(serialize('<p><s>a</s> <strike>b</strike> <del>c</del> <code>d</code> <kbd>e</kbd> H<sub>2</sub>O x<sup>2</sup> <small>f</small> <u>g</u> <mark>h</mark></p>'))
            .toBe('<p><del>a</del> <del>b</del> <del>c</del> <code>d</code> <code>e</code> H<sub>2</sub>O x<sup>2</sup> <small>f</small> g h</p>');
    });

    it('should wrap text that is not in a paragraph, and split it where two line breaks end one', () => {
        expect(serialize('Intro line<br><br>Second paragraph<br>with a break<br><br><br>Third'))
            .toBe('<p>Intro line</p>\n<p>Second paragraph<br/>with a break</p>\n<p>Third</p>');
    });

    it('should keep the line breaks inside of a paragraph', () => {
        expect(serialize('<p>Roses are red<br>Violets are blue<br><br>Sugar is sweet</p>'))
            .toBe('<p>Roses are red<br/>Violets are blue<br/><br/>Sugar is sweet</p>');
    });

    it('should drop the line breaks at the ends of a paragraph', () => {
        expect(serialize('<p><br>Text<br></p>')).toBe('<p>Text</p>');
    });

    it('should drop scripts, styles, frames, forms and advertisements together with their content', () => {
        expect(serialize('<p>Keep</p><script>alert(1)</script><style>p{}</style><iframe src="x">frame</iframe><form><input value="x"><button>Buy</button></form><div class="ad"><ins>ad</ins></div><nav>menu</nav><noscript>js</noscript><p>Also</p>'))
            .toBe('<p>Keep</p>\n<p>Also</p>');
    });

    it('should keep the text of links and spans, but not their attributes', () => {
        expect(serialize('<p>Go <a href="javascript:alert(1)" onclick="x()">here</a> <span class="x" style="color:red">now</span>.</p>'))
            .toBe('<p>Go here now.</p>');
    });

    it('should keep the base text of a ruby annotation only', () => {
        expect(serialize('<p><ruby>漢<rp>(</rp><rt>かん</rt><rp>)</rp></ruby>字</p>')).toBe('<p>漢字</p>');
    });

    it('should escape what XML reserves', () => {
        expect(serialize('<p>Tom &amp; Jerry &lt;3 &gt; ok &quot;quoted&quot;</p>')).toBe('<p>Tom &amp; Jerry &lt;3 &gt; ok "quoted"</p>');
    });

    it('should remove the characters XML 1.0 does not allow, and replace broken surrogates', () => {
        const root = createElement('div', {}, [createElement('p', {}, [createText('a\u0001b\u000Bc￾d\uD800e😀f')])]);
        const result = Novel.serializeNovel(root);
        expect(result).toBe('<p>abcd�e😀f</p>');
        expectWellFormed(result);
    });

    it('should collapse white space like a browser does, and keep non-breaking spaces', () => {
        expect(serialize('<p>  a \n\t b   <em> c </em> d  </p>')).toBe('<p>a b <em> c </em> d</p>');
    });

    it('should drop paragraphs that only space things out', () => {
        expect(serialize('<p>&nbsp;</p><p> </p><p><br></p><p>​</p><p>Text</p><p><em> </em></p>')).toBe('<p>Text</p>');
    });

    it('should keep the white space of preformatted text', () => {
        expect(serialize('<pre>line 1\n  line 2</pre>')).toBe('<pre>line 1\n  line 2</pre>');
    });

    it('should keep lists, quotes and rules', () => {
        expect(serialize('<ul><li>One</li><li>Two <b>x</b></li><li hidden>No</li>text</ul><ol><li><p>P</p></li></ol><blockquote>Quote<br><br>More</blockquote><hr>'))
            .toBe('<ul><li><p>One</p></li><li><p>Two <strong>x</strong></p></li></ul>\n<ol><li><p>P</p></li></ol>\n<blockquote><p>Quote</p><p>More</p></blockquote>\n<hr/>');
    });

    it('should make paragraphs of blocks that are wrapped in inline elements', () => {
        expect(serialize('<a href="x"><div>Linked paragraph</div></a><span>and <div>block in span</div> tail</span>'))
            .toBe('<p>Linked paragraph</p>\n<p>and</p>\n<p>block in span</p>\n<p>tail</p>');
    });

    it('should only separate words with a block inside of a paragraph or a heading', () => {
        expect(serialize('<p>one<div>two</div>three</p>')).toBe('<p>one two three</p>');
        expect(serialize('<h3>Title<br>part<div>two</div></h3>')).toBe('<h3>Title<br/>part two</h3>');
    });

    it('should flatten tables to their cells', () => {
        expect(serialize('<table><tr><td>A</td><td>B</td></tr></table>')).toBe('<p>A</p>\n<p>B</p>');
    });

    it('should return nothing when there is no text', () => {
        expect(serialize('<div><script>x</script></div>')).toBe('');
        expect(serialize('')).toBe('');
        expect(serialize('<p> </p>')).toBe('');
    });

    it('should not fail on a document nested too deep to be a chapter', () => {
        expect(serialize('<div>'.repeat(300) + 'deep' + '</div>'.repeat(300))).toBe('');
        expect(serialize('<div>'.repeat(150) + 'shallow enough' + '</div>'.repeat(150))).toBe('<p>shallow enough</p>');
    });

    it('should leave out the nodes that are neither text nor elements, like comments', () => {
        // the test double does not parse comments, so they are put into the tree by hand
        const body = createElement('body', {}, [
            { nodeType: 8, nodeValue: 'a comment that must not be shown' },
            createElement('p', {}, [createText('shown')]),
            { nodeType: 7, nodeValue: 'an instruction' }
        ]);
        expect(Novel.serializeNovel(body)).toBe('<p>shown</p>');
    });

    it('should keep the text of CDATA sections like any other text', () => {
        const body = createElement('body', {}, [createElement('p', {}, [{ nodeType: 4, nodeValue: 'cdata <text>' }])]);
        expect(Novel.serializeNovel(body)).toBe('<p>cdata &lt;text&gt;</p>');
    });

    it('should always produce well-formed XHTML', () => {
        const result = serialize('<div><p>A &amp; B <em>x<b>y</em> z</b></p>Loose <u>text</u><br><br><ul><li>i<li>j</ul><img src="/a.png" alt="&lt;&amp;&quot;"><p>"quotes" & <tags></p></div>');
        expect(result).not.toBe('');
        expectWellFormed(result);
    });
});

describe('what is not part of the text', () => {
    it('should drop the elements an obstacle selector matches', () => {
        const { body } = parseHTML('<div class="content"><p>One</p><div class="ads"><p>Buy now</p></div><p>Two</p></div>');
        expect(Novel.serializeNovel(body.querySelector('.content'), { obstacles: '.ads' })).toBe('<p>One</p>\n<p>Two</p>');
    });

    it('should drop the obstacles of a list of selectors', () => {
        const { body } = parseHTML('<div class="content"><p class="a">One</p><p class="b">Two</p><p>Three</p></div>');
        expect(Novel.serializeNovel(body.querySelector('.content'), { obstacles: '.a, .b' })).toBe('<p>Three</p>');
    });

    it('should not exclude anything with a selector that does not parse', () => {
        const { body } = parseHTML('<div class="content"><p>One</p><div class="ads"><p>Buy now</p></div></div>');
        expect(Novel.serializeNovel(body.querySelector('.content'), { obstacles: 'div!' })).toBe('<p>One</p>\n<p>Buy now</p>');
    });

    it('should drop the paragraphs that only advertise the site', () => {
        const options = { ignoredTexts: ['https://novels.example'] };
        expect(serialize('<p>https://novels.example</p><p>  https://novels.example </p><p>Story https://novels.example</p><p>Story</p>', options))
            .toBe('<p>Story https://novels.example</p>\n<p>Story</p>');
    });

    it('should drop hidden text: by attribute, display and visibility', () => {
        const style = element => ({ display: /display:\s*none/.test(element.attrs.style || '') ? 'none' : 'block', visibility: /visibility:\s*hidden/.test(element.attrs.style || '') ? 'hidden' : 'visible' });
        expect(serialize('<p hidden>attribute</p><p style="display: none">display</p><p style="visibility:hidden">visibility</p><div style="display:none"><p>nested</p></div><p>shown</p>', {}, { style }))
            .toBe('<p>shown</p>');
    });

    it('should show everything when the document cannot tell what is hidden', () => {
        expect(serialize('<p style="display:none">no styles here</p>')).toBe('<p>no styles here</p>');
        const failing = { style: () => { throw new Error('detached'); } };
        expect(serialize('<p>fine</p>', {}, failing)).toBe('<p>fine</p>');
    });
});

describe('illustrations in a chapter', () => {
    it('should resolve addresses against the page', () => {
        expect(serialize('<img src="/images/a.jpg" alt="A"><img src="b.jpg"><img src="//cdn.example/c.jpg"><img src="https://other.example/d.jpg">'))
            .toBe('<p><img src="https://novels.example/images/a.jpg" alt="A"/><img src="https://novels.example/series/1/b.jpg" alt=""/><img src="https://cdn.example/c.jpg" alt=""/><img src="https://other.example/d.jpg" alt=""/></p>');
    });

    it('should resolve against the base the caller gives when the document has none', () => {
        expect(serialize('<img src="a.jpg">', { baseURI: 'https://base.example/dir/' }, { baseURI: '' }))
            .toBe('<p><img src="https://base.example/dir/a.jpg" alt=""/></p>');
        expect(serialize('<img src="a.jpg">', {}, { baseURI: '' })).toBe('');
    });

    it('should prefer the address a lazy loader keeps, over the placeholder in src', () => {
        expect(serialize('<img src="data:image/gif;base64,R0lGOD" data-src="/real.png"><img src="/p.png" data-lazy-src="/real2.png"><img src="/p.png" data-original="/real3.png">'))
            .toBe('<p><img src="https://novels.example/real.png" alt=""/><img src="https://novels.example/real2.png" alt=""/><img src="https://novels.example/real3.png" alt=""/></p>');
    });

    it('should only load illustrations over the protocols the caller allows', () => {
        const markup = '<img src="javascript:alert(1)"><img src="ftp://x.example/y.png"><img src="file:///etc/passwd"><img src="data:text/html,<b>x</b>"><img src="data:image/png;base64,AAAA"><img src="https://a.example/ok.png">';
        expect(serialize(markup)).toBe('<p><img src="data:image/png;base64,AAAA" alt=""/><img src="https://a.example/ok.png" alt=""/></p>');
        expect(serialize('<img src="file:///tmp/a.png"><img src="https://a.example/ok.png">', { protocols: ['file:'] }))
            .toBe('<p><img src="file:///tmp/a.png" alt=""/></p>');
    });

    it('should drop tracking pixels and images without an address', () => {
        expect(serialize('<img src="/t.gif" width="1" height="1"><img src="/t.gif" width="2"><img><img src=" "><p>Text</p>')).toBe('<p>Text</p>');
    });

    it('should escape the address and the description', () => {
        const result = serialize('<img src="/a.jpg?x=1&amp;y=2" alt="A &quot;pic&quot; &lt;b&gt; &amp; c">');
        expect(result).toBe('<p><img src="https://novels.example/a.jpg?x=1&amp;y=2" alt="A &quot;pic&quot; &lt;b&gt; &amp; c"/></p>');
        expectWellFormed(result);
    });

    it('should keep a chapter that is only an illustration', () => {
        expect(serialize('<div><img src="/page.jpg"></div>')).toBe('<p><img src="https://novels.example/page.jpg" alt=""/></p>');
    });
});

// The script runs in the page of a hidden window. Here it runs in a context that holds nothing but what a page has,
// so it fails if it refers to anything of this module.
describe('the script for the hidden window', () => {
    function run(script, document) {
        return vm.runInNewContext(script, { document, setTimeout, Date, URL });
    }

    beforeEach(() => {
        vi.useFakeTimers();
    });

    it('should resolve with the XHTML of the content', async () => {
        const { document } = parseHTML('<div class="menu">Menu</div><div class="content"><p>One</p><p class="ad">Buy</p><p>https://novels.example</p><p>Two</p></div>');
        const result = run(Novel.createNovelScript('.content', { obstacles: '.ad', ignoredTexts: ['https://novels.example'] }), document);
        await vi.advanceTimersByTimeAsync(300);
        await expect(result).resolves.toBe('<p>One</p>\n<p>Two</p>');
    });

    it('should wait for the content to show up, and for it to stop growing', async () => {
        const { document, body } = parseHTML('');
        const result = run(Novel.createNovelScript('.content'), document);
        await vi.advanceTimersByTimeAsync(100);
        const content = createElement('div', { class: 'content' }, [createElement('p', {}, [createText('Loading')], document)], document);
        body.childNodes.push(content);
        await vi.advanceTimersByTimeAsync(100);
        content.childNodes[0].childNodes[0].nodeValue = 'Loading the whole chapter';
        await vi.advanceTimersByTimeAsync(2000);
        await expect(result).resolves.toBe('<p>Loading the whole chapter</p>');
    });

    it('should give up when the content never shows up', async () => {
        const { document } = parseHTML('<p>Something else</p>');
        const result = expect(run(Novel.createNovelScript('.content'), document)).rejects.toMatchObject({ message: 'The novel content ".content" was not found!' });
        await vi.advanceTimersByTimeAsync(11000);
        await result;
    });

    it('should take what is there when the content keeps growing until the time is up', async () => {
        const { document, body } = parseHTML('');
        const content = createElement('div', { class: 'content' }, [createElement('p', {}, [createText('0')], document)], document);
        body.childNodes.push(content);
        const result = run(Novel.createNovelScript('.content', { timeout: 1000 }), document);
        for (let step = 1; step <= 8; step++) {
            await vi.advanceTimersByTimeAsync(200);
            content.childNodes[0].childNodes[0].nodeValue += step;
        }
        await expect(result).resolves.toMatch(/^<p>0\d+<\/p>$/);
    });

    it('should reject when the content has no text', async () => {
        const { document } = parseHTML('<div class="content"><script>x</script></div>');
        const result = expect(run(Novel.createNovelScript('.content'), document)).rejects.toMatchObject({ message: 'The novel content ".content" has no text!' });
        await vi.advanceTimersByTimeAsync(300);
        await result;
    });

    it('should hand the selectors over safely, whatever characters they hold', () => {
        const script = Novel.createNovelScript('div[data-id="a\'b"] > p', { obstacles: 'a[href*="`${x}`"]', ignoredTexts: ['it\'s "quoted" \\ ${no}'] });
        expect(() => new vm.Script(script)).not.toThrow();
        expect(script).toContain(JSON.stringify('div[data-id="a\'b"] > p'));
    });

    it('should be sent as code without a reference to this module', () => {
        const script = Novel.createNovelScript('.content');
        expect(script).not.toMatch(/\bexport\b|\bimport\b|Novel\./);
        expect(script.startsWith('(function waitForNovel(serialize, parameters)')).toBe(true);
    });
});

describe('taking a novel from a page', () => {
    let Request = null;

    beforeAll(async () => {
        Request = (await import('../mjs/engine/Request.mjs')).default;
    });

    function fetchNovel(fetchUI, ...parameters) {
        return Request.prototype.fetchNovel.call({ fetchUI }, ...parameters);
    }

    it('should load the page in a hidden window and hand back the text as a novel page', async () => {
        const fetchUI = vi.fn(async () => '<p>Text &amp; more</p>');
        const request = { url: 'https://novels.example/series/1/chapter-1' };
        const page = await fetchNovel(fetchUI, request, 'div.content', { obstacles: '.ad', ignoredTexts: ['https://novels.example'] });
        expect(Novel.isNovelPage(page)).toBe(true);
        expect(Novel.readNovelPage(page)).toBe('<p>Text &amp; more</p>');
        expect(fetchUI).toHaveBeenCalledTimes(1);
        const [loaded, script, timeout, images] = fetchUI.mock.calls[0];
        expect(loaded).toBe(request);
        expect(script).toBe(Novel.createNovelScript('div.content', { obstacles: '.ad', ignoredTexts: ['https://novels.example'] }));
        expect(timeout).toBe(30000);
        // the pictures of the page are not needed to take its text
        expect(images).toBeUndefined();
    });

    it('should need no more than the element that holds the text', async () => {
        const fetchUI = vi.fn(async () => '<p>Text</p>');
        await fetchNovel(fetchUI, { url: 'https://novels.example/1' }, 'article');
        expect(fetchUI.mock.calls[0][1]).toBe(Novel.createNovelScript('article'));
    });

    it('should fail when there is no text to take', async () => {
        for (const answer of ['', undefined, null, 42, ['<p>Text</p>']]) {
            await expect(fetchNovel(async () => answer, { url: 'https://novels.example/1' }, 'article'))
                .rejects.toThrow('No text was found in the chapter "https://novels.example/1"!');
        }
    });

    it('should fail the way the hidden window fails', async () => {
        await expect(fetchNovel(async () => {
            throw new Error('The novel content "article" was not found!');
        }, { url: 'https://novels.example/1' }, 'article')).rejects.toThrow('The novel content "article" was not found!');
    });
});
