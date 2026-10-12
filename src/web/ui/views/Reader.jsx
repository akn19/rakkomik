import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { getRouteApi, useNavigate } from '@tanstack/react-router';
import { markChapterRead } from '../engine.js';
import { useSelection } from '../selection.jsx';
import Icon from '../icon.jsx';
import { fetchPages, resolveChapter } from '../queries.js';
import { isNovelPage, novelColors, novelExcerpt, novelMarkup } from '../novel.js';
import { useToast } from '../notify.jsx';

const readerRoute = getRouteApi('/reader');

// the keys that are single characters: they work while the reader (or nothing in particular) has the focus
const CHARACTER_KEYS = ['*', '/', '+', '-'];

// how the pages scroll: in one jump when the user asked the system for less motion
function scrollBehavior() {
    return typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'auto'
        : 'smooth';
}

function PageImage({ src, index, width, padding }) {
    const retry = React.useRef(0);
    const timer = React.useRef(null);
    // a picture that is not shown any more is not asked for again
    React.useEffect(() => () => window.clearTimeout(timer.current), []);
    const onError = (event) => {
        // Classic imgError parity: retry 3x with a cache-busting query.
        if (retry.current < 3) {
            retry.current += 1;
            timer.current = window.setTimeout(() => {
                event.target.src = src + (src.includes('?') ? '&' : '?') + Date.now();
            }, 1000);
        }
    };
    return (
        <img
            id={`rk-page-${index}`}
            className="rk-page mx-auto block"
            src={src}
            alt={`Page ${index + 1}`}
            onError={onError}
            style={{ width: `${width}%`, margin: `${padding}em auto` }}
        />
    );
}

/**
 * A chapter of a novel is text, not an image: it is shown as text, in the colours chosen for novels. The zoom of the
 * reader sets the size of the letters, 75% is the size of the text of the application.
 */
function NovelPage({ page, index, width, padding }) {
    const markup = React.useMemo(() => novelMarkup(page), [page]);
    const colors = novelColors();
    return (
        <article
            id={`rk-page-${index}`}
            className="rk-page rk-novel"
            style={{
                fontSize: `${width / 75}em`,
                margin: `${padding}em auto`,
                backgroundColor: colors.background,
                color: colors.text,
            }}
            dangerouslySetInnerHTML={{ __html: markup }}
        />
    );
}

function NovelThumbnail({ page, index, onOpen }) {
    const excerpt = React.useMemo(() => novelExcerpt(page), [page]);
    return (
        <button
            type="button"
            title={`Page ${index + 1}`}
            aria-label={`Page ${index + 1}`}
            onClick={onOpen}
            className="m-[0.5em] inline-block h-[16em] w-[16em] cursor-pointer overflow-hidden rounded-[1em] bg-(--page-thumbnail-background-color) p-[1em] text-left align-top [border:var(--page-thumbnail-border)] [box-shadow:var(--page-thumbnail-shadow)]"
        >
            <Icon name="book" size={20} className="mb-[0.5em]" />
            <span className="block text-[0.8em] leading-snug">{excerpt}</span>
        </button>
    );
}

function ToolbarButton({ icon, title, onClick }) {
    return (
        <button
            type="button"
            title={title}
            onClick={onClick}
            className="rk-button m-[0.25em] align-middle"
        >
            <Icon name={icon} size={22} />
        </button>
    );
}

/**
 * Classic page viewer buttons. While reading they are hidden until the pointer is over them (or the keyboard
 * focus is in them, not a click's focus, which would keep them open), and the chapter title shows with them.
 */
