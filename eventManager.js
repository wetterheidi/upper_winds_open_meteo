// eventManager.js
"use strict";

import { AppState } from './state.js';
import { Settings } from './settings.js';
import { Utils } from './utils.js';
import {
    updateAllDisplays, calculateJump, updateLandingPatternDisplay, updateJumpRunTrackDisplay,
    getSliderValue, downloadTableAsAscii, fetchWeatherForLocation,
    startPositionTracking, stopPositionTracking, calculateMeanWind, fetchEnsembleWeatherData,
    processAndVisualizeEnsemble, clearEnsembleVisualizations, debouncedPositionUpdate,
    updateJumpMasterLine, refreshMarkerPopup, calculateJumpRunTrack, updateWeatherDisplay,
    updateLivePositionControl, debouncedGetElevationAndQFE, getDownloadFormat,
    validateLegHeights, debouncedCalculateJump, setInputValue, setInputValueSilently
} from './app.js';
import * as mapManager from './mapManager.js';
import * as Coordinates from './coordinates.js';
import * as JumpPlanner from './jumpPlanner.js';
import { handleHarpPlacement, clearHarpMarker } from './harpMarker.js';
import { TileCache, cacheTilesForDIP } from './tileCache.js';
import { loadGpxTrack, loadCsvTrackUTC } from './trackManager.js';

export const getTemperatureUnit = () => Settings.getValue('temperatureUnit', 'radio', 'C');
export const getHeightUnit = () => Settings.getValue('heightUnit', 'radio', 'm');
export const getWindSpeedUnit = () => Settings.getValue('windUnit', 'radio', 'kt');
export const getCoordinateFormat = () => Settings.getValue('coordFormat', 'radio', 'Decimal');

// HILFSFUNKTIONEN FÜR EVENT SETUP
function setupCheckbox(id, setting, callback) {
    console.log(`setupCheckbox called for id: ${id}`);
    const checkbox = document.getElementById(id);
    if (checkbox) {
        if (checkbox._changeHandler) {
            checkbox.removeEventListener('change', checkbox._changeHandler);
            console.log(`Removed previous change listener for ${id}`);
        }
        checkbox._changeHandler = (event) => {
            console.log(`Change event fired for ${id}, checked: ${checkbox.checked}, event:`, event);
            event.stopPropagation();
            callback(checkbox);
        };
        checkbox.addEventListener('change', checkbox._changeHandler);
        checkbox.addEventListener('click', (event) => {
            console.log(`Click event on ${id}, checked: ${checkbox.checked}, target:`, event.target);
        });
        console.log(`Attached change and click listeners to ${id}`);
        // checkbox.checked = Settings.state.userSettings[setting]; // DIESE ZEILE ENTFERNEN ODER AUSKOMMENTIEREN
        // Apply visual indication for locked features
        if (id === 'showLandingPattern' && !(Settings.isFeatureUnlocked('landingPattern') && Settings.state.isLandingPatternUnlocked)) {
            checkbox.style.opacity = '0.5';
            checkbox.title = 'Feature locked. Click to enter password.';
        }
    } else {
        console.warn(`Checkbox ${id} not found`);
    }
}

function toggleSubmenu(element, submenu, isVisible) {
    console.log(`toggleSubmenu called for ${element.textContent || element.id}: ${isVisible ? 'show' : 'hide'}`);
    if (submenu) {
        // Sicherstellen, dass die Klasse .submenu vorhanden ist
        if (!submenu.classList.contains('submenu')) {
            submenu.classList.add('submenu');
        }

        // Klasse umschalten und Aria-Attribut für Barrierefreiheit setzen
        submenu.classList.toggle('hidden', !isVisible);
        element.setAttribute('aria-expanded', isVisible);
        console.log(`Submenu toggled for ${element.textContent || element.id}: ${isVisible ? 'shown' : 'hidden'}`);

        // WICHTIG: Die "forceVisibility"-Logik beibehalten, um UI-Bugs zu verhindern
        let attempts = 0;
        const maxAttempts = 5;
        const forceVisibility = () => {
            const currentState = {
                isHidden: submenu.classList.contains('hidden'),
                displayStyle: window.getComputedStyle(submenu).display
            };

            // Wenn das Menü geöffnet sein SOLL, aber aus irgendeinem Grund versteckt ist...
            if (isVisible && (currentState.isHidden || currentState.displayStyle === 'none')) {
                console.warn(`Submenu for ${element.textContent || element.id} was hidden unexpectedly. Forcing it to be visible.`);
                submenu.classList.remove('hidden');
                submenu.style.display = 'block'; // Erzwingt die Sichtbarkeit
                attempts++;
                if (attempts < maxAttempts) {
                    setTimeout(forceVisibility, 100); // Erneuter Check nach kurzer Zeit
                }
            }
        };
        setTimeout(forceVisibility, 100); // Initialer Check
    } else {
        console.warn(`Submenu for ${element.textContent || element.id} not found`);
    }
}

function setupRadioGroup(name, callback) {
    const radios = document.querySelectorAll(`input[name="${name}"]`);
    radios.forEach(radio => {
        radio.addEventListener('change', () => {
            const newValue = Settings.getValue(name, 'radio', Settings.defaultSettings[name]);
            Settings.state.userSettings[name] = newValue;
            Settings.save();
            console.log(`${name} changed to: ${newValue} and saved to localStorage`);

            if (name === 'landingDirection') {
                const customLL = document.getElementById('customLandingDirectionLL');
                const customRR = document.getElementById('customLandingDirectionRR');
                const landingDirection = Settings.state.userSettings.landingDirection;

                if (customLL) customLL.disabled = landingDirection !== 'LL';
                if (customRR) customRR.disabled = landingDirection !== 'RR';

                if (landingDirection === 'LL' && customLL && !customLL.value && Settings.state.userSettings.customLandingDirectionLL === '') {
                    customLL.value = Math.round(AppState.landingWindDir || 0);
                    Settings.state.userSettings.customLandingDirectionLL = parseInt(customLL.value);
                    Settings.save();
                    console.log(`Set customLandingDirectionLL to ${customLL.value}`);
                }
                if (landingDirection === 'RR' && customRR && !customRR.value && Settings.state.userSettings.customLandingDirectionRR === '') {
                    customRR.value = Math.round(AppState.landingWindDir || 0);
                    Settings.state.userSettings.customLandingDirectionRR = parseInt(customRR.value);
                    Settings.save();
                    console.log(`Set customLandingDirectionRR to ${customRR.value}`);
                }
            }
            callback();
        });
    });
}

function setupInput(id, eventType, debounceTime, callback) {
    const input = document.getElementById(id);
    if (!input) {
        console.warn(`Input element ${id} not found`);
        return;
    }
    input.addEventListener(eventType, Utils.debounce(() => {
        const value = input.type === 'number' ? parseFloat(input.value) : input.value;
        Settings.state.userSettings[id] = value;
        Settings.save();
        console.log(`${id} changed to: ${value} and saved to localStorage`);
        callback(value);
    }, debounceTime));
}

function setupLegHeightInput(id, defaultValue) {
    const input = document.getElementById(id);
    if (!input) {
        console.warn(`Input element ${id} not found`);
        return;
    }
    input.addEventListener('blur', () => {
        const value = parseInt(input.value) || defaultValue;
        console.log(`Attempting to update ${id} to ${value}`);
        Settings.state.userSettings[id] = value;
        Settings.save();

        const finalInput = document.getElementById('legHeightFinal');
        const baseInput = document.getElementById('legHeightBase');
        const downwindInput = document.getElementById('legHeightDownwind');

        if (!isNaN(value) && value >= 50 && value <= 1000 && validateLegHeights(finalInput, baseInput, downwindInput)) {
            console.log(`Valid ${id}: ${value}, updating displays`);
            updateAllDisplays();
            if (AppState.weatherData && AppState.lastLat && AppState.lastLng && id === 'legHeightDownwind' && Settings.state.userSettings.calculateJump) {
                debouncedCalculateJump();
            }
        } else {
            let adjustedValue = defaultValue;
            const finalVal = parseInt(finalInput?.value) || 100;
            const baseVal = parseInt(baseInput?.value) || 200;
            const downwindVal = parseInt(downwindInput?.value) || 300;

            if (id === 'legHeightFinal') adjustedValue = Math.min(baseVal - 1, 100);
            if (id === 'legHeightBase') adjustedValue = Math.max(finalVal + 1, Math.min(downwindVal - 1, 200));
            if (id === 'legHeightDownwind') adjustedValue = Math.max(baseVal + 1, 300);

            input.value = adjustedValue;
            Settings.state.userSettings[id] = adjustedValue;
            Settings.save();
            console.log(`Adjusted ${id} to ${adjustedValue} due to invalid input`);
            Utils.handleError(`Adjusted ${id} to ${adjustedValue} to maintain valid leg order.`);
        }
    });
}

// SETUP-FUNKTIONEN FÜR DIE EINZELNEN BEREICHE
function setupMenuEvents() {
    console.log("setupMenuEvents wird aufgerufen für allgemeine Menü-Logik.");
    const hamburgerBtn = document.getElementById('hamburgerBtn');
    const menu = document.getElementById('menu');
    if (!hamburgerBtn || !menu) return;

    // Hamburger-Button und Klick-außerhalb-Logik
    hamburgerBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.classList.toggle('hidden');
    });
    document.addEventListener('click', (e) => {
        if (!menu.contains(e.target) && !hamburgerBtn.contains(e.target)) {
            menu.classList.add('hidden');
        }
    });

    // --- KORRIGIERTE LOGIK ZUM ÖFFNEN DER UNTERMENÜS ---
    menu.addEventListener('click', (event) => {
        // Wir interessieren uns nur für das Element, das direkt geklickt wurde.
        const target = event.target;

        // Prüfe, ob das geklickte Element (oder sein direktes Elternelement)
        // eine Menü-Überschrift ist. Das schließt tiefere Elemente wie Buttons aus.
        const isToggleLabel = target.matches('li > span') || target.matches('li > label');

        if (isToggleLabel) {
            // Verhindere, dass der Klick sich weiter ausbreitet
            event.preventDefault();
            event.stopPropagation();

            const submenu = target.closest('li').querySelector('ul.submenu');
            if (submenu) {
                submenu.classList.toggle('hidden');
            }
        }
    });
}

