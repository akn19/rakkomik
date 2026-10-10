import { unzipSync, zipSync, strToU8 } from 'fflate';
import EbookGenerator from './EbookGenerator.mjs';
import Chapter from './Chapter.mjs';
import { createPath } from './Path.mjs';

const extensions = {
    // chapter format
    img: 'img',
    cbz: '.cbz',
    pdf: '.pdf',
    epub: '.epub'
};

const statusDefinitions = {
    offline: 'offline', // chapter/manga that cannot be downloaded, but exist in manga directory
};

export default class Storage {

    // TODO: use dependency injection instead of globals for EbookGenerator
    constructor() {
        // Fase 1 Slice C: filesystem via preload bridge (window.hakuneko), paths computed here (Path.mjs).
        // TODO: Use recursive native fs helpers where bulk operations are needed
        this.dialog = window.hakuneko.dialog;
        this.platform = window.hakuneko.platform;
        this.shell = window.hakuneko.shell;
        this.fs = window.hakuneko.fs;
        this.path = createPath(this.platform);
        this.config = this.path.join(window.hakuneko.app.getPath('userData'), 'hakuneko.');
        this.temp = this.path.join(window.hakuneko.os.tmpdir, 'hakuneko');

        this.pdfTargetHeight = 1600;
        this.fileURISubstitutions = {
            rgx: /['#?;]/g,
            map: {
                '\'': '%27',
                '#': '%23',
                '?': '%3F',
                ';': '%3B'
            }
        };
    }

    /**
     * Open the system's file browser and navigate to the given chapter item
     */
    showFolderContent(chapter) {
        this.shell.showItemInFolder(this._chapterOutputPath(chapter));
    }

    /**
     * Execute a post-download command in the main process (Fase 1: IPC).
     */
    exec(command, options, callback) {
        window.hakuneko.exec(command, options)
            .then(result => callback(result.error ? new Error(result.error) : undefined))
            .catch(error => callback(error));
    }

    /**
     * Save the given value for the given key in the persistant storage
     */
    saveConfig(key, value, indentation) {
        return this._writeFileAtomic(this.config + key, JSON.stringify(value, undefined, indentation)).then(() => undefined);
    }

    /**
     * Load the value for the given key from the persistant storage
     */
    async loadConfig(key) {
        //return fetch( this.config + key ).then( response => response.json() );
        let data = await this.fs.readFile(this.config + key, 'utf8');
        return JSON.parse(data);
    }

    /**
     * Convenience function wrapping key value saving for mangas collection
     */
    saveMangaList(connectorID, mangas) {
        return this.saveConfig('mangas.' + connectorID, mangas);
    }

    /**
     * Convenience function wrapping key value loading for mangas collection
     */
    loadMangaList(connectorID) {
        return this.loadConfig('mangas.' + connectorID);
    }

    /**
     * https://github.com/electron/electron/blob/master/docs/api/dialog.md#dialogshowopendialogbrowserwindow-options
     */
    async folderBrowser(rootPath) {
        let result = await this.dialog.showOpenDialog({
            title: 'Download Directory for Mangas',
            //message: 'MESSAGE',
            defaultPath: rootPath,
            properties: ['openDirectory']
        });
        // preload bridge returns the dialog result unchanged (or undefined when unsupported)
        result = result || { canceled: true, filePaths: [] };
        return !result.canceled && result.filePaths.length ? result.filePaths[0] : null;
    }

    /**
     * Return a promise that will be fulfilled if the corresponding path is an existing directory.
     */
    async directoryExist(path) {
        let stats = await this.fs.stat(path);
        if (!stats.isDirectory) {
            throw new Error(`The given path "${path}" is not a directory!`);
        }
    }

    /**
     * Return a promise that will be fulfilled if the corresponding manga directory exist.
     * Due to performance this method must not be used for bulk existing checks.
     */
    mangaDirectoryExist(manga) {
        return this.directoryExist(this._mangaOutputPath(manga));
    }

    /**
     * Wrapper for fs.readdir that fill return a promise instead of using a callback
     */
    _readDirectoryEntries(directory) {
        return this.fs.readdir(directory);
    }

    /**
     * Find all directories/files in the base directory.
     * This key-value map can than be used to look up for existing manga titles (where the key represents the title and the value is always true).
     * Keep in mind that the manga titles in this map are sanitized and may not equal the raw (original) manga title.
     */
    getExistingMangaTitles(connector) {
        let directory = this._connectorOutputPath(connector);
        return this._readDirectoryEntries(directory)
            .then(entries => {
                let titleMap = [];
                // use key value pairs instead of plain titles to increase performance when looking up a certain manga title
                entries.forEach(entry => {
                    titleMap[entry] = true;
                });
                return Promise.resolve(titleMap);
            });
    }

    /**
     * Find all directories/files in the manga directory.
     * This list can than be used to look for existing chapter titles.
     * Keep in mind that the chapter titles in this list are sanitized and may not equal the raw (original) chapter title.
     */
    getExistingChapterTitles(manga) {
        let directory = this._mangaOutputPath(manga);
        return this._readDirectoryEntries(directory)
            .then(entries => {
                /*
                 * TODO: only add supported files / folders
                 * file that ends with any of the supported extension,
                 * folders that contains any image?
                 */
                /*
                 * entries = entries.filter( path => {
                 * return (
                 * path.endsWith( extensions.epub ) ||
                 * path.endsWith( extensions.cbz ) ||
                 * path.endsWith( extensions.pdf )
                 * // what about directory with images ???
                 * );
                 * } );
                 */
                let titleMap = [];
                // use key value pairs instead of plain titles to increase performance when looking up a certain manga title
                entries.forEach(entry => {
                    titleMap[entry] = true;
                });
                return Promise.resolve(titleMap);
            });
    }

    /**
     * ...
     * Callback will be executed after completion and provided with an array of errors (or an empty array when no errors occured)
     * and a reference to the page list (undefined on error).
     */
    loadChapterPages(chapter) {
        let path = chapter instanceof Chapter ? this._chapterOutputPath(chapter) : chapter;
        if (typeof path !== 'string') {
            return Promise.reject(new Error('Invalid parameter "chapter", must be <String> or <Chapter> type!'));
        }
        if (path.endsWith(extensions.epub)) {
            return this._loadChapterPagesEPUB(path);
        }
        if (path.endsWith(extensions.pdf)) {
            return this._loadChapterPagesPDF(path);
        }
        if (path.endsWith(extensions.cbz)) {
            return this._loadChapterPagesCBZ(path);
        }
        return this._loadChapterPagesFolder(path);
    }
    /**
     * Return a promise with the loaded opened zip archive data
     */
    async _openZipArchive(file) {
        return unzipSync(await this.fs.readFile(file));
    }

    /**
     * Extract file from zip entry to temp and returns a promise that
     * will be resolved with the URI to the extracted file.
     */
    async _extractZipEntry(archive, file) {
        let name = this.path.join(this.temp, this.path.basename(file));
        // attach timestamp to force reload of already existing, but overwritten temp files
        let page = encodeURI('file://' + name.replace(/\\/g, '/') + '?ts=' + Date.now());
        await this._createDirectoryChain(this.temp);
        await this.fs.writeFile(name, archive[file]);
        return page;
    }

    /**
     * Read image data from e-book.
     * Callback will be executed after completion and provided with an array of errors (or an empty array when no errors occured)
     * and a reference to the page list (undefined on error).
     */
    _loadChapterPagesEPUB(ebook) {
        return this._openZipArchive(ebook)
            .then(archive => {
                let promises = Object.keys(archive).filter(file => {
                    return /^OEBPS[/\\]img[/\\][^/\\]+$/.test(file);
                }).map(file => {
                    return this._extractZipEntry(archive, file);
                });
                return Promise.all(promises);
            })
            .then(pages => {
                return Promise.resolve(pages.sort());
            });
    }

    /**
     * Read image data from portable document format.
     * Callback will be executed after completion and provided with an array of errors (or an empty array when no errors occured)
     * and a reference to the page list (undefined on error).
     */
    _loadChapterPagesPDF( /*pdf*/) {
        return Promise.reject(new Error('PDF preview not yet supported!'));
    }

    /**
     * Read image data from CBZ archive.
     * Callback will be executed after completion and provided with an array of errors (or an empty array when no errors occured)
     * and a reference to the page list (undefined on error).
     */
    _loadChapterPagesCBZ(cbz) {
        return this._openZipArchive(cbz)
            .then(archive => {
                let promises = Object.keys(archive).filter(file => {
                    return /^[^/\\]+\.(jpe?g|png|gif|webp|avif|bmp)$/i.test(file);
                }).map(file => {
                    return this._extractZipEntry(archive, file);
                });
                return Promise.all(promises);
            })
            .then(pages => {
                return Promise.resolve(pages.sort());
            });
    }

    /**
     * Read image data from directory.
     * Callback will be executed after completion and provided with an array of errors (or an empty array when no errors occured)
     * and a reference to the page list (undefined on error).
     */
    _loadChapterPagesFolder(directory) {
        return this.fs.readdir(directory)
            .then(files => {
                let pages = files.map(file => this._makeValidFileURL(directory, file));
                return Promise.resolve(pages);
            });
    }

    /**
     *
     */
    _makeValidFileURL(directory, file) {
        return encodeURI('file://' + this.path.join(directory, file).replace(/\\/g, '/'))
            // some special cases are not covered with encodeURI and needs to be replaced manually
            .replace(this.fileURISubstitutions.rgx, m => this.fileURISubstitutions.map[m]);
    }

    /**
     * Save the pages of the given chapter.
     * The given content is a list of raw data for each corresponding page in the chapter.
     * The storage decides depending on the engine and available settings where the pages will be stored!
     * Callback will be executed after completion and provided with an array of errors (or an empty array when no errors occured).
     *
     * content is an array of blobs
     */
    saveChapterPages(chapter, content) {
        try {
            let leadingZeroes = String(content.length).length;
            let pageData = content.map((page, index) => {
                return {
                    name: this._pageFileName(index + 1, page.type, leadingZeroes),
                    type: page.type,
                    data: page
                };
            });

            let promise = undefined;
            let output = this._chapterOutputPath(chapter);
            if (Engine.Settings.chapterFormat.value === extensions.img) {
                promise = this._createDirectoryChain(output)
                    .then(() => this._saveChapterPagesFolder(output, pageData))
                    .then(() => this._runPostChapterDownloadCommand(chapter, output));
            }
            if (Engine.Settings.chapterFormat.value === extensions.cbz) {
                promise = this._createDirectoryChain(this.path.dirname(output))
                    .then(() => this._saveChapterPagesCBZ(output, pageData, chapter.manga.title, chapter.title))
                    .then(() => this._runPostChapterDownloadCommand(chapter, output));
            }
            if (Engine.Settings.chapterFormat.value === extensions.epub) {
                promise = this._createDirectoryChain(this.path.dirname(output))
                    .then(() => this._saveChapterPagesEPUB(output, pageData))
                    .then(() => this._runPostChapterDownloadCommand(chapter, output));
            }
            return promise || Promise.reject(new Error('Unsupported output format: ' + Engine.Settings.chapterFormat.value));
        } catch (error) {
            return Promise.reject(error);
        }
    }

    /**
     * Create and save pages to the given e-book file.
     * Callback will be executed after completion and provided with an array of errors (or an empty array when no errors occured).
     */
    async _saveChapterPagesEPUB(ebook, pageData) {
        let params = [];
        let files = {
            // the EPUB container requires the mimetype as uncompressed first entry
            'mimetype': [ strToU8(EbookGenerator.createMimetype()), { level: 0 } ],
            'META-INF/container.xml': strToU8(EbookGenerator.createContainerXML()),
            'OEBPS/css/style.css': strToU8(EbookGenerator.createStyleCSS())
        };
        for (let [ index, page ] of pageData.entries()) {
            files['OEBPS/img/' + page.name] = await this._blobToBytes(page.data);
            files['OEBPS/xhtml/' + index + '.xhtml'] = strToU8(EbookGenerator.createPageXHTML(page.name));
            params.push({
                img: page.name,
                xhtml: index + '.xhtml',
                mime: page.type
            });
        }
        let uid = btoa(encodeURIComponent(ebook)).replace(/[^a-zA-Z]/g, '');
        let title = `${this.path.basename(this.path.dirname(ebook))} ${this.path.sep} ${this.path.basename(ebook, extensions.epub)}`;
        files['OEBPS/content.opf'] = strToU8(EbookGenerator.createContentOPF(uid, title, params));
        files['OEBPS/toc.ncx'] = strToU8(EbookGenerator.createTocNCX(uid, '', params));
        // images are compressed already: store everything
        return this._writeFile(ebook, zipSync(files, { level: 0 }));
    }

    /**
     * Create and save pages to the given portable document file.
     * Callback will be executed after completion and provided with an array of errors (or an empty array when no errors occured).
     */
    async _saveChapterPagesPDF(pdf, pageData) {
        var doc = new PDFDocument({ autoFirstPage: false });
        doc.pipe(this.fs.createWriteStream(pdf));
        for (let page of pageData) {
            await this._addImageToPDF(doc, page);
        }
        doc.end();
    }

    /**
     * Add a single image as PDF page to the given document.
     */
    async _addImageToPDF(pdfDocument, page) {
        let bitmap = await new Promise((resolve, reject) => {
            let img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('Failed to load image!'));
            img.src = URL.createObjectURL(page.data);
        });
        let pdfImgType = this._pdfImageType(page);
        let blob;
        if (!pdfImgType) {
            pdfImgType = 'JPEG';
            let canvas = document.createElement('canvas');
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
            let ctx = canvas.getContext('2d');
            ctx.drawImage(bitmap, 0, 0);
            blob = await new Promise(resolve => {
                canvas.toBlob(data => resolve(data), 'image/jpeg', 0.90);
            });
        } else {
            blob = page.data;
        }

        let bytes = await this._blobToBytes(blob);
        let pdfTargetWidth = this.pdfTargetHeight * bitmap.width / bitmap.height;
        pdfDocument.addPage({ size: [pdfTargetWidth, this.pdfTargetHeight] });
        pdfDocument.image(bytes.buffer, 0, 0, { width: pdfTargetWidth, height: this.pdfTargetHeight });
    }

