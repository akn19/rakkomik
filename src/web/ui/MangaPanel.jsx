import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
    toggleBookmark,
    isMangaBookmarked,
    getBookmarks,
    subscribeBookmarks,
    getUpdateProgress,
    announceConnector,
    announceManga,
} from './engine.js';
import { useConnectors } from './connectorsState.js';
import { fetchMangaList, updateMangaList } from './queries.js';
import {
    useUpdateProgress,
    describeUpdateProgress,
    updateMessage,
    countTitles,
} from './updateProgress.js';
import { useToast } from './notify.jsx';
import { useSelection } from './selection.jsx';
import ConnectorDialog from './connectors.jsx';
import StatusLine from './status.jsx';
import Icon from './icon.jsx';

const BOOKMARK_CONNECTOR_ID = 'bookmarks';
const CLIPBOARD_CONNECTOR_ID = 'clipboard';

// a row is as high as a pointer target (24 pixels)
const ROW_HEIGHT = 24;

/** Classic mangas.html filterMangas: 3 chars for latin patterns, 2 otherwise. */
function filterMangas(list, pattern) {
    const threshold = /^[a-zA-Z0-9]+$/.test(pattern) ? 3 : 2;
    if (!pattern || pattern.length < threshold) {
        return list;
    }
    const needle = pattern.toLowerCase();
    return list.filter(
        (manga) =>
            manga.title.toLowerCase().includes(needle) ||
            manga.connector.label.toLowerCase().includes(needle),
    );
}

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/**
 * Manga list panel (classic mangas.html parity): paste links from the
 * clipboard, connector picker, refresh, title filter, bookmark button for
 * the selected manga, virtual list with the empty-list notification, footer.
 *
 * The list is a list box for the keyboard: the list has the focus, the arrows move between the mangas (Page Up and
 * Down by a screen, Home and End to the ends), Enter or Space selects the one the keyboard is on.
 */
