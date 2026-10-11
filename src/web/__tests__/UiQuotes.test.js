// The quotes of the start view are data, but the view reads them without a check: one entry in the wrong shape would
// take the whole view down (`quote.lines.map`), and a repeated line would give two React children the same key.
let QUOTES = null;

beforeAll(async () => {
    QUOTES = (await import('../ui/quotes.js')).default;
});

describe('quotes of the start view', () => {
    it('should be a list with plenty to choose from', () => {
        expect(Array.isArray(QUOTES)).toBe(true);
        expect(QUOTES.length).toBeGreaterThan(50);
    });

    it('should have exactly the members that the view reads: lines and author', () => {
        for (const quote of QUOTES) {
            expect(Object.keys(quote).sort()).toEqual(['author', 'lines']);
        }
    });

    it('should give every quote an author', () => {
        for (const quote of QUOTES) {
            expect(typeof quote.author).toBe('string');
            expect(quote.author.trim()).toBe(quote.author);
            expect(quote.author.length).toBeGreaterThan(0);
        }
    });

    it('should give every quote at least one line of text, without a line that is empty or padded', () => {
        for (const quote of QUOTES) {
            expect(Array.isArray(quote.lines)).toBe(true);
            expect(quote.lines.length).toBeGreaterThan(0);
            for (const line of quote.lines) {
                expect(typeof line).toBe('string');
                expect(line.trim()).toBe(line);
                expect(line.length).toBeGreaterThan(0);
            }
        }
    });

    it('should not repeat a line within a quote, because the view uses the line as the key of its paragraph', () => {
        for (const quote of QUOTES) {
            expect(new Set(quote.lines).size).toBe(quote.lines.length);
        }
    });

    it('should not list the same quote twice', () => {
        const texts = QUOTES.map(quote => `${quote.lines.join(' ')} -- ${quote.author}`);
        expect(texts.filter((text, index) => texts.indexOf(text) !== index)).toEqual([]);
    });
});
