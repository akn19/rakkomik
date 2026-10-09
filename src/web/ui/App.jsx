import React from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import AppRouter from './router.jsx';
import { ToastProvider } from './notify.jsx';
import { queryClient } from './queries.js';
import { subscribeDownloads } from './engine.js';

export default function App() {
    // Live chapter badges: any download event refreshes chapter lists
    // (chapter objects mutate in place; invalidation re-reads them).
    React.useEffect(() => subscribeDownloads(() => {
        queryClient.invalidateQueries({ queryKey: ['chapters'] });
    }), []);
    return (
        <QueryClientProvider client={queryClient}>
            <ToastProvider>
                <AppRouter />
            </ToastProvider>
        </QueryClientProvider>
    );
}
