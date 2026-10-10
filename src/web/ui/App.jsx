import React from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import AppRouter from './router.jsx';
import { ToastProvider } from './notify.jsx';
import { queryClient } from './queries.js';
import { subscribeDownloads, subscribeSettings } from './engine.js';

export default function App() {
    // Live chapter badges: any download event refreshes chapter lists
    // (chapter objects mutate in place; invalidation re-reads them).
    React.useEffect(() => subscribeDownloads(() => {
        queryClient.invalidateQueries({ queryKey: ['chapters'] });
    }), []);
    // The chapter title format may have changed: reload chapter lists after
    // the engine cleared its cache (classic chapters.html onSettingsSaved).
    React.useEffect(() => subscribeSettings(() => {
        setTimeout(() => queryClient.invalidateQueries({ queryKey: ['chapters'] }), 0);
    }), []);
    return (
        <QueryClientProvider client={queryClient}>
            <ToastProvider>
                <AppRouter />
            </ToastProvider>
        </QueryClientProvider>
    );
}
