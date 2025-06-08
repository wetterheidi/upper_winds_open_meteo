import { AppState } from './state.js';
import { Settings } from './settings.js';
import { Utils } from './utils.js';

export function handleHarpPlacement(e) {
    if (!AppState.isPlacingHarp) return;
    const { lat, lng } = e.latlng;
    if (AppState.harpMarker) {
        AppState.harpMarker.setLatLng([lat, lng]);
        console.log('Updated HARP marker position:', { lat, lng });
    } else {
        AppState.harpMarker = createHarpMarker(lat, lng).addTo(AppState.map);
        console.log('Placed new HARP marker:', { lat, lng });
    }
    Settings.state.userSettings.harpLat = lat;
    Settings.state.userSettings.harpLng = lng;
    Settings.save();
    AppState.isPlacingHarp = false;
    AppState.map.off('click', handleHarpPlacement);
    console.log('HARP placement mode deactivated');
    // Enable HARP radio button
    const harpRadio = document.querySelector('input[name="jumpMasterLineTarget"][value="HARP"]');
    if (harpRadio) {
        harpRadio.disabled = false;
        console.log('Enabled HARP radio button');
    }
}

export function createHarpMarker(latitude, longitude) {
    const marker = L.marker([latitude, longitude], {
        icon: L.divIcon({
            className: 'harp-marker',
            html: '<div style="background-color: green; width: 10px; height: 10px; border-radius: 50%;"></div>',
            iconSize: [10, 10],
            iconAnchor: [5, 5]
        }),
        pane: 'markerPane' // Use standard marker pane
    });
    console.log('Created HARP marker at:', { latitude, longitude });
    return marker;
}

export function clearHarpMarker() {
    if (!AppState.map) {
        console.warn('Map not initialized, cannot clear HARP marker');
        Utils.handleMessage('Map not initialized, cannot clear HARP marker.');
        return;
    }

    if (AppState.harpMarker) {
        AppState.map.removeLayer(AppState.harpMarker);
        AppState.harpMarker = null;
        console.log('Removed HARP marker');
    }
    Settings.state.userSettings.harpLat = null;
    Settings.state.userSettings.harpLng = null;
    Settings.save();
    const harpRadio = document.querySelector('input[name="jumpMasterLineTarget"][value="HARP"]');
    if (harpRadio) {
        harpRadio.disabled = true;
        console.log('Disabled HARP radio button');
    }
    // If Jump Master Line is set to HARP, remove it or switch to DIP
    if (Settings.state.userSettings.jumpMasterLineTarget === 'HARP' && Settings.state.userSettings.showJumpMasterLine) {
        if (AppState.jumpMasterLine) {
            AppState.map.removeLayer(AppState.jumpMasterLine);
            AppState.jumpMasterLine = null;
            console.log('Removed Jump Master Line: HARP marker cleared');
        }
        // Switch to DIP
        Settings.state.userSettings.jumpMasterLineTarget = 'DIP';
        const dipRadio = document.querySelector('input[name="jumpMasterLineTarget"][value="DIP"]');
        if (dipRadio) {
            dipRadio.checked = true;
            console.log('Switched Jump Master Line to DIP');
        }
        Settings.save();
        // Update line if live tracking is active
        if (AppState.liveMarker && AppState.currentMarker && AppState.lastLat !== null && AppState.lastLng !== null) {
            debouncedPositionUpdate({
                coords: {
                    latitude: AppState.lastLatitude,
                    longitude: AppState.lastLongitude,
                    accuracy: AppState.lastAccuracy,
                    altitude: AppState.lastDeviceAltitude,
                    altitudeAccuracy: AppState.lastAltitudeAccuracy
                }
            });
        }
    }
    Utils.handleMessage('HARP marker cleared');
}