    /**
     * Create and save pages to the given archive file.
     * Callback will be executed after completion and provided with an array of errors (or an empty array when no errors occured).
     */
    async _saveChapterPagesCBZ(archive, pageData, mangaName = '', chapterName = '') {
        let files = {
            'ComicInfo.xml': strToU8(Engine.ComicInfoGenerator.createComicInfoXML(mangaName, chapterName, pageData.length))
        };
        for (let page of pageData) {
            files[page.name] = await this._blobToBytes(page.data);
        }
        // images are compressed already: store everything
        return this._writeFile(archive, zipSync(files, { level: 0 }));
    }

    /**
     * Save pages to the given directory.
     * Callback will be executed after completion and provided with an array of errors (or an empty array when no errors occured).
     */
    _saveChapterPagesFolder(directory, pageData) {
        let promises = pageData.map(page => {
            return this._blobToBytes(page.data)
                .then(data => {
                    return this._writeFile(this.path.join(directory, page.name), data);
                });
        });
        return Promise.all(promises);
    }

    /**
     *
     */
    _runPostChapterDownloadCommand(chapter, path) {
        let command = Engine.Settings.postChapterDownloadCommand.value; // `echo "%C% | %M% | %O%" > "%PATH%.txt"`;
        if (command) {
            command = command.replace(/%PATH%/g, path);
            command = command.replace(/%C%/g, chapter.manga.connector.label);
            command = command.replace(/%M%/g, chapter.manga.title);
            command = command.replace(/%O%/g, chapter.title);
            this.exec(command, { cwd: this.path.dirname(path), windowsHide: true }, error => {
                if (error) {
                    console.error(error);
                }
            });
        }
        return Promise.resolve();
    }

