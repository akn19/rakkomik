export default class InterProcessCommunication {

    constructor() {
        // Fase 1 Slice C: main-to-renderer subscriptions via preload bridge.
        // Replies use the dynamic response channel created by the main side.
    }

    listen(channel, handler) {
        window.hakuneko.on(channel, async (responseChannelID, payload) => {
            try {
                let data = await handler(payload);
                window.hakuneko.send(responseChannelID, data);
            } catch(error) {
                console.error(error);
                window.hakuneko.send(responseChannelID, undefined);
            }
        });
    }
}
