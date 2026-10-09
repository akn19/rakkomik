import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import '@fontsource-variable/inter';
import './index.css';

/**
 * Mount the React shell into the given container.
 * Called by `loadReactShell()` in `index.html` AFTER `loadEngine()`, so
 * `window.Engine` is ready and the bridge reads real data.
 */
export function mountReactShell(container) {
    const root = createRoot(container);
    root.render(
        <React.StrictMode>
            <App />
        </React.StrictMode>
    );
    return () => root.unmount();
}
