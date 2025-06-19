// eventManager.js
"use strict";

import { AppState } from './state.js';
import { Settings } from './settings.js';
import { Utils } from './utils.js';
import { updateUIState } from './app.js';
import {
    updateAllDisplays, calculateJump, updateUIWithNewWeatherData,
    downloadTableAsAscii, calculateMeanWind, calculateJumpRunTrack,
    debouncedGetElevationAndQFE, getDownloadFormat, updateJumpMasterLineAndPanel,
    validateLegHeights, debouncedCalculateJump, applySettingToInput, setInputValueSilently
} from './app.js';
import * as displayManager from './displayManager.js';
import * as mapManager from './mapManager.js';
import * as Coordinates from './coordinates.js';
import * as JumpPlanner from './jumpPlanner.js';
import { TileCache, cacheTilesForDIP } from './tileCache.js';
import { loadGpxTrack, loadCsvTrackUTC } from './trackManager.js';
import * as weatherManager from './weatherManager.js';
import * as liveTrackingManager from './liveTrackingManager.js';
import { fetchEnsembleWeatherData, processAndVisualizeEnsemble, clearEnsembleVisualizations } from './ensembleManager.js';
import { getSliderValue } from './ui.js';
import * as AutoupdateManager from './autoupdateManager.js';
import 'leaflet-gpx';

let listenersInitialized = false; 

