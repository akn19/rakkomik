import React from 'react';
import { Link, Outlet, useNavigate } from '@tanstack/react-router';
import { getEngineStatus, hasActiveDownloads, subscribeAppClose, quitApp, openExternalLink } from './engine.js';
import { SelectionProvider } from './selection.jsx';
import { useSelection } from './selection.jsx';
import { ConfirmDialog } from './dialog.jsx';
import { useDownloadJobs } from './downloads.js';
import MangaPanel from './MangaPanel.jsx';
import ChaptersPanel from './ChaptersPanel.jsx';
import Icon from './icon.jsx';

function Titlebar({ dark, onToggleTheme, onToggleMenu }) {
    const hakuneko = typeof window !== 'undefined' ? window.hakuneko : undefined;
    const act = fn => () => {
        if (hakuneko) {
            fn(hakuneko).catch?.(() => undefined);
        }
    };
    return (
        <header className="rk-drag flex h-9 shrink-0 items-center gap-2 bg-[#d6d6d6] px-2 dark:bg-zinc-900">
            <span className="rk-no-drag flex items-center">
                <button
                    type="button"
                    title="Toggle menu"
                    onClick={onToggleMenu}
                    className="rounded px-1 py-0.5 text-zinc-700 hover:bg-zinc-300 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                    <Icon name="menu" />
                </button>
                <span className="px-1 text-sm font-bold text-zinc-700 dark:text-zinc-200">RakKomik</span>
                <span className="rounded bg-amber-200 px-1 py-px text-[10px] font-bold uppercase text-amber-900 dark:bg-amber-900 dark:text-amber-100">Beta</span>
            </span>
            <span className="flex-1" />
            <span className="rk-no-drag flex items-center gap-0.5">
                <button
                    type="button"
                    title="Toggle theme"
                    onClick={onToggleTheme}
                    className="rounded px-1.5 py-0.5 text-zinc-700 hover:bg-zinc-300 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                    <Icon name={dark ? 'sun' : 'moon'} size={13} />
                </button>
                <button
                    type="button"
                    title="Minimize window"
                    onClick={act(h => h.window.minimize())}
                    className="rounded px-1.5 py-0.5 text-zinc-700 hover:bg-zinc-300 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                    <Icon name="minimize" size={12} />
                </button>
                <button
                    type="button"
                    title="Maximize window"
                    onClick={act(async h => {
                        if (await h.window.isMaximized()) {
                            await h.window.unmaximize();
                        } else {
                            await h.window.maximize();
                        }
                    })}
                    className="rounded px-1.5 py-0.5 text-zinc-700 hover:bg-zinc-300 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                    <Icon name="maximize" size={12} />
                </button>
                <button
                    type="button"
                    title="Close window"
                    onClick={act(h => h.window.close())}
                    className="rounded px-1.5 py-0.5 text-zinc-700 hover:bg-red-500 hover:text-white dark:text-zinc-300"
                >
                    <Icon name="close" size={12} />
                </button>
            </span>
        </header>
    );
}

const MENU_NAV = [
    { to: '/', name: 'Start' },
    { to: '/downloads', name: 'Downloads' },
    { to: '/connectors', name: 'Connectors' },
    { to: '/bookmarks', name: 'Bookmarks' },
    { to: '/settings', name: 'Settings' }
];

function MenuPopup({ open, onClose, dark, onToggleTheme }) {
    const navigate = useNavigate();
    if (!open) {
        return null;
    }
    const go = to => {
        onClose();
        navigate({ to });
    };
    return (
        <div className="absolute top-9 left-0 z-40 w-56 border border-zinc-500 bg-[#e4e4e4] shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
            {MENU_NAV.map(item => (
                <button
                    key={item.to}
                    type="button"
                    onClick={() => go(item.to)}
                    className="block w-full px-3 py-1.5 text-left text-[13px] hover:bg-[rgba(0,128,255,0.15)]"
                >
                    {item.name}
                </button>
            ))}
            <div className="border-t border-zinc-400 dark:border-zinc-700">
                <button
                    type="button"
                    onClick={() => {
                        onToggleTheme();
                        onClose();
                    }}
                    className="block w-full px-3 py-1.5 text-left text-[13px] hover:bg-[rgba(0,128,255,0.15)]"
                >
                    {dark ? 'Light theme' : 'Dark theme'}
                </button>
                <button
                    type="button"
                    onClick={() => {
                        openExternalLink('https://hakuneko.download');
                        onClose();
                    }}
                    className="block w-full px-3 py-1.5 text-left text-[13px] text-[#2080e0] hover:bg-[rgba(0,128,255,0.15)]"
                >
                    Homepage
                </button>
            </div>
        </div>
    );
}

