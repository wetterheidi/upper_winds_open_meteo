/**
 * @file favoritesIO.js
 * @description Export und Import von Favoriten als JSON-Datei.
 * Nutzt auf nativen Plattformen (iOS/Android) die Capacitor Filesystem API
 * (Documents/DZMaster) und im Web den Blob-Download bzw. FileReader.
 */

import { Utils } from './utils.js';
import { I18n } from './i18n.js';
import { getCapacitor } from './capacitor-adapter.js';
import { getCoordHistory, saveCoordHistory, _dispatchFavoritesUpdate } from './locationManager.js';

const FAVORITES_FILE_FORMAT = 'dzmaster-favorites';
const FAVORITES_FILE_VERSION = 1;

/**
 * Entfernt unzulässige Zeichen aus einem Dateinamen und hängt ".json" an.
 * @param {string} rawName - Der vom Benutzer eingegebene Name (z.B. "Fav_USA").
 * @returns {string} Ein sicherer Dateiname inkl. Endung.
 */
export function sanitizeFavoritesFileName(rawName) {
    let name = (rawName || '').trim()
        .replace(/\.json$/i, '')
        .replace(/[\\/:*?"<>|]+/g, '_')
        .replace(/\s+/g, '_')
        .replace(/^\.+/, '');
    if (!name) {
        name = getDefaultFavoritesFileName();
    }
    return `${name}.json`;
}

/**
 * Liefert einen Standard-Dateinamen (ohne Endung), z.B. "DZMaster_Favorites_2026-07-04".
 * @returns {string}
 */
export function getDefaultFavoritesFileName() {
    const date = new Date().toISOString().slice(0, 10);
    return `DZMaster_Favorites_${date}`;
}

/**
 * Exportiert alle Favoriten als JSON-Datei.
 * Nativ: Documents/DZMaster/<name>.json, Web: Download.
 * @param {string} rawName - Gewünschter Dateiname (ohne Pfad, Endung optional).
 * @returns {Promise<boolean>} true bei Erfolg.
 */
export async function exportFavorites(rawName) {
    const favorites = getCoordHistory().filter(entry => entry.isFavorite);
    if (favorites.length === 0) {
        Utils.handleError(I18n.t('location.error_no_favorites_export'));
        return false;
    }

    const fileName = sanitizeFavoritesFileName(rawName);
    const payload = {
        format: FAVORITES_FILE_FORMAT,
        version: FAVORITES_FILE_VERSION,
        exportedAt: new Date().toISOString(),
        favorites: favorites.map(entry => ({
            lat: entry.lat,
            lng: entry.lng,
            label: entry.label,
            isHomeDZ: entry.isHomeDZ === true
        }))
    };
    const jsonContent = JSON.stringify(payload, null, 2);

    try {
        const { Filesystem, Directory, isNative } = await getCapacitor();

        if (isNative && Filesystem) {
            await Filesystem.writeFile({
                path: `DZMaster/${fileName}`,
                data: jsonContent,
                directory: Directory.Documents,
                encoding: 'utf8',
                recursive: true
            });
            Utils.handleMessage(I18n.t('location.favorites_exported_docs', { name: fileName, count: favorites.length }));
        } else {
            const blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(a.href);
            Utils.handleMessage(I18n.t('location.favorites_exported', { name: fileName, count: favorites.length }));
        }
        return true;
    } catch (error) {
        console.error('exportFavorites: Error:', error);
        Utils.handleError(I18n.t('location.error_favorites_export_failed'));
        return false;
    }
}

/**
 * Importiert Favoriten aus einer Datei (Web-File oder natives FilePicker-Objekt mit path).
 * Bestehende Einträge (gleiche Koordinaten) werden aktualisiert, neue hinzugefügt.
 * @param {File|object} file - Datei-Objekt (Web) oder { path, webPath, name } (nativ).
 * @returns {Promise<boolean>} true bei Erfolg.
 */
export async function importFavoritesFromFile(file) {
    try {
        const content = await readFileContent(file);
        return importFavoritesFromContent(content);
    } catch (error) {
        console.error('importFavoritesFromFile: Error:', error);
        Utils.handleError(I18n.t('location.error_favorites_import_failed'));
        return false;
    }
}

/**
 * Parst und validiert den JSON-Inhalt und führt die Favoriten mit dem
 * bestehenden Verlauf zusammen.
 * @param {string} content - Der JSON-Inhalt der Import-Datei.
 * @returns {boolean} true bei Erfolg.
 */
export function importFavoritesFromContent(content) {
    let parsed;
    try {
        parsed = JSON.parse(content);
    } catch (e) {
        Utils.handleError(I18n.t('location.error_favorites_invalid_file'));
        return false;
    }

    // Sowohl das eigene Exportformat als auch ein nacktes Array akzeptieren
    const rawList = Array.isArray(parsed) ? parsed : parsed?.favorites;
    if (!Array.isArray(rawList)) {
        Utils.handleError(I18n.t('location.error_favorites_invalid_file'));
        return false;
    }

    const validEntries = rawList.filter(entry =>
        entry &&
        typeof entry.lat === 'number' && entry.lat >= -90 && entry.lat <= 90 &&
        typeof entry.lng === 'number' && entry.lng >= -180 && entry.lng <= 180 &&
        typeof entry.label === 'string' && entry.label.trim() !== ''
    );

    if (validEntries.length === 0) {
        Utils.handleError(I18n.t('location.error_favorites_invalid_file'));
        return false;
    }

    const history = getCoordHistory();
    const hasHomeDZ = history.some(entry => entry.isHomeDZ);
    let importedCount = 0;

    validEntries.forEach(entry => {
        const newLat = parseFloat(entry.lat.toFixed(5));
        const newLng = parseFloat(entry.lng.toFixed(5));
        const existing = history.find(e =>
            Math.abs(e.lat - newLat) < 0.001 && Math.abs(e.lng - newLng) < 0.001
        );
        if (existing) {
            existing.isFavorite = true;
            existing.label = entry.label;
        } else {
            history.unshift({
                lat: newLat,
                lng: newLng,
                label: entry.label,
                isFavorite: true,
                // Home DZ nur übernehmen, wenn aktuell keiner gesetzt ist
                isHomeDZ: !hasHomeDZ && entry.isHomeDZ === true,
                timestamp: Date.now()
            });
        }
        importedCount++;
    });

    saveCoordHistory(history);
    _dispatchFavoritesUpdate();
    Utils.handleMessage(I18n.t('location.favorites_imported', { count: importedCount }));
    return true;
}

/**
 * Liest den Textinhalt einer Datei. Nutzt die Capacitor Filesystem API für native
 * Apps und den Web FileReader als Fallback (gleiches Muster wie trackManager).
 * @param {File|object} file - Das Datei-Objekt.
 * @returns {Promise<string>} Der Inhalt der Datei als Text.
 * @private
 */
async function readFileContent(file) {
    const { Filesystem, isNative } = await getCapacitor();

    if (isNative && file.path && Filesystem) {
        try {
            const result = await Filesystem.readFile({
                path: file.path,
                encoding: 'utf8'
            });
            return result.data;
        } catch (error) {
            console.error('favoritesIO: Error reading file with Capacitor:', error);
            // Fallback für Content-URIs auf Android, die nicht direkt per Pfad lesbar sind
            if (file.webPath) {
                const response = await fetch(file.webPath);
                return await response.text();
            }
            throw new Error('Could not read file using native API.');
        }
    }

    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = () => reject(new Error('Error reading file.'));
        reader.readAsText(file);
    });
}
