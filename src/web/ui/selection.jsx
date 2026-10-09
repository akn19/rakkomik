import React from 'react';

const SelectionContext = React.createContext(null);

/**
 * Shared manga/chapter/connector selection (classic selectedConnector,
 * selectedManga, selectedChapter binding). Panels and content read and
 * write the same selection; routes only carry deep-linkable reader targets.
 */
export function SelectionProvider({ children }) {
    const [connectorId, setConnectorId] = React.useState('');
    const [manga, setManga] = React.useState(null);
    const [chapter, setChapter] = React.useState(null);

    const selectConnector = React.useCallback(id => {
        setConnectorId(id);
        setManga(null);
        setChapter(null);
    }, []);

    const selectManga = React.useCallback(entry => {
        setManga(entry);
        setChapter(null);
    }, []);

    const value = React.useMemo(() => ({
        connectorId,
        selectConnector,
        manga,
        selectManga,
        chapter,
        setChapter
    }), [connectorId, selectConnector, manga, selectManga, chapter]);

    return (
        <SelectionContext.Provider value={value}>
            {children}
        </SelectionContext.Provider>
    );
}

export function useSelection() {
    const selection = React.useContext(SelectionContext);
    if (!selection) {
        throw new Error('useSelection() must be used inside <SelectionProvider>!');
    }
    return selection;
}
