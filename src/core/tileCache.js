/**
 * @file tileCache.js
 * @description Implementiert die komplette Logik für das Offline-Caching von Kartenkacheln.
 * Nutzt IndexedDB zur Speicherung und erweitert Leaflet's TileLayer, um Kacheln
 * automatisch aus dem Cache zu laden, wenn keine Netzwerkverbindung besteht.
 */

import { Utils } from './utils.js';
import { Settings } from './settings.js';
import { CACHE_DEFAULTS } from './constants.js';
import { AppState } from './state.js';

// ===================================================================
// 1. IndexedDB Wrapper-Objekt
// ===================================================================

/**
 * Das TileCache-Objekt kapselt alle direkten Interaktionen mit der IndexedDB-Datenbank.
 */
export const TileCache = {
    dbName: 'SkydivingTileCache',
    storeName: 'tiles',
    db: null,

    /**
     * Initialisiert die IndexedDB-Datenbank und erstellt den Object Store, falls nicht vorhanden.
     * @returns {Promise<void>}
     */
    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, 1);
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                db.createObjectStore(this.storeName, { keyPath: 'url' });
            };
            request.onsuccess = (event) => {
                this.db = event.target.result;
                resolve();
            };
            request.onerror = (event) => {
                console.error('IndexedDB initialization failed:', event);
                reject(event);
            };
        });
    },

    /**
     * Speichert eine einzelne Kachel (als Blob) in der Datenbank.
     * @param {string} url - Die normalisierte URL der Kachel (dient als Schlüssel).
     * @param {Blob} blob - Die Kachel-Daten.
     * @returns {Promise<boolean>}
     */
    async storeTile(url, blob) {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const request = store.put({ url, blob, timestamp: Date.now() });
            request.onsuccess = () => {
                console.log(`Stored tile: ${url}`);
                resolve(true);
            };
            request.onerror = (event) => {
                console.warn(`Failed to store tile: ${url}`, event);
                Utils.handleError('Failed to store some tiles. Try clearing cache.');
                reject(event);
            };
        });
    },

    /**
     * Ruft eine Kachel aus der Datenbank ab.
     * @param {string} url - Die normalisierte URL der Kachel.
     * @returns {Promise<Blob|null>} Der Blob der Kachel oder null, wenn nicht gefunden.
     */
    async getTile(url) {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readonly');
            const store = transaction.objectStore(this.storeName);
            const request = store.get(url);
            request.onsuccess = (event) => {
                const result = event.target.result;
                if (result) {
                    resolve(result.blob);
                } else {
                    const urlVariants = [
                        url.replace('https://tile.opentopomap.org', 'https://a.tile.opentopomap.org'),
                        url.replace('https://tile.opentopomap.org', 'https://b.tile.opentopomap.org'),
                        url.replace('https://tile.opentopomap.org', 'https://c.tile.opentopomap.org'),
                        url.replace('https://tile.openstreetmap.org', 'https://a.tile.openstreetmap.org'),
                        url.replace('https://tile.openstreetmap.org', 'https://b.tile.openstreetmap.org'),
                        url.replace('https://tile.openstreetmap.org', 'https://c.tile.openstreetmap.org'),
                        url.replace('https://basemaps.cartocdn.com', 'https://a.basemaps.cartocdn.com'),
                        url.replace('https://basemaps.cartocdn.com', 'https://b.basemaps.cartocdn.com'),
                        url.replace('https://basemaps.cartocdn.com', 'https://c.basemaps.cartocdn.com'),
                        url.replace('https://basemaps.cartocdn.com', 'https://d.basemaps.cartocdn.com')
                    ];
                    let foundBlob = null;
                    for (const variant of urlVariants) {
                        if (variant === url) continue;
                        const variantRequest = store.get(variant);
                        variantRequest.onsuccess = (variantEvent) => {
                            const variantResult = variantEvent.target.result;
                            if (variantResult) {
                                foundBlob = variantResult.blob;
                                resolve(foundBlob);
                            }
                        };
                        variantRequest.onerror = () => { };
                    }
                    setTimeout(() => {
                        if (!foundBlob) {
                            resolve(null);
                        }
                    }, 100);
                }
            };
            request.onerror = (event) => {
                console.warn(`Failed to retrieve tile: ${url}`, event);
                reject(event);
            };
        });
    },

    /**
     * Löscht alle Kacheln aus der Datenbank.
     * @returns {Promise<void>}
     */
    async clearCache() {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const request = store.clear();
            request.onsuccess = () => {
                console.log('Tile cache cleared');
                resolve();
            };
            request.onerror = (event) => {
                console.error('Failed to clear cache:', event);
                reject(event);
            };
        });
    },

    /**
     * Löscht Kacheln, die älter als eine bestimmte Anzahl von Tagen sind.
     * @param {number} [maxAgeDays=CACHE_DEFAULTS.MAX_AGE_DAYS] - Das maximale Alter der Kacheln in Tagen.
     * @returns {Promise<{deletedCount: number, deletedSizeMB: number}>}
     */
    async clearOldTiles(maxAgeDays = CACHE_DEFAULTS.MAX_AGE_DAYS) {
        if (!this.db) await this.init();
        const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const request = store.openCursor();
            let deletedCount = 0;
            let deletedSize = 0;
            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    if (Date.now() - cursor.value.timestamp > maxAgeMs) {
                        deletedSize += cursor.value.blob.size || 0;
                        cursor.delete();
                        deletedCount++;
                    }
                    cursor.continue();
                } else {
                    const deletedSizeMB = deletedSize / (1024 * 1024);
                    console.log(`Cleared ${deletedCount} old tiles, freed ${deletedSizeMB.toFixed(2)} MB`);
                    resolve({ deletedCount, deletedSizeMB });
                }
            };
            request.onerror = (event) => {
                console.error('Failed to clear old tiles:', event);
                reject(event);
            };
        });
    },

    /**
     * Berechnet die Gesamtgrösse des Kachel-Caches in Megabyte.
     * @returns {Promise<number>} Die Cache-Grösse in MB.
     */
    async getCacheSize() {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readonly');
            const store = transaction.objectStore(this.storeName);
            const request = store.openCursor();
            let size = 0;
            let tileCount = 0;
            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    try {
                        const tileSize = cursor.value.blob?.size || 0;
                        if (typeof tileSize !== 'number' || isNaN(tileSize)) {
                            console.warn(`Invalid blob size for tile: ${cursor.value.url}, size: ${tileSize}`);
                        } else {
                            size += tileSize;
                            tileCount++;
                        }
                        cursor.continue();
                    } catch (error) {
                        console.warn(`Error processing tile during size calculation: ${cursor.value.url}`, error);
                        cursor.continue();
                    }
                } else {
                    const sizeInMB = size / (1024 * 1024);
                    console.log(`Cache size calculation completed: ${sizeInMB.toFixed(2)} MB, ${tileCount} tiles`);
                    resolve(sizeInMB);
                }
            };
            request.onerror = (event) => {
                console.error('Failed to calculate cache size:', event);
                reject(event);
            };
        });
    },

    /**
     * Migriert Kachel-URLs, um Subdomains (z.B. a.tile.openstreetmap.org) zu entfernen.
     * Dies stellt sicher, dass Kacheln unabhängig von der Subdomain gefunden werden.
     * HINWEIS (ToDo): Diese Logik könnte flexibler gestaltet werden, um neue Kartenanbieter leichter zu unterstützen.
     * @returns {Promise<void>}
     */
    async migrateTiles() {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const request = store.openCursor();
            let migratedCount = 0;
            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    const { url, blob, timestamp } = cursor.value;
                    const normalizedUrl = url.replace(/^(https?:\/\/[a-c]\.tile\.openstreetmap\.org)/, 'https://tile.openstreetmap.org')
                        .replace(/^(https?:\/\/[a-d]\.basemaps\.cartocdn\.com)/, 'https://basemaps.cartocdn.com')
                        .replace(/^(https?:\/\/[a-c]\.tile\.opentopomap\.org)/, 'https://tile.opentopomap.org');
                    if (url !== normalizedUrl) {
                        cursor.delete();
                        store.put({ url: normalizedUrl, blob, timestamp });
                        migratedCount++;
                    }
                    cursor.continue();
                } else {
                    console.log(`Migrated ${migratedCount} tiles to normalized URLs`);
                    resolve();
                }
            };
            request.onerror = (event) => {
                console.error('Failed to migrate tiles:', event);
                reject(event);
            };
        });
    }
};

