/**
 * The `node:path` operations the engine needs (join, normalize, dirname, basename,
 * extname, parse), computed in the renderer. The preload is sandboxed (no `node:path`)
 * and a synchronous IPC round trip per path operation blocked the UI thread.
 *
 * Ports of Node's `path.posix` / `path.win32` algorithms (Path.test.js compares every
 * function against Node's own implementation).
 */

const CHAR_DOT = 46;
const CHAR_SLASH = 47;
const CHAR_BACKSLASH = 92;
const CHAR_COLON = 58;

const isPosixSeparator = code => code === CHAR_SLASH;
const isWin32Separator = code => code === CHAR_SLASH || code === CHAR_BACKSLASH;
const isDeviceRoot = code => code >= 65 && code <= 90 || code >= 97 && code <= 122;

function validateString(value, name) {
    if (typeof value !== 'string') {
        throw new TypeError(`The "${name}" argument must be of type string. Received ${typeof value}`);
    }
}

/**
 * Resolve `.` and `..` segments and collapse separators (Node's `normalizeString`).
 */
function normalizeString(path, allowAboveRoot, separator, isSeparator) {
    let result = '';
    let lastSegmentLength = 0;
    let lastSlash = -1;
    let dots = 0;
    let code = 0;
    for (let i = 0; i <= path.length; ++i) {
        if (i < path.length) {
            code = path.charCodeAt(i);
        } else if (isSeparator(code)) {
            break;
        } else {
            code = CHAR_SLASH;
        }
        if (isSeparator(code)) {
            if (lastSlash === i - 1 || dots === 1) {
                // empty segment or "."
            } else if (dots === 2) {
                if (result.length < 2 || lastSegmentLength !== 2 || result.charCodeAt(result.length - 1) !== CHAR_DOT || result.charCodeAt(result.length - 2) !== CHAR_DOT) {
                    if (result.length > 2) {
                        const lastSlashIndex = result.lastIndexOf(separator);
                        if (lastSlashIndex === -1) {
                            result = '';
                            lastSegmentLength = 0;
                        } else {
                            result = result.slice(0, lastSlashIndex);
                            lastSegmentLength = result.length - 1 - result.lastIndexOf(separator);
                        }
                        lastSlash = i;
                        dots = 0;
                        continue;
                    } else if (result.length !== 0) {
                        result = '';
                        lastSegmentLength = 0;
                        lastSlash = i;
                        dots = 0;
                        continue;
                    }
                }
                if (allowAboveRoot) {
                    result += result.length > 0 ? `${separator}..` : '..';
                    lastSegmentLength = 2;
                }
            } else {
                result += result.length > 0 ? `${separator}${path.slice(lastSlash + 1, i)}` : path.slice(lastSlash + 1, i);
                lastSegmentLength = i - lastSlash - 1;
            }
            lastSlash = i;
            dots = 0;
        } else if (code === CHAR_DOT && dots !== -1) {
            ++dots;
        } else {
            dots = -1;
        }
    }
    return result;
}

/**
 * Length of the root of a win32 path: `\`, `C:`, `C:\` or a UNC root `\\server\share\`.
 */
function win32RootLength(path) {
    const length = path.length;
    const code = path.charCodeAt(0);
    if (isWin32Separator(code)) {
        if (!isWin32Separator(path.charCodeAt(1))) {
            return 1;
        }
        let j = 2;
        let last = j;
        while (j < length && !isWin32Separator(path.charCodeAt(j))) {
            j++;
        }
        if (j < length && j !== last) {
            last = j;
            while (j < length && isWin32Separator(path.charCodeAt(j))) {
                j++;
            }
            if (j < length && j !== last) {
                last = j;
                while (j < length && !isWin32Separator(path.charCodeAt(j))) {
                    j++;
                }
                if (j === length) {
                    return j;
                }
                if (j !== last) {
                    return j + 1;
                }
            }
        }
        return 1;
    }
    if (isDeviceRoot(code) && path.charCodeAt(1) === CHAR_COLON) {
        return length > 2 && isWin32Separator(path.charCodeAt(2)) ? 3 : 2;
    }
    return 0;
}