function setupCheckboxEvents() {
    if (!AppState.map) {
        console.warn('Map not initialized, skipping setupCheckboxEvents');
        return;
    }

    setupCheckbox('showTableCheckbox', 'showTable', (checkbox) => {
        Settings.state.userSettings.showTable = checkbox.checked;
        Settings.save();
        console.log('showTableCheckbox changed:', checkbox.checked);
        const info = document.getElementById('info');
        if (info) {
            info.style.display = checkbox.checked ? 'block' : 'none';
            console.log('Info display set to:', info.style.display);
        }
        if (checkbox.checked && AppState.weatherData && AppState.lastLat && AppState.lastLng) {
            updateWeatherDisplay(getSliderValue());
        }
        mapManager.recenterMap();
    });

    setupCheckbox('showExitAreaCheckbox', 'showExitArea', (checkbox) => {
        Settings.state.userSettings.showExitArea = checkbox.checked;
        Settings.save();
        console.log('Show Exit Area set to:', Settings.state.userSettings.showExitArea);

        // Rufe immer calculateJump auf. Die Funktion entscheidet, was zu tun ist.
        if (AppState.weatherData && AppState.lastLat && AppState.lastLng && Settings.state.userSettings.calculateJump) {
            calculateJump();
        }
    });

    setupCheckbox('showCanopyAreaCheckbox', 'showCanopyArea', (checkbox) => {
        Settings.state.userSettings.showCanopyArea = checkbox.checked;
        Settings.save();
        console.log('Show Canopy Area set to:', Settings.state.userSettings.showCanopyArea);

        // Rufe immer calculateJump auf. Die Funktion entscheidet, was zu tun ist.
        if (AppState.weatherData && AppState.lastLat && AppState.lastLng && Settings.state.userSettings.calculateJump) {
            calculateJump();
        }
    });

    setupCheckbox('showJumpRunTrack', 'showJumpRunTrack', (checkbox) => {
        Settings.state.userSettings.showJumpRunTrack = checkbox.checked;
        Settings.save();
        checkbox.checked = Settings.state.userSettings.showJumpRunTrack;
        console.log('showJumpRunTrack changed:', checkbox.checked);
        if (checkbox.checked && AppState.weatherData && AppState.lastLat && AppState.lastLng && Settings.state.isCalculateJumpUnlocked && Settings.state.userSettings.calculateJump) {
            calculateJumpRunTrack();
        } else {
            if (AppState.jumpRunTrackLayer) {
                if (AppState.jumpRunTrackLayer.airplaneMarker && AppState.map && typeof AppState.map.removeLayer === 'function') {
                    AppState.map.removeLayer(AppState.jumpRunTrackLayer.airplaneMarker);
                    AppState.jumpRunTrackLayer.airplaneMarker = null;
                }
                if (AppState.jumpRunTrackLayer.approachLayer && AppState.map && typeof AppState.map.removeLayer === 'function') {
                    AppState.map.removeLayer(AppState.jumpRunTrackLayer.approachLayer);
                    AppState.jumpRunTrackLayer.approachLayer = null;
                }
                if (AppState.map && typeof AppState.map.removeLayer === 'function') {
                    AppState.map.removeLayer(AppState.jumpRunTrackLayer);
                }
                AppState.jumpRunTrackLayer = null;
                console.log('Removed JRT polyline');
            }
            const directionInput = document.getElementById('jumpRunTrackDirection');
            if (directionInput) {
                const trackData = JumpPlanner.jumpRunTrack();
                directionInput.value = trackData ? trackData.direction : '';
                console.log('Updated jumpRunTrackDirection value:', trackData?.direction || '');
            }
        }
    });

    setupCheckbox('showCutAwayFinder', 'showCutAwayFinder', (checkbox) => {
        Settings.state.userSettings.showCutAwayFinder = checkbox.checked;
        Settings.save();
        console.log('Show Cut Away Finder set to:', checkbox.checked);

        // Finde das zugehörige Untermenü
        const submenu = checkbox.closest('li')?.querySelector('ul.submenu');

        if (checkbox.checked) {
            // *** HIER DIE KORREKTUR: ÖFFNE DAS SUBMENÜ ***
            if (submenu) {
                submenu.classList.remove('hidden');
            }
        } else {
            // Wenn die Checkbox deaktiviert wird, räume alles auf.
            if (submenu) {
                submenu.classList.add('hidden');
            }
            mapManager.clearCutAwayMarker();
            AppState.cutAwayLat = null;
            AppState.cutAwayLng = null;
        }

        // Rufe immer calculateJump auf. Die Funktion entscheidet, was zu tun ist.
        if (AppState.weatherData && AppState.lastLat && AppState.lastLng && Settings.state.userSettings.calculateJump) {
            calculateJump();
        }
    });

    setupCheckbox('showLandingPattern', 'showLandingPattern', (checkbox) => {
        const feature = 'landingPattern';
        const enableFeature = () => {
            Settings.state.userSettings.showLandingPattern = true;
            Settings.save();
            const submenu = checkbox.closest('li')?.querySelector('ul');
            toggleSubmenu(checkbox, submenu, true);
            updateLandingPatternDisplay();
        };

        const disableFeature = () => {
            Settings.state.userSettings.showLandingPattern = false;
            Settings.save();
            checkbox.checked = false;
            const submenu = checkbox.closest('li')?.querySelector('ul');
            toggleSubmenu(checkbox, submenu, false);

            // KORREKTUR: Rufen Sie einfach die zentrale Funktion auf, die alles löscht.
            mapManager.drawLandingPattern(null);
        };

        if (checkbox.checked) {
            if (Settings.isFeatureUnlocked(feature)) {
                enableFeature();
            } else {
                Settings.showPasswordModal(feature, enableFeature, disableFeature);
            }
        } else {
            disableFeature();
        }
    });

    setupCheckbox('trackPositionCheckbox', 'trackPosition', (checkbox) => {
        console.log('trackPositionCheckbox changed to:', checkbox.checked);
        Settings.state.userSettings.trackPosition = checkbox.checked;
        Settings.save();
        const parentLi = checkbox.closest('li');
        const submenu = parentLi?.querySelector('ul');
        console.log('Submenu lookup for trackPositionCheckbox:', {
            parentLi: parentLi ? 'Found' : 'Not found',
            submenu: submenu ? 'Found' : 'Not found',
            submenuClasses: submenu?.classList.toString(),
            parentLiInnerHTML: parentLi?.innerHTML
        });
        if (submenu) {
            toggleSubmenu(checkbox, submenu, checkbox.checked);
        } else {
            console.log('No submenu for trackPositionCheckbox, skipping toggleSubmenu');
        }
        if (checkbox.checked) {
            startPositionTracking();
            // Enable Jump Master Line checkbox if it exists
            const jumpMasterCheckbox = document.getElementById('showJumpMasterLine');
            if (jumpMasterCheckbox) {
                jumpMasterCheckbox.disabled = false;
                jumpMasterCheckbox.style.opacity = '1';
                jumpMasterCheckbox.title = '';
                console.log('Enabled showJumpMasterLine checkbox due to trackPosition being enabled');
            }
        } else {
            stopPositionTracking();
            // Disable and uncheck Jump Master Line checkbox
            const jumpMasterCheckbox = document.getElementById('showJumpMasterLine');
            if (jumpMasterCheckbox) {
                jumpMasterCheckbox.disabled = true;
                jumpMasterCheckbox.checked = false;
                jumpMasterCheckbox.style.opacity = '0.5';
                jumpMasterCheckbox.title = 'Enable Live Tracking to use Jump Master Line';
                Settings.state.userSettings.showJumpMasterLine = false;
                Settings.save();
                const jumpMasterSubmenu = jumpMasterCheckbox.closest('li')?.querySelector('ul');
                if (jumpMasterSubmenu) {
                    toggleSubmenu(jumpMasterCheckbox, jumpMasterSubmenu, false);
                }
                console.log('Disabled and unchecked showJumpMasterLine checkbox');
            }
        }
        // Remove Jump Master Line from map
        if (AppState.jumpMasterLine) {
            if (AppState.map && typeof AppState.map.removeLayer === 'function') {
                AppState.map.removeLayer(AppState.jumpMasterLine);
            } else {
                console.warn('Map not initialized, cannot remove jumpMasterLine');
            }
            AppState.jumpMasterLine = null;
            console.log('Removed Jump Master Line due to trackPosition disabled');
        }
        if (AppState.livePositionControl) {
            AppState.livePositionControl.update(
                0,
                0,
                null,
                null,
                0,
                'N/A',
                'kt',
                'N/A',
                false,
                null
            );
            AppState.livePositionControl._container.style.display = 'none';
            console.log('Cleared livePositionControl content and hid panel');
        }
    });

    setupCheckbox('showJumpMasterLine', 'showJumpMasterLine', (checkbox) => {
        console.log('showJumpMasterLine checkbox changed to:', checkbox.checked);
        // Only allow changes if trackPosition is enabled
        if (!Settings.state.userSettings.trackPosition) {
            checkbox.checked = false;
            checkbox.disabled = true;
            checkbox.style.opacity = '0.5';
            checkbox.title = 'Enable Live Tracking to use Jump Master Line';
            Settings.state.userSettings.showJumpMasterLine = false;
            Settings.save();
            Utils.handleMessage('Enable Live Tracking to use Jump Master Line.');
            const submenu = checkbox.closest('li')?.querySelector('ul');
            toggleSubmenu(checkbox, submenu, false);
            return;
        }
        // If targeting DIP, ensure a position is set
        if (checkbox.checked && Settings.state.userSettings.jumpMasterLineTarget === 'DIP' &&
            (AppState.lastLat === null || AppState.lastLng === null || !AppState.currentMarker)) {
            checkbox.checked = false;
            Settings.state.userSettings.showJumpMasterLine = false;
            Settings.save();
            Utils.handleMessage('Please select a DIP position on the map first.');
            const submenu = checkbox.closest('li')?.querySelector('ul');
            toggleSubmenu(checkbox, submenu, false);
            return;
        }
        // If targeting HARP, ensure valid HARP coordinates exist
        if (checkbox.checked && Settings.state.userSettings.jumpMasterLineTarget === 'HARP' &&
            (!Settings.state.userSettings.harpLat || !Settings.state.userSettings.harpLng)) {
            checkbox.checked = false;
            Settings.state.userSettings.showJumpMasterLine = false;
            Settings.save();
            Utils.handleMessage('Please place a HARP marker first.');
            const submenu = checkbox.closest('li')?.querySelector('ul');
            toggleSubmenu(checkbox, submenu, false);
            return;
        }
        Settings.state.userSettings.showJumpMasterLine = checkbox.checked;
        Settings.save();
        const submenu = checkbox.closest('li')?.querySelector('ul');
        console.log('Submenu lookup for showJumpMasterLine:', { submenu: submenu ? 'Found' : 'Not found', submenuClasses: submenu?.classList.toString() });
        toggleSubmenu(checkbox, submenu, checkbox.checked);
        if (!checkbox.checked) {
            if (AppState.jumpMasterLine) {
                if (AppState.map && typeof AppState.map.removeLayer === 'function') {
                    AppState.map.removeLayer(AppState.jumpMasterLine);
                } else {
                    console.warn('Map not initialized, cannot remove jumpMasterLine');
                }
                AppState.jumpMasterLine = null;
                console.log('Removed Jump Master Line: unchecked');
            }
            if (AppState.livePositionControl) {
                AppState.livePositionControl.update(
                    AppState.lastLatitude || 0,
                    AppState.lastLongitude || 0,
                    AppState.lastDeviceAltitude,
                    AppState.lastAltitudeAccuracy,
                    AppState.lastAccuracy,
                    AppState.lastSpeed,
                    AppState.lastEffectiveWindUnit,
                    AppState.lastDirection,
                    false,
                    null
                );
                console.log('Cleared jump master line data from livePositionControl');
            }
        } else {
            // Immediately draw the Jump Master Line if conditions are met
            if (AppState.liveMarker && AppState.livePositionControl &&
                ((Settings.state.userSettings.jumpMasterLineTarget === 'DIP' && AppState.currentMarker &&
                    AppState.lastLat !== null && AppState.lastLng !== null) ||
                    (Settings.state.userSettings.jumpMasterLineTarget === 'HARP' &&
                        Settings.state.userSettings.harpLat && Settings.state.userSettings.harpLng))) {
                console.log('Drawing Jump Master Line immediately for:', Settings.state.userSettings.jumpMasterLineTarget);
                updateJumpMasterLine();
                // Update live position control with current data
                AppState.livePositionControl.update(
                    AppState.lastLatitude || 0,
                    AppState.lastLongitude || 0,
                    AppState.lastDeviceAltitude,
                    AppState.lastAltitudeAccuracy,
                    AppState.lastAccuracy,
                    AppState.lastSpeed,
                    AppState.lastEffectiveWindUnit,
                    AppState.lastDirection,
                    true,
                    null
                );
                // Trigger a position update to ensure line is drawn with latest data
                if (AppState.lastLatitude && AppState.lastLongitude) {
                    debouncedPositionUpdate({
                        coords: {
                            latitude: AppState.lastLatitude,
                            longitude: AppState.lastLongitude,
                            accuracy: AppState.lastAccuracy || 0,
                            altitude: AppState.lastDeviceAltitude,
                            altitudeAccuracy: AppState.lastAltitudeAccuracy
                        }
                    });
                }
            } else {
                console.log('Cannot draw Jump Master Line immediately: missing required data', {
                    hasLiveMarker: !!AppState.liveMarker,
                    hasLivePositionControl: !!AppState.livePositionControl,
                    target: Settings.state.userSettings.jumpMasterLineTarget,
                    hasDIP: AppState.currentMarker && AppState.lastLat !== null && AppState.lastLng !== null,
                    hasHARP: Settings.state.userSettings.harpLat && Settings.state.userSettings.harpLng
                });
            }
        }
    });

    const harpRadio = document.querySelector('input[name="jumpMasterLineTarget"][value="HARP"]');
    if (harpRadio) {
        harpRadio.disabled = !Settings.state.userSettings.harpLat || !Settings.state.userSettings.harpLng;
        console.log('HARP radio button initialized, disabled:', harpRadio.disabled);
    }

    const placeHarpButton = document.getElementById('placeHarpButton');
    if (placeHarpButton) {
        placeHarpButton.addEventListener('click', () => {
            AppState.isPlacingHarp = true;
            console.log('HARP placement mode activated');
            AppState.map.on('click', handleHarpPlacement); // Use imported function
            Utils.handleMessage('Click the map to place the HARP marker');
        });
    }

    const clearHarpButton = document.getElementById('clearHarpButton');
    if (clearHarpButton) {
        clearHarpButton.addEventListener('click', clearHarpMarker); // Use imported function
    }

    const menu = document.querySelector('.hamburger-menu');
    if (menu) {
        menu.addEventListener('click', (e) => {
            console.log('Menu click:', e.target, 'class:', e.target.className, 'id:', e.target.id);
        });
    }
}

