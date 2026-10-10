/**
 * Windows executable resources (icon and version information) without
 * `rcedit` (deprecated upstream, a Windows-only binary). `resedit` and
 * `pe-library` rewrite the PE resource section in pure JavaScript, so the
 * step runs on every platform.
 */
import fs from 'node:fs/promises';
import * as PELibrary from 'pe-library';
import * as ResEdit from 'resedit';

function versionParts(version) {
    const parts = String(version).split(/[.-]/).map(part => parseInt(part, 10));
    return [0, 1, 2, 3].map(index => (Number.isInteger(parts[index]) ? parts[index] : 0));
}

/**
 * @param {string} executable path of the PE file (rewritten in place)
 * @param {{ icon?: string, version: string, strings: Record<string, string> }} options
 *   `strings` are VersionInfo string values (ProductName, FileDescription, ...).
 * @returns {Promise<void>}
 */
export async function setExecutableResources(executable, { icon, version, strings }) {
    // release binaries may carry an Authenticode signature, which the rewrite drops anyway (as rcedit did)
    const exe = PELibrary.NtExecutable.from(await fs.readFile(executable), { ignoreCert: true });
    const resource = PELibrary.NtExecutableResource.from(exe);

    if (icon) {
        const iconFile = ResEdit.Data.IconFile.from(await fs.readFile(icon));
        const [ group ] = ResEdit.Resource.IconGroupEntry.fromEntries(resource.entries);
        if (!group) {
            throw new Error(`"${executable}" has no icon group to replace!`);
        }
        ResEdit.Resource.IconGroupEntry.replaceIconsForResource(resource.entries, group.id, group.lang, iconFile.icons.map(item => item.data));
    }

    const [ info ] = ResEdit.Resource.VersionInfo.fromEntries(resource.entries);
    if (!info) {
        throw new Error(`"${executable}" has no version information to edit!`);
    }
    const [ language ] = info.getAvailableLanguages();
    const parts = versionParts(version);
    info.setFileVersion(...parts, language.lang);
    info.setProductVersion(...parts, language.lang);
    info.setStringValues(language, strings);
    info.outputToResourceEntries(resource.entries);

    resource.outputResource(exe);
    await fs.writeFile(executable, Buffer.from(exe.generate()));
}

/**
 * Read back the version strings of a PE file (verification helper).
 * @param {string} executable
 * @returns {Promise<Record<string, string>>}
 */
export async function readVersionStrings(executable) {
    const exe = PELibrary.NtExecutable.from(await fs.readFile(executable), { ignoreCert: true });
    const resource = PELibrary.NtExecutableResource.from(exe);
    const [ info ] = ResEdit.Resource.VersionInfo.fromEntries(resource.entries);
    const [ language ] = info.getAvailableLanguages();
    return { ...info.getStringValues(language), FileVersion: info.fixedInfo.fileVersionMS, ProductVersion: info.fixedInfo.productVersionMS };
}
