export default class InterProcessCommunication {
    constructor() {
        // Main-to-renderer subscriptions go through the preload bridge.
        // Replies use the dynamic response channel created by the main side.
    }

    listen(channel, handler) {
        window.hakuneko.on(channel, async (responseChannelID, payload) => {
            try {
                let data = await handler(payload);
                window.hakuneko.send(responseChannelID, data);
            } catch (error) {
                console.error(error);
                window.hakuneko.send(responseChannelID, undefined);
            }
        });
    }
}
