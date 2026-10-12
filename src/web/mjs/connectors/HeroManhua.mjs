import WordPressMadara from './templates/WordPressMadara.mjs';

export default class HeroManhua extends WordPressMadara {
    constructor() {
        super();
        super.id = 'heromanhua';
        super.label = 'HeroManhua ✕ Leveler';
        this.tags = ['webtoon', 'english'];
        this.url = 'https://levelerscans.xyz';
    }
}
