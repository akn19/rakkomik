import React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getEngine, openExternalLink, findConnectorsByManga } from '../engine.js';
import { updateMangaList } from '../queries.js';
import { useToast } from '../notify.jsx';

function ConnectorCard({ connector, updating, updateError, onUpdate }) {
    const icon = `/img/connectors/${connector.id}`;
    return (
        <div
            title={`Click to show mangas from this website\n\nLabel: ${connector.label}\nID: ${connector.id}\nURL: ${connector.url}`}
            className="flex gap-3 rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-900"
        >
            <img
                src={icon}
                alt=""
                onError={event => {
                    event.target.src = '/img/connectors/default';
                }}
                className="h-10 w-10 shrink-0 rounded"
            />
            <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-medium">{connector.label}</p>
                    <div className="flex shrink-0 items-center gap-1">
                        {connector.links && connector.links.login && (
                            <button
                                type="button"
                                title="Open the login page"
                                onClick={() => openExternalLink(connector.links.login)}
                                className="rounded px-1.5 py-0.5 text-xs text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                            >
                                Login
                            </button>
                        )}
                        {connector.links && connector.links.donation && (
                            <button
                                type="button"
                                title="Open the donation page"
                                onClick={() => openExternalLink(connector.links.donation)}
                                className="rounded px-1.5 py-0.5 text-xs text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                            >
                                Donate
                            </button>
                        )}
                        <button
                            type="button"
                            title="Open the website (useful to check status, bypass CloudFlare, unlock captchas)"
                            onClick={() => openExternalLink(connector.url)}
                            className="rounded px-1.5 py-0.5 text-xs text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                        >
                            Site
                        </button>
                        <button
                            type="button"
                            title={`Synchronize manga list with ${connector.label}`}
                            onClick={onUpdate}
                            disabled={updating}
                            className="rounded border border-zinc-300 px-2 py-0.5 text-xs hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-600 dark:hover:bg-zinc-800"
                        >
                            {updating ? 'Updating …' : 'Update'}
                        </button>
                    </div>
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                    {(connector.tags || []).map(tag => (
                        <span key={tag} className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                            {tag}
                        </span>
                    ))}
                </div>
                {updateError && (
                    <p className="mt-1 text-xs text-red-600 dark:text-red-400">{updateError}</p>
                )}
            </div>
        </div>
    );
}

export default function ConnectorsView() {
    const { notify } = useToast();
    const queryClient = useQueryClient();
    const connectors = getEngine().Connectors;
    const [pattern, setPattern] = React.useState('');
    const [mangaPattern, setMangaPattern] = React.useState('');
    const [mangaMatches, setMangaMatches] = React.useState(null);
    const [selectedTags, setSelectedTags] = React.useState([]);
    const [updating, setUpdating] = React.useState({});
    const [errors, setErrors] = React.useState({});
    const [searching, setSearching] = React.useState(false);

    const allTags = React.useMemo(() => {
        const tags = new Set();
        connectors.forEach(connector => (connector.tags || []).forEach(tag => tags.add(tag)));
        return [...tags].sort();
    }, [connectors]);

    const toggleTag = tag => {
        setSelectedTags(current => current.includes(tag) ? current.filter(entry => entry !== tag) : [...current, tag]);
    };

    const searchByManga = async () => {
        if (!mangaPattern.trim()) {
            setMangaMatches(null);
            return;
        }
        setSearching(true);
        try {
            setMangaMatches(await findConnectorsByManga(mangaPattern));
        } catch (error) {
            notify(`Manga search failed: ${error.message}`, 'error');
        } finally {
            setSearching(false);
        }
    };

    const clearFilters = () => {
        setPattern('');
        setMangaPattern('');
        setMangaMatches(null);
        setSelectedTags([]);
    };

    const visible = connectors.filter(connector => {
        const needle = pattern.trim().toLowerCase();
        const patternMatch = !needle || (connector.id + connector.label + connector.url).toLowerCase().includes(needle);
        const tagsMatch = selectedTags.every(tag => (connector.tags || []).includes(tag));
        const mangaMatch = !mangaMatches || mangaMatches.includes(connector.id);
        return patternMatch && tagsMatch && mangaMatch;
    });

    const update = async connector => {
        if (updating[connector.id]) {
            return;
        }
        setUpdating(current => ({ ...current, [connector.id]: true }));
        setErrors(current => ({ ...current, [connector.id]: '' }));
        try {
            const mangas = await updateMangaList(connector);
            queryClient.setQueryData(['mangas', connector.id], mangas);
            notify(`Updated ${connector.label} (${mangas.length} titles).`, 'success');
        } catch (error) {
            setErrors(current => ({ ...current, [connector.id]: error.message }));
        } finally {
            setUpdating(current => ({ ...current, [connector.id]: false }));
        }
    };

    return (
        <div className="mx-auto max-w-4xl space-y-3 pb-8">
            <div className="flex flex-wrap items-center gap-2">
                <input
                    type="search"
                    placeholder="Filter by website …"
                    value={pattern}
                    onChange={event => setPattern(event.target.value)}
                    title="Show only websites with a matching name (case-insensitive)"
                    className="min-w-0 flex-1 rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800"
                />
                <input
                    type="search"
                    placeholder="Filter by manga (Enter) …"
                    value={mangaPattern}
                    onChange={event => setMangaPattern(event.target.value)}
                    onKeyDown={event => {
                        if (event.key === 'Enter') {
                            searchByManga();
                        }
                    }}
                    title="Show only websites with a manga that matches (case-insensitive). Searches local synchronized lists."
                    className="min-w-0 flex-1 rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800"
                />
                <button
                    type="button"
                    onClick={clearFilters}
                    title="Reset all filters"
                    className="rounded border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-600 dark:hover:bg-zinc-800"
                >
                    Reset
                </button>
            </div>
            {searching && <p className="text-xs text-zinc-500">Searching local manga lists …</p>}
            <div className="flex flex-wrap gap-1">
                {allTags.map(tag => (
                    <button
                        key={tag}
                        type="button"
                        onClick={() => toggleTag(tag)}
                        title="Toggle tag filter"
                        className={
                            'rounded-full px-2 py-0.5 text-xs ' +
                            (selectedTags.includes(tag)
                                ? 'bg-zinc-800 text-white dark:bg-zinc-100 dark:text-zinc-900'
                                : 'bg-zinc-200 text-zinc-600 hover:bg-zinc-300 dark:bg-zinc-800 dark:text-zinc-400')
                        }
                    >
                        {tag}
                    </button>
                ))}
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">{visible.length} / {connectors.length} websites</p>
            <div className="space-y-2">
                {visible.map(connector => (
                    <ConnectorCard
                        key={connector.id}
                        connector={connector}
                        updating={!!updating[connector.id]}
                        updateError={errors[connector.id] || ''}
                        onUpdate={() => update(connector)}
                    />
                ))}
            </div>
        </div>
    );
}
