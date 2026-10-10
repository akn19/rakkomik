const { mockModule } = require('./support/mockRequire');
mockModule('fs/promises');
const fs = require('fs/promises');

mockModule('jszip');
const jszip = require('jszip');

const path = require('path');
const { FileLogger } = require('../Logger');
const CacheDirectoryManager = require('../CacheDirectoryManager');
var logger = new FileLogger(__filename + '.log', FileLogger.LEVEL.All);
logger.clear();

var loadAsyncMock;
// `new JSZip()` needs a constructor-compatible implementation (not an arrow function)
jszip.mockImplementation(function() {
    return {
        loadAsync: loadAsyncMock
    };
});

describe('CacheDirectoryManager', function () {

    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        //
    });

    describe('getCurrentVersion()', function () {
        it('should get version when file exists', async () => {
            fs.readFile.mockReturnValueOnce(Promise.resolve('xxx'));
            let testee = new CacheDirectoryManager('/cache', logger);
            let version = await testee.getCurrentVersion();
            expect(version).toEqual('xxx');
        });
        it('should get undefined when an error occurs', async () => {
            fs.readFile.mockReturnValueOnce(Promise.reject(new Error('File not found!')));
            let testee = new CacheDirectoryManager('/cache', logger);
            let version = await testee.getCurrentVersion();
            expect(version).toEqual(undefined);
        });
    });

    describe('_extractZipEntry()', function () {
        it('should skip directory entries', async () => {
            fs.mkdir.mockReturnValueOnce(Promise.resolve());
            fs.writeFile.mockReturnValueOnce(Promise.resolve());
            let archiveMock = {
                files: {
                    'dir/sub': {
                        dir: true,
                        async: vi.fn(() => Promise.resolve('RAW BYTES'))
                    }
                }
            };
            let testee = new CacheDirectoryManager('/cache', logger);
            await testee._extractZipEntry(archiveMock, '/cache', 'dir/sub');
            expect(fs.mkdir).not.toHaveBeenCalled();
            expect(fs.writeFile).not.toHaveBeenCalled();
            expect(archiveMock.files['dir/sub'].async).not.toHaveBeenCalled();
        });
        it('should create directory and extract file', async () => {
            fs.mkdir.mockReturnValueOnce(Promise.resolve());
            fs.writeFile.mockReturnValueOnce(Promise.resolve());
            let archiveMock = {
                files: {
                    'dir/sub/file': {
                        dir: false,
                        async: vi.fn(() => Promise.resolve('RAW BYTES'))
                    }
                }
            };
            let testee = new CacheDirectoryManager('/cache', logger);
            await testee._extractZipEntry(archiveMock, '/cache', 'dir/sub/file');
            expect(fs.mkdir).toHaveBeenCalledTimes(1);
            expect(fs.mkdir).toHaveBeenLastCalledWith(path.normalize('/cache/dir/sub'), { recursive: true });
            expect(fs.writeFile).toHaveBeenCalledTimes(1);
            expect(fs.writeFile).toHaveBeenLastCalledWith(path.normalize('/cache/dir/sub/file'), 'RAW BYTES');
            expect(archiveMock.files['dir/sub/file'].async).toHaveBeenCalledTimes(1);
            expect(archiveMock.files['dir/sub/file'].async).toHaveBeenLastCalledWith('uint8array');
        });
    });

    describe('applyUpdateArchive()', function () {
        it('should keep existing cache when archive is invalid', async () => {
            loadAsyncMock = vi.fn(() => Promise.reject());
            let testee = new CacheDirectoryManager('/cache', logger);
            testee._extractZipEntry = vi.fn();
            expect.assertions(5);
            try {
                await testee.applyUpdateArchive('1.0.0', 'ARCHIVE BYTES');
            } catch(error) {
                expect(loadAsyncMock).toHaveBeenCalledTimes(1);
                expect(loadAsyncMock).toHaveBeenLastCalledWith('ARCHIVE BYTES', {});
                expect(fs.rm).not.toHaveBeenCalled();
                expect(fs.writeFile).not.toHaveBeenCalled();
                expect(testee._extractZipEntry).not.toHaveBeenCalled();
            }
        });
        it('should replace existing cache when archive is valid', async () => {
            let archive = {
                files: {
                    'index.html': null,
                    'js': null,
                    'js/app.js': null
                }
            };
            loadAsyncMock = vi.fn(() => Promise.resolve(archive));
            let testee = new CacheDirectoryManager('/cache', logger);
            testee._extractZipEntry = vi.fn();
            await testee.applyUpdateArchive('1.0.0', 'ARCHIVE BYTES');
            expect(loadAsyncMock).toHaveBeenCalledTimes(1);
            expect(loadAsyncMock).toHaveBeenLastCalledWith('ARCHIVE BYTES', {});
            expect(fs.rm).toHaveBeenCalled();
            expect(fs.rm).toHaveBeenLastCalledWith(path.normalize('/cache'), { recursive: true, force: true });
            expect(fs.writeFile).toHaveBeenCalled();
            expect(fs.writeFile).toHaveBeenLastCalledWith(path.normalize('/cache/version'), '1.0.0');
            expect(testee._extractZipEntry).toHaveBeenCalledTimes(3);
            expect(testee._extractZipEntry).toHaveBeenCalledWith(archive, path.normalize('/cache'), 'index.html');
            expect(testee._extractZipEntry).toHaveBeenCalledWith(archive, path.normalize('/cache'), 'js');
            expect(testee._extractZipEntry).toHaveBeenCalledWith(archive, path.normalize('/cache'), 'js/app.js');
        });
    });
});