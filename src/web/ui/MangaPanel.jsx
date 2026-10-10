import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { toggleBookmark, isMangaBookmarked, subscribeBookmarks } from './engine.js';
import { useConnectors } from './connectorsState.js';
import { fetchMangaList, updateMangaList } from './queries.js';
import { useUpdateProgress, describeUpdateProgress, updateMessage } from './updateProgress.js';
import { useToast } from './notify.jsx';
import { useSelection } from './selection.jsx';
import ConnectorDialog from './connectors.jsx';
import StatusLine from './status.jsx';
import Icon from './icon.jsx';

const BOOKMARK_CONNECTOR_ID = 'bookmarks';
const CLIPBOARD_CONNECTOR_ID = 'clipboard';

/** Classic mangas.html filterMangas: 3 chars for latin patterns, 2 otherwise. */
function filterMangas(list, pattern) {
    const threshold = /^[a-zA-Z0-9]+$/.test(pattern) ? 3 : 2;
    if (!pattern || pattern.length < threshold) {
        return list;
    }
    const needle = pattern.toLowerCase();
    return list.filter(manga => manga.title.toLowerCase().includes(needle) || manga.connector.label.toLowerCase().includes(needle));
}

/**
 * Manga list panel (classic mangas.html parity): paste links from the
 * clipboard, connector picker, refresh, title filter, bookmark button for
 * the selected manga, virtual list with the empty-list notification, footer.
 */
