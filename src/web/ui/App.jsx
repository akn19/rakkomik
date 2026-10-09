import React from 'react';
import AppRouter from './router.jsx';
import { ToastProvider } from './notify.jsx';

export default function App() {
    return (
        <ToastProvider>
            <AppRouter />
        </ToastProvider>
    );
}
