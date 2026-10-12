const electron = require('electron');
const { ConsoleLogger } = require('./Logger');

const discordPresenceId = '726702836775256094';

/**
 * Main-side Discord rich presence transport.
 * Owns the RPC client (node-only, IPC transport to the local Discord
 * client); the renderer keeps status computation, event hooks and timers
 * (DiscordPresence.mjs) and drives this bridge with plain per-call
 * success reporting. The former `discord-<id>://` URL scheme registration
 * was dropped: it only served Discord's join/spectate launch, which the
 * application never offered.
 */
module.exports = class DiscordBridge {
    constructor(logger) {
        this._logger = logger || new ConsoleLogger(ConsoleLogger.LEVEL.Warn);
        this._client = null;
        this._starting = null;
    }

    register() {
        electron.ipcMain.handle('rakkomik:presence:ensureStarted', () => {
            return this._ensureStarted();
        });
        electron.ipcMain.handle('rakkomik:presence:setActivity', (event, status) => {
            return this._setActivity(status);
        });
        electron.ipcMain.handle('rakkomik:presence:clearAndDestroy', () => {
            return this._clearAndDestroy();
        });
    }

    async _ensureStarted() {
        if (this._client) {
            return true;
        }
        // the renderer asks on every selection event: a call during a pending login shares its outcome
        if (!this._starting) {
            this._starting = this._start().finally(() => {
                this._starting = null;
            });
        }
        return this._starting;
    }

    async _start() {
        try {
            // loaded on first use: the RPC client and its HTTP stack must not delay the application start
            const { Client } = require('@xhayper/discord-rpc');
            let client = new Client({ clientId: discordPresenceId, transport: { type: 'ipc' } });
            client.on('disconnected', () => {
                this._client = null;
            });
            await client.login();
            this._client = client;
            return true;
        } catch (error) {
            this._logger.warn(
                'DiscordPresence - could not start (' + (error && error.message) + ')',
            );
            this._client = null;
            return false;
        }
    }

    async _setActivity(status) {
        if (!this._client || !this._client.user) {
            return false;
        }
        try {
            await this._client.user.setActivity(status);
            return true;
        } catch (error) {
            this._logger.warn(
                'DiscordPresence - setActivity failed (' + (error && error.message) + ')',
            );
            return false;
        }
    }

    async _clearAndDestroy() {
        if (!this._client) {
            return false;
        }
        try {
            if (this._client.user) {
                await this._client.user.clearActivity();
            }
        } catch (error) {
            this._logger.warn(
                'DiscordPresence - clearActivity failed (' + (error && error.message) + ')',
            );
        }
        try {
            await this._client.destroy();
        } catch (error) {
            this._logger.warn(
                'DiscordPresence - destroy failed (' + (error && error.message) + ')',
            );
        }
        this._client = null;
        return true;
    }
};
