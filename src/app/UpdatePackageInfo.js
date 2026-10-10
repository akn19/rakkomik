const crypto = require('node:crypto');

module.exports = class UpdatePackageInfo {

    constructor(version, signature, link) {
        this.version = version;
        this.signature = signature;
        this.link = link;
    }

    /**
     * Validates that the given data is correctly signed (RSA PKCS#1 v1.5 over SHA-256, hex encoded).
     * @param {Uint8Array | Buffer} data The package data to be validated
     * @param {string} pubkey The PEM public key matching the signing key
     * @returns {Promise} A promise that will resolve with the given data if verification succeeds, otherwise reject with a related error
     */
    async validate(data, pubkey) {
        if(!crypto.verify('sha256', data, pubkey, Buffer.from(this.signature, 'hex'))) {
            throw new Error('Integrity check of update failed! The signature does not match the update package.');
        }
        return data;
    }
};