/**
 * basename / extname / parse share the scan for the last segment and its extension.
 * `parseStart(rootEnd)` is where parse() starts that scan: Node's posix variant scans
 * from 0 even for absolute paths (which is why `parse('/..')` has the extension "."),
 * the win32 variant from the end of the root.
 */
function createShared(isSeparator, deviceLength, rootLength, parseStart) {
    function basename(path, suffix) {
        validateString(path, 'path');
        if (suffix !== undefined) {
            validateString(suffix, 'suffix');
        }
        let start = deviceLength(path);
        let end = -1;
        let matchedSlash = true;
        if (suffix !== undefined && suffix.length > 0 && suffix.length <= path.length) {
            if (suffix === path) {
                return '';
            }
            let extIdx = suffix.length - 1;
            let firstNonSlashEnd = -1;
            for (let i = path.length - 1; i >= start; --i) {
                const code = path.charCodeAt(i);
                if (isSeparator(code)) {
                    if (!matchedSlash) {
                        start = i + 1;
                        break;
                    }
                } else {
                    if (firstNonSlashEnd === -1) {
                        matchedSlash = false;
                        firstNonSlashEnd = i + 1;
                    }
                    if (extIdx >= 0) {
                        if (code === suffix.charCodeAt(extIdx)) {
                            if (--extIdx === -1) {
                                end = i;
                            }
                        } else {
                            extIdx = -1;
                            end = firstNonSlashEnd;
                        }
                    }
                }
            }
            if (start === end) {
                end = firstNonSlashEnd;
            } else if (end === -1) {
                end = path.length;
            }
            return path.slice(start, end);
        }
        for (let i = path.length - 1; i >= start; --i) {
            if (isSeparator(path.charCodeAt(i))) {
                if (!matchedSlash) {
                    start = i + 1;
                    break;
                }
            } else if (end === -1) {
                matchedSlash = false;
                end = i + 1;
            }
        }
        return end === -1 ? '' : path.slice(start, end);
    }

    // scan the last segment of `path` (down to `rootEnd`): where it starts, ends and where its extension starts
    function scanLastSegment(path, rootEnd, startPart = rootEnd) {
        let startDot = -1;
        let end = -1;
        let matchedSlash = true;
        let preDotState = 0;
        for (let i = path.length - 1; i >= rootEnd; --i) {
            const code = path.charCodeAt(i);
            if (isSeparator(code)) {
                if (!matchedSlash) {
                    startPart = i + 1;
                    break;
                }
                continue;
            }
            if (end === -1) {
                matchedSlash = false;
                end = i + 1;
            }
            if (code === CHAR_DOT) {
                if (startDot === -1) {
                    startDot = i;
                } else if (preDotState !== 1) {
                    preDotState = 1;
                }
            } else if (startDot !== -1) {
                preDotState = -1;
            }
        }
        // no dot, a leading dot only (".bashrc") or the segment ".." have no extension
        const noExtension = startDot === -1 || end === -1 || preDotState === 0 || preDotState === 1 && startDot === end - 1 && startDot === startPart + 1;
        return { startPart, startDot, end, noExtension };
    }

    function extname(path) {
        validateString(path, 'path');
        const { startDot, end, noExtension } = scanLastSegment(path, deviceLength(path));
        return noExtension ? '' : path.slice(startDot, end);
    }

    function parse(path) {
        validateString(path, 'path');
        const result = { root: '', dir: '', base: '', ext: '', name: '' };
        if (path.length === 0) {
            return result;
        }
        const rootEnd = rootLength(path);
        if (rootEnd === path.length) {
            result.root = result.dir = path;
            return result;
        }
        result.root = path.slice(0, rootEnd);
        const { startPart, startDot, end, noExtension } = scanLastSegment(path, rootEnd, parseStart(rootEnd));
        if (end !== -1) {
            const start = startPart === 0 ? rootEnd : startPart;
            result.base = path.slice(start, end);
            result.name = noExtension ? result.base : path.slice(start, startDot);
            result.ext = noExtension ? '' : path.slice(startDot, end);
        }
        result.dir = startPart > 0 && startPart !== rootEnd ? path.slice(0, startPart - 1) : result.root;
        return result;
    }

    return { basename, extname, parse };
}

