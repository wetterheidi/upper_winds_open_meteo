import { Utils } from './utils.js';
import { Settings } from './settings.js';
import { CACHE_DEFAULTS } from './constants.js';
import { AppState } from './state.js';


const TileCache = {
    dbName: 'SkydivingTileCache',
    storeName: 'tiles',
    db: null,

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

L.TileLayer.Cached = L.TileLayer.extend({
    createTile(coords, done) {
        const tile = document.createElement('img');
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

L.tileLayer.cached = function (url, options) {
    return new L.TileLayer.Cached(url, options);
};

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

async function cacheTilesForDIP({ map, lastLat, lastLng, baseMaps, onProgress, onComplete, onCancel, radiusKm: forcedRadius = null, silent = false }) {
    if (!map) {
        if (onComplete && !silent) onComplete('Map not initialized, cannot cache tiles.');
        return;
    }

    if (!lastLat || !lastLng) {
        if (onComplete && !silent) onComplete('Please select a location to cache map tiles.');
        return;
    }

    const radiusKm = forcedRadius !== null ? forcedRadius : (Settings.state.userSettings.cacheRadiusKm || Settings.defaultSettings.cacheRadiusKm);
    const zoomLevels = Settings.state.userSettings.cacheZoomLevels || Settings.defaultSettings.cacheZoomLevels;
    const tiles = getTilesInRadius(lastLat, lastLng, radiusKm, zoomLevels, map);

    const tileLayers = [];
    if (Settings.state.userSettings.baseMaps === 'Esri Satellite + OSM') {
        tileLayers.push(
            { name: 'Esri Satellite', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', normalizedUrl: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}' },
            { name: 'OSM Overlay', url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', subdomains: ['a', 'b', 'c'], normalizedUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png' }
        );
    } else {
        const layer = baseMaps[Settings.state.userSettings.baseMaps];
        if (layer) {
            tileLayers.push({
                name: Settings.state.userSettings.baseMaps,
                url: layer.options.url || layer._url,
                subdomains: layer.options.subdomains,
                normalizedUrl: (layer.options.url || layer._url).replace(/{s}\./, '')
            });
        }
    }

    const totalTiles = tiles.length * tileLayers.length;
    if (totalTiles === 0) {
        if (onComplete && !silent) onComplete('No tiles to cache for this basemap.');
        return;
    }

    let cachedCount = 0;
    let failedCount = 0;
    const failedTiles = [];
    AppState.isCachingCancelled = false;

    if (onProgress && !silent) {
        onProgress(0, totalTiles, () => {
            AppState.isCachingCancelled = true;
            if (onCancel) onCancel();
        });
    }

    try {
        for (const layer of tileLayers) {
            console.log('Processing layer:', layer.name);
            if (AppState.isCachingCancelled) {
                console.log('Caching cancelled by user');
                break;
            }
            const fetchPromises = tiles.map(async (tile, index) => {
                if (AppState.isCachingCancelled) {
                    console.log('Caching cancelled during tile processing');
                    return;
                }

                const url = layer.url
                    .replace('{z}', tile.zoom)
                    .replace('{x}', tile.x)
                    .replace('{y}', tile.y)
                    .replace('{s}', layer.subdomains ? layer.subdomains[Math.floor(Math.random() * layer.subdomains.length)] : '');
                const normalizedUrl = layer.normalizedUrl
                    .replace('{z}', tile.zoom)
                    .replace('{x}', tile.x)
                    .replace('{y}', tile.y);

                console.log(`Processing tile ${index + 1}/${tiles.length} for layer ${layer.name}:`, { url, normalizedUrl });

                const cachedBlob = await TileCache.getTile(normalizedUrl).catch(err => {
                    console.error(`Error retrieving tile from cache: ${normalizedUrl}`, err);
                    return null;
                });
                if (cachedBlob) {
                    cachedCount++;
                    console.log(`Tile ${index + 1} already in cache`);
                } else {
                    const result = await cacheTileWithRetry(url);
                    if (result.success) {
                        const stored = await TileCache.storeTile(normalizedUrl, result.blob).catch(err => {
                            console.error(`Error storing tile: ${normalizedUrl}`, err);
                            return false;
                        });
                        if (stored) {
                            cachedCount++;
                            console.log(`Tile ${index + 1} cached successfully`);
                        } else {
                            failedCount++;
                            failedTiles.push(url);
                            console.log(`Tile ${index + 1} failed to store`);
                        }
                    } else {
                        failedCount++;
                        failedTiles.push(url);
                        console.log(`Tile ${index + 1} failed to fetch:`, result.error.message);
                    }
                }

                const currentCount = cachedCount + failedCount;
            if ((index + 1) % 10 === 0 || index === tiles.length - 1) {
                if (onProgress && !silent) {
                    onProgress(currentCount, totalTiles, () => {
                        AppState.isCachingCancelled = true;
                    });
                }
            }
            });

            console.log(`Processing batch of ${tiles.length} tiles for layer ${layer.name}`);
            for (let i = 0; i < fetchPromises.length; i += 20) {
                if (AppState.isCachingCancelled) {
                    console.log('Caching cancelled during batch processing');
                    break;
                }
                const batch = fetchPromises.slice(i, i + 20);
                await Promise.all(batch).catch(err => {
                    console.error('Error processing batch of tiles:', err);
                });
                console.log(`Completed batch ${i / 20 + 1} for layer ${layer.name}`);
            }
        }
    } catch (error) {
        console.error('Unexpected error in cacheTilesForDIP:', error);
        Utils.handleError('Failed to cache map tiles: ' + error.message);
    } finally {
        console.log('Hiding progress bar');
        if (onComplete) {
            let message = '';
            if (AppState.isCachingCancelled) {
                message = `Caching cancelled: ${cachedCount} tiles cached, ${failedCount} failed.`;
            } else if (failedCount > 0) {
                message = `Cached ${cachedCount} tiles around DIP (${failedCount} failed).`;
            } else {
                message = `Cached ${cachedCount} tiles around DIP successfully.`;
            }
            onComplete(message);
        }
    }

    if (failedTiles.length > 0) {
        console.warn(`Failed to cache ${failedTiles.length} tiles:`, failedTiles);
    }

    console.log(`DIP caching complete: ${cachedCount} tiles cached, ${failedCount} failed`);
    let completionMessage = '';
    if (AppState.isCachingCancelled) {
        completionMessage = `Caching cancelled: ${cachedCount} tiles cached, ${failedCount} failed.`;
    } else if (failedCount > 0) {
        completionMessage = `Cached ${cachedCount} tiles around DIP (${failedCount} failed).`;
    } else {
        completionMessage = `Cached ${cachedCount} tiles around DIP successfully.`;
    }

    if (onComplete) {
        onComplete(completionMessage);
    }

    try {
        const size = await TileCache.getCacheSize();
        console.log(`Cache size after DIP caching: ${size.toFixed(2)} MB`);
        if (size > CACHE_DEFAULTS.SIZE_LIMIT_MB_WARNING) {
            Utils.handleError(`Cache size large (${size.toFixed(2)} MB). Consider clearing cache to free up space.`);
        }
    } catch (error) {
        console.error('Failed to check cache size after DIP caching:', error);
        Utils.handleError('Unable to check cache size. Consider clearing cache to free up space.');
    }
}

async function cacheVisibleTiles({ map, baseMaps, onProgress, onComplete, onCancel }) {
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
    if (!baseMaps[Settings.state.userSettings.baseMaps]) {
        console.warn(`Base map ${Settings.state.userSettings.baseMaps} not found, skipping caching`);
        if (onComplete) onComplete('Selected base map not available for caching.');
        return;
    }

    if (Settings.state.userSettings.baseMaps === 'Esri Satellite + OSM') {
        tileLayers.push(
            { name: 'Esri Satellite', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', normalizedUrl: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}' },
            { name: 'OSM Overlay', url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', subdomains: ['a', 'b', 'c'], normalizedUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png' }
        );
    } else {
        const layer = baseMaps[Settings.state.userSettings.baseMaps];
        // --- KORREKTUR START ---
        // Prüft, ob der Layer und seine URL-Eigenschaft existieren, bevor er zum Caching hinzugefügt wird.
        if (layer && (layer.options.url || layer._url)) {
            tileLayers.push({
                name: Settings.state.userSettings.baseMaps,
                url: layer.options.url || layer._url,
                subdomains: layer.options.subdomains,
                normalizedUrl: (layer.options.url || layer._url).replace(/{s}\./, '')
            });
        }
        // --- KORREKTUR ENDE ---
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

export { TileCache, cacheTilesForDIP, cacheVisibleTiles };