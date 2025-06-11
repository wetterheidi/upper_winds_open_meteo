import { AppState } from './state.js';
import { Utils } from './utils.js';
import { Settings } from './settings.js';
import { TileCache, cacheTilesForDIP } from './tileCache.js';

function setupCacheManagement() {
    const bottomContainer = document.getElementById('bottom-container');
    if (!bottomContainer) {
        console.error('Bottom container not found; cannot create settings/cache buttons.');
        return;
    }

    // 1. Erstelle den gemeinsamen Container für die Buttons
    const buttonWrapper = document.createElement('div');
    buttonWrapper.id = 'settings-cache-buttons';
    buttonWrapper.className = 'button-wrapper';

    // 2. Erstelle den "Reset Settings" Button (Logik von eventManager hierher verschoben)
    const resetButton = document.createElement('button');
    resetButton.id = 'resetButton';
    resetButton.textContent = 'Reset Settings';
    resetButton.title = 'Resets all settings to their default values and locks all features';
    resetButton.addEventListener('click', () => {
        if (confirm("Are you sure you want to reset all settings and lock all features?")) {
            localStorage.removeItem('unlockedFeatures');
            localStorage.removeItem('upperWindsSettings');
            
            // Führe einen Reload der Seite durch, um alles sauber neu zu initialisieren
            window.location.reload();
        }
    });
    buttonWrapper.appendChild(resetButton); // Füge den Reset-Button zum Wrapper hinzu

    // 3. Erstelle den "Clear Tile Cache" Button
    const clearCacheButton = document.createElement('button');
    clearCacheButton.id = 'clearCacheButton';
    clearCacheButton.textContent = 'Clear Tile Cache';
    clearCacheButton.title = 'Clears cached map tiles. Pan/zoom to cache more tiles for offline use.';
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
    buttonWrapper.appendChild(clearCacheButton); // Füge den Clear-Cache-Button zum Wrapper hinzu

    // 4. Füge den fertigen Wrapper zum DOM hinzu
    bottomContainer.appendChild(buttonWrapper);
}


function setupCacheSettings() {
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
            
            const { map, lastLat, lastLng, baseMaps } = AppState;

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