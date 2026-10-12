const path = require('node:path');
const fs = require('node:fs');
const electron = require('electron');

const publicKey = `-----BEGIN PUBLIC KEY-----
MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEAx8wRFrix8rwGiDexiOnU
XhuCutb2rzqXpGcGl8Kdjh2OglHpL4rA3yGTGI4h6RAy+ZQTEadVfRn64Y2NyO/s
QwNpZ46k6Dux2tZ2rf8S9l+DmKnahZqT3zPWup55X0pu/Lw8Li+55Zka0z61wPuE
Zx7MrlJHzhMiKWBpDdGUo/6hW769rpuqKApWDVTFzIrZsvutj+5rcUIndg/grygy
uCWs2g/wXNSntpzIRQDBiPFc0hRsxkDQOpKV7d3YY+9PsxAw99HLCFLTdjrG8Ci4
+Xq4o3TUk+Tr9HZnoKWhFbMQrLfDVqPwqAl0KgNiixP8abSfD8PwGZ1ZlYWgjicU
+QIg73xh+2xrrSzfkWaXoQx342dXxafhZLkHxtVSl08WUngQKxzSmxHJ9R/cakIj
zy/YcE02DDi1233sXacU4eP60m3mbmJBB5xwKXzNHLI4gyU/ebDreBqmg42+lBpj
K72AZ0PxpO92nKZmrEDB5espxGHwikK/SCYr89pjypTUbh3SdFl9gUxenmTKhQ0O
MlR6qLZ9SNkcYXGE/eqF/aww5MRKMSxbMEN6WfGgd+rlW2mWTyKjMBt+NwjQrhw4
pFI4oY4y8fvNDs+jz2tVDUxfrIXl8krav8jdPZhJBcFolAiCLFWvCayvaupJ9UKR
FCeE3f9vRDeIArstfYlkRWkCAwEAAQ==
-----END PUBLIC KEY-----`;

module.exports = class Configuration {
    /**
     * Configuration for portable usage of the application
     * See also: https://github.com/electron/electron/blob/master/docs/api/app.md#appgetpathname
     * @param {Configuration} configuration Another configuration (object/structure) from which the properties shall be applied
     */
    constructor(configuration) {
        let options = configuration || {};
        let applicationExecutableDirectory = path.dirname(electron.app.getPath('exe'));
        this._applicationUpdateURL =
            options['applicationUpdateURL'] ||
            'https://github.com/akn19/rakkomik/releases/download/web-main/latest';
        // the scheme is part of the engine's contract: Connectors.mjs loads its modules over hakuneko://
        this._applicationStartupURL =
            options['applicationStartupURL'] || 'hakuneko://cache/index.html';
        this._applicationCacheDirectory =
            options['applicationCacheDirectory'] ||
            path.join(applicationExecutableDirectory, 'cache');
        this._applicationUserDataDirectory =
            options['applicationUserDataDirectory'] ||
            path.join(applicationExecutableDirectory, 'userdata');
    }

    printInfo() {
        let separator = '-------------';
        console.log('');
        console.log(separator);
        console.log('Configuration');
        console.log(separator);
        console.log('Update URL           :', this.applicationUpdateURL);
        console.log('Connector Protocol   :', this.connectorProtocol);
        console.log('Application Protocol :', this.applicationProtocol);
        console.log('Startup URL          :', this.applicationStartupURL);
        console.log('AppCache Directory   :', this.applicationCacheDirectory);
        console.log('UserData Directory   :', this.applicationUserDataDirectory);
        console.log('');
    }

    static get isPortableMode() {
        return fs.existsSync(electron.app.getPath('exe') + '.portable');
    }

    /**
     * The web part that ships with a packaged application: the folder `web` next to `app.asar`, where the Arch
     * package and the installers put it. Undefined in development (`electron .`), where nothing is packed.
     */
    static get bundledWebDirectory() {
        const application = electron.app.getAppPath();
        if (path.basename(application) !== 'app.asar') {
            return undefined;
        }
        const directory = path.join(path.dirname(application), 'web');
        return fs.existsSync(path.join(directory, 'index.html')) ? directory : undefined;
    }

    get publicKey() {
        return publicKey;
    }

    get applicationUpdateURL() {
        return this._applicationUpdateURL;
    }

    get applicationProtocol() {
        return new URL(this._applicationStartupURL).protocol.slice(0, -1);
    }

    get connectorProtocol() {
        return 'connector';
    }

    get applicationStartupURL() {
        return this._applicationStartupURL;
    }

    get applicationCacheDirectory() {
        return this._absolute(this._applicationCacheDirectory);
    }

    get applicationUserDataDirectory() {
        return this._absolute(this._applicationUserDataDirectory);
    }

    get applicationUserPluginsDirectory() {
        return path.join(this.applicationUserDataDirectory, 'rakkomik.plugins');
    }

    _absolute(endpoint) {
        return path.resolve(electron.app.getAppPath(), path.normalize(endpoint));
    }
};
