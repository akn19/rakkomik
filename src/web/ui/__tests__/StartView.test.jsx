import { render, screen } from '@testing-library/react';
import QUOTES from '../quotes.js';
import StartView from '../views/Start.jsx';

afterEach(() => {
    vi.restoreAllMocks();
});

function quoteOf(container) {
    return container.querySelector('blockquote');
}

describe('start view', () => {
    it('should welcome the user and explain how to get to a manga', () => {
        render(<StartView />);
        expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Welcome to RakKomik');
        // the five steps of the list: connector, refresh, find, language, chapter
        expect(screen.getAllByRole('listitem')).toHaveLength(5);
        expect(screen.getByText(/Select your connector/)).toBeTruthy();
        expect(screen.getByText(/Click on the refresh button/)).toBeTruthy();
    });

    it('should show one quote with each of its lines and its author', () => {
        const { container } = render(<StartView />);
        const text = quoteOf(container).textContent;
        const shown = QUOTES.filter(quote => text.includes(`— ${quote.author}`) && quote.lines.every(line => text.includes(line)));
        expect(shown.length).toBeGreaterThanOrEqual(1);
        expect(quoteOf(container).querySelectorAll('p')).toHaveLength(shown[0].lines.length);
    });

    it.each([['the first', 0, 0], ['the last', 0.999999, QUOTES.length - 1]])('should be able to show %s quote', (name, random, index) => {
        vi.spyOn(Math, 'random').mockReturnValue(random);
        const { container } = render(<StartView />);
        const paragraphs = [...quoteOf(container).querySelectorAll('p')].map(node => node.textContent);
        expect(paragraphs).toEqual(QUOTES[index].lines);
        expect(quoteOf(container).querySelector('footer').textContent).toBe(`— ${QUOTES[index].author}`);
    });

    it('should keep its quote when it is drawn again, so that the text does not change under the reader', () => {
        const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
        const { container, rerender } = render(<StartView />);
        const before = quoteOf(container).textContent;
        random.mockReturnValue(0.1);
        rerender(<StartView />);
        expect(quoteOf(container).textContent).toBe(before);
    });
});

describe('start view for the screen reader', () => {
    it('should put the parts under second-level headings and hide the emoji', () => {
        const { container } = render(<StartView />);
        expect(screen.getAllByRole('heading', { level: 2 }).map(heading => heading.textContent)).toEqual([
            'Find a site to get the content you want to view',
            'Ready to go 🚀'
        ]);
        expect(screen.queryByRole('heading', { level: 3 })).toBeNull();
        const hidden = [...container.querySelectorAll('[aria-hidden="true"]')].map(node => node.textContent).filter(Boolean);
        expect(hidden).toEqual(['👉', '👉', '🚀', '📚']);
    });
});
