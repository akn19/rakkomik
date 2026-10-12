import WordPressMadara from './WordPressMadara.mjs';

export default class WordPressMadaraNovel extends WordPressMadara {
    constructor() {
        super();

        this.novelContentQuery = 'div.reading-content div[class^="text-"';
        this.novelObstaclesQuery = '_';
    }

    async _getPages(chapter) {
        let uri = new URL(chapter.id, this.url);
        uri.searchParams.set('style', 'list');
        let request = new Request(uri, this.requestOptions);
        let data = await this.fetchDOM(request, this.novelContentQuery);
        return data.length > 0 ? this._getPagesNovel(request) : super._getPages(chapter);
    }

    async _getPagesNovel(request) {
        return [
            await Engine.Request.fetchNovel(request, 'div.entry-content', {
                obstacles: this.novelObstaclesQuery,
            }),
        ];
    }
}