    /**
     * Helper function to convert a Blob to an Uint8Array
     * https://github.com/electron/electron/blob/master/docs/api/protocol.md#protocolregisterbufferprotocolscheme-handler-completion
     */
    async _blobToBytes(blob) {
        return new Uint8Array(await blob.arrayBuffer());
    }

    /**
     * Wrap the async write file function into a promise
     */
    _writeFile(path, data) {
        return this._writeFileAtomic(path, data).then(() => path);
    }

    /**
     * Crash-safe write: data lands in a temp sibling first, then a single
     * atomic rename publishes it. A crash can only leave a stray temp file
     * (same directory, same filesystem => rename is atomic); the target is
     * never observed half-written, so JSON configs cannot corrupt.
     */
    async _writeFileAtomic(path, data) {
        const temp = `${path}.tmp-${Date.now().toString(36)}-${Math.floor(Math.random() * 0xffffff).toString(36)}`;
        try {
            await this.fs.writeFile(temp, data);
            await this.fs.rename(temp, path);
        } catch (error) {
            await this.fs.unlink(temp).catch(() => undefined);
            throw error;
        }
    }

    async saveTempFile(name, data) {
        let file = this.path.join(this.temp, this.sanatizePath(name));
        await this._createDirectoryChain(this.temp);
        return this._writeFile(file, data);
    }
    /**
     * Helper function to generate the path where the bookmarks and markers are stored.
     */
    get _bookmarkOutputPath() {
        return this.path.join(Engine.Settings.bookmarkDirectory.value, 'hakuneko.');
    }