// ===================================================================
// 2. Leaflet-Layer-Erweiterung
// ===================================================================

/**
 * Erweitert den L.TileLayer von Leaflet, um eine Caching-Logik zu integrieren.
 * `createTile` wird für jede Kachel aufgerufen und entscheidet, ob sie aus dem Netzwerk
 * geladen oder aus dem IndexedDB-Cache geholt werden soll.
 */
L.TileLayer.Cached = L.TileLayer.extend({
    createTile(coords, done) {
        const tile = document.createElement('img');
        tile.setAttribute('crossOrigin', 'anonymous');

        L.DomEvent.on(tile, 'load', () => {
            console.log('Tile loaded:', this.getTileUrl(coords));
            done(null, tile);
        });
        L.DomEvent.on(tile, 'error', () => {
            console.warn('Tile error:', this.getTileUrl(coords));
            done(new Error('Failed to load tile'), tile);
        });

        const url = this.getTileUrl(coords);
        tile.setAttribute('role', 'presentation');

        // URL normalisieren, um Subdomains zu entfernen (wichtig für den Cache-Schlüssel)
        const normalizedUrl = url.replace(/^(https?:\/\/[a-c]\.tile\.openstreetmap\.org)/, 'https://tile.openstreetmap.org')
            .replace(/^(https?:\/\/[a-d]\.basemaps\.cartocdn\.com)/, 'https://basemaps.cartocdn.com')
            .replace(/^(https?:\/\/[a-c]\.tile\.opentopomap\.org)/, 'https://tile.opentopomap.org');

        if (!navigator.onLine && (coords.z < 11 || coords.z > 14)) {
            console.log(`Skipping tile request outside cached zoom levels (11–14): ${url}`);
            Utils.handleError('Offline: Zoom restricted to levels 11–14 for cached tiles.');
            done(new Error('Zoom level not cached'), tile);
            return tile;
        }

        if (!navigator.onLine) {
            // Offline-Modus: Versuche, die Kachel aus dem Cache zu laden
            TileCache.getTile(normalizedUrl).then(blob => {
                if (blob) {
                    tile.src = URL.createObjectURL(blob);
                    console.log(`Tile loaded from cache: ${normalizedUrl}`);
                } else {
                    console.warn(`Tile not in cache: ${normalizedUrl}`);
                    Utils.handleError('This area is not cached. Please cache more tiles while online.');
                    done(new Error('Tile not in cache'), tile);
                }
            }).catch(error => {
                console.warn('Cache error for offline tile:', normalizedUrl, error);
                Utils.handleError('This area is not cached. Please cache more tiles while online.');
                done(error, tile);
            });
        } else {
            // Online-Modus: Lade aus dem Netzwerk und speichere im Cache
            tile.src = url;
            fetch(url, { signal: AbortSignal.timeout(CACHE_DEFAULTS.FETCH_TIMEOUT_MS) })
                .then(response => {
                    if (!response.ok) throw new Error(`HTTP ${response.status}`);
                    return response.blob();
                })
                .then(blob => {
                    TileCache.storeTile(normalizedUrl, blob).catch(error => console.warn('Failed to cache tile during rendering:', normalizedUrl, error));
                })
                .catch(error => {
                    console.warn('Fetch error for tile during rendering:', url, error);
                    TileCache.getTile(normalizedUrl).then(blob => {
                        if (blob) {
                            tile.src = URL.createObjectURL(blob);
                            console.log(`Tile loaded from cache (fallback): ${normalizedUrl}`);
                        } else {
                            done(error, tile);
                        }
                    }).catch(err => {
                        console.warn('Cache fallback error:', normalizedUrl, err);
                        done(err, tile);
                    });
                });
        }

        return tile;
    }
});

