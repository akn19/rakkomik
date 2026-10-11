import { act, render } from '@testing-library/react';
import { SelectionProvider, useSelection } from '../selection.jsx';

// mounts the provider and hands out what the panels read; `selection.current` is the latest value
function mountSelection() {
    const selection = { renders: 0 };
    function Probe() {
        selection.current = useSelection();
        selection.renders++;
        return null;
    }
    render(
        <SelectionProvider>
            <Probe />
        </SelectionProvider>
    );
    return selection;
}

const manga = { id: 'm1', title: 'One' };
const chapter = { id: 'c1', title: 'Ch 1' };

describe('selection', () => {
    it('should start with nothing selected', () => {
        const { current } = mountSelection();
        expect(current.connectorId).toBe('');
        expect(current.manga).toBeNull();
        expect(current.chapter).toBeNull();
        expect(current.chapterOrder).toEqual([]);
    });

    it('should forget the manga and the chapter when another connector is selected', () => {
        const selection = mountSelection();
        act(() => selection.current.selectConnector('site-a'));
        act(() => selection.current.selectManga(manga));
        act(() => selection.current.setChapter(chapter));
        expect(selection.current).toMatchObject({ connectorId: 'site-a', manga, chapter });
        act(() => selection.current.selectConnector('site-b'));
        expect(selection.current).toMatchObject({ connectorId: 'site-b', manga: null, chapter: null });
    });

    it('should forget the chapter, but not the connector, when another manga is selected', () => {
        const selection = mountSelection();
        act(() => selection.current.selectConnector('site-a'));
        act(() => selection.current.selectManga(manga));
        act(() => selection.current.setChapter(chapter));
        act(() => selection.current.selectManga({ id: 'm2', title: 'Two' }));
        expect(selection.current.connectorId).toBe('site-a');
        expect(selection.current.manga.id).toBe('m2');
        expect(selection.current.chapter).toBeNull();
    });

    it('should keep the order of the chapters as the panel shows it, and keep it when the chapter changes', () => {
        const selection = mountSelection();
        const order = [chapter, { id: 'c2', title: 'Ch 2' }];
        act(() => selection.current.setChapterOrder(order));
        act(() => selection.current.setChapter(chapter));
        expect(selection.current.chapterOrder).toBe(order);
    });

    it('should hand out the same functions on every render, because the panels list them as dependencies of their effects', () => {
        const selection = mountSelection();
        const { selectConnector, selectManga, setChapter, setChapterOrder } = selection.current;
        act(() => selection.current.selectConnector('site-a'));
        act(() => selection.current.selectManga(manga));
        expect(selection.current.selectConnector).toBe(selectConnector);
        expect(selection.current.selectManga).toBe(selectManga);
        expect(selection.current.setChapter).toBe(setChapter);
        expect(selection.current.setChapterOrder).toBe(setChapterOrder);
    });

    it('should not draw its readers again when a selection is set to what it already is', () => {
        const selection = mountSelection();
        act(() => selection.current.setChapter(chapter));
        const renders = selection.renders;
        act(() => selection.current.setChapter(chapter));
        expect(selection.renders).toBe(renders);
    });

    it('should refuse to be used outside of its provider', () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        function Lonely() {
            useSelection();
            return null;
        }
        expect(() => render(<Lonely />)).toThrow('useSelection() must be used inside <SelectionProvider>!');
        error.mockRestore();
    });
});