function setupSliderEvents() {
    const slider = document.getElementById('timeSlider');
    if (!slider) {
        console.warn('Time slider not found:', { id: 'timeSlider' });
        return;
    }

    // Use 'input' event for real-time updates
    slider.addEventListener('input', async () => {
        const sliderIndex = parseInt(slider.value) || 0;
        console.log('Time slider moved to index:', sliderIndex);

        if (AppState.weatherData && AppState.lastLat && AppState.lastLng) {
            await updateWeatherDisplay(sliderIndex);
            await refreshMarkerPopup();
            if (AppState.lastAltitude !== 'N/A') calculateMeanWind();
            if (Settings.state.userSettings.showLandingPattern) {
                console.log('Updating landing pattern for slider index:', sliderIndex);
                updateLandingPatternDisplay();
            }
            if (Settings.state.userSettings.calculateJump) {
                console.log('Recalculating jump for slider index:', sliderIndex);
                calculateJump();
                JumpPlanner.calculateCutAway();
            }
            if (Settings.state.userSettings.showJumpRunTrack) {
                console.log('Updating jump run track for slider index:', sliderIndex);
                updateJumpRunTrackDisplay();
            }
            //mapManager.recenterMap();
            updateLivePositionControl();
        } else {
            // Aktualisiere zumindest die Zeitanzeige, auch wenn keine vollständigen Wetterdaten für das Hauptmodell da sind
            let timeToDisplay = 'N/A';
            if (AppState.weatherData?.time?.[sliderIndex]) {
                timeToDisplay = await Utils.getDisplayTime(AppState.weatherData.time[sliderIndex], AppState.lastLat, AppState.lastLng);
            } else if (AppState.ensembleModelsData && Object.keys(AppState.ensembleModelsData).length > 0) {
                const firstEnsembleModelName = Object.keys(AppState.ensembleModelsData)[0];
                const ensembleTimeArray = AppState.ensembleModelsData[firstEnsembleModelName]?.time;
                if (ensembleTimeArray?.[sliderIndex]) {
                    timeToDisplay = await Utils.getDisplayTime(ensembleTimeArray[sliderIndex], AppState.lastLat, AppState.lastLng);
                }
            }
            const selectedTimeElement = document.getElementById('selectedTime');
            if (selectedTimeElement) {
                selectedTimeElement.innerHTML = `Selected Time: ${timeToDisplay}`;
            }
        }

        // 2. Ensemble-Visualisierungen aktualisieren
        if (Settings.state.userSettings.selectedEnsembleModels && Settings.state.userSettings.selectedEnsembleModels.length > 0) {
            console.log("Time slider change triggering ensemble update for index:", sliderIndex);
            if (AppState.ensembleModelsData && Object.keys(AppState.ensembleModelsData).length > 0) {
                processAndVisualizeEnsemble(); // Diese Funktion verwendet intern den aktuellen sliderIndex via getSliderValue()
            } else {
                console.warn("Ensemble update skipped: AppState.ensembleModelsData is not populated yet.");
                // Optional: Daten erneut abrufen, falls sie fehlen sollten
                // await fetchEnsembleWeatherData();
                // processAndVisualizeEnsemble();
            }
        }
    });

    // Das 'change'-Event (feuert nach dem Loslassen des Sliders) kann für finale Textupdates bleiben,
    // oder wenn die 'input'-Performance bei sehr vielen Datenpunkten ein Problem wäre.
    // Für die Textanzeige der Zeit ist 'input' aber auch responsiv genug.
    slider.addEventListener('change', async () => {
        const sliderIndex = parseInt(slider.value) || 0;
        let timeToDisplay = 'N/A';

        // Konsistente Logik zur Zeitanzeige, wie im 'input'-Handler
        if (AppState.weatherData?.time?.[sliderIndex]) {
            timeToDisplay = await Utils.getDisplayTime(AppState.weatherData.time[sliderIndex], AppState.lastLat, AppState.lastLng);
        } else if (AppState.ensembleModelsData && Object.keys(AppState.ensembleModelsData).length > 0) {
            const firstEnsembleModelName = Object.keys(AppState.ensembleModelsData)[0];
            const ensembleTimeArray = AppState.ensembleModelsData[firstEnsembleModelName]?.time;
            if (ensembleTimeArray?.[sliderIndex]) {
                timeToDisplay = await Utils.getDisplayTime(ensembleTimeArray[sliderIndex], AppState.lastLat, AppState.lastLng);
            }
        }
        const selectedTimeElement = document.getElementById('selectedTime');
        if (selectedTimeElement) {
            selectedTimeElement.innerHTML = `Selected Time: ${timeToDisplay}`;
            console.log('Time slider change event, updated selectedTime label to:', timeToDisplay);
        }
        // Die Haupt-Aktualisierungslogik ist bereits im 'input'-Event.
        // Zusätzliche Aktionen nach dem Loslassen könnten hier platziert werden.
    });
}