function dispatchAppEvent(eventName, detail = {}) {
    console.log(`[EventManager] Dispatching event: ${eventName}`, detail);
    const event = new CustomEvent(eventName, { detail, bubbles: true, cancelable: true });
    document.dispatchEvent(event);
}

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
            displayManager.updateWeatherDisplay(getSliderValue());
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
            displayManager.updateLandingPatternDisplay();
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

    const showJumpMasterLineCheckbox = document.getElementById('showJumpMasterLine');
    if (showJumpMasterLineCheckbox) {
        // Initialen Zustand setzen (wird von app.js gesteuert, aber wir sichern es hier ab)
        showJumpMasterLineCheckbox.disabled = !Settings.state.userSettings.trackPosition;
        showJumpMasterLineCheckbox.style.opacity = showJumpMasterLineCheckbox.disabled ? '0.5' : '1';

        showJumpMasterLineCheckbox.addEventListener('change', () => {
            const isChecked = showJumpMasterLineCheckbox.checked;

            if (isChecked && showJumpMasterLineCheckbox.disabled) {
                showJumpMasterLineCheckbox.checked = false;
                Utils.handleError('Please start Live Tracking first.');
                return;
            }

            Settings.state.userSettings.showJumpMasterLine = isChecked;
            Settings.save();
            dispatchAppEvent('ui:showJumpMasterLineChanged', { isChecked });

            // --- START DER ERWEITERUNG ---
            // Finde das zugehörige Submenü
            const submenu = showJumpMasterLineCheckbox.closest('li')?.querySelector('ul.submenu');

            // Rufe die Hilfsfunktion auf, um das Menü basierend auf dem Status der Checkbox ein- oder auszublenden
            if (submenu) {
                toggleSubmenu(showJumpMasterLineCheckbox, submenu, isChecked);
            }
            // --- ENDE DER ERWEITERUNG ---
        });
    }

    const trackPositionCheckbox = document.getElementById('trackPositionCheckbox');
    if (trackPositionCheckbox) {
        trackPositionCheckbox.addEventListener('change', () => {
            const isChecked = trackPositionCheckbox.checked;
            Settings.state.userSettings.trackPosition = isChecked;
            Settings.save();

            if (isChecked) {
                liveTrackingManager.startPositionTracking();
            } else {
                liveTrackingManager.stopPositionTracking();
            }
        });
    }

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
            AppState.map.on('click', mapManager.handleHarpPlacement); // Use imported function
            Utils.handleMessage('Click the map to place the HARP marker');
        });
    }

    const clearHarpButton = document.getElementById('clearHarpButton');
    if (clearHarpButton) {
        clearHarpButton.addEventListener('click', mapManager.clearHarpMarker); // Use imported function
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
            await displayManager.updateWeatherDisplay(sliderIndex);
            await displayManager.refreshMarkerPopup();
            if (AppState.lastAltitude !== 'N/A') calculateMeanWind();
            if (Settings.state.userSettings.showLandingPattern) {
                console.log('Updating landing pattern for slider index:', sliderIndex);
                displayManager.updateLandingPatternDisplay();
            }
            if (Settings.state.userSettings.calculateJump) {
                console.log('Recalculating jump for slider index:', sliderIndex);
                calculateJump();
                JumpPlanner.calculateCutAway();
            }
            if (Settings.state.userSettings.showJumpRunTrack) {
                console.log('Updating jump run track for slider index:', sliderIndex);
                displayManager.updateJumpRunTrackDisplay();
            }
            //mapManager.recenterMap();
            updateJumpMasterLineAndPanel();
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

    modelSelect.addEventListener('change', async () => {
        console.log('Model select changed to:', modelSelect.value);

        Settings.state.userSettings.model = modelSelect.value;
        Settings.save();

        if (AppState.lastLat && AppState.lastLng) {
            const currentIndex = getSliderValue();
            const currentTime = AppState.weatherData?.time?.[currentIndex] || null;

            const newWeatherData = await weatherManager.fetchWeatherForLocation(AppState.lastLat, AppState.lastLng, currentTime);
            if (newWeatherData) {
                await updateUIWithNewWeatherData(newWeatherData);
            }

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
        updateJumpMasterLineAndPanel();
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
                        AppState.coordsControl.update(`${coordText}<br>Elevation: ${displayElevation} ${displayElevation === 'N/A' ? '' : heightUnit}`);
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
        updateJumpMasterLineAndPanel(); // <-- HINZUFÜGEN
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
        if (AppState.lastLat && AppState.lastLng) {
            displayManager.refreshMarkerPopup();
        }
        updateJumpMasterLineAndPanel(); // <-- HINZUFÜGEN
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

        // --- START DER KORREKTUR ---
        // Problem: Direkter Aufruf von debouncedPositionUpdate(...) war hier und verursachte den Fehler.
        // Lösung: Stattdessen ein Event auslösen, auf das app.js lauschen kann.
        dispatchAppEvent('jml:targetChanged');
        // --- ENDE DER KORREKTUR ---

        // Der restliche Teil der Funktion (HARP Radio-Button deaktivieren) bleibt unverändert.
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
            applySettingToInput('openingAltitude', 1200);
            Settings.state.userSettings.openingAltitude = 1200;
            Settings.save();
        }
    });
    setupInput('exitAltitude', 'change', 300, (value) => {
        if (!isNaN(value) && value >= 500 && value <= 15000) {
            if (Settings.state.userSettings.calculateJump && AppState.weatherData && AppState.lastLat && AppState.lastLng) debouncedCalculateJump(); // Use debounced version
        } else {
            Utils.handleError('Exit altitude must be between 500 and 15000 meters.');
            applySettingToInput('exitAltitude', 3000);
            Settings.state.userSettings.exitAltitude = 3000;
            Settings.save();
        }
    });
    setupInput('canopySpeed', 'change', 300, (value) => {
        if (!isNaN(value) && value >= 5 && value <= 50) {
            updateAllDisplays();
        } else {
            Utils.handleError('Canopy speed must be between 5 and 50 kt.');
            applySettingToInput('canopySpeed', 20);
            Settings.state.userSettings.canopySpeed = 20;
            Settings.save();
        }
    });
    setupInput('descentRate', 'change', 300, (value) => {
        if (!isNaN(value) && value >= 1 && value <= 10) {
            updateAllDisplays();
        } else {
            Utils.handleError('Descent rate must be between 1 and 10 m/s.');
            applySettingToInput('descentRate', 3);
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
                displayManager.updateLandingPatternDisplay();
                mapManager.recenterMap();
            }
        } else {
            Utils.handleError('Landing direction must be between 0 and 359°.');
            applySettingToInput('customLandingDirectionLL', Settings.state.userSettings.customLandingDirectionLL || 0);
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
                displayManager.updateLandingPatternDisplay();
                mapManager.recenterMap();
            }
        } else {
            Utils.handleError('Landing direction must be between 0 and 359°.');
            applySettingToInput('customLandingDirectionRR', Settings.state.userSettings.customLandingDirectionRR || 0);
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
                    displayManager.updateJumpRunTrackDisplay();
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
                    displayManager.updateJumpRunTrackDisplay();
                });
            }
            if (AppState.weatherData && AppState.lastLat && AppState.lastLng) {
                if (Settings.state.userSettings.showJumpRunTrack) {
                    console.log('Updating JRT for invalid direction input');
                    displayManager.updateJumpRunTrackDisplay();
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
                displayManager.updateJumpRunTrackDisplay();
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
                displayManager.updateJumpRunTrackDisplay();
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
                displayManager.updateJumpRunTrackDisplay();
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
                displayManager.updateJumpRunTrackDisplay();
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
        displayManager.updateJumpRunTrackDisplay();
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
            applySettingToInput('numberOfJumpers', defaultSettings.numberOfJumpers);
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
            applySettingToInput('jumperSeparation', defaultSettings.jumperSeparation);
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
            applySettingToInput('cutAwayAltitude', 1000);
            Settings.state.userSettings.cutAwayAltitude = 1000;
            Settings.save();
        }
    });
    setupInput('historicalDatePicker', 'change', 300, (value) => {
        console.log('historicalDatePicker changed to:', value);
        if (AppState.lastLat && AppState.lastLng) {
            // *** KORREKTUR HIER ***
            weatherManager.fetchWeatherForLocation(AppState.lastLat, AppState.lastLng, value ? `${value}T00:00:00Z` : null).then(newWeatherData => {
                if (newWeatherData) {
                    AppState.weatherData = newWeatherData;
                    updateAllDisplays();
                }
            });
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

function setupClearHistoricalDate() {
    const clearButton = document.getElementById('clearHistoricalDate');
    if (clearButton) {
        clearButton.addEventListener('click', () => {
            const datePicker = document.getElementById('historicalDatePicker');
            if (datePicker) {
                datePicker.value = ''; // Datum leeren
                console.log('Cleared historical date, refetching forecast data');
                if (AppState.lastLat && AppState.lastLng) {
                    // *** KORREKTUR HIER ***
                    // Lade die aktuellen (nicht-historischen) Wetterdaten neu
                    weatherManager.fetchWeatherForLocation(AppState.lastLat, AppState.lastLng, null).then(newWeatherData => {
                        if (newWeatherData) {
                            AppState.weatherData = newWeatherData;
                            updateAllDisplays();
                        }
                    });
                }
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
                displayManager.updateJumpRunTrackDisplay();
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
            displayManager.updateJumpRunTrackDisplay();
        });
    }

    const showTrackCheckbox = document.getElementById('showJumpRunTrack');
    if (showTrackCheckbox) {
        showTrackCheckbox.addEventListener('change', (e) => {
            Settings.state.userSettings.showJumpRunTrack = e.target.checked;
            Settings.save();
            displayManager.updateJumpRunTrackDisplay();
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
        Coordinates.addCoordToHistory(lat, lng);

        // Bewege den Marker (falls die Aktion nicht schon vom Marker selbst kam)
        if (source !== 'marker_drag') {
            // Annahme: Sie haben eine moveMarker-Funktion im mapManager
            // Dies ist ein Befehl von app.js an mapManager.js
            mapManager.moveMarker(lat, lng);
        }

        // 2. Kernlogik ausführen
        resetJumpRunDirection(true); // resetJumpRunDirection muss in app.js sein
        await weatherManager.fetchWeatherForLocation(lat, lng); // fetchWeather... muss in app.js sein

        if (Settings.state.userSettings.calculateJump) {
            calculateJump(); // calculateJump muss in app.js sein
            JumpPlanner.calculateCutAway();
        }

        mapManager.recenterMap(true); // recenterMap ist jetzt im mapManager
        AppState.isManualPanning = false;

        // 3. UI-Updates anstoßen, die von den neuen Daten abhängen
        displayManager.updateJumpRunTrackDisplay(); // update... Funktionen sind jetzt im mapManager
        displayManager.updateLandingPatternDisplay();
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

                // =======================================================
                // HIER DIE NEUE LOGIK EINFÜGEN
                // =======================================================
                if (historicalDate) {
                    console.log("Historischer Track geladen, deaktiviere Autoupdate.");
                    const autoupdateCheckbox = document.getElementById('autoupdateCheckbox');
                    if (autoupdateCheckbox) {
                        autoupdateCheckbox.checked = false;
                    }
                    // Stoppe den laufenden Autoupdate-Prozess
                    AutoupdateManager.stopAutoupdate();
                    // Speichere die neue Einstellung
                    Settings.state.userSettings.autoupdate = false;
                    Settings.save();
                    Utils.handleMessage("Autoupdate disabled for historical track viewing.");
                }
                // =======================================================
                // ENDE DER NEUEN LOGIK
                // =======================================================

                await mapManager.createOrUpdateMarker(lat, lng);

                // 1. Wetterdaten für den historischen Zeitpunkt abrufen
                const newWeatherData = await weatherManager.fetchWeatherForLocation(lat, lng, timestamp);

                if (newWeatherData) {
                    AppState.weatherData = newWeatherData; // Daten im AppState speichern

                    // 2. Den Slider auf den richtigen Zeitpunkt setzen
                    const slider = document.getElementById('timeSlider');
                    if (slider && AppState.weatherData.time) {
                        slider.max = AppState.weatherData.time.length - 1;
                        slider.disabled = slider.max <= 0;

                        // Finde den Index, der am besten zum Track-Zeitstempel passt
                        const targetTimestamp = new Date(timestamp).getTime();
                        let bestIndex = 0;
                        let minDiff = Infinity;
                        AppState.weatherData.time.forEach((time, idx) => {
                            const diff = Math.abs(new Date(time).getTime() - targetTimestamp);
                            if (diff < minDiff) {
                                minDiff = diff;
                                bestIndex = idx;
                            }
                        });
                        slider.value = bestIndex; // Slider positionieren!
                    }
                }
                // HIER ENDET DIE ÄNDERUNG

                // Erst jetzt, nachdem der Slider korrekt steht, die Anzeigen aktualisieren
                await updateAllDisplays();

                // Erst danach die restlichen UI-Updates durchführen
                if (Settings.state.isCalculateJumpUnlocked && Settings.state.userSettings.calculateJump) calculateJump();
                if (Settings.state.isLandingPatternUnlocked && Settings.state.userSettings.showLandingPattern) displayManager.updateLandingPatternDisplay();

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

// HAUPT-INITIALISIERUNGSFUNKTION
export function initializeEventListeners() {
    if (listenersInitialized) {
        return; // Bricht die Funktion sofort ab, wenn sie schon einmal lief
    }
    console.log("Initializing all UI event listeners...");
    setupMenuEvents();
    setupCheckboxEvents();
    setupSliderEvents();
    setupModelSelectEvents();
    setupRadioEvents();
    setupInputEvents();
    setupDownloadEvents();
    setupTrackEvents();
    setupClearHistoricalDate();
    setupCoordinateEvents();
    setupCutawayRadioButtons();
    setupJumpRunTrackEvents();
    setupMapEventListeners();
    setupMenuItemEvents();
    setupResetCutAwayMarkerButton();
    setupCacheManagement();
    setupCacheSettings();
     listenersInitialized = true;
    console.log("Event listeners initialized successfully (first and only time).");
       
}