import React from 'react';
import { getEngineStatus } from '../engine.js';

/**
 * Structural placeholder for views owned by later slices
 * (manga/chapter lists, reader, jobs, connectors).
 */
export default function PlaceholderView({ title, note }) {
    const { connectors } = getEngineStatus();
    return (
        <div className="mx-auto max-w-3xl rounded-lg border border-zinc-200 bg-white p-8 dark:border-zinc-700 dark:bg-zinc-900">
            <h1 className="text-xl font-semibold capitalize">{title}</h1>
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
                {note || `The ${title} view arrives in a later slice.`}
            </p>
            <p className="mt-4 text-xs text-zinc-400 dark:text-zinc-500">
                {connectors} connectors registered.
            </p>
        </div>
    );
}