function setupModelSelectEvents() {
    const modelSelect = document.getElementById('modelSelect');
    if (!modelSelect) {
        console.warn('modelSelect element not found');
        return;
    }

    // Function to initialize modelSelect with stored value
    const initializeModelSelect = () => {
        const storedModel = Settings.state.userSettings.model;
        const options = Array.from(modelSelect.options).map(option => option.value);
        console.log('modelSelect options during initialization:', options);
        if (storedModel && options.includes(storedModel)) {
            modelSelect.value = storedModel;
            console.log(`Initialized modelSelect to stored value: ${storedModel}`);
            return true; // Stop polling when stored model is found
        } else {
            console.log(`Stored model ${storedModel} not found in options, keeping current value: ${modelSelect.value}`);
            return false; // Continue polling
        }
    };

    // Initial attempt to set modelSelect
    initializeModelSelect();

    // Poll for options until the stored model is found or timeout
    const maxAttempts = 20; // 10 seconds
    let attempts = 0;
    const pollInterval = setInterval(() => {
        if (initializeModelSelect() || attempts >= maxAttempts) {
            clearInterval(pollInterval);
            console.log(`Stopped polling for modelSelect options after ${attempts} attempts`);
            if (attempts >= maxAttempts && !Array.from(modelSelect.options).some(opt => opt.value === Settings.state.userSettings.model)) {
                console.warn(`Timeout: Stored model ${Settings.state.userSettings.model} never found, keeping ${modelSelect.value}`);
            }
        } else {
            attempts++;
            console.log(`Polling attempt ${attempts}: modelSelect options`, Array.from(modelSelect.options).map(opt => opt.value));
        }
    }, 500);

    // Observe changes to modelSelect's parent container
    const parentContainer = modelSelect.parentElement || document.body;
    const observer = new MutationObserver(() => {
        console.log('modelSelect or parent DOM changed, reinitializing');
        initializeModelSelect();
    });
    observer.observe(parentContainer, { childList: true, subtree: true });

    // Handle changes
    modelSelect.addEventListener('change', async () => {
        console.log('Model select changed to:', modelSelect.value);

        // Speichere die neue Modellauswahl direkt in den Einstellungen
        Settings.state.userSettings.model = modelSelect.value;
        Settings.save();

        if (AppState.lastLat && AppState.lastLng) {
            // Behalte die aktuell ausgewählte Zeit bei
            const currentIndex = getSliderValue();
            const currentTime = AppState.weatherData?.time?.[currentIndex] || null;

            // Rufe die zentrale Funktion auf, die den gesamten Prozess steuert
            await fetchWeatherForLocation(AppState.lastLat, AppState.lastLng, currentTime);

        } else {
            Utils.handleError('Please select a position on the map first.');
        }
    });
}

