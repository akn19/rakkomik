const path = require('node:path');
const electron = require('electron');
const Configuration = require('./Configuration');

module.exports = class ConfigurationWindows extends Configuration {

    constructor(configuration) {
        super(configuration);
        let options = configuration || {};
        let applicationLocalDirectory = path.normalize(path.join(electron.app.getPath('appData'), '..', 'Local', electron.app.name));
        this._applicationCacheDirectory = options['applicationCacheDirectory'] || path.join(applicationLocalDirectory, 'cache'); // => ~\AppData\Local\rakkomik\cache
        this._applicationUserDataDirectory = options['applicationUserDataDirectory'] || electron.app.getPath('userData');
    }
};