export const posix = {
    sep: '/',

    normalize(path) {
        validateString(path, 'path');
        if (path.length === 0) {
            return '.';
        }
        const isAbsolute = path.charCodeAt(0) === CHAR_SLASH;
        const trailingSeparator = path.charCodeAt(path.length - 1) === CHAR_SLASH;
        path = normalizeString(path, !isAbsolute, '/', isPosixSeparator);
        if (path.length === 0) {
            if (isAbsolute) {
                return '/';
            }
            return trailingSeparator ? './' : '.';
        }
        if (trailingSeparator) {
            path += '/';
        }
        return isAbsolute ? `/${path}` : path;
    },

    join(...parts) {
        let joined;
        for (const part of parts) {
            validateString(part, 'path');
            if (part.length > 0) {
                joined = joined === undefined ? part : `${joined}/${part}`;
            }
        }
        return joined === undefined ? '.' : posix.normalize(joined);
    },

    dirname(path) {
        validateString(path, 'path');
        if (path.length === 0) {
            return '.';
        }
        const hasRoot = path.charCodeAt(0) === CHAR_SLASH;
        let end = -1;
        let matchedSlash = true;
        for (let i = path.length - 1; i >= 1; --i) {
            if (path.charCodeAt(i) === CHAR_SLASH) {
                if (!matchedSlash) {
                    end = i;
                    break;
                }
            } else {
                matchedSlash = false;
            }
        }
        if (end === -1) {
            return hasRoot ? '/' : '.';
        }
        if (hasRoot && end === 1) {
            return '//';
        }
        return path.slice(0, end);
    },

    ...createShared(isPosixSeparator, () => 0, path => path.charCodeAt(0) === CHAR_SLASH ? 1 : 0, () => 0)
};