function setupRadioEvents() {
    setupRadioGroup('refLevel', () => {
        Settings.updateUnitLabels();

        updateAllDisplays();
    });
    setupRadioGroup('heightUnit', () => {
        Settings.updateUnitLabels();
        updateAllDisplays();
        if (AppState.lastMouseLatLng && AppState.coordsControl) {
            const coordFormat = getCoordinateFormat();
            const lat = AppState.lastMouseLatLng.lat;
            const lng = AppState.lastMouseLatLng.lng;
            let coordText;
            if (coordFormat === 'MGRS') {
                const mgrs = Utils.decimalToMgrs(lat, lng);
                coordText = `MGRS: ${mgrs}`;
            } else {
                coordText = `Lat: ${lat.toFixed(5)}, Lng: ${lng.toFixed(5)}`;
            }
            debouncedGetElevationAndQFE(lat, lng, { lat, lng }, (elevation, requestLatLng) => {
                if (AppState.lastMouseLatLng) {
                    const deltaLat = Math.abs(AppState.lastMouseLatLng.lat - requestLatLng.lat);
                    const deltaLng = Math.abs(AppState.lastMouseLatLng.lng - requestLatLng.lng);
                    const threshold = 0.05;
                    if (deltaLat < threshold && deltaLng < threshold) {
                        const heightUnit = getHeightUnit();
                        let displayElevation = elevation === 'N/A' ? 'N/A' : elevation;
                        if (displayElevation !== 'N/A') {
                            displayElevation = Utils.convertHeight(displayElevation, heightUnit);
                            displayElevation = Math.round(displayElevation);
                        }
                        console.log('Updating elevation display after heightUnit change:', { lat, lng, elevation, heightUnit, displayElevation });
                        coordsControl.update(`${coordText}<br>Elevation: ${displayElevation} ${displayElevation === 'N/A' ? '' : heightUnit}`);
                    }
                }
            });
        }
        if (AppState.gpxLayer && AppState.gpxPoints.length > 0) {
            const groundAltitude = AppState.lastAltitude !== 'N/A' && !isNaN(AppState.lastAltitude) ? parseFloat(AppState.lastAltitude) : null;
            const windUnit = getWindSpeedUnit();
            const heightUnit = getHeightUnit();
            AppState.gpxLayer.eachLayer(layer => {
                if (layer instanceof L.Polyline) {
                    layer.on('mousemove', function (e) {
                        const latlng = e.latlng;
                        let closestPoint = AppState.gpxPoints[0];
                        let minDist = Infinity;
                        let closestIndex = 0;
                        AppState.gpxPoints.forEach((p, index) => {
                            const dist = Math.sqrt(Math.pow(p.lat - latlng.lat, 2) + Math.pow(p.lng - latlng.lng, 2));
                            if (dist < minDist) {
                                minDist = dist;
                                closestPoint = p;
                                closestIndex = index;
                            }
                        });
                        layer.setTooltipContent(getTooltipContent(closestPoint, closestIndex, AppState.gpxPoints, groundAltitude, windUnit, heightUnit)).openTooltip(latlng);
                    });
                }
            });
        }
    });
    setupRadioGroup('temperatureUnit', () => {
        updateAllDisplays();
    });
    setupRadioGroup('windUnit', () => {
        Settings.updateUnitLabels();
        updateAllDisplays();
        if (AppState.gpxLayer && AppState.gpxPoints.length > 0) {
            const groundAltitude = AppState.lastAltitude !== 'N/A' && !isNaN(AppState.lastAltitude) ? parseFloat(AppState.lastAltitude) : null;
            const windUnit = getWindSpeedUnit();
            const heightUnit = getHeightUnit();
            AppState.gpxLayer.eachLayer(layer => {
                if (layer instanceof L.Polyline) {
                    layer.on('mousemove', function (e) {
                        const latlng = e.latlng;
                        let closestPoint = AppState.gpxPoints[0];
                        let minDist = Infinity;
                        let closestIndex = 0;
                        AppState.gpxPoints.forEach((p, index) => {
                            const dist = Math.sqrt(Math.pow(p.lat - latlng.lat, 2) + Math.pow(p.lng - latlng.lng, 2));
                            if (dist < minDist) {
                                minDist = dist;
                                closestPoint = p;
                                closestIndex = index;
                            }
                        });
                        layer.setTooltipContent(getTooltipContent(closestPoint, closestIndex, AppState.gpxPoints, groundAltitude, windUnit, heightUnit)).openTooltip(latlng);
                    });
                }
            });
        }
    });
    setupRadioGroup('timeZone', async () => {
        updateAllDisplays();
    });
    setupRadioGroup('coordFormat', () => {
        // Die fehlerhafte Zeile wurde entfernt.
        // Die Funktion `updateCoordInputs` existiert im `Coordinates`-Modul nicht mehr.

        // Korrekter Aufruf, um das Marker-Popup zu aktualisieren.
        if (AppState.lastLat && AppState.lastLng) {
            refreshMarkerPopup();
        }
    });
    setupRadioGroup('downloadFormat', () => {
        console.log('Download format changed:', getDownloadFormat());
    });
    setupRadioGroup('landingDirection', () => {
        const customLL = document.getElementById('customLandingDirectionLL');
        const customRR = document.getElementById('customLandingDirectionRR');
        const landingDirection = Settings.state.userSettings.landingDirection;
        console.log('landingDirection changed:', { landingDirection, customLL: customLL?.value, customRR: customRR?.value });
        if (customLL) {
            customLL.disabled = landingDirection !== 'LL';
            if (landingDirection === 'LL' && !customLL.value && AppState.landingWindDir !== null) {
                customLL.value = Math.round(AppState.landingWindDir);
                Settings.state.userSettings.customLandingDirectionLL = parseInt(customLL.value);
                Settings.save();
            }
        }
        if (customRR) {
            customRR.disabled = landingDirection !== 'RR';
            if (landingDirection === 'RR' && !customRR.value && AppState.landingWindDir !== null) {
                customRR.value = Math.round(AppState.landingWindDir);
                Settings.state.userSettings.customLandingDirectionRR = parseInt(customRR.value);
                Settings.save();
            }
        }
        updateUIState(); // Ensure UI reflects disabled state
        updateAllDisplays();
    });
    setupRadioGroup('jumpMasterLineTarget', () => {
        Settings.state.userSettings.jumpMasterLineTarget = Settings.getValue('jumpMasterLineTarget', 'radio', 'DIP');
        Settings.save();
        console.log('jumpMasterLineTarget changed:', Settings.state.userSettings.jumpMasterLineTarget);
        if (Settings.state.userSettings.showJumpMasterLine && AppState.liveMarker) {
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
        // Disable HARP if no marker
        const harpRadio = document.querySelector('input[name="jumpMasterLineTarget"][value="HARP"]');
        if (harpRadio) {
            harpRadio.disabled = !AppState.harpMarker || Settings.state.userSettings.harpLat === null || Settings.state.userSettings.harpLng === null;
            console.log('HARP radio button disabled:', harpRadio.disabled);
        }
    });
    // Trigger initial tooltip refresh for heightUnit
    if (AppState.gpxLayer && AppState.gpxPoints.length > 0) {
        const groundAltitude = AppState.lastAltitude !== 'N/A' && !isNaN(AppState.lastAltitude) ? parseFloat(AppState.lastAltitude) : null;
        const windUnit = getWindSpeedUnit();
        const heightUnit = getHeightUnit();
        AppState.gpxLayer.eachLayer(layer => {
            if (layer instanceof L.Polyline) {
                layer.on('mousemove', function (e) {
                    const latlng = e.latlng;
                    let closestPoint = AppState.gpxPoints[0];
                    let minDist = Infinity;
                    let closestIndex = 0;
                    AppState.gpxPoints.forEach((p, index) => {
                        const dist = Math.sqrt(Math.pow(p.lat - latlng.lat, 2) + Math.pow(p.lng - latlng.lng, 2));
                        if (dist < minDist) {
                            minDist = dist;
                            closestPoint = p;
                            closestIndex = index;
                        }
                    });
                    layer.setTooltipContent(getTooltipContent(closestPoint, closestIndex, AppState.gpxPoints, groundAltitude, windUnit, heightUnit)).openTooltip(latlng);
                });
            }
        });
    }


    //Ensemble stuff
    const scenarioRadios = document.querySelectorAll('input[name="ensembleScenario"]');
    scenarioRadios.forEach(radio => {
        radio.addEventListener('change', () => {
            if (radio.checked) {
                Settings.state.userSettings.currentEnsembleScenario = radio.value;
                AppState.currentEnsembleScenario = radio.value; // Auch AppState aktualisieren
                Settings.save();
                console.log('Ensemble scenario changed to:', radio.value);

                // Daten abrufen (falls noch nicht geschehen) und dann visualisieren
                if (Settings.state.userSettings.selectedEnsembleModels.length > 0) {
                    // Prüfen, ob Daten für die ausgewählten Modelle bereits geladen sind
                    const modelsLoaded = Settings.state.userSettings.selectedEnsembleModels.every(
                        m => AppState.ensembleModelsData && AppState.ensembleModelsData[m]
                    );

                    if (!modelsLoaded && radio.value !== 'all_models') { // Min/Mean/Max benötigen alle Modelldaten
                        fetchEnsembleWeatherData(); // processAndVisualizeEnsemble wird am Ende von fetchEnsembleWeatherData aufgerufen
                    } else if (!modelsLoaded && radio.value === 'all_models' && AppState.ensembleModelsData && Object.keys(AppState.ensembleModelsData).length > 0) {
                        // 'all_models' kann auch mit unvollständigen Daten etwas anzeigen
                        processAndVisualizeEnsemble();
                    } else if (modelsLoaded) {
                        processAndVisualizeEnsemble();
                    } else { // Keine Modelle ausgewählt oder Daten fehlen komplett
                        Utils.handleMessage("Please select models and ensure data is fetched.");
                        clearEnsembleVisualizations();
                    }
                } else if (radio.value !== 'all_models') {
                    Utils.handleMessage("Please select models from the 'Ensemble > Models' menu first.");
                    clearEnsembleVisualizations();
                } else { // 'all_models' aber keine Modelle selektiert
                    clearEnsembleVisualizations();
                }
            }
        });
    });

    // Initialisierung des ausgewählten Szenarios beim Laden der Seite
    const initialScenario = Settings.state.userSettings.currentEnsembleScenario || 'all_models';
    const currentScenarioRadio = document.querySelector(`input[name="ensembleScenario"][value="${initialScenario}"]`);
    if (currentScenarioRadio) {
        currentScenarioRadio.checked = true;
        AppState.currentEnsembleScenario = initialScenario; // AppState synchron halten
    }

    // Sicherstellen, dass die ensembleLayerGroup initialisiert ist, wenn die Karte bereit ist
    if (AppState.map && !AppState.ensembleLayerGroup) {
        AppState.ensembleLayerGroup = L.layerGroup().addTo(AppState.map);
    }
}

function setupInputEvents() {
    setupInput('lowerLimit', 'change', 300, (value) => {
        if (AppState.weatherData && AppState.lastLat && AppState.lastLng && AppState.lastAltitude !== 'N/A') calculateMeanWind();
    });
    setupInput('upperLimit', 'change', 300, (value) => {
        if (AppState.weatherData && AppState.lastLat && AppState.lastLng && AppState.lastAltitude !== 'N/A') calculateMeanWind();
    });
    setupInput('openingAltitude', 'change', 300, (value) => {
        if (!isNaN(value) && value >= 500 && value <= 15000) {
            if (Settings.state.userSettings.calculateJump && AppState.weatherData && AppState.lastLat && AppState.lastLng) {
                debouncedCalculateJump(); // Use debounced version
                JumpPlanner.calculateCutAway();
            }
        } else {
            Utils.handleError('Opening altitude must be between 500 and 15000 meters.');
            setInputValue('openingAltitude', 1200);
            Settings.state.userSettings.openingAltitude = 1200;
            Settings.save();
        }
    });
    setupInput('exitAltitude', 'change', 300, (value) => {
        if (!isNaN(value) && value >= 500 && value <= 15000) {
            if (Settings.state.userSettings.calculateJump && AppState.weatherData && AppState.lastLat && AppState.lastLng) debouncedCalculateJump(); // Use debounced version
        } else {
            Utils.handleError('Exit altitude must be between 500 and 15000 meters.');
            setInputValue('exitAltitude', 3000);
            Settings.state.userSettings.exitAltitude = 3000;
            Settings.save();
        }
    });
    setupInput('canopySpeed', 'change', 300, (value) => {
        if (!isNaN(value) && value >= 5 && value <= 50) {
            updateAllDisplays();
        } else {
            Utils.handleError('Canopy speed must be between 5 and 50 kt.');
            setInputValue('canopySpeed', 20);
            Settings.state.userSettings.canopySpeed = 20;
            Settings.save();
        }
    });
    setupInput('descentRate', 'change', 300, (value) => {
        if (!isNaN(value) && value >= 1 && value <= 10) {
            updateAllDisplays();
        } else {
            Utils.handleError('Descent rate must be between 1 and 10 m/s.');
            setInputValue('descentRate', 3);
            Settings.state.userSettings.descentRate = 3;
            Settings.save();
        }
    });
    setupInput('interpStepSelect', 'change', 300, (value) => {
        updateAllDisplays();
    });
    setupLegHeightInput('legHeightFinal', 100);
    setupLegHeightInput('legHeightBase', 200);
    setupLegHeightInput('legHeightDownwind', 300);
    setupInput('customLandingDirectionLL', 'input', 100, (value) => {
        const customDir = parseInt(value, 10);
        console.log('customLandingDirectionLL input:', { value, customDir });
        if (!isNaN(customDir) && customDir >= 0 && customDir <= 359) {
            Settings.state.userSettings.customLandingDirectionLL = customDir;
            Settings.save();
            if (Settings.state.userSettings.landingDirection === 'LL' && AppState.weatherData && AppState.lastLat && AppState.lastLng) {
                console.log('Updating landing pattern for LL:', customDir);
                updateLandingPatternDisplay();
                mapManager.recenterMap();
            }
        } else {
            Utils.handleError('Landing direction must be between 0 and 359°.');
            setInputValue('customLandingDirectionLL', Settings.state.userSettings.customLandingDirectionLL || 0);
        }
    });
    setupInput('customLandingDirectionRR', 'input', 100, (value) => {
        const customDir = parseInt(value, 10);
        console.log('customLandingDirectionRR input:', { value, customDir });
        if (!isNaN(customDir) && customDir >= 0 && customDir <= 359) {
            Settings.state.userSettings.customLandingDirectionRR = customDir;
            Settings.save();
            if (Settings.state.userSettings.landingDirection === 'RR' && AppState.weatherData && AppState.lastLat && AppState.lastLng) {
                console.log('Updating landing pattern for RR:', customDir);
                updateLandingPatternDisplay();
                mapManager.recenterMap();
            }
        } else {
            Utils.handleError('Landing direction must be between 0 and 359°.');
            setInputValue('customLandingDirectionRR', Settings.state.userSettings.customLandingDirectionRR || 0);
        }
    });
    setupInput('jumpRunTrackDirection', 'change', 0, (value) => {
        const customDir = parseInt(value, 10);
        console.log('jumpRunTrackDirection change event:', {
            value,
            customDir,
            jumpRunTrackOffset: Settings.state.userSettings.jumpRunTrackOffset
        });
        if (!isNaN(customDir) && customDir >= 0 && customDir <= 359) {
            /*if (Settings.state.userSettings.jumpRunTrackOffset !== 0) {
                console.log('Error: Attempted to rotate jump run track with non-zero offset');
                displayError('jump run track rotation only works at the original position. Reset offset to 0 or rotate before moving.');
                return;
            }*/
            AppState.customJumpRunDirection = customDir;
            console.log('Set custom direction from input:', customDir);
            if (AppState.weatherData && AppState.lastLat && AppState.lastLng) {
                if (Settings.state.userSettings.showJumpRunTrack) {
                    console.log('Updating JRT for custom direction input');
                    updateJumpRunTrackDisplay();
                }
                if (Settings.state.userSettings.calculateJump) {
                    console.log('Recalculating jump for custom JRT direction');
                    debouncedCalculateJump(); // Use debounced version
                    JumpPlanner.calculateCutAway();
                }
            } else {
                console.warn('Cannot update JRT or jump: missing conditions', {
                    weatherData: !!AppState.weatherData,
                    lastLat: AppState.lastLat,
                    lastLng: AppState.lastLng
                });
            }
        } else {
            console.log('Invalid direction input, resetting to calculated');
            Utils.handleError('Jump run direction must be between 0 and 359°.');
            AppState.customJumpRunDirection = null;
            const directionInput = document.getElementById('jumpRunTrackDirection');
            if (directionInput) {
                directionInput.addEventListener('change', () => {
                    const value = parseFloat(directionInput.value);

                    // Prüfen, ob eine gültige Zahl eingegeben wurde
                    if (Number.isFinite(value) && value >= 0 && value <= 359) {
                        Settings.state.userSettings.customJumpRunDirection = value;
                        console.log(`Setting 'customJumpRunDirection' on change to:`, value);
                    } else {
                        // Wenn die Eingabe ungültig ist, zurück zum berechneten Wert
                        Settings.state.userSettings.customJumpRunDirection = null;
                        directionInput.value = ''; // Feld leeren
                        console.log('Invalid direction, resetting to calculated.');
                    }
                    Settings.save();
                    updateJumpRunTrackDisplay();
                });
            }
            if (AppState.weatherData && AppState.lastLat && AppState.lastLng) {
                if (Settings.state.userSettings.showJumpRunTrack) {
                    console.log('Updating JRT for invalid direction input');
                    updateJumpRunTrackDisplay();
                }
                if (Settings.state.userSettings.calculateJump) {
                    console.log('Recalculating jump for reset JRT direction');
                    debouncedCalculateJump(); // Use debounced version
                    JumpPlanner.calculateCutAway();
                }
            }
        }
    });
    setupInput('jumpRunTrackOffset', 'change', 0, (value) => {
        const offset = parseInt(value, 10);
        console.log('jumpRunTrackOffset change event:', { value, offset });
        if (!isNaN(offset) && offset >= -50000 && offset <= 50000 && offset % 100 === 0) {
            Settings.state.userSettings.jumpRunTrackOffset = offset;
            Settings.save();
            if (Settings.state.userSettings.calculateJump && Settings.state.userSettings.showJumpRunTrack && AppState.weatherData && AppState.lastLat && AppState.lastLng) {
                console.log('Updating JRT for offset change');
                updateJumpRunTrackDisplay();
            }
        } else {
            Utils.handleError('Offset must be between -50000 and 50000 in steps of 100.');
            const offsetInput = document.getElementById('jumpRunTrackOffset');
            if (offsetInput) {
                offsetInput.value = 0;
            }
            Settings.state.userSettings.jumpRunTrackOffset = 0;
            Settings.save();
            if (Settings.state.userSettings.calculateJump && Settings.state.userSettings.showJumpRunTrack) {
                console.log('Resetting JRT for invalid offset');
                updateJumpRunTrackDisplay();
            }
        }
    });
    setupInput('jumpRunTrackForwardOffset', 'change', 0, (value) => {
        const offset = parseInt(value, 10);
        console.log('jumpRunTrackForwardOffset change event:', { value, offset });
        if (!isNaN(offset) && offset >= -50000 && offset <= 50000 && offset % 100 === 0) {
            Settings.state.userSettings.jumpRunTrackForwardOffset = offset;
            Settings.save();
            if (Settings.state.userSettings.calculateJump && Settings.state.userSettings.showJumpRunTrack && AppState.weatherData && AppState.lastLat && AppState.lastLng) {
                console.log('Updating JRT for forward offset change');
                updateJumpRunTrackDisplay();
            }
        } else {
            Utils.handleError('Forward offset must be between -50000 and 50000 in steps of 100.');
            const offsetInput = document.getElementById('jumpRunTrackForwardOffset');
            if (offsetInput) {
                offsetInput.value = 0;
            }
            Settings.state.userSettings.jumpRunTrackForwardOffset = 0;
            Settings.save();
            if (Settings.state.userSettings.calculateJump && Settings.state.userSettings.showJumpRunTrack) {
                console.log('Resetting JRT for invalid forward offset');
                updateJumpRunTrackDisplay();
            }
        }
    });
    setupInput('aircraftSpeedKt', 'change', 300, (speed) => {
        const separation = JumpPlanner.getSeparationFromTAS(speed);
        document.getElementById('jumperSeparation').value = separation;
        Settings.state.userSettings.jumperSeparation = separation;
        Settings.state.userSettings.aircraftSpeedKt = parseFloat(speed); // Sicherstellen, dass der Wert gespeichert wird
        Settings.save();
        calculateJump();
        updateJumpRunTrackDisplay();
    });
    setupInput('numberOfJumpers', 'change', 300, (value) => {
        const number = parseFloat(value);
        if (!isNaN(number) && number >= 1 && number <= 50) {
            Settings.state.userSettings.numberOfJumpers = number;
            Settings.save();
            if (Settings.state.userSettings.calculateJump && AppState.weatherData && AppState.lastLat && AppState.lastLng) {
                console.log('Recalculating jump for jumper number change');
                debouncedCalculateJump(); // Use debounced version
                JumpPlanner.calculateCutAway();
            }
        } else {
            Utils.handleError('Jumper number must be between 1 and 50.');
            setInputValue('numberOfJumpers', defaultSettings.numberOfJumpers);
            Settings.state.userSettings.numberOfJumpers = defaultSettings.numberOfJumpers;
            Settings.save();
        }
    });
    setupInput('jumperSeparation', 'change', 300, (value) => {
        const separation = parseFloat(value);
        if (!isNaN(separation) && separation >= 1 && separation <= 50) {
            Settings.state.userSettings.jumperSeparation = separation;
            AppState.isJumperSeparationManual = true; // Mark as manually set
            Settings.save();
            console.log(`jumperSeparation manually set to ${separation}s`);
            if (Settings.state.userSettings.calculateJump && AppState.weatherData && AppState.lastLat && AppState.lastLng) {
                console.log('Recalculating jump for jumper separation change');
                debouncedCalculateJump(); // Use debounced version
                JumpPlanner.calculateCutAway();
            }
        } else {
            Utils.handleError('Jumper separation must be between 1 and 50 seconds.');
            setInputValue('jumperSeparation', defaultSettings.jumperSeparation);
            Settings.state.userSettings.jumperSeparation = defaultSettings.jumperSeparation;
            AppState.isJumperSeparationManual = false; // Reset to auto on invalid input
            Settings.save();
        }
    });
    setupInput('cutAwayAltitude', 'change', 300, (value) => {
        if (!isNaN(value) && value >= 400 && value <= 15000) {
            Settings.state.userSettings.cutAwayAltitude = value;
            Settings.save();

            // Rufe immer die zentrale Funktion zur Neuberechnung auf.
            if (Settings.state.userSettings.showCutAwayFinder && AppState.weatherData && AppState.lastLat && AppState.lastLng) {
                console.log('Recalculating jump for cut-away altitude change');
                calculateJump();
            }
        } else {
            Utils.handleError('Cut away altitude must be between 400 and 15000 meters.');
            setInputValue('cutAwayAltitude', 1000);
            Settings.state.userSettings.cutAwayAltitude = 1000;
            Settings.save();
        }
    });
    setupInput('historicalDatePicker', 'change', 300, (value) => {
        console.log('historicalDatePicker changed to:', value);
        if (AppState.lastLat && AppState.lastLng) {
            fetchWeatherForLocation(AppState.lastLat, AppState.lastLng, value ? `${value}T00:00:00Z` : null);
        } else {
            Utils.handleError('Please select a position on the map first.');
        }
    });
}

function setupDownloadEvents() {
    const downloadButton = document.getElementById('downloadButton');
    if (downloadButton) {
        downloadButton.addEventListener('click', () => {
            const downloadFormat = getDownloadFormat();
            downloadTableAsAscii(downloadFormat);
        });
    }
}

function setupResetButton() {
    const bottomContainer = document.getElementById('bottom-container');
    const resetButton = document.createElement('button');
    resetButton.id = 'resetButton';
    resetButton.textContent = 'Reset Settings';
    resetButton.title = 'Resets all settings to their default values and locks all features';

    const buttonWrapper = document.createElement('div');
    buttonWrapper.id = 'settings-cache-buttons';
    buttonWrapper.className = 'button-wrapper';

    buttonWrapper.appendChild(resetButton);
    bottomContainer.appendChild(buttonWrapper);

    resetButton.addEventListener('click', () => {
        // Reset settings to defaults
        Settings.state.userSettings = { ...Settings.defaultSettings };
        // Reset feature unlock status
        Settings.state.unlockedFeatures = { landingPattern: false, calculateJump: false };
        Settings.state.isLandingPatternUnlocked = false;
        Settings.state.isCalculateJumpUnlocked = false;
        // Clear localStorage
        localStorage.removeItem('unlockedFeatures');
        localStorage.removeItem('upperWindsSettings');
        console.log('Reset feature unlock status:', { isLandingPatternUnlocked: Settings.state.isLandingPatternUnlocked, isCalculateJumpUnlocked: Settings.state.isCalculateJumpUnlocked, unlockedFeatures: Settings.state.unlockedFeatures });
        // Save and reinitialize settings
        Settings.save();
        Settings.initialize();
        console.log('Settings reset to defaults:', Settings.state.userSettings);

        // Update UI to reflect locked state
        const landingPatternCheckbox = document.getElementById('showLandingPattern');
        if (landingPatternCheckbox) {
            landingPatternCheckbox.checked = false;
            landingPatternCheckbox.style.opacity = '0.5';
            landingPatternCheckbox.title = 'Feature locked. Click to enter password.';
            console.log('Updated landingPatternCheckbox UI: locked');
        }
        const calculateJumpMenuItem = document.getElementById('calculateJumpCheckbox');
        if (calculateJumpMenuItem) {
            calculateJumpMenuItem.checked = false;
            calculateJumpMenuItem.style.opacity = '0.5';
            calculateJumpMenuItem.title = 'Feature locked. Click to enter password.';
            // Hide submenu
            const submenu = calculateJumpMenuItem.parentElement.nextElementSibling;
            if (submenu && submenu.classList.contains('submenu')) {
                submenu.classList.add('hidden');
                console.log('Hid calculateJump submenu');
            }
        }

        // Reinitialize UI elements
        initializeUIElements();
        console.log('Reinitialized UI elements after reset');

        // Trigger tile caching if position is available
        if (AppState.lastLat && AppState.lastLng) {
            cacheTilesForDIP({ map: AppState.map, lastLat: AppState.lastLat, lastLng: AppState.lastLng, baseMaps: AppState.baseMaps });
            console.log('Triggered tile caching after reset');
        }

        Utils.handleMessage('Settings and feature locks reset to default values.');
    });
}

function setupClearHistoricalDate() {
    const clearButton = document.getElementById('clearHistoricalDate');
    if (clearButton) {
        clearButton.addEventListener('click', () => {
            const datePicker = document.getElementById('historicalDatePicker');
            if (datePicker) {
                datePicker.value = '';
                console.log('Cleared historical date, refetching forecast data');
                if (AppState.lastLat && AppState.lastLng) {
                    fetchWeatherForLocation(AppState.lastLat, AppState.lastLng, null);
                    // Re-enable autoupdate if previously enabled
                    if (Settings.state.userSettings.autoupdate) {
                        startAutoupdate();
                    }
                } else {
                    Utils.handleError('Please select a position on the map first.');
                }
            }
        });
    }

    // Add listener for historical date changes
    const datePicker = document.getElementById('historicalDatePicker');
    if (datePicker) {
        datePicker.addEventListener('change', () => {
            if (datePicker.value && Settings.state.userSettings.autoupdate) {
                console.log('Historical date set, disabling autoupdate');
                stopAutoupdate();
                document.getElementById('autoupdateCheckbox').checked = false;
                Settings.state.userSettings.autoupdate = false;
                Settings.save();
                Utils.handleMessage('Autoupdate disabled due to historical date selection.');
            }
            if (AppState.lastLat && AppState.lastLng) {
                fetchWeatherForLocation(AppState.lastLat, AppState.lastLng, datePicker.value);
            } else {
                Utils.handleError('Please select a position on the map first.');
            }
        });
    }
}
function setupCoordinateEvents() {
    Coordinates.initializeLocationSearch();
    console.log("Coordinate events setup complete.");
}
function setupCutawayRadioButtons() {
    const cutAwayRadios = document.querySelectorAll('input[name="cutAwayState"]');
    if (cutAwayRadios.length === 0) return;

    // Set the initial state from saved settings
    const currentSetting = Settings.state.userSettings.cutAwayState || 'Partially';
    const activeRadio = document.querySelector(`input[name="cutAwayState"][value="${currentSetting}"]`);
    if (activeRadio) {
        activeRadio.checked = true;
    }

    // Add event listeners
    cutAwayRadios.forEach(radio => {
        radio.addEventListener('change', () => {
            if (radio.checked) {
                console.log(`Cut Away State changed to: ${radio.value}`);

                // 1. Save the new setting
                Settings.state.userSettings.cutAwayState = radio.value;
                Settings.save();

                // 2. Trigger the recalculation and redraw
                if (AppState.weatherData && AppState.lastLat && AppState.lastLng && Settings.state.userSettings.calculateJump) {
                    calculateJump();
                }
            }
        });
    });
}
function setupJumpRunTrackEvents() {
    console.log("App: Richte Event-Listener für Track-Einstellungen ein.");

    const setupInput = (inputId, settingName) => {
        const element = document.getElementById(inputId);
        if (element) {
            // Setze den Initialwert basierend auf Settings
            element.value = Settings.state.userSettings[settingName] || 0;
            console.log(`Set ${inputId} to initial value:`, element.value);
            element.addEventListener('input', () => {
                const value = parseFloat(element.value);
                if (isNaN(value)) return;
                Settings.state.userSettings[settingName] = value;
                Settings.save();
                updateJumpRunTrackDisplay();
            });
        }
    };

    setupInput('numberOfJumpers', 'numberOfJumpers');
    setupInput('jumperSeparation', 'jumperSeparation');
    setupInput('jumpRunTrackOffset', 'jumpRunTrackOffset');
    setupInput('jumpRunTrackForwardOffset', 'jumpRunTrackForwardOffset');

    const directionInput = document.getElementById('jumpRunTrackDirection');
    if (directionInput) {
        directionInput.value = Settings.state.userSettings.customJumpRunDirection || '';
        directionInput.addEventListener('change', () => {
            const value = parseFloat(directionInput.value);
            if (Number.isFinite(value) && value >= 0 && value <= 359) {
                Settings.state.userSettings.customJumpRunDirection = value;
                console.log(`Setting 'customJumpRunDirection' on change to:`, value);
            } else {
                Settings.state.userSettings.customJumpRunDirection = null;
                directionInput.value = '';
                console.log('Invalid direction, resetting to calculated.');
            }
            Settings.save();
            updateJumpRunTrackDisplay();
        });
    }

    const showTrackCheckbox = document.getElementById('showJumpRunTrack');
    if (showTrackCheckbox) {
        showTrackCheckbox.addEventListener('change', (e) => {
            Settings.state.userSettings.showJumpRunTrack = e.target.checked;
            Settings.save();
            updateJumpRunTrackDisplay();
        });
    }
}
function setupMapEventListeners() {
    console.log("App: Richte Event-Listener für Karten-Events ein.");

    document.addEventListener('map:location_selected', async (event) => {
        const { lat, lng, source } = event.detail;
        console.log(`App: Event 'map:location_selected' von '${source}' empfangen.`);

        // --- HIER IST JETZT DIE GESAMTE ANWENDUNGSLOGIK ---

        // 1. Marker-Position im AppState und UI aktualisieren
        AppState.lastLat = lat;
        AppState.lastLng = lng;
        AppState.lastAltitude = await Utils.getAltitude(lat, lng);

        // Informiere das Coordinates-Modul über die neue Position
        Coordinates.updateCurrentMarkerPosition(lat, lng);
        Coordinates.addCoordToHistory(lat, lng);

        // Bewege den Marker (falls die Aktion nicht schon vom Marker selbst kam)
        if (source !== 'marker_drag') {
            // Annahme: Sie haben eine moveMarker-Funktion im mapManager
            // Dies ist ein Befehl von app.js an mapManager.js
            mapManager.moveMarker(lat, lng);
        }

        // 2. Kernlogik ausführen
        resetJumpRunDirection(true); // resetJumpRunDirection muss in app.js sein
        await fetchWeatherForLocation(lat, lng); // fetchWeather... muss in app.js sein

        if (Settings.state.userSettings.calculateJump) {
            calculateJump(); // calculateJump muss in app.js sein
            JumpPlanner.calculateCutAway();
        }

        mapManager.recenterMap(true); // recenterMap ist jetzt im mapManager
        AppState.isManualPanning = false;

        // 3. UI-Updates anstoßen, die von den neuen Daten abhängen
        updateJumpRunTrackDisplay(); // update... Funktionen sind jetzt im mapManager
        updateLandingPatternDisplay();
    });

    document.addEventListener('map:mousemove', (event) => {
        const { lat, lng } = event.detail;
        AppState.lastMouseLatLng = { lat, lng }; // Position für den Callback speichern

        const coordFormat = getCoordinateFormat();
        let coordText;

        // Koordinaten-Text korrekt formatieren
        if (coordFormat === 'MGRS') {
            const mgrsVal = Utils.decimalToMgrs(lat, lng);
            coordText = `MGRS: ${mgrsVal || 'N/A'}`;
        } else if (coordFormat === 'DMS') {
            const formatDMS = (dms) => `${dms.deg}°${dms.min}'${dms.sec.toFixed(0)}" ${dms.dir}`;
            coordText = `Lat: ${formatDMS(Utils.decimalToDms(lat, true))}, Lng: ${formatDMS(Utils.decimalToDms(lng, false))}`;
        } else {
            coordText = `Lat: ${lat.toFixed(5)}, Lng: ${lng.toFixed(5)}`;
        }

        // Sofortiges Update mit "Fetching..."
        if (AppState.coordsControl) {
            AppState.coordsControl.update(`${coordText}<br>Elevation: Fetching...<br>QFE: Fetching...`);
        }

        // Debounced-Funktion aufrufen, um API-Anfragen zu begrenzen
        debouncedGetElevationAndQFE(lat, lng, { lat, lng }, ({ elevation, qfe }, requestLatLng) => {
            // Callback wird ausgeführt, wenn die Daten da sind
            if (AppState.lastMouseLatLng && AppState.coordsControl) {
                // Nur aktualisieren, wenn die Maus noch in der Nähe ist
                const deltaLat = Math.abs(AppState.lastMouseLatLng.lat - requestLatLng.lat);
                const deltaLng = Math.abs(AppState.lastMouseLatLng.lng - requestLatLng.lng);
                const threshold = 0.05;

                if (deltaLat < threshold && deltaLng < threshold) {
                    const heightUnit = getHeightUnit();
                    let displayElevation = elevation === 'N/A' ? 'N/A' : elevation;
                    if (displayElevation !== 'N/A') {
                        displayElevation = Utils.convertHeight(displayElevation, heightUnit);
                        displayElevation = Math.round(displayElevation);
                    }
                    const qfeText = qfe === 'N/A' ? 'N/A' : `${qfe} hPa`;
                    AppState.coordsControl.update(`${coordText}<br>Elevation: ${displayElevation} ${displayElevation === 'N/A' ? '' : heightUnit}<br>QFE: ${qfeText}`);
                }
            }
        });
    });
}
function setupMenuItemEvents() {
    console.log("setupMenuItemEvents wird aufgerufen für 'Calculate Jump'.");
    const calculateJumpMenuItem = Array.from(document.querySelectorAll('.menu-label'))
        .find(item => item.textContent.trim() === 'Calculate Jump');

    if (!calculateJumpMenuItem) {
        console.error('Calculate Jump menu item not found');
        return;
    }

    const submenu = calculateJumpMenuItem.closest('li').querySelector('ul.submenu');

    const setVisualLockState = () => {
        if (Settings.isFeatureUnlocked('calculateJump')) {
            calculateJumpMenuItem.style.opacity = '1';
            calculateJumpMenuItem.title = 'Click to open/close jump calculation settings';
        } else {
            calculateJumpMenuItem.style.opacity = '0.5';
            calculateJumpMenuItem.title = 'Feature locked. Click to enter password.';
            if (submenu) submenu.classList.add('hidden');
        }
    };

    setVisualLockState(); // Setzt den initialen Zustand

    calculateJumpMenuItem.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();

        if (Settings.isFeatureUnlocked('calculateJump')) {
            if (submenu) submenu.classList.toggle('hidden');
        } else {
            Settings.showPasswordModal('calculateJump',
                () => { // onSuccess
                    setVisualLockState();
                    if (submenu) submenu.classList.remove('hidden');
                },
                () => { // onCancel
                    setVisualLockState();
                }
            );
        }
    });
}
function setupResetCutAwayMarkerButton() {
    const resetButton = document.getElementById('resetCutAwayMarker');
    if (resetButton) {
        resetButton.addEventListener('click', () => {
            if (!AppState.map) {
                console.warn('Map not initialized, cannot reset cut-away marker');
                return;
            }
            if (AppState.cutAwayMarker) {
                AppState.map.removeLayer(AppState.cutAwayMarker);
                AppState.cutAwayMarker = null;
                AppState.cutAwayLat = null;
                AppState.cutAwayLng = null;
                console.log('Cut-away marker reset');
                if (AppState.cutAwayCircle) {
                    AppState.map.removeLayer(AppState.cutAwayCircle);
                    AppState.cutAwayCircle = null;
                    console.log('Cleared cut-away circle');
                }
                document.getElementById('info').innerHTML = 'Right-click map to place cut-away marker';
            }
        });
    }
}
function setupTrackEvents() {
    console.log('[app.js] Setting up track events');
    const trackFileInput = document.getElementById('trackFileInput');
    const loadingElement = document.getElementById('loading'); // Deklarieren wir die Variable hier einmal zentral.

    if (trackFileInput) {
        trackFileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];

            // 1. Spinner hier anzeigen, wenn eine Datei ausgewählt wird.
            if (loadingElement) {
                loadingElement.style.display = 'block';
            }

            if (!file) {
                Utils.handleError('No file selected.');
                if (loadingElement) loadingElement.style.display = 'none'; // Bei Fehler sofort ausblenden
                return;
            }

            const extension = file.name.split('.').pop().toLowerCase();
            let trackMetaData = null;

            try {
                if (extension === 'gpx') {
                    trackMetaData = await loadGpxTrack(file);
                } else if (extension === 'csv') {
                    trackMetaData = await loadCsvTrackUTC(file);
                } else {
                    Utils.handleError('Unsupported file type. Please upload a .gpx or .csv file.');
                    if (loadingElement) loadingElement.style.display = 'none'; // Bei Fehler sofort ausblenden
                }
            } catch (error) {
                console.error('Error during track file processing:', error);
                Utils.handleError('Failed to process track file.');
                if (loadingElement) loadingElement.style.display = 'none'; // Bei Fehler sofort ausblenden
            }
        });
    }

    const clearTrackButton = document.getElementById('clearTrack');
    if (clearTrackButton) {
        clearTrackButton.addEventListener('click', () => {
            if (!AppState.map) { Utils.handleError('Cannot clear track: map not initialized.'); return; }
            if (AppState.gpxLayer) {
                try {
                    if (AppState.map.hasLayer(AppState.gpxLayer)) AppState.map.removeLayer(AppState.gpxLayer);
                    AppState.gpxLayer = null; AppState.gpxPoints = []; AppState.isTrackLoaded = false;
                    const infoElement = document.getElementById('info');
                    if (infoElement) {
                        const modelDisplayRegex = /(<br><strong>Available Models:<\/strong><ul>.*?<\/ul>|<br><strong>Available Models:<\/strong> None)/s;
                        const currentInfoHTML = infoElement.innerHTML;
                        const modelInfoMatch = currentInfoHTML.match(modelDisplayRegex);
                        infoElement.innerHTML = 'Click on the map to fetch weather data.' + (modelInfoMatch ? modelInfoMatch[0] : '');
                    }
                    if (trackFileInput) trackFileInput.value = '';
                } catch (error) { Utils.handleError('Failed to clear track: ' + error.message); }
            } else { Utils.handleMessage('No track to clear.'); }
        });
    }

    // Listener für das "track:loaded"-Event
    if (AppState.map) {
        AppState.map.getContainer().addEventListener('track:loaded', async (event) => {
            // Die Variable `loadingElement` ist hier jetzt dank der Deklaration oben verfügbar.
            try {
                const { lat, lng, timestamp, historicalDate, summary } = event.detail;
                console.log('Event "track:loaded" empfangen, starte Aktionen.');

                await mapManager.createOrUpdateMarker(lat, lng);

                // 2. WICHTIG: Wir WARTEN hier, bis der langsame Wetterabruf komplett fertig ist.
                await fetchWeatherForLocation(lat, lng, timestamp);

                // Erst danach die restlichen UI-Updates durchführen
                if (Settings.state.isCalculateJumpUnlocked && Settings.state.userSettings.calculateJump) calculateJump();
                if (Settings.state.isLandingPatternUnlocked && Settings.state.userSettings.showLandingPattern) updateLandingPatternDisplay();

                const infoEl = document.getElementById('info');
                if (infoEl && summary) {
                    const modelDisplayRegex = /(<br><strong>Available Models:<\/strong><ul>.*?<\/ul>|<br><strong>Available Models:<\/strong> None)/s;
                    const modelInfoMatch = infoEl.innerHTML.match(modelDisplayRegex);
                    infoEl.innerHTML = summary + (modelInfoMatch ? modelInfoMatch[0] : '');
                }

                if (historicalDate) {
                    const historicalDatePicker = document.getElementById('historicalDatePicker');
                    if (historicalDatePicker) historicalDatePicker.value = historicalDate;
                }

            } catch (error) {
                console.error('Fehler bei der Verarbeitung von track:loaded:', error);
                Utils.handleError('Konnte Track-Daten nicht vollständig verarbeiten.');
            } finally {
                // 3. Der Spinner wird jetzt zuverlässig GANZ AM ENDE ausgeblendet.
                if (loadingElement) {
                    loadingElement.style.display = 'none';
                }
            }
        });
    }
}

// HAUPT-INITIALISIERUNGSFUNKTION
export function initializeEventListeners() {
    console.log("Initializing all UI event listeners...");
    setupMenuEvents();
    setupCheckboxEvents();
    setupSliderEvents();
    setupModelSelectEvents();
    setupRadioEvents();
    setupInputEvents();
    setupDownloadEvents();
    setupTrackEvents();
    setupResetButton();
    setupClearHistoricalDate();
    setupCoordinateEvents();
    setupCutawayRadioButtons();
    setupJumpRunTrackEvents();
    setupMapEventListeners();
    setupMenuItemEvents();
    setupResetCutAwayMarkerButton();
}