import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useNavigate, useSearch } from '@tanstack/react-router';
import {
    getChaptermark,
    subscribeChaptermarks,
    toggleChaptermark,
    deleteChaptermark,
    isChapterMarked,
    showChapterFolder,
    subscribeChapterStatus,
    cancelChapterDownload,
} from './engine.js';
import { fetchChapterList, addChapterDownloads } from './queries.js';
import { useSelection } from './selection.jsx';
import { useToast } from './notify.jsx';
import { ConfirmDialog } from './dialog.jsx';
import StatusLine from './status.jsx';
import Icon from './icon.jsx';

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

// a row is as high as its buttons, which are pointer targets of 24 pixels
const ROW_HEIGHT = 24;

// Classic chapters.html getChapterDownloadClass/-Tooltip parity. The label is what a screen reader reads for the
// button of the status, after the title of the chapter.
const STATUS = {
    unavailable: {
        icon: 'warning',
        color: '',
        text: 'text-(--status-unavailable-color)',
        tooltip: 'Chapter is not available',
        label: 'not available',
    },
    offline: {
        icon: 'folderClosed',
        color: 'text-(--chapter-button-offline-color)',
        text: '',
        tooltip: 'OFFLINE\nThe chapter is only accessable from the manga directory',
        label: 'offline, only in the manga directory',
    },
    available: {
        icon: 'cloud',
        color: 'text-(--chapter-button-available-color)',
        text: 'text-(--status-available-color)',
        tooltip: 'AVAILABLE\nClick to download chapter',
        label: 'available, download the chapter',
    },
    queued: {
        icon: 'cloudDownload',
        color: 'text-(--chapter-button-queued-color)',
        text: 'text-(--status-queued-color)',
        tooltip: 'QUEUED\nClick to cancel the download',
        label: 'queued, cancel the download',
    },
    downloading: {
        icon: 'cloudDownload',
        color: 'text-(--chapter-button-downloading-color)',
        text: 'text-(--status-downloading-color)',
        tooltip: 'DOWNLOADING\nClick to cancel the download',
        label: 'downloading, cancel the download',
    },
    completed: {
        icon: 'folder',
        color: 'text-(--chapter-button-completed-color)',
        text: 'text-(--status-completed-color)',
        tooltip: 'DOWNLOADED\nClick to delete and re-download chapter',
        label: 'downloaded, delete and download again',
    },
    failed: {
        icon: 'warning',
        color: 'text-(--chapter-button-failed-color)',
        text: '',
        tooltip:
            'DOWNLOAD FAILED\nCheck the exclamation mark in the joblist for details\nClick to delete and re-download the chapter',
        label: 'download failed, download again',
    },
};
const UNKNOWN_STATUS = {
    icon: 'warning',
    color: '',
    text: '',
    tooltip: 'No tooltip available!',
    label: 'unknown status',
};

const SORT_ICON = { none: 'sort', asc: 'sortAlphaDown', desc: 'sortAlphaUp' };
const SORT_NAME = { none: 'as listed', asc: 'A to Z', desc: 'Z to A' };

/** Classic filterChapters: `/regex/flags` patterns, otherwise a plain substring. */
function matchTitle(title, pattern) {
    if (!pattern) {
        return true;
    }
    const parts = pattern.split('/');
    if (parts.length === 3 && parts[0].length === 0 && parts[1].length > 0) {
        try {
            return new RegExp(parts[1], parts[2]).test(title);
        } catch {
            return false;
        }
    }
    return title.toLowerCase().includes(pattern.toLowerCase());
}

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/**
 * Chapter list panel (classic chapters.html parity): language and title
 * filters, sort cycle, download-all, virtual list with status button,
 * preview, recently-read marker and folder opener, footer.
 *
 * The list is a grid for the keyboard (WAI-ARIA grid pattern): Tab stops on one cell, the arrows move between the
 * cells and the rows, Page Up and Down by a screen, Home and End to the ends of the row and with Control of the list.
 * Enter and Space work the button of a cell; Enter on the title opens the folder like a double click does.
 */
