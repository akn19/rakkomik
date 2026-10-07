const { ConsoleLogger } = require('./Logger');

const discordPresenceId = '726702836775256094';

/**
 * Main-side Discord rich presence transport (Fase 1 Slice C).
 * Owns the discord-rpc client (node-only); the renderer keeps status
 * computation, event hooks and timers (DiscordPresence.mjs) and drives
 * this bridge. The transport-health heuristics of the old in-renderer
 * client (socket.bytesWritten introspection) are replaced by plain
 * per-call success reporting.
 */
module.exports = class DiscordBridge {

    constructor(logger) {
        this._logger = logger || new ConsoleLogger(ConsoleLogger.LEVEL.Warn);
        this._client = null;
    }

    register() {
        const electron = require('electron');
        try {
            require('discord-rpc').register(discordPresenceId);
        } catch (error) {
            this._logger.warn('DiscordPresence - scheme registration failed!', error);
        }
        electron.ipcMain.handle('hakuneko:presence:ensureStarted', () => {
            return this._ensureStarted();
        });
        electron.ipcMain.handle('hakuneko:presence:setActivity', (event, status) => {
            return this._setActivity(status);
        });
        electron.ipcMain.handle('hakuneko:presence:clearAndDestroy', () => {
            return this._clearAndDestroy();
        });
    }

    async _ensureStarted() {
        if (this._client) {
            return true;
        }
        try {
            const DiscordRPC = require('discord-rpc');
            let client = new DiscordRPC.Client({ transport: 'ipc' });
            await client.login({ clientId: discordPresenceId });
            client.on('disconnected', () => {
                this._client = null;
            });
            this._client = client;
            return true;
        } catch (error) {
            this._logger.warn('DiscordPresence - could not start (' + (error && error.message) + ')');
            this._client = null;
            return false;
        }
    }

    async _setActivity(status) {
        if (!this._client) {
            return false;
        }
        try {
            await this._client.setActivity(status);
            return true;
        } catch (error) {
            this._logger.warn('DiscordPresence - setActivity failed (' + (error && error.message) + ')');
            return false;
        }
    }

    async _clearAndDestroy() {
        if (!this._client) {
            return false;
        }
        try {
            this._client.clearActivity();
            await this._client.destroy();
        } catch (error) {
            this._logger.warn('DiscordPresence - destroy failed (' + (error && error.message) + ')');
        }
        this._client = null;
        return true;
    }
};
