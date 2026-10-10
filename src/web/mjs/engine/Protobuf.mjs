/**
 * protobuf.js on demand. Only a few connectors speak Protocol Buffers, so the
 * UMD bundle (`src/web/js/protobuf.min.js`, vendored by `scripts/vendor.js`)
 * is injected as a classic script on first use instead of being parsed at
 * every start of the application.
 */
let loading = null;

/**
 * @returns {Promise<object>} the `protobuf` namespace (protobufjs)
 */
export function loadProtobuf() {
    if (globalThis.protobuf) {
        return Promise.resolve(globalThis.protobuf);
    }
    loading ??= new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = new URL('../../js/protobuf.min.js', import.meta.url).href;
        script.onload = () => resolve(globalThis.protobuf);
        script.onerror = () => {
            loading = null;
            script.remove();
            reject(new Error('Failed to load the protobuf library!'));
        };
        document.head.append(script);
    });
    return loading;
}
