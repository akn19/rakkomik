export default class EbookGenerator {
    /**
     * Make a text safe to be put into XML, as content or as the value of an attribute.
     */
    static escapeXML(text) {
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    static createMimetype() {
        return 'application/epub+zip';
    }

    // TODO: use array and join with '\n' instead of string concatenation
    static createContainerXML() {
        let content = '';
        content += '<?xml version="1.0" encoding="UTF-8" ?>\n';
        content +=
            '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n';
        content += '    <rootfiles>\n';
        content +=
            '        <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>\n';
        content += '    </rootfiles>\n';
        content += '</container>\n';
        return content;
    }

    static createStyleCSS() {
        let content = '';
        content += 'img {\n';
        content += '    max-height: 100%;\n';
        content += '    max-width: 100%;\n';
        content += '}\n';
        return content;
    }

    static createPageXHTML(pageName) {
        let content = '';
        content += '<?xml version="1.0" encoding="utf-8"?>\n';
        content +=
            '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">\n';
        content += '<html xmlns="http://www.w3.org/1999/xhtml">\n';
        content += '<head>\n';
        content += '    <link href="../css/style.css" rel="stylesheet" type="text/css"/>\n';
        content += '    <title>' + EbookGenerator.escapeXML(pageName) + '</title>\n';
        content += '</head>\n';
        content += '<body>\n';
        content += '    <div>\n';
        content +=
            '        <img alt="' +
            EbookGenerator.escapeXML(pageName) +
            '" src="../img/' +
            EbookGenerator.escapeXML(pageName) +
            '"/>\n';
        content += '    </div>\n';
        content += '</body>\n';
        content += '</html>\n';
        return content;
    }

    static createContentOPF(uid, title, pages) {
        let content = '';
        content += '<?xml version="1.0" encoding="UTF-8"?>\n';
        content +=
            '<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="' +
            uid +
            '" version="2.0">\n';
        content +=
            '    <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">\n';
        content += '        <dc:title>' + EbookGenerator.escapeXML(title) + '</dc:title>\n';
        content += '        <dc:language>en-UNDEFINED</dc:language>\n';
        content +=
            '        <dc:identifier id="' +
            uid +
            '" opf:scheme="UUID">' +
            uid +
            '</dc:identifier>\n';
        content += '    </metadata>\n';
        content += '    <manifest>\n';
        content +=
            '        <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>\n';
        content += '        <item id="style.css" href="css/style.css" media-type="text/css"/>\n';
        pages.forEach((page, index) => {
            content +=
                '        <item id="IMG_' +
                index +
                '" href="img/' +
                page.img +
                '" media-type="' +
                page.mime +
                '"/>\n';
            content +=
                '        <item id="XHTML_' +
                index +
                '" href="xhtml/' +
                page.xhtml +
                '" media-type="application/xhtml+xml"/>\n';
        });
        content += '    </manifest>\n';
        content += '    <spine toc="ncx">\n';
        pages.forEach((page, index) => {
            content += '        <itemref idref="XHTML_' + index + '"/>\n';
        });
        content += '    </spine>\n';
        content += '</package>\n';
        return content;
    }

    static createTocNCX(uid, title, pages) {
        let content = '';
        content += '<?xml version="1.0" encoding="UTF-8"?>\n';
        content += '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">\n';
        content += '    <head>\n';
        content += '        <meta name="dtb:uid" content="' + uid + '"/>\n';
        content += '    </head>\n';
        content += '    <docTitle>\n';
        content += '        <text>' + EbookGenerator.escapeXML(title) + '</text>\n';
        content += '    </docTitle>\n';
        content += '    <navMap>\n';
        pages.forEach((page, index) => {
            index++;
            content += '        <navPoint id="TOC_' + index + '" playOrder="' + index + '">\n';
            content += '            <navLabel>\n';
            content += '                <text>Page ' + index + '</text>\n';
            content += '            </navLabel>\n';
            content += '            <content src="xhtml/' + page.xhtml + '"/>\n';
            content += '        </navPoint>\n';
        });
        content += '    </navMap>\n';
        content += '</ncx>\n';
        return content;
    }

    /**
     * Where the text of a novel chapter lives in an EPUB made by `createNovel...`; the reader finds its text there.
     */
    static get novelChapterPath() {
        return 'OEBPS/xhtml/chapter.xhtml';
    }

    static createNovelStyleCSS() {
        return [
            'body {',
            '    margin: 5%;',
            '    line-height: 1.5;',
            '}',
            'h1, h2, h3, h4, h5, h6 {',
            '    text-align: center;',
            '    line-height: 1.25;',
            '}',
            'p {',
            '    margin: 0 0 1em 0;',
            '}',
            'blockquote {',
            '    margin: 1em 2em;',
            '}',
            'pre {',
            '    white-space: pre-wrap;',
            '}',
            'hr {',
            '    margin: 2em 0;',
            '}',
            'img {',
            '    max-width: 100%;',
            '}',
            '',
        ].join('\n');
    }

    /**
     * @param {string} title title of the document
     * @param {string} heading heading above the text
     * @param {string} body XHTML fragment with the text of the chapter
     * @param {string} language language of the text (BCP 47)
     */
    static createNovelChapterXHTML(title, heading, body, language) {
        let content = '';
        content += '<?xml version="1.0" encoding="utf-8"?>\n';
        content +=
            '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">\n';
        content +=
            '<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="' +
            EbookGenerator.escapeXML(language) +
            '">\n';
        content += '<head>\n';
        content += '    <link href="../css/style.css" rel="stylesheet" type="text/css"/>\n';
        content += '    <title>' + EbookGenerator.escapeXML(title) + '</title>\n';
        content += '</head>\n';
        content += '<body>\n';
        content += '<h1>' + EbookGenerator.escapeXML(heading) + '</h1>\n';
        content += body + '\n';
        content += '</body>\n';
        content += '</html>\n';
        return content;
    }

    /**
     * @param {string} uid identifier of the book
     * @param {string} title title of the book
     * @param {string} language language of the text (BCP 47)
     * @param {Array<{ name: string, mime: string }>} images file name (in `img`) and media type of each illustration
     */
    static createNovelContentOPF(uid, title, language, images) {
        let content = '';
        content += '<?xml version="1.0" encoding="UTF-8"?>\n';
        content +=
            '<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="' +
            uid +
            '" version="2.0">\n';
        content +=
            '    <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">\n';
        content += '        <dc:title>' + EbookGenerator.escapeXML(title) + '</dc:title>\n';
        content +=
            '        <dc:language>' + EbookGenerator.escapeXML(language) + '</dc:language>\n';
        content +=
            '        <dc:identifier id="' +
            uid +
            '" opf:scheme="UUID">' +
            uid +
            '</dc:identifier>\n';
        content += '    </metadata>\n';
        content += '    <manifest>\n';
        content +=
            '        <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>\n';
        content += '        <item id="style.css" href="css/style.css" media-type="text/css"/>\n';
        content +=
            '        <item id="XHTML_0" href="xhtml/chapter.xhtml" media-type="application/xhtml+xml"/>\n';
        images.forEach((image, index) => {
            content +=
                '        <item id="IMG_' +
                index +
                '" href="img/' +
                EbookGenerator.escapeXML(image.name) +
                '" media-type="' +
                EbookGenerator.escapeXML(image.mime) +
                '"/>\n';
        });
        content += '    </manifest>\n';
        content += '    <spine toc="ncx">\n';
        content += '        <itemref idref="XHTML_0"/>\n';
        content += '    </spine>\n';
        content += '</package>\n';
        return content;
    }

    static createNovelTocNCX(uid, title) {
        let content = '';
        content += '<?xml version="1.0" encoding="UTF-8"?>\n';
        content += '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">\n';
        content += '    <head>\n';
        content += '        <meta name="dtb:uid" content="' + uid + '"/>\n';
        content += '    </head>\n';
        content += '    <docTitle>\n';
        content += '        <text>' + EbookGenerator.escapeXML(title) + '</text>\n';
        content += '    </docTitle>\n';
        content += '    <navMap>\n';
        content += '        <navPoint id="TOC_1" playOrder="1">\n';
        content += '            <navLabel>\n';
        content += '                <text>' + EbookGenerator.escapeXML(title) + '</text>\n';
        content += '            </navLabel>\n';
        content += '            <content src="xhtml/chapter.xhtml"/>\n';
        content += '        </navPoint>\n';
        content += '    </navMap>\n';
        content += '</ncx>\n';
        return content;
    }

    /**
     * The page the main process prints a novel chapter from (see PdfBridge): a book page (A5) of text, with the
     * illustrations in it as `data:` URLs, and nothing it could load or run from anywhere else.
     * @param {string} title title of the document
     * @param {string} heading heading above the text
     * @param {string} body XHTML fragment with the text of the chapter
     * @param {string} language language of the text (BCP 47)
     */
    static createNovelPrintHTML(title, heading, body, language) {
        return [
            '<!DOCTYPE html>',
            '<html lang="' + EbookGenerator.escapeXML(language) + '">',
            '<head>',
            '<meta charset="utf-8"/>',
            '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; style-src \'unsafe-inline\'"/>',
            '<title>' + EbookGenerator.escapeXML(title) + '</title>',
            '<style>',
            '@page { size: A5; margin: 16mm 14mm; }',
            'body { font-family: serif; font-size: 11pt; line-height: 1.5; margin: 0; }',
            'h1, h2, h3, h4, h5, h6 { text-align: center; line-height: 1.25; break-after: avoid; }',
            'h1 { font-size: 1.6em; margin: 0 0 1.2em 0; }',
            'p { margin: 0 0 0.8em 0; }',
            'blockquote { margin: 1em 2em; }',
            'pre { white-space: pre-wrap; }',
            'hr { margin: 2em 0; }',
            'img { display: block; margin: 1em auto; max-width: 100%; max-height: 170mm; break-inside: avoid; }',
            '</style>',
            '</head>',
            '<body>',
            '<h1>' + EbookGenerator.escapeXML(heading) + '</h1>',
            body,
            '</body>',
            '</html>',
            '',
        ].join('\n');
    }
}
