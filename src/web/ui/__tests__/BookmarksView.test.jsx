import { act, fireEvent, screen, within } from '@testing-library/react';
import BookmarksView from '../views/BookmarksView.jsx';
import { addManga, createConnector, installEngine } from './support/fakeEngine.js';
import { renderWithProviders } from './support/render.jsx';

let engine = null;
let site = null;

function bookmark(title, connector = site) {
    const manga = addManga(connector, { title });
    engine.BookmarkManager.addBookmark(manga);
    return manga;
}

// the question that asks to confirm; its button has the same name as the buttons of the rows
function question() {
    return within(screen.getByText('Remove bookmark?').closest('.fixed'));
}

function rows() {
    return screen
        .getAllByTitle(/^Remove /)
        .map((button) => button.closest('.flex').querySelector('.truncate').textContent);
}

beforeEach(() => {
    site = createConnector({ id: 'site', label: 'Site' });
    engine = installEngine({ connectors: [site] });
});

describe('bookmarks view', () => {
    it('should say that there are no bookmarks, and show no list', () => {
        renderWithProviders(<BookmarksView />, { selection: false });
        expect(screen.getByText(/No bookmarks yet/)).toBeTruthy();
        expect(screen.queryByTitle(/^Remove /)).toBeNull();
    });

    it('should list the bookmarks with the website they belong to', () => {
        bookmark('Berserk');
        bookmark('Akira', createConnector({ id: 'other', label: 'Other Site' }));
        renderWithProviders(<BookmarksView />, { selection: false });
        expect(rows()).toEqual(['Akira', 'Berserk']);
        expect(screen.getByText('Other Site')).toBeTruthy();
        expect(screen.getByText('Site')).toBeTruthy();
    });

    it('should ask before it removes a bookmark, and leave everything as it was when that is declined', () => {
        const manga = bookmark('Berserk');
        renderWithProviders(<BookmarksView />, { selection: false });
        fireEvent.click(screen.getByTitle('Remove Berserk'));
        expect(screen.getByText('Remove bookmark?')).toBeTruthy();
        expect(screen.getByText('"Berserk" will be removed from your bookmarks.')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(screen.queryByText('Remove bookmark?')).toBeNull();
        expect(engine.BookmarkManager.deleteBookmark).not.toHaveBeenCalled();
        expect(engine.BookmarkManager.bookmarks).toHaveLength(1);
        expect(manga.title).toBe('Berserk');
        expect(rows()).toEqual(['Berserk']);
    });

    it('should remove the bookmark that was confirmed, and tell so', () => {
        bookmark('Akira');
        const berserk = bookmark('Berserk');
        renderWithProviders(<BookmarksView />, { selection: false });
        fireEvent.click(screen.getByTitle('Remove Berserk'));
        fireEvent.click(question().getByRole('button', { name: 'Remove' }));
        expect(engine.BookmarkManager.deleteBookmark).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({ key: { connector: 'site', manga: berserk.id } }),
        );
        expect(screen.getByText('Bookmark removed.')).toBeTruthy();
        expect(screen.queryByText('Remove bookmark?')).toBeNull();
        expect(rows()).toEqual(['Akira']);
    });

    it('should say so when the bookmark was already gone', () => {
        bookmark('Berserk');
        engine.BookmarkManager.deleteBookmark.mockReturnValueOnce(false);
        renderWithProviders(<BookmarksView />, { selection: false });
        fireEvent.click(screen.getByTitle('Remove Berserk'));
        fireEvent.click(question().getByRole('button', { name: 'Remove' }));
        expect(screen.getByText('Bookmark is already gone.')).toBeTruthy();
        expect(screen.queryByText('Remove bookmark?')).toBeNull();
    });

    it('should report a failure to remove, and close the question', () => {
        bookmark('Berserk');
        engine.BookmarkManager.deleteBookmark.mockImplementationOnce(() => {
            throw new Error('disk is full');
        });
        renderWithProviders(<BookmarksView />, { selection: false });
        fireEvent.click(screen.getByTitle('Remove Berserk'));
        fireEvent.click(question().getByRole('button', { name: 'Remove' }));
        expect(screen.getByText('Failed to remove bookmark: disk is full')).toBeTruthy();
        expect(screen.queryByText('Remove bookmark?')).toBeNull();
        expect(rows()).toEqual(['Berserk']);
    });

    it('should show a bookmark that is added while the view is open', () => {
        renderWithProviders(<BookmarksView />, { selection: false });
        expect(screen.getByText(/No bookmarks yet/)).toBeTruthy();
        act(() => {
            bookmark('Berserk');
        });
        expect(rows()).toEqual(['Berserk']);
    });

    it('should show a bookmark that is removed while the view is open', () => {
        const manga = bookmark('Berserk');
        bookmark('Akira');
        renderWithProviders(<BookmarksView />, { selection: false });
        expect(rows()).toEqual(['Akira', 'Berserk']);
        act(() => {
            engine.BookmarkManager.deleteBookmark(
                engine.BookmarkManager.bookmarks.find((entry) => entry.key.manga === manga.id),
            );
        });
        expect(rows()).toEqual(['Akira']);
    });

    it('should show the bookmarks that were imported while the view is open, which the engine announces as a change', () => {
        renderWithProviders(<BookmarksView />, { selection: false });
        act(() => {
            engine.BookmarkManager.bookmarks.push({
                key: { connector: 'site', manga: 'x' },
                title: { connector: 'Site', manga: 'Imported' },
            });
            engine.BookmarkManager.emit('changed', engine.BookmarkManager.bookmarks);
        });
        expect(rows()).toEqual(['Imported']);
    });

    it('should stop listening to the engine when it goes away', () => {
        const { unmount } = renderWithProviders(<BookmarksView />, { selection: false });
        const manager = engine.BookmarkManager;
        const removeEventListener = vi.spyOn(manager, 'removeEventListener');
        unmount();
        expect(removeEventListener.mock.calls.map(([event]) => event).sort()).toEqual([
            'added',
            'changed',
            'removed',
        ]);
    });

    it('should keep the rows apart when two websites have a manga with the same id', () => {
        bookmark('Same', site);
        const other = createConnector({ id: 'other', label: 'Other' });
        const manga = addManga(other, { id: 'm1', title: 'Same (other)' });
        engine.BookmarkManager.addBookmark(manga);
        renderWithProviders(<BookmarksView />, { selection: false });
        expect(
            within(screen.getAllByTitle(/^Remove /)[0].closest('.flex')).getByText(/Same/),
        ).toBeTruthy();
        expect(screen.getAllByTitle(/^Remove /)).toHaveLength(2);
    });
});

describe('bookmarks view for the screen reader', () => {
    it('should head the view, list the bookmarks and name the button of each after its manga', () => {
        engine.BookmarkManager.bookmarks.push(
            {
                key: { connector: 'site', manga: 'm1' },
                title: { connector: 'Site', manga: 'Berserk' },
            },
            {
                key: { connector: 'site', manga: 'm2' },
                title: { connector: 'Site', manga: 'Akira' },
            },
        );
        renderWithProviders(<BookmarksView />, { selection: false });
        expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Bookmarks');
        expect(screen.getByRole('list').querySelectorAll('li')).toHaveLength(2);
        expect(screen.getByRole('button', { name: 'Remove Berserk' }).textContent).toBe('Remove');
        expect(screen.getByRole('button', { name: 'Remove Akira' })).toBeTruthy();
    });
});