export default function MangaPanel({ readerEnabled }) {
    const { notify } = useToast();
    const { connectorId, selectConnector, manga: selectedManga, selectManga } = useSelection();
    const queryClient = useQueryClient();
    const { connectors, ready } = useConnectors();
    const [pattern, setPattern] = React.useState('');
    const [updating, setUpdating] = React.useState(false);
    const [pickerOpen, setPickerOpen] = React.useState(false);
    const scrollRef = React.useRef(null);

    // the default (first) connector is only known once the list is complete and sorted
    const effectiveId = connectorId || (ready && connectors[0] ? connectors[0].id : '');
    const connector = connectors.find(entry => entry.id === effectiveId);
    const progress = useUpdateProgress(connector);
    // the engine knows about updates that were started elsewhere as well (the connector dialog)
    const refreshing = updating || !!progress;
    const bookmarked = React.useSyncExternalStore(
        subscribeBookmarks,
        () => (selectedManga ? isMangaBookmarked(selectedManga) : false)
    );

    const mangaQuery = useQuery({
        queryKey: ['mangas', effectiveId],
        queryFn: () => fetchMangaList(connector),
        enabled: !!connector
    });

    // Bookmarks of connectors that registered late become available once all are loaded.
    React.useEffect(() => {
        if (ready) {
            queryClient.invalidateQueries({ queryKey: ['mangas', BOOKMARK_CONNECTOR_ID] });
        }
    }, [ready, queryClient]);

    // The bookmark connector mirrors the bookmark list: reload it on change.
    React.useEffect(() => {
        if (effectiveId !== BOOKMARK_CONNECTOR_ID) {
            return undefined;
        }
        return subscribeBookmarks(() => {
            queryClient.invalidateQueries({ queryKey: ['mangas', BOOKMARK_CONNECTOR_ID] });
        });
    }, [effectiveId, queryClient]);

    const total = mangaQuery.data ? mangaQuery.data.length : 0;
    const mangas = React.useMemo(
        () => filterMangas(mangaQuery.data || [], pattern),
        [mangaQuery.data, pattern]
    );

    const virtualizer = useVirtualizer({
        count: mangas.length,
        getScrollElement: () => scrollRef.current,
        estimateSize: () => 22,
        overscan: 20
    });

    const update = async target => {
        if (!target || updating) {
            return;
        }
        setUpdating(true);
        try {
            const updated = await updateMangaList(target);
            queryClient.setQueryData(['mangas', target.id], updated);
            notify(`Manga list updated (${updated.length} titles).`, 'success');
        } catch (error) {
            notify(`Failed to update manga list for ${target.label}\n${error.message}`, 'error');
        } finally {
            setUpdating(false);
        }
    };

    // Classic onPasteClick: switch to the clipboard connector and read it.
    const onPaste = () => {
        const clipboard = connectors.find(entry => entry.id === CLIPBOARD_CONNECTOR_ID);
        if (clipboard) {
            selectConnector(clipboard.id);
            update(clipboard);
        }
    };

    const onToggleBookmark = () => {
        if (!selectedManga) {
            return;
        }
        try {
            toggleBookmark(selectedManga);
        } catch (error) {
            notify(`Bookmark failed: ${error.message}`, 'error');
        }
    };

    const showNotification = !!connector && connector.id !== BOOKMARK_CONNECTOR_ID && total < 1;
    const refreshClass = 'text-(--manga-refresh-button-color) [filter:drop-shadow(var(--manga-refresh-button-shadow))] cursor-pointer';
    const refreshTitle = connector ? `Synchronize local manga list with online list from <${connector.label}>` : '';

    return (
        <section
            className={
                'box-border flex min-h-0 flex-col bg-(--control-background-color) p-[0.5em] ' +
                (readerEnabled ? 'w-[20em] shrink-0' : 'max-w-1/2 flex-1')
            }
        >
            <div className="rk-separator flex items-center p-[0.25em] text-[1.25em] font-bold">
                <span className="flex-1">Manga List</span>
                <button
                    type="button"
                    onClick={onPaste}
                    title="Click to paste manga links from the clipboard"
                    className="rk-button"
                >
                    <Icon name="paste" size={16} />
                </button>
            </div>
            <div className="rk-separator grid grid-cols-[auto_1fr_auto] items-center gap-x-[0.25em]">
                <Icon name="plug" size={14} className="rk-icon -scale-x-100" />
                <input
                    type="text"
                    readOnly
                    value={connector ? connector.label : (ready ? '' : `Loading connectors … (${connectors.length})`)}
                    onClick={() => setPickerOpen(true)}
                    onKeyDown={event => {
                        if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            setPickerOpen(true);
                        }
                    }}
                    title="Select a website from which the manga list should be shown"
                    aria-label="Website"
                    className="rk-field rk-field-select w-[calc(100%-0.5em)] cursor-pointer"
                />
                <button
                    type="button"
                    onClick={() => update(connector)}
                    disabled={!connector}
                    title={refreshTitle}
                    className={refreshClass + (refreshing ? ' cursor-progress! text-(--manga-button-disabled-color)!' : '')}
                >
                    <Icon name="refresh" size={14} spin={refreshing} />
                </button>
                <Icon name="search" size={14} className="rk-icon" />
                <input
                    type="text"
                    value={pattern}
                    onChange={event => setPattern(event.target.value)}
                    title="Enter a pattern (at least 3 characters) to filter the manga list by their titles"
                    className="rk-field w-[calc(100%-0.5em)]"
                />
                <button
                    type="button"
                    onClick={onToggleBookmark}
                    title={
                        !selectedManga
                            ? 'Please select a manga to use the bookmark feature'
                            : bookmarked
                                ? 'Click to remove the selected manga from the bookmark list'
                                : 'Click to add the selected manga to the bookmark list'
                    }
                    className="relative cursor-pointer text-(--bookmark-button-default-color) [filter:drop-shadow(var(--bookmark-button-shadow))]"
                >
                    <Icon name="star" size={16} filled />
                    {selectedManga && (
                        <span
                            className={
                                'absolute -right-[3px] -bottom-[3px] rounded-full bg-(--control-background-color) ' +
                                (bookmarked
                                    ? 'text-(--bookmark-button-delete-color)'
                                    : 'text-(--bookmark-button-add-color)')
                            }
                        >
                            <Icon name={bookmarked ? 'minusCircle' : 'plusCircle'} size={9} />
                        </span>
                    )}
                </button>
            </div>
            <div
                ref={scrollRef}
                role="listbox"
                aria-label="Manga list"
                className="rk-list my-[0.5em] min-h-0 flex-1 overflow-x-hidden overflow-y-scroll bg-(--list-background-color) p-[0.25em] whitespace-nowrap"
            >
                {showNotification && (
                    <div className="bg-(--manga-list-notification-color) p-[0.5em] text-center leading-[150%] font-bold whitespace-normal [border:var(--manga-list-notification-border)]">
                        Manga list is loading or empty
                        <br />
                        Click&nbsp;
                        <button
                            type="button"
                            onClick={() => update(connector)}
                            title={refreshTitle}
                            className={'align-middle ' + refreshClass}
                        >
                            <Icon name="refresh" size={14} spin={refreshing} />
                        </button>
                        &nbsp;button to update list
                        <br />
                        <br />
                        <Icon name="info" size={13} className="inline align-text-bottom" /> Some connectors are slow
                        <br />
                        and may take more than 10mins
                        <br />
                        While the status line below
                        <br />
                        keeps counting requests, it&apos;s still working
                        <br />
                        <br />
                        To see the requests press F12
                        <br />
                        and go to the network tab
                    </div>
                )}
                <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
                    {virtualizer.getVirtualItems().map(virtual => {
                        const manga = mangas[virtual.index];
                        if (!manga) {
                            return null;
                        }
                        const selected = selectedManga && selectedManga.id === manga.id;
                        return (
                            <div
                                key={manga.id}
                                role="option"
                                aria-selected={!!selected}
                                title={`${manga.title}\n${manga.connector.label}`}
                                onClick={() => selectManga(manga)}
                                className={
                                    'absolute top-0 left-0 w-full cursor-pointer overflow-hidden text-ellipsis ' +
                                    (selected ? 'bg-(--list-selected)' : 'hover:bg-(--list-highlighted)')
                                }
                                style={{ height: virtual.size, transform: `translateY(${virtual.start}px)` }}
                            >
                                {manga.title}
                            </div>
                        );
                    })}
                </div>
            </div>
            {refreshing && (
                <div role="progressbar" aria-label="Updating manga list" aria-valuetext={describeUpdateProgress(progress) || 'Updating'} className="rk-progress" />
            )}
            <StatusLine
                message={refreshing ? updateMessage(progress) : `Mangas: ${mangas.length} / ${total}`}
                busy={refreshing || mangaQuery.isPending || !ready}
                busyTitle={
                    !ready
                        ? `Loading connectors (${connectors.length})`
                        : connector
                            ? refreshing
                                ? `Updating manga list (${connector.label}): ${describeUpdateProgress(progress) || 'waiting for the website'}`
                                : `Loading manga list (${connector.label})`
                            : ''
                }
            />
            <ConnectorDialog
                open={pickerOpen}
                selectedId={effectiveId}
                onSelect={id => {
                    selectConnector(id);
                    setPickerOpen(false);
                }}
                onClose={() => setPickerOpen(false)}
            />
        </section>
    );
}
