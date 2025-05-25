import { Utils } from './utils.js';
import { Settings } from './settings.js';
import { TileCache, cacheTilesForDIP } from './tileCache.js';

function setupCacheManagement() {
    const buttonWrapper = document.getElementById('settings-cache-buttons');
    if (!buttonWrapper) {
        console.warn('Button wrapper not found; ensure setupResetButton is called before setupCacheManagement');
        return;
    }

    const clearCacheButton = document.createElement('button');
    clearCacheButton.id = 'clearCacheButton';
    clearCacheButton.textContent = 'Clear Tile Cache';
    clearCacheButton.title = 'Clears cached map tiles. Pan/zoom to cache more tiles for offline use.';

    buttonWrapper.appendChild(clearCacheButton);

    clearCacheButton.addEventListener('click', async () => {
        try {
            const size = await TileCache.getCacheSize();
            await TileCache.clearCache();
            Utils.handleMessage(`Tile cache cleared successfully (freed ${size.toFixed(2)} MB).`);
            console.log('Tile cache cleared');
        } catch (error) {
            Utils.handleError('Failed to clear tile cache: ' + error.message);
        }
    });
}

function setupCacheSettings({ map, lastLat, lastLng, baseMaps }) {
    const cacheRadiusSelect = document.getElementById('cacheRadiusSelect');
    if (cacheRadiusSelect) {
cacheRadiusSelect.addEventListener('change', () => {
    if (!Settings.state || !Settings.state.userSettings) {
        console.error('Settings not properly initialized');
        return;
    }
     Settings.state.userSettings.cacheRadiusKm = parseInt(cacheRadiusSelect.value, 10);
            Settings.save();
            console.log('Updated cacheRadiusKm:', Settings.state.userSettings.cacheRadiusKm);
        });
        console.log('cacheRadiusSelect listener attached, initial value:', cacheRadiusSelect.value);
    } else {
        console.warn('cacheRadiusSelect not found in DOM');
    }

    const cacheZoomLevelsSelect = document.getElementById('cacheZoomLevelsSelect');
    if (cacheZoomLevelsSelect) {
        cacheZoomLevelsSelect.addEventListener('change', () => {
            const [minZoom, maxZoom] = cacheZoomLevelsSelect.value.split('-').map(Number);
            Settings.state.userSettings.cacheZoomLevels = Array.from(
                { length: maxZoom - minZoom + 1 },
                (_, i) => minZoom + i
            );
            Settings.save();
            console.log('Updated cacheZoomLevels:', Settings.state.userSettings.cacheZoomLevels);
        });
        console.log('cacheZoomLevelsSelect listener attached, initial value:', cacheZoomLevelsSelect.value);
    } else {
        console.warn('cacheZoomLevelsSelect not found in DOM');
    }

    const recacheNowButton = document.getElementById('recacheNowButton');
    if (recacheNowButton) {
        recacheNowButton.addEventListener('click', (e) => {
            e.stopPropagation();
            console.log('Recache Now button clicked');
            if (!navigator.onLine) {
                Utils.handleError('Cannot recache while offline.');
                return;
            }
            if (!map) {
                console.warn('Map not initialized, cannot recache tiles');
                Utils.handleMessage('Map not initialized, cannot recache tiles.');
                return;
            }
            cacheTilesForDIP({ map, lastLat, lastLng, baseMaps });
        });
        console.log('recacheNowButton listener attached');
    } else {
        console.warn('recacheNowButton not found in DOM');
    }
}

export { setupCacheManagement, setupCacheSettings };