function Toolbar({ title, reading, imageWidth, actions }) {
    return (
        <div
            // it sits above the pages, so the wheel has to be handed on to them
            onWheel={actions.wheel}
            className={
                'group absolute top-0 right-0 z-10 rounded-bl-[1em] bg-(--page-viewer-title-background-color) pr-[2em] pl-[1em] text-(--page-chapter-title-color) transition-opacity duration-200 has-[:focus-visible]:opacity-100 hover:opacity-100 [box-shadow:var(--page-viewer-title-shadow)] ' +
                (reading ? 'opacity-0' : 'opacity-70')
            }
        >
            {/* the title is the heading of the view; while reading it is only shown with the buttons, a screen reader has it at all times */}
            <span
                role="heading"
                aria-level={1}
                className={
                    'mr-[0.5em] text-[1.25em] font-bold ' +
                    (reading
                        ? 'sr-only group-has-[:focus-visible]:not-sr-only group-hover:not-sr-only'
                        : '')
                }
            >
                {title}
            </span>
            {reading && (
                <>
                    <ToolbarButton
                        icon="chevronLeft"
                        title="Previous Chapter (ArrowLeft)"
                        onClick={actions.previous}
                    />
                    <ToolbarButton
                        icon="chevronRight"
                        title="Next Chapter (ArrowRight)"
                        onClick={actions.next}
                    />
                    &nbsp;
                    <ToolbarButton
                        icon="shrink"
                        title="Decrease spacing between images (CTRL -)"
                        onClick={actions.lessPadding}
                    />
                    <ToolbarButton
                        icon="expand"
                        title="Increase spacing between images (CTRL +)"
                        onClick={actions.morePadding}
                    />
                    &nbsp;
                    <ToolbarButton icon="zoomIn" title="Zoom In (+)" onClick={actions.zoomIn} />
                    <ToolbarButton icon="zoomOut" title="Zoom Out (-)" onClick={actions.zoomOut} />
                    &nbsp;
                    <ToolbarButton
                        icon="defaultWidth"
                        title="Default Image Width (/)"
                        onClick={actions.defaultWidth}
                    />
                    <ToolbarButton
                        icon="fitWidth"
                        title="Zoom to Fit Window (*)"
                        onClick={actions.fitWidth}
                    />
                    &nbsp;
                    <span role="status" className="align-middle italic">
                        Image Width: {imageWidth}%
                    </span>
                    <ToolbarButton
                        icon="scrollDown"
                        title="Magic Scroll Down (SPACEBAR)"
                        onClick={actions.scroll}
                    />
                </>
            )}
            <ToolbarButton
                icon="closeCircle"
                title={reading ? 'Close (ESC)' : 'Close the preview (ESC)'}
                onClick={actions.close}
            />
        </div>
    );
}

/**
 * Classic pages.html parity: thumbnails of the opened chapter, click a page
 * to read. Next/previous chapter follow the panel's chapter list order
 * (classic chapterUp = the entry above, chapterDown = the entry below).
 */