/**
 * Factory-Funktion zur einfachen Erstellung einer L.TileLayer.Cached-Instanz.
 * @param {string} url - Die URL-Vorlage für die Kacheln.
 * @param {object} options - Die Leaflet-Layer-Optionen.
 * @returns {L.TileLayer.Cached}
 */
L.tileLayer.cached = function (url, options) {
    return new L.TileLayer.Cached(url, options);
};

// ===================================================================
// 3. Öffentliche Caching-Funktionen
// ===================================================================

/**
 * Startet den Prozess, um Kacheln in einem bestimmten Radius um den DIP zu cachen.
 * @param {object} options - Ein Objekt mit den Caching-Parametern.
 * @param {L.Map} options.map - Die Leaflet-Karteninstanz.
 * @param {number} options.lastLat - Breite des Mittelpunkts.
 * @param {number} options.lastLng - Länge des Mittelpunkts.
 * @param {object} options.baseMaps - Das Objekt mit den Basiskarten.
 * @param {function} options.onProgress - Callback für Fortschritts-Updates.
 * @param {function} options.onComplete - Callback nach Abschluss.
 * @param {function} options.onCancel - Callback bei Abbruch.
 */
export async function cacheTilesForDIP({ map, lastLat, lastLng, baseMaps, onProgress, onComplete, onCancel, radiusKm: forcedRadius = null, silent = false }) {
    if (!map || !lastLat || !lastLng) {
        if (onComplete && !silent) onComplete('Map or location not ready for caching.');
        return;
    }

    const radiusKm = forcedRadius !== null ? forcedRadius : (Settings.state.userSettings.cacheRadiusKm || Settings.defaultSettings.cacheRadiusKm);
    const zoomLevels = Settings.state.userSettings.cacheZoomLevels || Settings.defaultSettings.cacheZoomLevels;
    const tiles = getTilesInRadius(lastLat, lastLng, radiusKm, zoomLevels, map);

    const tileLayers = [];
    const selectedLayerName = Settings.state.userSettings.baseMaps;
    const layer = baseMaps[selectedLayerName];

    if (layer) {
        if (layer instanceof L.LayerGroup) {
            layer.eachLayer(subLayer => {
                // Nur Layer mit 'cached'-Funktion berücksichtigen
                if (subLayer instanceof L.TileLayer.Cached) {
                    const url = subLayer.options.url || subLayer._url;
                    tileLayers.push({
                        url: url,
                        subdomains: subLayer.options.subdomains,
                        normalizedUrl: url.replace(/{s}\./, '')
                    });
                }
            });
        } else if (layer instanceof L.TileLayer.Cached) {
            const url = layer.options.url || layer._url;
            tileLayers.push({
                url: url,
                subdomains: layer.options.subdomains,
                normalizedUrl: url.replace(/{s}\./, '')
            });
        }
    }

    const totalTiles = tiles.length * tileLayers.length;
    if (totalTiles === 0) {
        if (onComplete && !silent) onComplete('No tiles to cache for this basemap.');
        return;
    }

    let processedCount = 0;
    let successCount = 0;
    AppState.isCachingCancelled = false;

    if (onProgress && !silent) {
        onProgress(0, totalTiles, () => {
            AppState.isCachingCancelled = true;
            if (onCancel) onCancel();
        });
    }

    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

    try {
        const allTileFunctions = [];
        for (const layer of tileLayers) {
            for (const tile of tiles) {
                allTileFunctions.push(async () => {
                    if (AppState.isCachingCancelled) return;

                    const url = layer.url.replace('{z}', tile.zoom).replace('{x}', tile.x).replace('{y}', tile.y).replace('{s}', layer.subdomains ? layer.subdomains[Math.floor(Math.random() * layer.subdomains.length)] : '');
                    const normalizedUrl = layer.normalizedUrl.replace('{z}', tile.zoom).replace('{x}', tile.x).replace('{y}', tile.y);

                    const cachedBlob = await TileCache.getTile(normalizedUrl).catch(() => null);
                    if (cachedBlob) {
                        successCount++;
                    } else {
                        const result = await cacheTileWithRetry(url);
                        if (result.success) {
                            const stored = await TileCache.storeTile(normalizedUrl, result.blob).catch(() => false);
                            if (stored) successCount++;
                        }
                    }
                    processedCount++;
                });
            }
        }

        for (let i = 0; i < allTileFunctions.length; i += 10) {
            if (AppState.isCachingCancelled) break;

            const batch = allTileFunctions.slice(i, i + 10).map(fn => fn());
            await Promise.all(batch);

            if (onProgress && !silent) {
                onProgress(processedCount, totalTiles, () => { AppState.isCachingCancelled = true; });
            }
            await delay(250); // Eine Viertelsekunde Pause nach jedem 10er-Paket
        }

    } catch (error) {
        console.error('Unexpected error in cacheTilesForDIP:', error);
        if (onComplete && !silent) onComplete('An error occurred during caching.');
    } finally {
        const failedCount = processedCount - successCount;
        let message = '';
        if (AppState.isCachingCancelled) {
            message = `Caching cancelled. ${successCount} tiles processed.`;
        } else {
            message = `Caching complete. ${successCount} tiles cached${failedCount > 0 ? `, ${failedCount} failed` : '.'}`;
        }
        if (onComplete && !silent) onComplete(message);
    }
}