    /**
     * Helper function to generate the path where the connector mangas are stored.
     */
    _connectorOutputPath(connector) {
        let output = Engine.Settings.baseDirectory.value;
        // NOTE: Some (system) connectors are defining their own directory
        if (connector.config && connector.config.path) {
            output = connector.config.path.value;
        } else {
            if (Engine.Settings.useSubdirectory.value) {
                output = this.path.join(output, this.sanatizePath(connector.label));
            }
        }
        return output;
    }

    /**
     * Helper function to generate the path where the manga chapters are stored.
     */
    _mangaOutputPath(manga) {
        let output = this._connectorOutputPath(manga.connector);
        output = this.path.join(output, this.sanatizePath(manga.title));
        return output;
    }

    /**
     * Helper function to generate the path where the chapter pages are stored.
     */
    _chapterOutputPath(chapter) {
        let output = this._mangaOutputPath(chapter.manga);
        output = this.path.join(output, this.sanatizePath(chapter.title));
        if (chapter.status === statusDefinitions.offline) {
            return output;
        }
        // used when loading and saving manga chapters
        if (Engine.Settings.chapterFormat.value !== extensions.img) {
            output += Engine.Settings.chapterFormat.value;
        }
        return output;
    }

    /**
     * Create the given folder and all of its missing parents (no-op when it exists).
     * @returns {Promise<void>}
     */
    _createDirectoryChain(path) {
        return this.fs.mkdir(path);
    }