export default function ChaptersPanel({ readerEnabled }) {
    const navigate = useNavigate();
    const {
        connector: openConnectorId,
        manga: openMangaId,
        chapter: openChapterId,
    } = useSearch({ strict: false });
    const { connectorId, manga, setChapterOrder } = useSelection();
    const [pattern, setPattern] = React.useState('');
    const [language, setLanguage] = React.useState('');
    const [sort, setSort] = React.useState('none');
    const [confirm, setConfirm] = React.useState(null);
    const [confirmAll, setConfirmAll] = React.useState(null);
    const scrollRef = React.useRef(null);
    const headingId = React.useId();
    const { notify } = useToast();

    const chaptersQuery = useQuery({
        // the key of the reader is made from the address, which holds text: ids that are numbers must make the same key
        queryKey: ['chapters', connectorId, manga && String(manga.id)],
        queryFn: () => fetchChapterList(manga),
        enabled: !!manga,
    });
    const chapters = React.useMemo(() => chaptersQuery.data || [], [chaptersQuery.data]);
    // a list that cannot be loaded would only look empty
    React.useEffect(() => {
        if (chaptersQuery.error) {
            notify(`Failed to load the chapter list: ${chaptersQuery.error.message}`, 'error');
        }
    }, [chaptersQuery.error, notify]);

    // A download changes the status of its chapter in place (queued, downloading, completed), which React cannot see:
    // a query that re-reads the list returns the same objects and keeps its old data. So redraw the rows on the event.
    const [, redraw] = React.useReducer((count) => count + 1, 0);
    React.useEffect(() => subscribeChapterStatus(redraw), []);

    const markedChapter = React.useSyncExternalStore(subscribeChaptermarks, () =>
        manga ? getChaptermark(manga) : null,
    );

    const languages = React.useMemo(
        () =>
            Array.from(new Set(chapters.map((chapter) => chapter.language).filter(Boolean))).sort(),
        [chapters],
    );

    // A new manga resets the language filter (classic onSelectedMangaChanged).
    React.useEffect(() => setLanguage(''), [manga]);

    const visible = React.useMemo(() => {
        let list = chapters.filter((chapter) => {
            const chapterLanguage = chapter.language
                ? chapter.language.toLowerCase()
                : chapter.language;
            return (
                matchTitle(chapter.title, pattern) &&
                (!language || language.toLowerCase() === chapterLanguage)
            );
        });
        if (sort === 'asc') {
            list = list.slice().sort((a, b) => collator.compare(a.title, b.title));
        } else if (sort === 'desc') {
            list = list.slice().sort((a, b) => -collator.compare(a.title, b.title));
        }
        return list;
    }, [chapters, pattern, language, sort]);

    // The reader steps through the list exactly as shown here (classic chapterUp/-Down).
    React.useEffect(() => {
        setChapterOrder(visible);
        return () => setChapterOrder([]);
    }, [visible, setChapterOrder]);

    // The marked chapter vanished from the list: classic shows a removable stub row.
    const markedRemoved =
        !!markedChapter &&
        chapters.length > 0 &&
        !chapters.some((chapter) => isChapterMarked(chapter, markedChapter));

    // The cell that Tab reaches (one for the whole grid); `focusCursor` asks for the focus to be moved there once it is
    // drawn, and while the focus is in the grid its row stays drawn, wherever the list is scrolled to.
    const columns = readerEnabled ? 4 : 3;
    const [cursor, setCursor] = React.useState({ row: 0, column: 0 });
    const [focusWithin, setFocusWithin] = React.useState(false);
    const focusCursor = React.useRef(false);
    const cursorRow = clamp(cursor.row, 0, Math.max(0, visible.length - 1));
    const cursorColumn = clamp(cursor.column, 0, columns - 1);

    const rangeExtractor = React.useCallback(
        (range) => {
            const start = Math.max(range.startIndex - range.overscan, 0);
            const end = Math.min(range.endIndex + range.overscan, range.count - 1);
            const indexes = [];
            for (let index = start; index <= end; index++) {
                indexes.push(index);
            }
            if (focusWithin && cursorRow < range.count && (cursorRow < start || cursorRow > end)) {
                indexes.push(cursorRow);
                indexes.sort((a, b) => a - b);
            }
            return indexes;
        },
        [focusWithin, cursorRow],
    );

    const virtualizer = useVirtualizer({
        count: visible.length,
        getScrollElement: () => scrollRef.current,
        estimateSize: () => ROW_HEIGHT,
        overscan: 20,
        rangeExtractor,
    });

    React.useEffect(() => {
        if (!focusCursor.current || !scrollRef.current) {
            return;
        }
        const element = scrollRef.current.querySelector(
            `[data-cell="${cursorRow}:${cursorColumn}"]`,
        );
        if (element) {
            focusCursor.current = false;
            element.focus();
        }
    });

    const tabIndexOf = (row, column) => (row === cursorRow && column === cursorColumn ? 0 : -1);
    const cell = (row, column) => ({
        tabIndex: tabIndexOf(row, column),
        'data-cell': `${row}:${column}`,
        onFocus: () =>
            setCursor((current) =>
                current.row === row && current.column === column ? current : { row, column },
            ),
    });

    const onGridKeyDown = (event) => {
        if (visible.length === 0) {
            return;
        }
        const screen = Math.max(
            1,
            Math.floor((scrollRef.current ? scrollRef.current.clientHeight : 0) / ROW_HEIGHT) - 1,
        );
        let row = cursorRow;
        let column = cursorColumn;
        switch (event.key) {
            case 'ArrowDown':
                row += 1;
                break;
            case 'ArrowUp':
                row -= 1;
                break;
            case 'ArrowRight':
                column += 1;
                break;
            case 'ArrowLeft':
                column -= 1;
                break;
            case 'PageDown':
                row += screen;
                break;
            case 'PageUp':
                row -= screen;
                break;
            case 'Home':
                row = event.ctrlKey ? 0 : row;
                column = 0;
                break;
            case 'End':
                row = event.ctrlKey ? visible.length - 1 : row;
                column = columns - 1;
                break;
            default:
                return;
        }
        event.preventDefault();
        row = clamp(row, 0, visible.length - 1);
        column = clamp(column, 0, columns - 1);
        setCursor({ row, column });
        focusCursor.current = true;
        virtualizer.scrollToIndex(row);
    };

    const openReader = (chapter) => {
        navigate({
            to: '/reader',
            // some connectors hand over numbers as ids: the route of the reader only takes text
            search: {
                connector: connectorId,
                manga: String(manga.id),
                chapter: String(chapter.id),
            },
        });
    };

    const openFolder = (chapter) => {
        try {
            showChapterFolder(chapter);
        } catch (error) {
            notify(`Failed to open the folder: ${error.message}`, 'error');
        }
    };

    const cycleSort = () => {
        setSort((current) => (current === 'none' ? 'asc' : current === 'asc' ? 'desc' : 'none'));
    };

    const queue = (list) => {
        addChapterDownloads(list);
        notify(`Queued ${list.length} chapter(s).`, 'success');
    };

    const onDownloadAll = () => {
        const available = visible.filter((chapter) => chapter.status === 'available');
        if (available.length > 0) {
            setConfirmAll(available);
        }
    };

    const cancelChapter = (chapter) => {
        try {
            if (cancelChapterDownload(chapter)) {
                notify(`Canceled "${chapter.title}".`, 'success');
            } else {
                notify('The download cannot be canceled any more.', 'info');
            }
        } catch (error) {
            notify(`Cancel failed: ${error.message}`, 'error');
        }
    };

    const processChapter = (chapter) => {
        switch (chapter.status) {
            case 'available':
            case 'failed':
                queue([chapter]);
                break;
            case 'completed':
                setConfirm(chapter);
                break;
            case 'queued':
            case 'downloading':
                cancelChapter(chapter);
                break;
            default:
                notify('No action available!', 'info');
                break;
        }
    };

    return (
        <section
            aria-labelledby={headingId}
            className={
                'box-border flex min-h-0 flex-col bg-(--control-background-color) p-[0.5em] ' +
                (readerEnabled ? 'w-[20em] shrink-0' : 'max-w-1/2 flex-1')
            }
        >
            <div className="rk-separator flex items-center gap-[0.25em] p-[0.25em] text-[1.25em] font-bold">
                <h2 id={headingId} className="flex-1">
                    Chapter List
                </h2>
                <button
                    type="button"
                    onClick={cycleSort}
                    title="Click to toggle chapter sorting"
                    aria-label={`Sort the chapters (now ${SORT_NAME[sort]})`}
                    className="rk-button"
                >
                    <Icon name={SORT_ICON[sort]} size={16} />
                </button>
                <button
                    type="button"
                    onClick={onDownloadAll}
                    title="Click to download all chapters currently shown in the filtered and sorted list"
                    aria-label="Download all listed chapters"
                    className="rk-button"
                >
                    <Icon name="download" size={16} />
                </button>
            </div>
            <div className="rk-separator grid grid-cols-[auto_1fr] items-center gap-x-[0.25em]">
                <Icon name="language" size={14} className="rk-icon" />
                <select
                    value={language}
                    onChange={(event) => setLanguage(event.target.value)}
                    title="Select a language to filter the chapter list"
                    aria-label="Language of the chapters"
                    className="rk-field rk-field-select w-[calc(100%-0.5em)]"
                >
                    <option value="">*</option>
                    {languages.map((entry) => (
                        <option key={entry} value={entry}>
                            {entry}
                        </option>
                    ))}
                </select>
                <Icon name="search" size={14} className="rk-icon" />
                <input
                    type="text"
                    value={pattern}
                    onChange={(event) => setPattern(event.target.value)}
                    title="Enter a pattern (regex support e.g. '/ch 001/i') to filter the chapter list by their titles"
                    aria-label="Filter the chapters by title"
                    className="rk-field w-[calc(100%-0.5em)]"
                />
            </div>
            <div
                ref={scrollRef}
                className="rk-list my-[0.5em] min-h-0 flex-1 overflow-x-hidden overflow-y-scroll bg-(--list-background-color) p-[0.25em] whitespace-nowrap"
            >
                {markedRemoved && (
                    <div className="flex items-center gap-[0.25em] overflow-hidden pl-[0.5em] text-ellipsis">
                        <span className="w-6 shrink-0" />
                        {readerEnabled && <span className="w-6 shrink-0" />}
                        <button
                            type="button"
                            title="Click to remove the marked chapter"
                            aria-label={`Remove the "recently read" marker of ${markedChapter.chapterTitle}, which is no longer in the list`}
                            onClick={() => deleteChaptermark(markedChapter)}
                            className="w-6 shrink-0 cursor-pointer text-(--chapter-marker-removed-color)"
                        >
                            <Icon name="bookmark" size={14} className="mx-auto" />
                        </button>
                        <span
                            className="text-(--chapter-marker-removed-color)"
                            title={`The chapter has been marked as "recently read" but is no longer available\nID: ${markedChapter.chapterID}`}
                        >
                            {markedChapter.chapterTitle}
                        </span>
                    </div>
                )}
                {/* what Enter does on the title of a chapter, for a screen reader */}
                <span id={`${headingId}-folder`} className="sr-only">
                    Double-click, or press Enter, to open the folder of the chapter
                </span>
                <div
                    role="grid"
                    aria-label="Chapters"
                    aria-rowcount={visible.length}
                    aria-colcount={columns}
                    tabIndex={-1}
                    onKeyDown={onGridKeyDown}
                    onFocus={() => setFocusWithin(true)}
                    onBlur={(event) => {
                        if (!event.currentTarget.contains(event.relatedTarget)) {
                            setFocusWithin(false);
                        }
                    }}
                >
                    <div
                        role="rowgroup"
                        className="relative w-full"
                        style={{ height: virtualizer.getTotalSize() }}
                    >
                        {virtualizer.getVirtualItems().map((virtual) => {
                            const chapter = visible[virtual.index];
                            if (!chapter) {
                                return null;
                            }
                            const status = STATUS[chapter.status] || UNKNOWN_STATUS;
                            const marked = isChapterMarked(chapter, markedChapter);
                            // the chapter that is open in the reader: the id of a chapter of another manga can be the same
                            const open =
                                openChapterId === String(chapter.id) &&
                                openMangaId === String(manga.id) &&
                                openConnectorId === connectorId;
                            const row = virtual.index;
                            return (
                                <div
                                    key={chapter.id}
                                    role="row"
                                    aria-rowindex={row + 1}
                                    // the padding keeps the icons clear of the mark of the row that is open
                                    className={
                                        'absolute top-0 left-0 flex w-full items-center gap-[0.25em] pl-[0.5em] ' +
                                        (open
                                            ? 'rk-selected bg-(--list-selected)'
                                            : 'hover:bg-(--list-highlighted)')
                                    }
                                    style={{
                                        height: virtual.size,
                                        transform: `translateY(${virtual.start}px)`,
                                    }}
                                >
                                    <span role="gridcell" className="w-6 shrink-0">
                                        <button
                                            type="button"
                                            {...cell(row, 0)}
                                            title={status.tooltip}
                                            aria-label={`${chapter.title}: ${status.label}`}
                                            onClick={() => processChapter(chapter)}
                                            className={
                                                'rk-icon w-full cursor-pointer ' + status.color
                                            }
                                        >
                                            <Icon
                                                name={status.icon}
                                                size={14}
                                                className="mx-auto"
                                            />
                                        </button>
                                    </span>
                                    {readerEnabled && (
                                        <span role="gridcell" className="w-6 shrink-0">
                                            <button
                                                type="button"
                                                {...cell(row, 1)}
                                                title="Show preview of chapter's pages"
                                                aria-label={`${chapter.title}: show the pages`}
                                                onClick={() => openReader(chapter)}
                                                className="rk-button w-full"
                                            >
                                                <Icon name="image" size={14} className="mx-auto" />
                                            </button>
                                        </span>
                                    )}
                                    <span role="gridcell" className="w-6 shrink-0">
                                        <button
                                            type="button"
                                            {...cell(row, columns - 2)}
                                            title={
                                                marked
                                                    ? 'Remove the "recently read" marker from this chapter'
                                                    : 'Mark this chapter as "recently read"'
                                            }
                                            aria-label={`${chapter.title}: ${marked ? 'remove the "recently read" marker' : 'mark as "recently read"'}`}
                                            aria-pressed={marked}
                                            onClick={() =>
                                                toggleChaptermark(chapter, markedChapter)
                                            }
                                            className={
                                                'w-full cursor-pointer ' +
                                                (marked
                                                    ? 'text-(--chapter-marker-active-color)'
                                                    : 'text-(--chapter-marker-inactive-color)')
                                            }
                                        >
                                            <Icon
                                                name="bookmark"
                                                size={14}
                                                filled={marked}
                                                className="mx-auto"
                                            />
                                        </button>
                                    </span>
                                    <span
                                        role="gridcell"
                                        {...cell(row, columns - 1)}
                                        tabIndex={tabIndexOf(row, columns - 1)}
                                        className={
                                            'cursor-default overflow-hidden text-ellipsis select-none ' +
                                            status.text
                                        }
                                        title={`${chapter.title}\nDoubleclick to open the folder with your file manager`}
                                        aria-describedby={`${headingId}-folder`}
                                        onDoubleClick={() => openFolder(chapter)}
                                        onKeyDown={(event) => {
                                            if (event.key === 'Enter') {
                                                event.preventDefault();
                                                openFolder(chapter);
                                            }
                                        }}
                                    >
                                        {chapter.title}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
            <StatusLine
                message={`Chapters: ${visible.length} / ${chapters.length}`}
                busy={!!manga && chaptersQuery.isPending}
                busyTitle={manga ? `Loading chapter list (${manga.title})` : ''}
            />
            <ConfirmDialog
                open={confirm !== null}
                title="Re-download existing chapter?"
                message={confirm ? `"${confirm.title}" is already downloaded.` : ''}
                confirmLabel="Re-download"
                onConfirm={() => {
                    if (confirm) {
                        queue([confirm]);
                    }
                    setConfirm(null);
                }}
                onCancel={() => setConfirm(null)}
            />
            <ConfirmDialog
                open={confirmAll !== null}
                title={
                    confirmAll
                        ? `Download ${confirmAll.length} new chapter(s) from the current chapter list?`
                        : ''
                }
                confirmLabel="Download"
                onConfirm={() => {
                    if (confirmAll) {
                        queue(confirmAll);
                    }
                    setConfirmAll(null);
                }}
                onCancel={() => setConfirmAll(null)}
            />
        </section>
    );
}
