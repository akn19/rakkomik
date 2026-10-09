import React from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import AppRouter from './router.jsx';
import { ToastProvider } from './notify.jsx';
import { queryClient } from './queries.js';

export default function App() {
    return (
        <QueryClientProvider client={queryClient}>
            <ToastProvider>
                <AppRouter />
            </ToastProvider>
        </QueryClientProvider>
    );
}
