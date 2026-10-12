// Builds Windows executables for the tests of the resource editor and of the Windows packager. `pe-library` and
// `resedit` are the libraries that the editor itself uses; they make a real PE file from nothing, so no binary of
// Electron has to be checked in.
const { FUSE_SENTINEL, STOCK_FUSES } = require('./buildAppHarness');

// a 1x1 PNG
const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
);

/**
 * An icon file (ICO) whose frames are PNG images, as scripts/icons.js writes them.
 * @param {number[]} sizes the edge length of each frame (the image itself is the 1x1 PNG; only the directory differs)
 */
function createIcon(sizes = [1]) {
    const header = Buffer.alloc(6);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(sizes.length, 4);
    const directory = Buffer.alloc(16 * sizes.length);
    sizes.forEach((size, index) => {
        directory.writeUInt8(size >= 256 ? 0 : size, index * 16);
        directory.writeUInt8(size >= 256 ? 0 : size, index * 16 + 1);
        directory.writeUInt16LE(1, index * 16 + 4);
        directory.writeUInt16LE(32, index * 16 + 6);
        directory.writeUInt32LE(PNG.length, index * 16 + 8);
        directory.writeUInt32LE(
            header.length + directory.length + index * PNG.length,
            index * 16 + 12,
        );
    });
    return Buffer.concat([header, directory, ...sizes.map(() => PNG)]);
}

/**
 * The executable of an Electron release, as far as the packagers care: a PE file with the resources of Electron (an
 * icon group and version information) and, after the sections, the fuse wire that `@electron/fuses` flips.
 * @param {object} [options]
 * @param {string} [options.wire] the fuse wire, "1" enabled and "0" disabled
 * @param {boolean} [options.icon] holds an icon group
 * @param {boolean} [options.versionInfo] holds version information
 * @param {boolean} [options.signed] carries an Authenticode signature, as the executables of the Electron releases do
 * @param {number} [options.language] the language of the resources (1033 is English, US)
 * @returns {Promise<Buffer>}
 */
async function createExecutable({
    wire = STOCK_FUSES,
    icon = true,
    versionInfo = true,
    signed = false,
    language = 1033,
} = {}) {
    const PELibrary = await import('pe-library');
    const ResEdit = await import('resedit');
    const exe = PELibrary.NtExecutable.createEmpty(false, false);
    const resource = PELibrary.NtExecutableResource.from(exe);
    if (versionInfo) {
        const info = ResEdit.Resource.VersionInfo.createEmpty();
        info.setStringValues(
            { lang: language, codepage: 1200 },
            {
                ProductName: 'Electron',
                CompanyName: 'GitHub, Inc.',
                FileDescription: 'Electron',
                InternalName: 'electron.exe',
                OriginalFilename: 'electron.exe',
            },
        );
        info.setFileVersion(44, 7, 0, 0, language);
        info.setProductVersion(44, 7, 0, 0, language);
        info.outputToResourceEntries(resource.entries);
    }
    if (icon) {
        ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
            resource.entries,
            101,
            language,
            ResEdit.Data.IconFile.from(createIcon()).icons.map((item) => item.data),
        );
    }
    resource.outputResource(exe);
    // the fuse wire lives in the data of the executable, which the editor must carry over
    exe.setExtraData(
        Buffer.concat([
            Buffer.from(FUSE_SENTINEL),
            Buffer.from([1, wire.length]),
            Buffer.from(wire, 'latin1'),
            Buffer.from('\0'),
        ]),
    );
    const bytes = Buffer.from(exe.generate());
    if (!signed) {
        return bytes;
    }
    const signature = Buffer.alloc(64, 0xaa);
    const binary = Buffer.concat([bytes, signature]);
    const view = binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.length);
    const dos = PELibrary.Format.ImageDosHeader.from(view);
    const headers = PELibrary.Format.ImageNtHeaders.from(view, dos.newHeaderAddress);
    headers.optionalHeaderDataDirectory.set(PELibrary.Format.ImageDirectoryEntry.Certificate, {
        virtualAddress: bytes.length,
        size: signature.length,
    });
    return Buffer.from(view);
}

/**
 * What a Windows executable holds in its resources, read with the libraries and not with the editor under test.
 * @param {Buffer} bytes
 */
async function readResources(bytes) {
    const PELibrary = await import('pe-library');
    const ResEdit = await import('resedit');
    const exe = PELibrary.NtExecutable.from(bytes, { ignoreCert: true });
    const resource = PELibrary.NtExecutableResource.from(exe);
    const [info] = ResEdit.Resource.VersionInfo.fromEntries(resource.entries);
    const [language] = info.getAvailableLanguages();
    return {
        strings: info.getStringValues(language),
        fixed: info.fixedInfo,
        language,
        languages: info.getAvailableLanguages(),
        groups: ResEdit.Resource.IconGroupEntry.fromEntries(resource.entries),
        extra: exe.getExtraData() && Buffer.from(exe.getExtraData()),
    };
}

module.exports = { createExecutable, createIcon, readResources };
