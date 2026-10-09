/**
 * Engine bridge (audit §5.3).
 *
 * The engine is NOT imported as a module: it is loaded as classic scripts
 * that expose `window.Engine` BEFORE the React shell mounts (see
 * `loadEngine()` in `index.html`; connectors depend on that global too).
 * This adapter only reads the global, so engine logic stays untouched and
 * dynamically-imported connectors are unaffected.
 *
 * The engine is fully initialized before mount, so a plain snapshot read is
 * enough for the shell. Missing pieces degrade to empty values (never throw)
 * so the shell can still paint its skeleton. Per-view live data
 * (TanStack Query territory) arrives with the later slices, extending this
 * same global-read pattern.
 */
function readEngine() {
    return typeof window !== 'undefined' ? window.Engine : undefined;
}

export function getEngineStatus() {
    const engine = readEngine();
    if (!engine) {
        return { connectors: 0, frontend: '', version: '' };
    }
    let frontend = '';
    try {
        const setting = engine.Settings.frontend;
        const option = setting.options.find(entry => entry.value === setting.value);
        frontend = option ? option.name : setting.value;
    } catch {
        frontend = '';
    }
    let version = '';
    try {
        version = `${engine.Version.branch.label}@${engine.Version.revision.label}`;
    } catch {
        version = '';
    }
    let connectors = 0;
    try {
        connectors = engine.Connectors.length;
    } catch {
        connectors = 0;
    }
    return { connectors, frontend, version };
}
