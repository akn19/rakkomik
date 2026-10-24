// Updates of the web part (connectors and user interface) from the menu, through the shell of the application
// (UpdateBridge of src/app). An older shell cannot do it: it installs an update when the application starts.

const shell = () => (typeof window !== 'undefined' ? window.hakuneko : undefined);

/**
 * Whether the shell can look for an update and install it while the application runs.
 */
export function canUpdateWebPart() {
    const bridge = shell();
    return !!(bridge && bridge.update && typeof bridge.on === 'function');
}

/**
 * @returns {Promise<string|null>} the version of the web part that is installed
 */
export function installedWebPart() {
    return shell().update.current();
}

/**
 * @returns {Promise<{ disabled: boolean, available: boolean, current?: string, latest?: string, error?: string }>}
 */
export function checkWebPartUpdate() {
    return shell().update.check();
}

let subscribed = null;
const listeners = new Set();

/**
 * Download, verify and install the newest web part.
 * @param {function(object)} onStep told every step (see Updater.updateCache of src/app)
 * @returns {Promise<object>} the last step: `updated`, `current`, `disabled` or `failed`
 */
export async function installWebPartUpdate(onStep) {
    const bridge = shell();
    // the steps arrive as events, and the bridge cannot unsubscribe: it is subscribed once
    if (subscribed !== bridge) {
        bridge.on('update-progress', (step) => listeners.forEach((listener) => listener(step)));
        subscribed = bridge;
    }
    listeners.add(onStep);
    try {
        return await bridge.update.apply();
    } finally {
        listeners.delete(onStep);
    }
}

/**
 * Reload the window onto the web part that was installed.
 */
export function restartWebPart() {
    return shell().update.restart();
}

/**
 * The name of a web part for people: a web part is named after the time of its build, in base 36 (deploy-web.js).
 * @param {string} [version]
 * @returns {string}
 */
export function describeWebPart(version) {
    const time = /^[0-9A-Z]+$/i.test(version || '') ? parseInt(version, 36) : NaN;
    if (time > Date.UTC(2015, 0) && time < Date.UTC(2100, 0)) {
        return new Date(time).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
    }
    return version || 'unknown';
}

export function megabytes(bytes) {
    return (bytes / 1048576).toFixed(1) + ' MB';
}
