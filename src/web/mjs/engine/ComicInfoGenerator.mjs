export default class ComicInfoGenerator {
    createComicInfoXML(series, title, pagesCount) {
        series = this.escapeXML(series);
        title = this.escapeXML(title);
        return `<?xml version="1.0" encoding="utf-8"?>
<ComicInfo xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
    <Title>${title}</Title>
    <Series>${series}</Series>
    <PageCount>${pagesCount}</PageCount>
</ComicInfo>`;
    }

    escapeXML(str) {
        const symbols = {
            '<': '&lt;',
            '>': '&gt;',
            '&': '&amp;',
            '\'': '&apos;',
            '"': '&quot;'
        };

        // XML 1.0 has no place for a lone surrogate, most control characters, U+FFFE and U+FFFF, not even as an entity
        return str.toWellFormed()
            // eslint-disable-next-line no-control-regex
            .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
            .replace(/[<>&'"]/g, function (c) {
                return symbols[c];
            });
    }
}