/**
 * Startet den Prozess, um alle aktuell sichtbaren Kacheln auf der Karte zu cachen.
 * @param {object} options - Ein Objekt mit den Caching-Parametern.
 */
export async function cacheVisibleTiles({ map, baseMaps, onProgress, onComplete, onCancel }) {
    if (!map || !navigator.onLine) {
        console.log('Skipping visible tile caching: offline or map not initialized');
        return;
    }

    const bounds = map.getBounds();
    const zoom = map.getZoom();
    const zoomLevels = Settings.state.userSettings.cacheZoomLevels || Settings.defaultSettings.cacheZoomLevels;
    if (!zoomLevels.includes(zoom)) {
        console.log(`Skipping caching: zoom ${zoom} not in cacheZoomLevels`, zoomLevels);
        return;
    }

    const tileSize = 256;
    const swPoint = map.project(bounds.getSouthWest(), zoom);
    const nePoint = map.project(bounds.getNorthEast(), zoom);
    const minX = Math.floor(swPoint.x / tileSize);
    const maxX = Math.floor(nePoint.x / tileSize);
    const minY = Math.floor(nePoint.y / tileSize);
    const maxY = Math.floor(swPoint.y / tileSize);

    const tiles = [];
    for (let x = minX; x <= maxX; x++) {
        for (let y = minY; y <= maxY; y++) {
            const numTiles = 2 ** zoom;
            if (x >= 0 && x < numTiles && y >= 0 && y < numTiles) {
                tiles.push({ zoom, x, y });
            }
        }
    }

    console.log(`Caching ${tiles.length} visible tiles at zoom ${zoom} for ${Settings.state.userSettings.baseMaps}`);

    const tileLayers = [];
    const selectedLayerName = Settings.state.userSettings.baseMaps;
    const layer = baseMaps[selectedLayerName];

    if (layer) {
        if (layer instanceof L.LayerGroup) {
            layer.eachLayer(subLayer => {
                const url = subLayer.options.url || subLayer._url;
                if (url) {
                    tileLayers.push({
                        name: `${selectedLayerName} (${subLayer.options.attribution || 'sub-layer'})`,
                        url: url,
                        subdomains: subLayer.options.subdomains,
                        normalizedUrl: url.replace(/{s}\./, '')
                    });
                }
            });
        } else {
            const url = layer.options.url || layer._url;
            if (url) {
                tileLayers.push({
                    name: selectedLayerName,
                    url: url,
                    subdomains: layer.options.subdomains,
                    normalizedUrl: url.replace(/{s}\./, '')
                });
            }
        }
    } else {
        console.warn(`Base map ${selectedLayerName} not found, skipping caching`);
        if (onComplete) onComplete('Selected base map not available for caching.');
        return;
    }

    let cachedCount = 0;
    let failedCount = 0;
    const totalTiles = tiles.length * tileLayers.length;
    const failedTiles = [];
    AppState.isCachingCancelled = false;

    if (onProgress) {
        onProgress(0, totalTiles, () => {
            AppState.isCachingCancelled = true;
            if (onCancel) onCancel();
        });
    }

    for (const layer of tileLayers) {
        if (AppState.isCachingCancelled) break;
        const fetchPromises = tiles.map(async (tile, index) => {
            if (onProgress) {
                onProgress(cachedCount + failedCount, totalTiles, () => {
                    AppState.isCachingCancelled = true;
                    if (onCancel) onCancel();
                });
            }
        });
        await Promise.all(fetchPromises);
    }

    if (onComplete) {
        onComplete('Visible tiles cached.');
    }
}