    /**
     * Create a path without forbidden characters.
    */
    sanatizePath(path) {

        //replace C0 && C1 control codes
        // eslint-disable-next-line no-control-regex
        path = path.replace(/[\u0000-\u001F\u007F-\u009F]/g, '');
        if (this.platform.indexOf('win') === 0) {
            // TODO: max. 260 characters per path
            path = path.replace(/[\\/:*?"<>|]/g, '');
        }
        if (this.platform.indexOf('linux') === 0) {
            path = path.replace(/[/]/g, '');
        }
        if (this.platform.indexOf('darwin') === 0) {
            // TODO: max. 32 chars per part
            path = path.replace(/[/:]/g, '');
        }
        return path.replace(/[.\s]+$/g, '').trim();
    }

    /**
     * Helper function to generate an entry name for a page (picture) depending on the given number and mime type
     */
    _pageFileName(number, mimeType, leadingZeroes) {
        let fileName = String(number).padStart(leadingZeroes, 0);
        if (mimeType.indexOf('image/webp') > -1) {
            return fileName + '.webp';
        }
        if (mimeType.indexOf('image/jpeg') > -1) {
            return fileName + '.jpg';
        }
        if (mimeType.indexOf('image/png') > -1) {
            return fileName + '.png';
        }
        if (mimeType.indexOf('image/gif') > -1) {
            return fileName + '.gif';
        }
        if (mimeType.indexOf('image/bmp') > -1) {
            return fileName + '.bmp';
        }
        if (mimeType.indexOf('image/') > -1) {
            return fileName + '.img';
        }
        return fileName + '.bin';
    }

    /**
     * Helper function to get the mime type depending on the file extension of the given file name.
     */
    _pageFileMime(file) {
        let extension = this.path.extname(file);
        if (extension === '.webp') {
            return 'image/webp';
        }
        if (extension === '.jpeg') {
            return 'image/jpeg';
        }
        if (extension === '.jpg') {
            return 'image/jpeg';
        }
        if (extension === '.png') {
            return 'image/png';
        }
        if (extension === '.gif') {
            return 'image/gif';
        }
        if (extension === '.bmp') {
            return 'image/bmp';
        }
        if (extension === '.img') {
            return 'image/';
        }
        return 'application/octet-stream';
    }

    /**
     * Helper function to get the image type for jsPDF of the given mime type.
     * If the mime is not a spported PDF image format undefined will be returned.
     */
    _pdfImageType(image) {
        if (image.type === 'image/jpeg') {
            return 'JPEG';
        }
        if (image.type === 'image/png') {
            return 'PNG';
        }
        return undefined;
    }

    /**
     * Save the given value for the given key in the bookmark storage
     */
    saveBookmarks(key, value, indentation) {
        return new Promise((resolve, reject) => {
            this._writeFileAtomic(this._bookmarkOutputPath + key, JSON.stringify(value, undefined, indentation)).then(() => resolve(), error => reject(error));
        });
    }

    /**
     * Load the value for the given key from the bookmark storage
     */
    async loadBookmarks(key) {
        return this.fs.readFile(this._bookmarkOutputPath + key, 'utf8').then(data => JSON.parse(data));
    }
}