export default function ReaderView() {
    const { notify } = useToast();
    const navigate = useNavigate();
    const { connector: connectorId, manga: mangaId, chapter: chapterId } = readerRoute.useSearch();
    const [mode, setMode] = React.useState('thumbs');
    const [startPage, setStartPage] = React.useState(0);
    const [imageWidth, setImageWidth] = React.useState(75);
    const [imagePadding, setImagePadding] = React.useState(2);
    const autoNext = React.useRef(false);
    const autoNextTimer = React.useRef(null);
    // "press Space again" is asked and answered in one chapter: the question does not go on to the next one
    React.useEffect(
        () => () => {
            window.clearTimeout(autoNextTimer.current);
            autoNext.current = false;
        },
        [chapterId],
    );
    const containerRef = React.useRef(null);
    const frameRef = React.useRef(null);
    const keepRatio = React.useRef(null);

    const resolvedQuery = useQuery({
        queryKey: ['reader', connectorId, mangaId, chapterId],
        queryFn: () => resolveChapter(connectorId, mangaId, chapterId),
    });
    const resolved = resolvedQuery.data;
    const {
        connectorId: selectedConnectorId,
        selectConnector,
        selectManga,
        chapterOrder,
    } = useSelection();
    // Keep the panels coherent: resolving a deep link selects its connector and its manga (the links of the panels are
    // made from the connector of the selection, so a manga under the wrong one would lead to chapters that are not found).
    React.useEffect(() => {
        if (resolved) {
            if (selectedConnectorId !== connectorId) {
                // forgets the manga: the one of the link is selected right after
                selectConnector(connectorId);
            }
            selectManga(resolved.manga);
        }
    }, [resolved, connectorId, selectedConnectorId, selectConnector, selectManga]);
    const chapter = resolved ? resolved.chapters[resolved.index] : null;

    const pagesQuery = useQuery({
        queryKey: ['pages', connectorId, mangaId, chapterId],
        queryFn: () => fetchPages(chapter),
        enabled: !!chapter,
    });
    const media = Array.isArray(pagesQuery.data) ? pagesQuery.data : [];

    // Order of the panel's (filtered, sorted) list; the raw list before the panel published it.
    const order = React.useMemo(() => {
        if (chapterOrder.some((entry) => String(entry.id) === chapterId)) {
            return chapterOrder;
        }
        return resolved ? resolved.chapters : [];
    }, [chapterOrder, chapterId, resolved]);

    const openChapter = React.useCallback(
        (offset) => {
            const index = order.findIndex((entry) => String(entry.id) === chapterId);
            const target = order[index + offset];
            if (index < 0 || !target) {
                return;
            }
            setMode('read');
            setStartPage(0);
            if (containerRef.current) {
                containerRef.current.scrollTop = 0;
            }
            navigate({
                to: '/reader',
                search: { connector: connectorId, manga: mangaId, chapter: String(target.id) },
            });
        },
        [order, chapterId, connectorId, mangaId, navigate],
    );
    // chapterUp = the entry above in the list, chapterDown = the entry below.
    const nextChapter = React.useCallback(() => openChapter(-1), [openChapter]);
    const previousChapter = React.useCallback(() => openChapter(1), [openChapter]);

    // Reading: back to the thumbnails (and mark as read). Thumbnails: back to the start page.
    const closeReader = React.useCallback(() => {
        if (mode === 'read') {
            if (chapter) {
                markChapterRead(chapter);
            }
            setMode('thumbs');
        } else {
            navigate({ to: '/' });
        }
    }, [mode, chapter, navigate]);

    // Scroll to the opening page when entering read mode, and give the reader the focus: the thumbnail that was clicked
    // is gone, and the keys of the reader work where the focus is.
    React.useEffect(() => {
        if (mode === 'read') {
            const page = document.getElementById(`rk-page-${startPage}`);
            if (page) {
                page.scrollIntoView();
            } else if (containerRef.current) {
                containerRef.current.scrollTop = 0;
            }
            if (frameRef.current && !frameRef.current.contains(document.activeElement)) {
                frameRef.current.focus({ preventScroll: true });
            }
        }
    }, [mode, startPage, chapterId, media.length]);

    // Zoom/spacing keep the relative scroll position (classic zoom/setImagePadding).
    const changeLayout = (change) => {
        const container = containerRef.current;
        keepRatio.current =
            container && container.scrollHeight
                ? container.scrollTop / container.scrollHeight
                : null;
        change();
    };
    React.useLayoutEffect(() => {
        const container = containerRef.current;
        if (keepRatio.current !== null && container) {
            container.scrollTop = keepRatio.current * container.scrollHeight;
        }
        keepRatio.current = null;
    }, [imageWidth, imagePadding]);

    const zoom = (next) => changeLayout(() => setImageWidth(Math.min(400, Math.max(25, next))));
    const padding = (delta) =>
        changeLayout(() => setImagePadding((value) => Math.max(0, value + delta)));

    const scrollMagic = React.useCallback(
        (defaultDistance) => {
            const container = containerRef.current;
            if (!container) {
                return;
            }
            const images = [...container.querySelectorAll('.rk-page')];
            if (!images.length) {
                return;
            }
            if (images[images.length - 1].getBoundingClientRect().bottom - window.innerHeight < 1) {
                if (autoNext.current) {
                    autoNext.current = false;
                    nextChapter();
                    return;
                }
                autoNext.current = true;
                notify('Press Space again for the next chapter.', 'info');
                autoNextTimer.current = window.setTimeout(() => {
                    autoNext.current = false;
                }, 4000);
                return;
            }
            const inView = images.filter((image) => {
                const rect = image.getBoundingClientRect();
                return rect.top <= window.innerHeight && rect.bottom > 1;
            });
            // with no page in view (the window shows the gap between two pages) it goes on with the first page below the window
            const target =
                inView[inView.length - 1] ||
                images.find((image) => image.getBoundingClientRect().top > window.innerHeight) ||
                images[0];
            if (target.getBoundingClientRect().top > 1) {
                target.scrollIntoView({ behavior: scrollBehavior() });
            } else if (window.innerHeight + 1 < target.getBoundingClientRect().bottom) {
                container.scrollBy({
                    top: Math.min(
                        defaultDistance,
                        target.getBoundingClientRect().bottom - window.innerHeight,
                    ),
                    left: 0,
                    behavior: scrollBehavior(),
                });
            } else if (target.nextElementSibling) {
                target.nextElementSibling.scrollIntoView({ behavior: scrollBehavior() });
            }
        },
        [notify, nextChapter],
    );

    const onKeyDown = (event) => {
        const container = containerRef.current;
        const smooth = (distance) => {
            if (!container) {
                return;
            }
            if (scrollBehavior() === 'auto') {
                container.scrollBy({ top: distance });
                return;
            }
            let remaining = distance;
            const step = () => {
                if (Math.abs(remaining) < 1) {
                    return;
                }
                const delta = Math.sign(remaining) * Math.min(10, Math.abs(remaining));
                container.scrollBy({ top: delta });
                remaining -= delta;
                window.requestAnimationFrame(step);
            };
            window.requestAnimationFrame(step);
        };
        const reading = mode === 'read';
        // A shortcut that is one character (WCAG 2.1.4) only works while the reader has the focus, or nothing has: not
        // while a button of the titlebar does.
        const frame = frameRef.current;
        const target = event.target;
        const inReader =
            !(target instanceof HTMLElement) ||
            target === document.body ||
            (frame && frame.contains(target));
        switch (true) {
            case event.code === 'Escape' && !event.ctrlKey:
                closeReader();
                break;
            case !reading:
                break;
            case CHARACTER_KEYS.includes(event.key) && !inReader:
                break;
            case event.code === 'ArrowUp' && !event.ctrlKey:
                event.preventDefault();
                smooth(-64);
                break;
            case event.code === 'ArrowDown' && !event.ctrlKey:
                event.preventDefault();
                smooth(64);
                break;
            case event.code === 'PageUp' && !event.ctrlKey:
                if (container) {
                    container.scrollBy({
                        top: -window.innerHeight * 0.95,
                        left: 0,
                        behavior: scrollBehavior(),
                    });
                }
                break;
            case event.code === 'PageDown' && !event.ctrlKey:
                if (container) {
                    container.scrollBy({
                        top: window.innerHeight * 0.95,
                        left: 0,
                        behavior: scrollBehavior(),
                    });
                }
                break;
            case event.code === 'ArrowRight' && !event.ctrlKey:
                nextChapter();
                break;
            case event.code === 'ArrowLeft' && !event.ctrlKey:
                previousChapter();
                break;
            case event.key === '*' && !event.ctrlKey:
                changeLayout(() => setImageWidth(100));
                break;
            case event.key === '/' && !event.ctrlKey:
                changeLayout(() => setImageWidth(75));
                break;
            case event.key === '+' && !event.ctrlKey:
                zoom(imageWidth + 15);
                break;
            case event.key === '-' && !event.ctrlKey:
                zoom(imageWidth - 15);
                break;
            case event.key === '+' && event.ctrlKey:
                event.preventDefault();
                padding(1);
                break;
            case event.key === '-' && event.ctrlKey:
                event.preventDefault();
                padding(-1);
                break;
            case event.code === 'Space' && !event.ctrlKey:
                event.preventDefault();
                if (event.target instanceof HTMLElement) {
                    event.target.blur();
                }
                scrollMagic(window.innerHeight * 0.8);
                break;
            default:
                break;
        }
    };

    // Keys work wherever the focus is, except while typing in a filter/setting field.
    const keyHandler = React.useRef(onKeyDown);
    keyHandler.current = onKeyDown;
    React.useEffect(() => {
        const handler = (event) => {
            if (
                event.target instanceof HTMLElement &&
                /^(INPUT|SELECT|TEXTAREA)$/.test(event.target.tagName)
            ) {
                return;
            }
            keyHandler.current(event);
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, []);

    // Reading takes over everything below the titlebar, the side panels included, like the classic viewer: the
    // content row of the shell is the containing block, and the shell hides its panels while a `data-reading`
    // element is in that row. Every state of reading gets this frame, otherwise the panels would show for a moment
    // while the next chapter resolves.
    // The frame can take the focus (it does when reading starts), without a ring: it is the whole window.
    const frame =
        mode === 'read'
            ? {
                  ref: frameRef,
                  tabIndex: -1,
                  className:
                      'absolute inset-0 z-20 bg-(--page-reader-background-color) text-zinc-300 outline-none',
                  'data-reading': '',
              }
            : { ref: frameRef, tabIndex: -1, className: 'relative h-full outline-none' };

    if (resolvedQuery.isPending) {
        return (
            <div {...frame}>
                <h1 className="sr-only">Reader</h1>
                <p role="status" className="p-[1em]">
                    Resolving chapter …
                </p>
            </div>
        );
    }
    if (resolvedQuery.isError || !chapter) {
        return (
            <div {...frame}>
                <h1 className="sr-only">Reader</h1>
                <div className="space-y-[0.5em] p-[1em]">
                    <p role="alert" className="flex items-center gap-[0.5em] font-bold">
                        <Icon name="warning" size={16} />
                        Chapter not found.
                    </p>
                    <button
                        type="button"
                        onClick={() => navigate({ to: '/' })}
                        className="rk-button"
                    >
                        Close
                    </button>
                </div>
            </div>
        );
    }

    const actions = {
        previous: previousChapter,
        next: nextChapter,
        lessPadding: () => padding(-1),
        morePadding: () => padding(1),
        zoomIn: () => zoom(imageWidth + 15),
        zoomOut: () => zoom(imageWidth - 15),
        defaultWidth: () => changeLayout(() => setImageWidth(75)),
        fitWidth: () => changeLayout(() => setImageWidth(100)),
        scroll: () => scrollMagic(window.innerHeight * 0.8),
        wheel: (event) => containerRef.current?.scrollBy({ top: event.deltaY, left: event.deltaX }),
        close: closeReader,
    };

    return (
        <div {...frame}>
            <Toolbar
                title={chapter.title}
                reading={mode === 'read'}
                imageWidth={imageWidth}
                actions={actions}
            />
            {pagesQuery.isPending && (
                <p role="status" className="p-[1em]">
                    Loading pages …
                </p>
            )}
            {pagesQuery.isError && (
                <p role="alert" className="flex items-center gap-[0.5em] p-[1em] font-bold">
                    <Icon name="warning" size={16} className="shrink-0" />
                    Failed to load pages for this chapter
                    {pagesQuery.error ? `: ${pagesQuery.error.message}` : '.'}
                </p>
            )}
            {mode === 'thumbs' && media.length > 0 && (
                <div
                    ref={containerRef}
                    className="h-full overflow-y-scroll p-[1em] pt-[3em] select-none"
                >
                    {media.map((page, index) => {
                        const open = () => {
                            setStartPage(index);
                            setMode('read');
                        };
                        return isNovelPage(page) ? (
                            <NovelThumbnail
                                key={`${index}-${String(page).slice(-32)}`}
                                page={page}
                                index={index}
                                onOpen={open}
                            />
                        ) : (
                            <button
                                key={`${index}-${String(page).slice(-32)}`}
                                type="button"
                                title={`Page ${index + 1}`}
                                aria-label={`Page ${index + 1}`}
                                onClick={open}
                                className="m-[0.5em] inline-block h-[16em] w-[16em] cursor-pointer rounded-[1em] bg-(--page-thumbnail-background-color) bg-contain bg-center bg-no-repeat [border:var(--page-thumbnail-border)] [box-shadow:var(--page-thumbnail-shadow)]"
                                style={{
                                    backgroundImage: `url('${String(page).replace(/'/g, "\\'")}')`,
                                }}
                            />
                        );
                    })}
                </div>
            )}
            {mode === 'read' && media.length > 0 && (
                <div
                    ref={containerRef}
                    // the arrows and Page Up and Down scroll it while it has the focus
                    // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scrolling region needs a stop for Tab (WCAG 2.1.1), or the keyboard cannot reach what scrolls
                    tabIndex={0}
                    className="h-full overflow-y-scroll bg-(--page-reader-background-color) select-none focus-visible:outline-offset-[-3px] focus-visible:[outline-color:#f0f0f0]"
                >
                    {media.map((page, index) =>
                        isNovelPage(page) ? (
                            <NovelPage
                                key={`${index}-${String(page).slice(-32)}`}
                                page={page}
                                index={index}
                                width={imageWidth}
                                padding={imagePadding}
                            />
                        ) : (
                            <PageImage
                                key={`${index}-${String(page).slice(-32)}`}
                                src={page}
                                index={index}
                                width={imageWidth}
                                padding={imagePadding}
                            />
                        ),
                    )}
                </div>
            )}
        </div>
    );
}