// ===================================================================
// 4. Interne Hilfsfunktionen
// ===================================================================

/**
 * Berechnet eine Liste von Kachel-Koordinaten (z, x, y) innerhalb eines Radius um einen Punkt.
 * @param {number} lat - Breite des Mittelpunkts.
 * @param {number} lng - Länge des Mittelpunkts.
 * @param {number} radiusKm - Radius in Kilometern.
 * @param {number[]} zoomLevels - Ein Array von Zoom-Leveln, die gecached werden sollen.
 * @param {L.Map} map - Die Leaflet-Karteninstanz.
 * @returns {{zoom: number, x: number, y: number}[]} Eine Liste von Kachel-Objekten.
 * @private
 */
function getTilesInRadius(lat, lng, radiusKm, zoomLevels, map) {
    if (!map) {
        console.warn('Map not initialized, cannot calculate tiles');
        return [];
    }

    const tiles = new Set();
    const EARTH_CIRCUMFERENCE = 40075016.686;
    const radiusMeters = radiusKm * 1000;

    zoomLevels.forEach(zoom => {
        const point = map.project([lat, lng], zoom);
        const tileSize = 256;
        const centerX = point.x / tileSize;
        const centerY = point.y / tileSize;

        const latRad = lat * Math.PI / 180;
        const metersPerPixel = EARTH_CIRCUMFERENCE * Math.cos(latRad) / (tileSize * Math.pow(2, zoom));
        const tileRadius = Math.ceil(radiusMeters / (metersPerPixel * tileSize)) + 1;

        const numTiles = Math.pow(2, zoom);
        for (let x = Math.floor(centerX - tileRadius); x <= Math.ceil(centerX + tileRadius); x++) {
            for (let y = Math.floor(centerY - tileRadius); y <= Math.ceil(centerY + tileRadius); y++) {
                if (x >= 0 && x < numTiles && y >= 0 && y < numTiles) {
                    tiles.add(`${zoom}/${x}/${y}`);
                }
            }
        }
    });

    return Array.from(tiles).map(key => {
        const [zoom, x, y] = key.split('/').map(Number);
        return { zoom, x, y };
    });
}

/**
 * Versucht, eine Kachel mit einer Wiederholungslogik zu fetchen.
 * @param {string} url - Die URL der Kachel.
 * @param {number} [maxRetries=3] - Maximale Anzahl an Versuchen.
 * @returns {Promise<{success: boolean, blob?: Blob, error?: Error}>}
 * @private
 */
async function cacheTileWithRetry(url, maxRetries = 3) {
    let lastError = null;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), CACHE_DEFAULTS.FETCH_TIMEOUT_MS);
            const response = await fetch(url, { signal: controller.signal });
            clearTimeout(timeoutId);
            if (response.ok) {
                const blob = await response.blob();
                return { success: true, blob };
            }
            console.warn(`Attempt ${attempt} failed for ${url}: HTTP ${response.status}`);
            lastError = new Error(`HTTP ${response.status}`);
        } catch (error) {
            console.warn(`Attempt ${attempt} error for ${url}: ${error.message}`);
            lastError = error;
            if (error.name === 'AbortError') {
                console.warn(`Fetch timeout after 15s for ${url}`);
            }
        }
        if (attempt < maxRetries) await new Promise(resolve => setTimeout(resolve, 1000));
    }
    return { success: false, error: lastError };
}