function JobsPopup({ open }) {
    const jobs = useDownloadJobs();
    if (!open) {
        return null;
    }
    return (
        <div className="absolute right-0 bottom-7 z-40 max-h-64 w-96 overflow-auto border border-zinc-500 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
            {jobs.length === 0 && <p className="p-2 text-[13px] text-zinc-500">No downloads.</p>}
            {jobs.map((job, index) => (
                <div
                    key={`${job.labels.connector}/${job.labels.manga}/${job.labels.chapter}/${index}`}
                    className="border-b border-zinc-200 px-2 py-1 dark:border-zinc-700"
                >
                    <p className="truncate text-[13px] font-medium">{job.labels.manga}</p>
                    <p className="truncate text-xs text-zinc-500">{job.labels.chapter}</p>
                    <div className="mt-1 h-1 overflow-hidden rounded-full bg-[rgba(128,128,128,0.15)]">
                        <div
                            className="h-full rounded-full bg-[rgba(0,128,255,0.3)]"
                            style={{ width: `${Math.min(100, Math.max(0, job.progress || 0))}%` }}
                        />
                    </div>
                </div>
            ))}
            <p className="px-2 py-1 text-xs">{jobs.length} Download(s)</p>
        </div>
    );
}

export default function Shell() {
    const [dark, setDark] = React.useState(false);
    const [menuOpen, setMenuOpen] = React.useState(false);
    const [jobsOpen, setJobsOpen] = React.useState(false);
    const [confirmQuit, setConfirmQuit] = React.useState(false);
    const { version } = getEngineStatus();
    const jobs = useDownloadJobs();
    // Classic jobs.html parity: confirm when downloads are still running.
    React.useEffect(() => subscribeAppClose(() => {
        if (hasActiveDownloads()) {
            setConfirmQuit(true);
        } else {
            quitApp();
        }
    }), []);

    return (
        <SelectionProvider>
            <div className={'flex h-full flex-col text-[13px] text-zinc-900 dark:text-zinc-100 ' + (dark ? 'dark' : '')}>
                <Titlebar
                    dark={dark}
                    onToggleTheme={() => setDark(value => !value)}
                    onToggleMenu={() => setMenuOpen(open => !open)}
                />
                <MenuPopup open={menuOpen} onClose={() => setMenuOpen(false)} dark={dark} onToggleTheme={() => setDark(value => !value)} />
                <div className="flex min-h-0 flex-1 border-y border-zinc-500 dark:border-zinc-700">
                    <MangaPanel />
                    <ChaptersPanel />
                    <main className="rk-content-bg min-w-0 flex-1 overflow-auto p-4 dark:bg-black dark:bg-none">
                        <React.Suspense fallback={<p className="text-sm text-zinc-500">Loading view …</p>}>
                            <Outlet />
                        </React.Suspense>
                    </main>
                </div>
                <footer className="relative flex shrink-0 items-center gap-3 bg-[#d6d6d6] px-2 py-0.5 text-xs dark:bg-zinc-900">
                    <button
                        type="button"
                        onClick={() => {
                            setMenuOpen(false);
                            setJobsOpen(open => !open);
                        }}
                        title="Toggle download list"
                        className="hover:underline"
                    >
                        {jobs.length} Download(s)
                    </button>
                    <span className="flex-1" />
                    <span className="text-zinc-500">{version}</span>
                    <JobsPopup open={jobsOpen} />
                </footer>
                <ConfirmDialog
                    open={confirmQuit}
                    title="Downloads are still in progress."
                    message="Close application anyway?"
                    confirmLabel="Close"
                    onConfirm={() => {
                        setConfirmQuit(false);
                        quitApp();
                    }}
                    onCancel={() => setConfirmQuit(false)}
                />
            </div>
        </SelectionProvider>
    );
}