export default function MangaPanel({ readerEnabled }) {
    const { notify } = useToast();
    const { connectorId, selectConnector, manga: selectedManga, selectManga } = useSelection();
    const queryClient = useQueryClient();
    const { connectors, ready } = useConnectors();
    const [pattern, setPattern] = React.useState('');
    // the connectors that this panel is updating, by id: the busy state belongs to a connector, not to the panel
    const [updating, setUpdating] = React.useState({});
    const [pickerOpen, setPickerOpen] = React.useState(false);
    const scrollRef = React.useRef(null);
    const headingId = React.useId();
    const listId = React.useId();

    // the default (first) connector is only known once the list is complete and sorted
    const effectiveId = connectorId || (ready && connectors[0] ? connectors[0].id : '');
    const connector = connectors.find((entry) => entry.id === effectiveId);
    // The chapter list and the reader read the connector from the selection, so the default one has to be put there:
    // without it the link of the reader is made with an empty connector and the chapter is "not found".
    React.useEffect(() => {
        if (!connectorId && effectiveId) {
            selectConnector(effectiveId);
        }
    }, [connectorId, effectiveId, selectConnector]);
    // the Discord presence shows what is browsed
    React.useEffect(() => {
        if (connector) {
            announceConnector(connector);
        }
    }, [connector]);
    React.useEffect(() => {
        if (selectedManga) {
            announceManga(selectedManga);
        }
    }, [selectedManga]);
    const progress = useUpdateProgress(connector);
    // the engine knows about updates that were started elsewhere as well (the connector dialog)
    const refreshing = !!updating[effectiveId] || !!progress;
    const bookmarked = React.useSyncExternalStore(subscribeBookmarks, () =>
        selectedManga ? isMangaBookmarked(selectedManga) : false,
    );

    // the bookmarked mangas by website and id (as the rows are keyed): their titles are gold in every list
    const bookmarks = React.useSyncExternalStore(subscribeBookmarks, getBookmarks);
    const bookmarkedKeys = React.useMemo(
        () =>
            new Set(bookmarks.map((bookmark) => `${bookmark.key.connector}/${bookmark.key.manga}`)),
        [bookmarks],
    );

    const mangaQuery = useQuery({
        queryKey: ['mangas', effectiveId],
        queryFn: () => fetchMangaList(connector),
        enabled: !!connector,
    });

    // Bookmarks of connectors that registered late become available once all are loaded.
    React.useEffect(() => {
        if (ready) {
            queryClient.invalidateQueries({ queryKey: ['mangas', BOOKMARK_CONNECTOR_ID] });
        }
    }, [ready, queryClient]);

    // The bookmark connector mirrors the bookmark list: reload it on change, also while another connector is shown (the
    // list is kept for good, so it would be out of date when it is shown again).
    React.useEffect(
        () =>
            subscribeBookmarks(() => {
                queryClient.invalidateQueries({ queryKey: ['mangas', BOOKMARK_CONNECTOR_ID] });
            }),
        [queryClient],
    );

    const total = mangaQuery.data ? mangaQuery.data.length : 0;
    const mangas = React.useMemo(
        () => filterMangas(mangaQuery.data || [], pattern),
        [mangaQuery.data, pattern],
    );

    // The manga that the keyboard is on (`aria-activedescendant`): the selected one when the list arrives, then where
    // the arrows go. While the list has the focus its row stays drawn, wherever the list is scrolled to.
    const [active, setActive] = React.useState(0);
    const [focused, setFocused] = React.useState(false);
    const activeIndex = clamp(active, 0, Math.max(0, mangas.length - 1));
    const optionId = (index) => `${listId}-${index}`;
    React.useEffect(() => {
        if (selectedManga) {
            const index = mangas.findIndex(
                (manga) =>
                    manga.id === selectedManga.id &&
                    manga.connector.id === selectedManga.connector.id,
            );
            if (index >= 0) {
                setActive(index);
            }
        }
    }, [mangas, selectedManga]);

    const rangeExtractor = React.useCallback(
        (range) => {
            const start = Math.max(range.startIndex - range.overscan, 0);
            const end = Math.min(range.endIndex + range.overscan, range.count - 1);
            const indexes = [];
            for (let index = start; index <= end; index++) {
                indexes.push(index);
            }
            if (
                focused &&
                activeIndex < range.count &&
                (activeIndex < start || activeIndex > end)
            ) {
                indexes.push(activeIndex);
                indexes.sort((a, b) => a - b);
            }
            return indexes;
        },
        [focused, activeIndex],
    );

    const virtualizer = useVirtualizer({
        count: mangas.length,
        getScrollElement: () => scrollRef.current,
        estimateSize: () => ROW_HEIGHT,
        overscan: 20,
        rangeExtractor,
    });

    const onListKeyDown = (event) => {
        if (mangas.length === 0) {
            return;
        }
        const screen = Math.max(
            1,
            Math.floor((scrollRef.current ? scrollRef.current.clientHeight : 0) / ROW_HEIGHT) - 1,
        );
        let next = activeIndex;
        switch (event.key) {
            case 'ArrowDown':
                next += 1;
                break;
            case 'ArrowUp':
                next -= 1;
                break;
            case 'PageDown':
                next += screen;
                break;
            case 'PageUp':
                next -= screen;
                break;
            case 'Home':
                next = 0;
                break;
            case 'End':
                next = mangas.length - 1;
                break;
            case 'Enter':
            case ' ':
                event.preventDefault();
                selectManga(mangas[activeIndex]);
                return;
            default:
                return;
        }
        event.preventDefault();
        next = clamp(next, 0, mangas.length - 1);
        setActive(next);
        virtualizer.scrollToIndex(next);
    };

    const update = async (target) => {
        // an update that runs elsewhere (the connector dialog) is not started a second time: the engine would not answer
        if (!target || updating[target.id] || getUpdateProgress(target)) {
            return;
        }
        setUpdating((current) => ({ ...current, [target.id]: true }));
        try {
            const updated = await updateMangaList(target);
            queryClient.setQueryData(['mangas', target.id], updated);
            notify(`Manga list updated (${countTitles(updated.length)}).`, 'success');
        } catch (error) {
            notify(`Failed to update manga list for ${target.label}\n${error.message}`, 'error');
        } finally {
            setUpdating((current) => ({ ...current, [target.id]: false }));
        }
    };

    // Classic onPasteClick: switch to the clipboard connector and read it.
    const onPaste = () => {
        const clipboard = connectors.find((entry) => entry.id === CLIPBOARD_CONNECTOR_ID);
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
    const refreshClass =
        'text-(--manga-refresh-button-color) [filter:drop-shadow(var(--manga-refresh-button-shadow))] cursor-pointer';
    const refreshTitle = connector
        ? `Synchronize local manga list with online list from <${connector.label}>`
        : '';
    const refreshLabel = connector
        ? `Update the manga list of ${connector.label}`
        : 'Update the manga list';
    const websiteText = connector
        ? connector.label
        : ready
          ? ''
          : `Loading connectors … (${connectors.length})`;

    return (
        <section
            aria-labelledby={headingId}
            className={
                'box-border flex min-h-0 flex-col bg-(--control-background-color) p-[0.5em] ' +
                (readerEnabled ? 'w-[20em] shrink-0' : 'max-w-1/2 flex-1')
            }
        >
            <div className="rk-separator flex items-center p-[0.25em] text-[1.25em] font-bold">
                <h2 id={headingId} className="flex-1">
                    Manga List
                </h2>
                <button
                    type="button"
                    onClick={onPaste}
                    title="Click to paste manga links from the clipboard"
                    aria-label="Paste manga links from the clipboard"
                    className="rk-button"
                >
                    <Icon name="paste" size={16} />
                </button>
            </div>
            <div className="rk-separator grid grid-cols-[auto_1fr_auto] items-center gap-x-[0.25em]">
                <Icon name="plug" size={14} className="rk-icon -scale-x-100" />
                {/* looks like the field of a select, is a button: it opens the dialog that picks the website */}
                <button
                    type="button"
                    onClick={() => setPickerOpen(true)}
                    aria-haspopup="dialog"
                    aria-expanded={pickerOpen}
                    title="Select a website from which the manga list should be shown"
                    className="rk-field rk-field-select w-[calc(100%-0.5em)] min-w-0 cursor-pointer truncate text-left"
                >
                    <span className="sr-only">Website: </span>
                    {websiteText}
                </button>
                <button
                    type="button"
                    onClick={() => update(connector)}
                    disabled={!connector}
                    title={refreshTitle}
                    aria-label={refreshLabel}
                    className={
                        refreshClass +
                        (refreshing
                            ? ' cursor-progress! text-(--manga-button-disabled-color)!'
                            : '')
                    }
                >
                    <Icon name="refresh" size={14} spin={refreshing} />
                </button>
                <Icon name="search" size={14} className="rk-icon" />
                <input
                    type="text"
                    value={pattern}
                    onChange={(event) => setPattern(event.target.value)}
                    title="Enter a pattern (at least 3 characters) to filter the manga list by their titles"
                    aria-label="Filter the mangas by title"
                    className="rk-field w-[calc(100%-0.5em)]"
                />
                <button
                    type="button"
                    onClick={onToggleBookmark}
                    disabled={!selectedManga}
                    aria-pressed={bookmarked}
                    aria-label="Add or remove the bookmark of the selected manga"
                    title={
                        !selectedManga
                            ? 'Please select a manga to use the bookmark feature'
                            : bookmarked
                              ? 'Click to remove the selected manga from the bookmark list'
                              : 'Click to add the selected manga to the bookmark list'
                    }
                    className="relative cursor-pointer text-(--bookmark-button-default-color) [filter:drop-shadow(var(--bookmark-button-shadow))] disabled:cursor-default"
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
                aria-activedescendant={mangas.length > 0 ? optionId(activeIndex) : undefined}
                tabIndex={0}
                onKeyDown={onListKeyDown}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
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
                            aria-label={refreshLabel}
                            className={'align-middle ' + refreshClass}
                        >
                            <Icon name="refresh" size={14} spin={refreshing} />
                        </button>
                        &nbsp;button to update list
                        <br />
                        <br />
                        <Icon name="info" size={13} className="inline align-text-bottom" /> Some
                        connectors are slow
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
                    {virtualizer.getVirtualItems().map((virtual) => {
                        const manga = mangas[virtual.index];
                        if (!manga) {
                            return null;
                        }
                        // the lists of the bookmarks and of the clipboard hold mangas of several websites: the id is not enough
                        const selected =
                            selectedManga &&
                            selectedManga.id === manga.id &&
                            selectedManga.connector.id === manga.connector.id;
                        const key = `${manga.connector.id}/${manga.id}`;
                        const isBookmarked = bookmarkedKeys.has(key);
                        return (
                            // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/interactive-supports-focus -- the list box has the focus and the keys (aria-activedescendant)
                            <div
                                key={key}
                                id={optionId(virtual.index)}
                                role="option"
                                aria-selected={!!selected}
                                aria-setsize={mangas.length}
                                aria-posinset={virtual.index + 1}
                                // the star says "bookmarked" to the eye, the name to a screen reader
                                aria-label={isBookmarked ? `${manga.title}, bookmarked` : undefined}
                                title={`${manga.title}\n${manga.connector.label}`}
                                onClick={() => {
                                    setActive(virtual.index);
                                    selectManga(manga);
                                    // the keys go on from the manga that was clicked
                                    if (scrollRef.current) {
                                        scrollRef.current.focus();
                                    }
                                }}
                                // the padding keeps the title, and the star, clear of the mark of the selected row
                                className={
                                    'absolute top-0 left-0 w-full cursor-pointer overflow-hidden pl-[0.5em] text-ellipsis leading-6 ' +
                                    (selected
                                        ? 'rk-selected bg-(--list-selected) '
                                        : 'hover:bg-(--list-highlighted) ') +
                                    (virtual.index === activeIndex ? 'rk-active ' : '') +
                                    (isBookmarked ? 'text-(--manga-list-bookmarked-color)' : '')
                                }
                                style={{
                                    height: virtual.size,
                                    transform: `translateY(${virtual.start}px)`,
                                }}
                            >
                                {isBookmarked && (
                                    <Icon
                                        name="star"
                                        size={11}
                                        filled
                                        className="mr-[0.25em] inline shrink-0 align-[-1px]"
                                    />
                                )}
                                {manga.title}
                            </div>
                        );
                    })}
                </div>
            </div>
            {refreshing && (
                <div
                    role="progressbar"
                    aria-label="Updating manga list"
                    aria-valuetext={describeUpdateProgress(progress) || 'Updating'}
                    className="rk-progress"
                />
            )}
            <StatusLine
                message={
                    refreshing ? updateMessage(progress) : `Mangas: ${mangas.length} / ${total}`
                }
                busy={refreshing || mangaQuery.isLoading || !ready}
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
                onSelect={(id) => {
                    selectConnector(id);
                    setPickerOpen(false);
                }}
                onClose={() => setPickerOpen(false)}
            />
        </section>
    );
}