export const win32 = {
    sep: '\\',

    normalize(path) {
        validateString(path, 'path');
        const length = path.length;
        if (length === 0) {
            return '.';
        }
        let rootEnd = 0;
        let device;
        let isAbsolute = false;
        const code = path.charCodeAt(0);
        if (length === 1) {
            return code === CHAR_SLASH ? '\\' : path;
        }
        if (isWin32Separator(code)) {
            isAbsolute = true;
            if (isWin32Separator(path.charCodeAt(1))) {
                // possible UNC root: \\server\share
                let j = 2;
                let last = j;
                while (j < length && !isWin32Separator(path.charCodeAt(j))) {
                    j++;
                }
                if (j < length && j !== last) {
                    const firstPart = path.slice(last, j);
                    last = j;
                    while (j < length && isWin32Separator(path.charCodeAt(j))) {
                        j++;
                    }
                    if (j < length && j !== last) {
                        last = j;
                        while (j < length && !isWin32Separator(path.charCodeAt(j))) {
                            j++;
                        }
                        if (j === length) {
                            return `\\\\${firstPart}\\${path.slice(last)}\\`;
                        }
                        if (j !== last) {
                            device = `\\\\${firstPart}\\${path.slice(last, j)}`;
                            rootEnd = j;
                        }
                    }
                }
            } else {
                rootEnd = 1;
            }
        } else if (isDeviceRoot(code) && path.charCodeAt(1) === CHAR_COLON) {
            device = path.slice(0, 2);
            rootEnd = 2;
            if (length > 2 && isWin32Separator(path.charCodeAt(2))) {
                isAbsolute = true;
                rootEnd = 3;
            }
        }
        let tail = rootEnd < length ? normalizeString(path.slice(rootEnd), !isAbsolute, '\\', isWin32Separator) : '';
        if (tail.length === 0 && !isAbsolute) {
            tail = '.';
        }
        if (tail.length > 0 && isWin32Separator(path.charCodeAt(length - 1))) {
            tail += '\\';
        }
        if (device === undefined) {
            return isAbsolute ? `\\${tail}` : tail;
        }
        return isAbsolute ? `${device}\\${tail}` : `${device}${tail}`;
    },

    join(...parts) {
        let joined;
        let firstPart;
        for (const part of parts) {
            validateString(part, 'path');
            if (part.length > 0) {
                if (joined === undefined) {
                    joined = firstPart = part;
                } else {
                    joined += `\\${part}`;
                }
            }
        }
        if (joined === undefined) {
            return '.';
        }
        // the joined path must not start with two separators unless the first part is a
        // UNC path, otherwise normalize() would mistake it for one
        let needsReplace = true;
        let slashCount = 0;
        if (isWin32Separator(firstPart.charCodeAt(0))) {
            ++slashCount;
            const firstLength = firstPart.length;
            if (firstLength > 1 && isWin32Separator(firstPart.charCodeAt(1))) {
                ++slashCount;
                if (firstLength > 2) {
                    if (isWin32Separator(firstPart.charCodeAt(2))) {
                        ++slashCount;
                    } else {
                        needsReplace = false;
                    }
                }
            }
        }
        if (needsReplace) {
            while (slashCount < joined.length && isWin32Separator(joined.charCodeAt(slashCount))) {
                slashCount++;
            }
            if (slashCount >= 2) {
                joined = `\\${joined.slice(slashCount)}`;
            }
        }
        return win32.normalize(joined);
    },

    dirname(path) {
        validateString(path, 'path');
        const length = path.length;
        if (length === 0) {
            return '.';
        }
        let rootEnd = -1;
        let offset = 0;
        const code = path.charCodeAt(0);
        if (length === 1) {
            return isWin32Separator(code) ? path : '.';
        }
        if (isWin32Separator(code)) {
            rootEnd = offset = 1;
            if (isWin32Separator(path.charCodeAt(1))) {
                // possible UNC root: \\server\share
                let j = 2;
                let last = j;
                while (j < length && !isWin32Separator(path.charCodeAt(j))) {
                    j++;
                }
                if (j < length && j !== last) {
                    last = j;
                    while (j < length && isWin32Separator(path.charCodeAt(j))) {
                        j++;
                    }
                    if (j < length && j !== last) {
                        last = j;
                        while (j < length && !isWin32Separator(path.charCodeAt(j))) {
                            j++;
                        }
                        if (j === length) {
                            return path; // a UNC root only
                        }
                        if (j !== last) {
                            rootEnd = offset = j + 1;
                        }
                    }
                }
            }
        } else if (isDeviceRoot(code) && path.charCodeAt(1) === CHAR_COLON) {
            rootEnd = length > 2 && isWin32Separator(path.charCodeAt(2)) ? 3 : 2;
            offset = rootEnd;
        }
        let end = -1;
        let matchedSlash = true;
        for (let i = length - 1; i >= offset; --i) {
            if (isWin32Separator(path.charCodeAt(i))) {
                if (!matchedSlash) {
                    end = i;
                    break;
                }
            } else {
                matchedSlash = false;
            }
        }
        if (end === -1) {
            if (rootEnd === -1) {
                return '.';
            }
            end = rootEnd;
        }
        return path.slice(0, end);
    },

    ...createShared(isWin32Separator, path => path.length >= 2 && isDeviceRoot(path.charCodeAt(0)) && path.charCodeAt(1) === CHAR_COLON ? 2 : 0, win32RootLength, rootEnd => rootEnd)
};

/**
 * @param {string} platform `process.platform` of the main process
 * @returns {{ sep: string, join: Function, normalize: Function, dirname: Function, basename: Function, extname: Function, parse: Function }}
 */
export function createPath(platform) {
    return platform === 'win32' ? win32 : posix;
}
