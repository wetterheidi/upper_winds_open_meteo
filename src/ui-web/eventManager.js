"use strict";

import { AppState } from '../core/state.js';
import { Settings, getInterpolationStep } from '../core/settings.js';
import { Utils } from '../core/utils.js';
import * as JumpPlanner from '../core/jumpPlanner.js';
import * as displayManager from './displayManager.js';
import * as mapManager from './mapManager.js';
import * as Coordinates from '../ui-web/coordinates.js';
import { TileCache, cacheTilesForDIP, cacheVisibleTiles } from '../core/tileCache.js';
import { loadKmlTrack, loadGpxTrack, loadCsvTrackUTC, exportToGpx, exportLandingPatternToGpx } from '../core/trackManager.js';
import { fetchEnsembleWeatherData, processAndVisualizeEnsemble, clearEnsembleVisualizations } from '../core/ensembleManager.js';
import { getSliderValue, displayMessage, hideProgress, displayProgress, displayWarning, toggleLoading } from './ui.js';
import { updateModelSelectUI, cleanupSelectedEnsembleModels } from './ui.js';
import 'leaflet-gpx';
import * as LocationManager from '../core/locationManager.js';
import * as AdsbManager from '../core/adsbManager.js';
import * as weatherManager from '../core/weatherManager.js'; // NEUER IMPORT
import { DateTime } from 'luxon';                         // NEUER IMPORT

// =================================================================
// 1. Globale Variablen & Zustand
// =================================================================

let listenersInitialized = false;

// =================================================================
// 2. Allgemeine Hilfsfunktionen
// =================================================================

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
    } else {
        console.warn(`Checkbox ${id} not found`);
    }
}
function setupRadioGroup(name, callback) {
    const radios = document.querySelectorAll(`input[name="${name}"]`);
    radios.forEach(radio => {
        radio.addEventListener('change', () => {
            // Liest den Wert direkt vom ausgewählten Radio-Button
            const checkedRadio = document.querySelector(`input[name="${name}"]:checked`);
            if (!checkedRadio) return;
            const newValue = checkedRadio.value;

            // Speichert den korrekten neuen Wert
            Settings.state.userSettings[name] = newValue;
            Settings.save();
            console.log(`${name} changed to: ${newValue} and saved to localStorage`);

            // Spezifische Logik für landingDirection kann hier bleiben, da sie die UI steuert
            if (name === 'landingDirection') {
                const customLL = document.getElementById('customLandingDirectionLL');
                const customRR = document.getElementById('customLandingDirectionRR');

                if (customLL) customLL.disabled = newValue !== 'LL';
                if (customRR) customRR.disabled = newValue !== 'RR';

                if (newValue === 'LL' && customLL && !customLL.value && Settings.state.userSettings.customLandingDirectionLL === '') {
                    customLL.value = Math.round(AppState.landingWindDir || 0);
                    Settings.state.userSettings.customLandingDirectionLL = parseInt(customLL.value);
                    Settings.save();
                    console.log(`Set customLandingDirectionLL to ${customLL.value}`);
                }
                if (newValue === 'RR' && customRR && !customRR.value && Settings.state.userSettings.customLandingDirectionRR === '') {
                    customRR.value = Math.round(AppState.landingWindDir || 0);
                    Settings.state.userSettings.customLandingDirectionRR = parseInt(customRR.value);
                    Settings.save();
                    console.log(`Set customLandingDirectionRR to ${customRR.value}`);
                }
            }
            // Event auslösen, um die Anwendung über die Änderung zu informieren
            document.dispatchEvent(new CustomEvent('ui:radioGroupChanged', {
                detail: { name: name, value: newValue }
            }));

            // Optionaler Callback für rein lokale UI-Updates (wie updateUnitLabels)
            if (callback) {
                callback();
            }
        });
    });
}
function setupInput(id, eventType, debounceTime, validationCallback) {
    const input = document.getElementById(id);
    if (!input) { /*...*/ return; }
    input.addEventListener(eventType, Utils.debounce(() => {
        const value = input.type === 'number' ? parseFloat(input.value) : input.value;

        if (validationCallback && validationCallback(value) === false) {
            return;
        }

        // Verwendet einfach die 'id' des Elements als Schlüssel.
        Settings.state.userSettings[id] = value;
        Settings.save();
        console.log(`${id} changed to: ${value} and saved to localStorage`);

        document.dispatchEvent(new CustomEvent('ui:inputChanged', {
            detail: { name: id, value: value }
        }));
    }, debounceTime));
}

// =================================================================
// 3. UI-Komponenten-spezifische Setup-Funktionen
// =================================================================

// --- Haupt-Layout & Navigation ---

/**
 * Richtet die Klick-Handler für die Sidebar-Navigation ein, um Panels zu öffnen/schliessen.
 * @private
 */
function setupSidebarEvents() {
    const mainLayout = document.querySelector('.main-layout');
    const icons = document.querySelectorAll('.sidebar-icon');
    const panels = document.querySelectorAll('.panel');
    let activePanelId = null;

    if (!mainLayout) {
        console.error("Layout-Elemente für Sidebar-Logik nicht gefunden.");
        return;
    }

    // Die alten setPlannerLockState und setDataLockState Funktionen werden komplett entfernt.

    icons.forEach(icon => {
        icon.addEventListener('click', () => {
            const panelIdRaw = icon.dataset.panelId; // z.B. "panel-planner"
            const feature = panelIdRaw.replace('panel-', ''); // z.B. "planner"

            // Generische Prüfung für alle sperrbaren Features
            if ((feature === 'planner' || feature === 'data') && !Settings.isFeatureUnlocked(feature)) {
                Settings.showPasswordModal(
                    feature,
                    () => { // onSuccess
                        // Nach erfolgreichem Entsperren wird das 'ui:lockStateChanged'-Event die UI aktualisieren.
                        // Wir simulieren nur den Klick erneut, um das Panel zu öffnen.
                        icon.click();
                    },
                    () => { /* onCancel: nichts tun */ }
                );
                return; // Klick-Verarbeitung hier stoppen
            }

            // Der Rest der Logik zum Öffnen und Schließen der Panels bleibt unverändert
            const isAlreadyActive = mainLayout.classList.contains('sidebar-expanded') && activePanelId === panelIdRaw;

            mainLayout.classList.remove('sidebar-expanded', 'data-panel-visible');
            icons.forEach(i => i.classList.remove('active'));

            if (isAlreadyActive) {
                activePanelId = null;
            } else {
                mainLayout.classList.add('sidebar-expanded');
                icon.classList.add('active');
                activePanelId = panelIdRaw;
                panels.forEach(p => p.classList.toggle('hidden', p.id !== panelIdRaw));
                if (panelIdRaw === 'panel-data') {
                    mainLayout.classList.add('data-panel-visible');
                }
            }

            setTimeout(() => {
                if (AppState.map) AppState.map.invalidateSize({ animate: true });
            }, 300);
        });
    });
}

/**
 * Richtet die Klick-Handler für alle Akkordeon-Elemente ein.
 * @private
 */
function setupAccordionEvents() {
    const accordionHeaders = document.querySelectorAll('.accordion-header');

    accordionHeaders.forEach(header => {
        header.addEventListener('click', () => {
            const accordionItem = header.parentElement;

            // Schaltet die .active-Klasse für das geklickte Element um
            accordionItem.classList.toggle('active');
        });
    });
}

// --- Globale Steuerelemente (Slider, Modellauswahl) ---

/**
 * Richtet die Event-Listener für den Zeit-Slider ein.
 * @private
 */
function setupSliderEvents() {
    const slider = document.getElementById('timeSlider');
    if (!slider) { /*...*/ return; }

    slider.addEventListener('input', () => {
        // Der EventManager weiß nicht, was passieren soll.
        // Er meldet nur: "Der Slider wurde bewegt!"
        document.dispatchEvent(new CustomEvent('ui:sliderChanged', {
            detail: { sliderValue: slider.value }, // Wir geben den neuen Wert mit
            bubbles: true,
            cancelable: true
        }));
    });

    // Der 'change' Event-Listener wird für die finale Textanzeige beibehalten,
    // aber auch er löst nur ein Event aus.
    slider.addEventListener('change', async () => {
        document.dispatchEvent(new CustomEvent('ui:sliderChangeFinished', {
            detail: { sliderValue: slider.value },
            bubbles: true,
            cancelable: true
        }));
    });
}
function setupModelSelectEvents() {
    const modelSelect = document.getElementById('modelSelect');
    if (!modelSelect) { /*...*/ return; }

    modelSelect.addEventListener('change', () => {
        const newModel = modelSelect.value;
        console.log('Model select changed to:', newModel);

        Settings.state.userSettings.model = newModel;
        Settings.save();

        // Event auslösen, anstatt die Logik hier auszuführen
        document.dispatchEvent(new CustomEvent('ui:modelChanged', {
            detail: { model: newModel }
        }));
    });

    // Der Listener für 'models:available' ist in Ordnung, da er nur die UI aktualisiert
    document.addEventListener('models:available', (event) => {
        const { availableModels } = event.detail;
        updateModelSelectUI(availableModels);
        updateEnsembleModelUI(availableModels);
        cleanupSelectedEnsembleModels(availableModels);
    });
}
function setupCoordinateEvents() {
    Coordinates.initializeLocationSearch();
    console.log("Coordinate events setup complete.");
}
function setupMapEventListeners() {
    console.log("App: Richte Event-Listener für Karten-Events ein.");

    if (!AppState.map) {
        console.error("Karte nicht initialisiert, Event-Listener können nicht gesetzt werden.");
        return;
    }

    // Der Handler wird "dumm" - er löst nur noch ein Event aus.
    const mapMoveHandler = () => {
        document.dispatchEvent(new CustomEvent('map:moved'));
    };

    // Die Logik für das Caching kann hier bleiben, da sie eng mit der Karteninteraktion verbunden ist.
    const debouncedCacheHandler = Utils.debounce(() => {
        cacheVisibleTiles({
            map: AppState.map,
            baseMaps: AppState.baseMaps,
            onProgress: displayProgress,
            onComplete: (message) => {
                hideProgress();
                if (message) Utils.handleMessage(message);
            },
            onCancel: () => {
                hideProgress();
                Utils.handleMessage('Caching cancelled.');
            }
        });
    }, 1000);

    // Wir registrieren den einen, zentralen Handler für beide Events
    AppState.map.on('zoomend', mapMoveHandler);
    AppState.map.on('moveend', mapMoveHandler);
    AppState.map.on('moveend', debouncedCacheHandler); // Caching kann parallel laufen
}
function setupModelInfoButtonEvents() {
    const modelInfoButton = document.getElementById('modelInfoButton');
    const modelInfoPopup = document.getElementById('modelInfoPopup');

    if (!modelInfoButton || !modelInfoPopup) return;

    modelInfoButton.addEventListener('click', (event) => {
        event.stopPropagation(); // Verhindert, dass der Klick das Document-Event auslöst
        const isVisible = modelInfoPopup.style.display === 'block';
        modelInfoPopup.style.display = isVisible ? 'none' : 'block';
    });

    // Schließt das Popup, wenn irgendwo anders hingeklickt wird
    document.addEventListener('click', (event) => {
        if (modelInfoPopup.style.display === 'block' && !modelInfoButton.contains(event.target)) {
            modelInfoPopup.style.display = 'none';
        }
    });
}
function setupInfoIcons() {
    const infoIcons = document.querySelectorAll('.info-icon');

    infoIcons.forEach(icon => {
        // Findet das *direkt folgende* Popup-Element.
        const popup = icon.nextElementSibling;

        if (popup && popup.classList.contains('info-popup')) {
            const infoText = icon.dataset.info;
            if (infoText) {
                popup.textContent = infoText; // Füllt das Popup mit dem Text
            }

            icon.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();

                // Schließe alle anderen offenen Popups
                document.querySelectorAll('.info-popup').forEach(p => {
                    if (p !== popup) p.style.display = 'none';
                });

                // Zeige oder verstecke das aktuelle Popup
                const isVisible = popup.style.display === 'block';
                popup.style.display = isVisible ? 'none' : 'block';
            });
        }
    });

    // Globaler Klick-Listener, um alle Popups zu schließen
    document.addEventListener('click', (event) => {
        if (!event.target.closest('.info-icon')) {
            document.querySelectorAll('.info-popup').forEach(p => {
                p.style.display = 'none';
            });
        }
    });
}
/**
 * Richtet den Event-Listener für die "Alle Formate anzeigen" / "Weniger anzeigen" Links
 * in den DIP- und HARP-Popups ein.
 * @private
 */
function setupPopupFormatToggle() {
    if (!AppState.map) {
        console.warn('Map not initialized, skipping setup for popup format toggle.');
        return;
    }

    AppState.map.getContainer().addEventListener('click', (e) => {
        // Prüfen, ob auf einen unserer Links geklickt wurde
        if (e.target.classList.contains('toggle-coords-format')) {
            e.preventDefault(); // Verhindert, dass der Link die Seite neu lädt
            const target = e.target;
            const markerType = target.dataset.markerType;
            const isCurrentlyExpanded = target.dataset.expanded === 'true';

            if (markerType === 'dip') {
                // Ruft die Funktion auf, die das DIP-Popup neu rendert, mit dem umgekehrten Status
                displayManager.refreshMarkerPopup(!isCurrentlyExpanded, true); // Erzwingt das Öffnen
            } else if (markerType === 'harp' && AppState.harpMarker) {
                // Liest die im Link gespeicherten Koordinaten
                const lat = parseFloat(target.dataset.lat);
                const lng = parseFloat(target.dataset.lng);
                // Ruft die Funktion auf, die das HARP-Popup neu rendert, mit dem umgekehrten Status
                mapManager.updateHarpMarkerPopup(AppState.harpMarker, lat, lng, true, !isCurrentlyExpanded);
            }
        }
    });
}

// --- Planner- & Berechnungs-spezifische Events ---
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

            // KORREKTUR: Offsets bei manueller Eingabe zurücksetzen
            Settings.state.userSettings.jumpRunTrackOffset = 0;
            Settings.state.userSettings.jumpRunTrackForwardOffset = 0;
            const offsetInput = document.getElementById('jumpRunTrackOffset');
            const forwardOffsetInput = document.getElementById('jumpRunTrackForwardOffset');
            if (offsetInput) offsetInput.value = 0;
            if (forwardOffsetInput) forwardOffsetInput.value = 0;
            console.log('Manuelle JRT-Richtungsänderung: Offsets auf 0 zurückgesetzt.');

            if (Number.isFinite(value) && value >= 0 && value <= 360) {
                Settings.state.userSettings.customJumpRunDirection = value;
                console.log(`Set 'customJumpRunDirection' on change to:`, value);
            } else {
                Settings.state.userSettings.customJumpRunDirection = null;
                directionInput.value = '';
                console.log('Invalid direction, resetting to calculated.');
            }
            Settings.save();

            // Bestehende Funktion zum Neuzeichnen der Linie
            displayManager.updateJumpRunTrackDisplay();
            // NEU: Event auslösen, um die Neuberechnung der Exit Circles anzustoßen
            document.dispatchEvent(new CustomEvent('ui:recalculateJump'));
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
                document.dispatchEvent(new CustomEvent('ui:recalculateJump'));

            }
        });
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
function setupDeselectAllEnsembleButton() {
    const deselectButton = document.getElementById('deselectAllEnsembleButton');
    if (!deselectButton) return;

    deselectButton.addEventListener('click', () => {
        // 1. Finde alle Checkboxen der Ensemble-Modelle
        const ensembleCheckboxes = document.querySelectorAll('#ensembleModelsSubmenu input[type="checkbox"]');

        // 2. Entferne bei allen den Haken
        ensembleCheckboxes.forEach(checkbox => {
            checkbox.checked = false;
        });

        // 3. Leere die Auswahl in den Einstellungen und speichere
        Settings.state.userSettings.selectedEnsembleModels = [];
        Settings.save();

        // 4. Lösche die geladenen Ensemble-Daten und die Visualisierungen
        AppState.ensembleModelsData = null;
        clearEnsembleVisualizations(); // Diese Funktion aus ensembleManager.js wird hier wiederverwendet

        Utils.handleMessage('All ensemble models deselected.');
    });
}
/**
 * Richtet den Event-Listener für den Terrain-Analyse-Button ein.
 * @private
 */
function setupTerrainAnalysisEvents() {
    const analyzeTerrainBtn = document.getElementById('analyzeTerrainButton');
    if (analyzeTerrainBtn) {
        analyzeTerrainBtn.addEventListener('click', async () => {
            if (!AppState.weatherData || AppState.lastLat == null || AppState.lastLng == null) {
                Utils.handleError("Please select a location and fetch weather data first.");
                return;
            }

            // Prüfen, ob die Schirmfahrt-Anzeige aktiviert ist.
            if (!Settings.state.userSettings.showCanopyArea) {
                Utils.handleError("Please activate 'Show Canopy Flight Area' to analyze terrain.");
                return; // Analyse abbrechen und die verständliche Meldung anzeigen.
            }

            toggleLoading(true, 'Analyzing terrain, this may take a moment...');

            try {
                const dangerousPoints = await JumpPlanner.analyzeTerrainClearance();
                mapManager.drawTerrainWarning(dangerousPoints);

                if (dangerousPoints.length > 0) {
                    displayWarning("Warning: Low clearance areas detected and marked in red.");
                } else {
                    Utils.handleMessage("Terrain analysis complete. No low clearance areas found.");
                }

            } catch (error) {
                console.error("Terrain analysis failed:", error);
                Utils.handleError("An error occurred during terrain analysis.");
            } finally {
                toggleLoading(false);
            }
        });
    }
}

// --- Track & Datei-Management ---
function setupTrackEvents() {
    const uploadButton = document.getElementById('uploadTrackButton');
    const trackFileInput = document.getElementById('trackFileInput');
    const fileNameDisplay = document.getElementById('fileNameDisplay');
    const clearTrackButton = document.getElementById('clearTrack');

    if (!uploadButton || !trackFileInput || !fileNameDisplay || !clearTrackButton) {
        console.error('One or more track upload elements are missing from the DOM.');
        return;
    }

    // Ein Klick auf unseren gestylten Button löst den Klick auf den versteckten Input aus.
    uploadButton.addEventListener('click', () => {
        trackFileInput.click();
    });

    // Dieser Listener wird aktiv, sobald der Benutzer eine Datei ausgewählt hat.
    trackFileInput.addEventListener('change', async (e) => {
        const loadingElement = document.getElementById('loading');
        if (e.target.files && e.target.files.length > 0) {
            const file = e.target.files[0];

            // UI aktualisieren
            fileNameDisplay.textContent = file.name;
            fileNameDisplay.style.fontStyle = 'normal';
            if (loadingElement) loadingElement.style.display = 'block';

            const extension = file.name.split('.').pop().toLowerCase();
            try {
                if (extension === 'gpx') {
                    await loadGpxTrack(file); // Ruft die importierte Funktion auf
                } else if (extension === 'csv') {
                    await loadCsvTrackUTC(file); // Ruft die importierte Funktion auf
                } else if (extension === 'kml') { // NEUE BEDINGUNG
                    await loadKmlTrack(file);
                } else {
                    Utils.handleError('Unsupported file type. Please upload a .gpx or .csv file.');
                }
            } catch (error) {
                console.error('Error during track file processing:', error);
                Utils.handleError('Failed to process track file.');
            } finally {
                if (loadingElement) loadingElement.style.display = 'none';
            }
        }
    });

    // Logik für den "Clear Track" Button
    clearTrackButton.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!AppState.map) { Utils.handleError('Cannot clear track: map not initialized.'); return; }

        if (AppState.gpxLayer) {
            try {
                if (AppState.map.hasLayer(AppState.gpxLayer)) AppState.map.removeLayer(AppState.gpxLayer);
                AppState.gpxLayer = null;
                AppState.gpxPoints = [];
                AppState.isTrackLoaded = false;

                trackFileInput.value = ''; // Input zurücksetzen
                fileNameDisplay.textContent = 'No file chosen';
                fileNameDisplay.style.fontStyle = 'italic';

            } catch (error) {
                Utils.handleError('Failed to clear track: ' + error.message);
            }
        } else {
            Utils.handleMessage('No track to clear.');
        }
    });
}
function setupGpxExportEvent() {

    const sliderIndex = getSliderValue();
    const interpStep = getInterpolationStep();
    const heightUnit = Settings.getValue('heightUnit', 'm');

    const exportButton = document.getElementById('exportGpxButton');
    if (exportButton) {
        exportButton.addEventListener('click', async () => {
            const sliderIndex = getSliderValue();
            const interpStep = getInterpolationStep();
            const heightUnit = Settings.getValue('heightUnit', 'm');

            await exportToGpx(sliderIndex, interpStep, heightUnit);
        });
    }

    const exportLandingPatternButton = document.getElementById('exportLandingPatternGpxButton');
    if (exportLandingPatternButton) {
        exportLandingPatternButton.addEventListener('click', () => {
            console.log("DEBUG: Klick auf 'exportLandingPatternGpxButton' registriert.");
            exportLandingPatternToGpx();
        });
    }
}

// --- Einstellungs-Panel ---
function setupCheckboxEvents() {
    if (!AppState.map) {
        console.warn('Map not initialized, skipping setupCheckboxEvents');
        return;
    }

    setupCheckbox('showExitAreaCheckbox', 'showExitArea', (checkbox) => {
        Settings.state.userSettings.showExitArea = checkbox.checked;
        Settings.save();
        document.dispatchEvent(new CustomEvent('ui:jumpFeatureChanged'));
    });

    setupCheckbox('showCanopyAreaCheckbox', 'showCanopyArea', (checkbox) => {
        Settings.state.userSettings.showCanopyArea = checkbox.checked;
        Settings.save();
        document.dispatchEvent(new CustomEvent('ui:jumpFeatureChanged'));
    });

    setupCheckbox('showJumpRunTrack', 'showJumpRunTrack', (checkbox) => {
        Settings.state.userSettings.showJumpRunTrack = checkbox.checked;
        Settings.save();

        document.dispatchEvent(new CustomEvent('ui:showJumpRunTrackChanged', {
            detail: { checked: checkbox.checked }
        }));
    });

    setupCheckbox('showCutAwayFinder', 'showCutAwayFinder', (checkbox) => {
        Settings.state.userSettings.showCutAwayFinder = checkbox.checked;
        Settings.save();

        document.dispatchEvent(new CustomEvent('ui:showCutAwayFinderChanged', {
            detail: { checked: checkbox.checked }
        }));
    });

    setupCheckbox('showLandingPattern', 'showLandingPattern', (checkbox) => {
        Settings.state.userSettings.showLandingPattern = checkbox.checked;
        Settings.save();
        document.dispatchEvent(new CustomEvent('ui:landingPatternEnabled'));
    });

    setupCheckbox('trackPositionCheckbox', 'trackPosition', (checkbox) => {
        Settings.state.userSettings.trackPosition = checkbox.checked;
        Settings.save();

        document.dispatchEvent(new CustomEvent('ui:trackPositionToggled', {
            detail: { checked: checkbox.checked }
        }));
    });

    setupCheckbox('showJumpMasterLine', 'showJumpMasterLine', (checkbox) => {
        // Prüfung, ob Live-Tracking aktiv ist
        if (checkbox.checked && !Settings.state.userSettings.trackPosition) {
            checkbox.checked = false;
            Utils.handleError('Please start Live Tracking first.');
            return;
        }

        Settings.state.userSettings.showJumpMasterLine = checkbox.checked;
        Settings.save();

        document.dispatchEvent(new CustomEvent('ui:showJumpMasterLineChanged'));

        // Untermenü ein-/ausblenden
        const submenu = checkbox.closest('li')?.querySelector('ul.submenu');
        if (submenu) {
            submenu.classList.toggle('hidden', !checkbox.checked);
        }
    });

    setupRadioGroup('jumpMasterLineTarget', () => {
        // Holt den neuen Wert und speichert ihn
        const newValue = Settings.getValue('jumpMasterLineTarget', 'radio', 'DIP');
        Settings.state.userSettings.jumpMasterLineTarget = newValue;
        Settings.save();
        console.log('jumpMasterLineTarget changed:', newValue);

        // Event auslösen
        document.dispatchEvent(new CustomEvent('ui:jumpMasterLineTargetChanged'));
    });

    setupCheckbox('lockInteractionCheckbox', 'isInteractionLocked', (checkbox) => {
        const isLocked = checkbox.checked;
        Settings.state.userSettings.isInteractionLocked = isLocked;
        Settings.save();

        // GeoMan-Steuerung (de-)aktivieren
        mapManager.toggleGeoManControls(isLocked);

        // Draggable-Status des JRT-Markers (Flugzeug) aktualisieren
        if (AppState.jumpRunTrackLayerGroup) {
            AppState.jumpRunTrackLayerGroup.eachLayer(layer => {
                if (layer instanceof L.Marker && layer.options.icon && layer.options.icon.options.iconUrl.includes('airplane')) {
                    if (isLocked) {
                        layer.dragging.disable();
                    } else {
                        layer.dragging.enable();
                    }
                }
            });
        }

        // --- NEUER, KORRIGIERTER CODEBLOCK ---
        // Aktualisiert den Draggable-Status für die anderen Marker

        // DIP Marker (Hauptmarker)
        if (AppState.currentMarker) {
            if (isLocked) {
                AppState.currentMarker.dragging.disable();
            } else {
                AppState.currentMarker.dragging.enable();
            }
        }

        // HARP Marker
        if (AppState.harpMarker) {
            // HINWEIS: Der HARP-Marker war ursprünglich nicht verschiebbar. 
            // Diese Zeilen fügen die Sperr-Logik hinzu, falls er doch verschiebbar gemacht wird.
            if (isLocked) {
                if (AppState.harpMarker.dragging) AppState.harpMarker.dragging.disable();
            } else {
                if (AppState.harpMarker.dragging) AppState.harpMarker.dragging.enable();
            }
        }

        // Cutaway Marker
        if (AppState.cutAwayMarker) {
            if (isLocked) {
                AppState.cutAwayMarker.dragging.disable();
            } else {
                AppState.cutAwayMarker.dragging.enable();
            }
        }
        // --- ENDE DES NEUEN CODEBLOCKS ---


        if (isLocked) {
            Utils.handleMessage("Map interactions are now locked.");
        } else {
            Utils.handleMessage("Map interactions are now unlocked.");
        }
    });

    // NEUE CHECKBOXEN FÜR ALERTS
    setupCheckbox('alertWindEnabled', 'alerts.wind.enabled', (checkbox) => {
        Settings.state.userSettings.alerts.wind.enabled = checkbox.checked;
        Settings.save();
        // Löst eine Neuberechnung der Alarme aus
        document.dispatchEvent(new CustomEvent('ui:recalculateAlerts'));
    });

    setupCheckbox('alertGustEnabled', 'alerts.gust.enabled', (checkbox) => {
        Settings.state.userSettings.alerts.gust.enabled = checkbox.checked;
        Settings.save();
        document.dispatchEvent(new CustomEvent('ui:recalculateAlerts'));
    });

    setupCheckbox('alertThunderstormEnabled', 'alerts.thunderstorm.enabled', (checkbox) => {
        Settings.state.userSettings.alerts.thunderstorm.enabled = checkbox.checked;
        Settings.save();
        document.dispatchEvent(new CustomEvent('ui:recalculateAlerts'));
    });

    const placeHarpButton = document.getElementById('placeHarpButton');
    if (placeHarpButton) {
        placeHarpButton.addEventListener('click', () => {
            AppState.isPlacingHarp = true;
            console.log('HARP placement mode activated');
            AppState.map.on('click', mapManager.handleHarpPlacement);
            Utils.handleMessage('Click the map to place the HARP marker');

            // NEUE LOGIK: Sidebar schließen und Karte anpassen
            const mainLayout = document.querySelector('.main-layout');
            if (mainLayout) {
                mainLayout.classList.remove('sidebar-expanded', 'data-panel-visible');
            }
            document.querySelectorAll('.sidebar-icon.active').forEach(icon => icon.classList.remove('active'));

            setTimeout(() => {
                if (AppState.map) AppState.map.invalidateSize({ animate: true });
            }, 300); // Warten auf die CSS-Transition
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
function setupRadioEvents() {
    setupRadioGroup('landingDirection', () => { });
    setupRadioGroup('jumpMasterLineTarget', () => {
        document.dispatchEvent(new CustomEvent('ui:jumpMasterLineTargetChanged'));
    });

    const scenarioRadios = document.querySelectorAll('input[name="ensembleScenario"]');
    scenarioRadios.forEach(radio => {
        radio.addEventListener('change', async () => { // Die Funktion zu 'async' machen
            if (radio.checked) {
                Settings.state.userSettings.currentEnsembleScenario = radio.value;
                AppState.currentEnsembleScenario = radio.value;
                Settings.save();
                console.log('Ensemble scenario changed to:', radio.value);

                const modelsLoaded = Settings.state.userSettings.selectedEnsembleModels.every(
                    m => AppState.ensembleModelsData && AppState.ensembleModelsData[m]
                );

                // Zuerst prüfen, ob Daten geholt werden müssen
                if (!modelsLoaded && radio.value !== 'all_models') {
                    const success = await fetchEnsembleWeatherData();
                    if (!success) {
                        Utils.handleError("Failed to fetch data for scenario.");
                        return; // Abbrechen bei Fehler
                    }
                }

                // JETZT, da die Daten sicher vorhanden sind, die Visualisierung mit dem Index aufrufen
                const sliderIndex = getSliderValue(); // Den Index aus der UI holen
                processAndVisualizeEnsemble(sliderIndex); // Den Index an die Core-Funktion übergeben
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
function setupSelectEvents() {
    const selectIds = ['refLevel', 'heightUnit', 'temperatureUnit', 'windUnit', 'timeZone', 'coordFormat', 'downloadFormat', 'maxForecastTime']; // Hinzugefügt

    selectIds.forEach(id => {
        const selectElement = document.getElementById(id);
        if (selectElement) {
            selectElement.addEventListener('change', () => {
                const newValue = selectElement.value;

                Settings.state.userSettings[id] = newValue;
                Settings.save();
                console.log(`Setting '${id}' changed to: ${newValue} and saved.`);

                document.dispatchEvent(new CustomEvent('ui:settingChanged', {
                    detail: { name: id, value: newValue }
                }));
            });
        } else {
            console.warn(`Select element with id '${id}' not found.`);
        }
    });
}
function setupInputEvents() {
    // Helfer-Funktion, die den Event-Listener für die legHeight erstellt
    const createLegHeightListener = (id, defaultValue) => {
        const input = document.getElementById(id);
        if (!input) return;

        input.addEventListener('blur', () => {
            let value = parseInt(input.value) || defaultValue;

            const finalInput = document.getElementById('legHeightFinal');
            const baseInput = document.getElementById('legHeightBase');
            const downwindInput = document.getElementById('legHeightDownwind');

            let isValid = (!isNaN(value) && value >= 50 && value <= 1000 && Utils.validateLegHeights(finalInput, baseInput, downwindInput));

            if (!isValid) {
                // Die Logik zur automatischen Korrektur von früher
                let adjustedValue = defaultValue;
                const finalVal = parseInt(finalInput.value) || 100;
                const baseVal = parseInt(baseInput.value) || 200;
                const downwindVal = parseInt(downwindInput.value) || 300;

                if (id === 'legHeightFinal') adjustedValue = Math.min(baseVal - 1, 100);
                if (id === 'legHeightBase') adjustedValue = Math.max(finalVal + 1, Math.min(downwindVal - 1, 200));
                if (id === 'legHeightDownwind') adjustedValue = Math.max(baseVal + 1, 300);

                input.value = adjustedValue;
                value = adjustedValue; // Wichtig: Den Wert für das Event aktualisieren
                Utils.handleError(`Adjusted ${id} to ${adjustedValue} to maintain valid leg order.`);
            }

            // Setting speichern und Event auslösen
            Settings.state.userSettings[id] = value;
            Settings.save();
            document.dispatchEvent(new CustomEvent('ui:inputChanged', {
                detail: { name: id, value: value }
            }));
        });
    };

    // Die neuen Listener für die legHeight erstellen
    createLegHeightListener('legHeightFinal', 100);
    createLegHeightListener('legHeightBase', 200);
    createLegHeightListener('legHeightDownwind', 300);

    setupInput('lowerLimit', 'change', 300);
    setupInput('upperLimit', 'change', 300);

    setupInput('openingAltitude', 'change', 300, (value) => {
        if (isNaN(value) || value < 500 || value > 15000) {
            Utils.handleError('Opening altitude must be between 500 and 15000 meters.');

            // Event auslösen, um die UI zurückzusetzen
            document.dispatchEvent(new CustomEvent('ui:invalidInput', {
                detail: { id: 'openingAltitude', defaultValue: 1200 }
            }));
            return false; // Verhindert weiterhin das Senden des 'ui:inputChanged' Events
        }
        return true;
    });

    setupInput('exitAltitude', 'change', 300, (value) => {
        if (isNaN(value) || value < 500 || value > 15000) {
            Utils.handleError('Exit altitude must be between 500 and 15000 meters.');

            //Event auslösen, um die UI zurückzusetzen
            document.dispatchEvent(new CustomEvent('ui:invalidInput', {
                detail: { id: 'exitAltitude', defaultValue: 3000 }
            }));
            return false;
        }
        return true;
    });

    setupInput('safetyHeight', 'change', 300);

    setupInput('canopySpeed', 'change', 300);
    setupInput('descentRate', 'change', 300);
    setupInput('interpStep', 'change', 300, null, 'interpStep');

    setupInput('customLandingDirectionLL', 'input', 100);
    setupInput('customLandingDirectionRR', 'input', 100);

    setupInput('jumpRunTrackDirection', 'change', 0);
    setupInput('jumpRunTrackOffset', 'change', 0);
    setupInput('jumpRunTrackForwardOffset', 'change', 0);

    setupInput('aircraftSpeedKt', 'change', 300);
    setupInput('numberOfJumpers', 'change', 300);
    setupInput('jumperSeparation', 'change', 300);

    setupInput('cutAwayAltitude', 'change', 300);
    setupInput('terrainClearance', 'change', 300);

    setupInput('historicalDatePicker', 'change', 300);

    setupInput('alertWindThreshold', 'change', 300, (value) => {
        Settings.state.userSettings.alerts.wind.threshold = value;
        Settings.save();
        document.dispatchEvent(new CustomEvent('ui:recalculateAlerts'));
        return true;
    });

    setupInput('alertGustThreshold', 'change', 300, (value) => {
        Settings.state.userSettings.alerts.gust.threshold = value;
        Settings.save();
        document.dispatchEvent(new CustomEvent('ui:recalculateAlerts'));
        return true;
    });
}
function setupDownloadEvents() {
    const downloadButton = document.getElementById('downloadButton');
    if (downloadButton) {
        downloadButton.addEventListener('click', () => {
            document.dispatchEvent(new CustomEvent('ui:downloadClicked'));
        });
    }
}
function setupClearHistoricalDate() {
    const clearButton = document.getElementById('clearHistoricalDate');
    if (clearButton) {
        clearButton.addEventListener('click', () => {
            document.dispatchEvent(new CustomEvent('ui:clearDateClicked'));
        });
    }
}
function setupThemeToggle() {
    const toggleButton = document.getElementById('theme-toggle');
    const body = document.body;

    // Gespeichertes Theme beim Laden anwenden
    const currentTheme = localStorage.getItem('theme');
    if (currentTheme) {
        body.setAttribute('data-theme', currentTheme);
        if (toggleButton) {
            toggleButton.textContent = currentTheme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode';
        }
    }

    if (toggleButton) {
        toggleButton.addEventListener('click', () => {
            if (body.getAttribute('data-theme') === 'dark') {
                body.removeAttribute('data-theme');
                localStorage.removeItem('theme');
                toggleButton.textContent = 'Switch to Dark Mode';
            } else {
                body.setAttribute('data-theme', 'dark');
                localStorage.setItem('theme', 'dark');
                toggleButton.textContent = 'Switch to Light Mode';
            }
        });
    }
}
/**
 * Richtet den Klick-Event-Listener für das Wetter-Alarm-Icon auf der Karte ein.
 * @private
 */
async function setupAlertIconEvents() { // Die Funktion ist jetzt async
    const alertIcon = document.getElementById('map-alert-icon');
    if (alertIcon) {
        alertIcon.addEventListener('click', async () => { // Der Callback ist ebenfalls async
            const { highWinds, highGusts, thunderstorms } = weatherManager.checkWeatherAlerts(AppState.weatherData);

            const popupContainer = document.getElementById('info-popup-container');
            const popupTitle = document.getElementById('info-popup-title');
            const popupList = document.getElementById('info-popup-list');
            const popupClose = document.getElementById('info-popup-close');

            if (!popupContainer || !popupTitle || !popupList || !popupClose) return;

            popupTitle.textContent = 'Active Weather Alert';
            popupList.innerHTML = '';

            const createListItem = (text) => {
                const li = document.createElement('li');
                li.textContent = text;
                return li;
            };

            const timeZoneSetting = Settings.getValue('timeZone', 'Z');

            if (highWinds.length > 0) {
                const windThreshold = Settings.state.userSettings.alerts.wind.threshold;
                // KORREKTUR: Nutzt getDisplayTime für die korrekte Zeitzone
                const firstTime = await Utils.getDisplayTime(AppState.weatherData.time[highWinds[0]], AppState.lastLat, AppState.lastLng, timeZoneSetting);
                popupList.appendChild(createListItem(`High Winds (> ${windThreshold} kt) detected at ${firstTime} and other times.`));
            }
            if (highGusts.length > 0) {
                const gustThreshold = Settings.state.userSettings.alerts.gust.threshold;
                // KORREKTUR: Nutzt getDisplayTime für die korrekte Zeitzone
                const firstTime = await Utils.getDisplayTime(AppState.weatherData.time[highGusts[0]], AppState.lastLat, AppState.lastLng, timeZoneSetting);
                popupList.appendChild(createListItem(`High Gusts (> ${gustThreshold} kt) detected at ${firstTime} and other times.`));
            }

            if (thunderstorms.length > 0) {
                const firstTime = await Utils.getDisplayTime(AppState.weatherData.time[thunderstorms[0]], AppState.lastLat, AppState.lastLng, timeZoneSetting);
                popupList.appendChild(createListItem(`Thunderstorm forecast at ${firstTime} and other times.`));
            }
            popupContainer.classList.remove('hidden');

            popupClose.onclick = () => {
                popupContainer.classList.add('hidden');
            };
        });
    }
}

// --- Cache Management ---
function setupCacheManagement() {
    const targetContainer = document.getElementById('app-management-settings');

    if (!targetContainer) {
        console.error('Ziel-Container für App-Management-Buttons nicht gefunden.');
        return;
    }

    const buttonWrapper = document.createElement('div');
    buttonWrapper.id = 'settings-cache-buttons';
    buttonWrapper.className = 'settings-grid';

    // --- Reset Settings Button ---
    const resetButton = document.createElement('button');
    resetButton.id = 'resetButton';
    resetButton.textContent = 'Reset Settings';
    resetButton.title = 'Resets all settings to their default values and locks all features';

    resetButton.className = 'btn btn-danger'; // Weist die neuen CSS-Klassen zu

    resetButton.addEventListener('click', () => {
        if (confirm("Are you sure you want to reset all settings and lock all features?")) {
            localStorage.removeItem('unlockedFeatures');
            localStorage.removeItem('upperWindsSettings');
            window.location.reload();
        }
    });

    // Grid-Layout-Logik beibehalten
    buttonWrapper.appendChild(document.createElement('label'));
    buttonWrapper.appendChild(resetButton);

    // --- Clear Tile Cache Button ---
    const clearCacheButton = document.createElement('button');
    clearCacheButton.id = 'clearCacheButton';
    clearCacheButton.textContent = 'Clear Tile Cache';
    clearCacheButton.title = 'Clears cached map tiles. Pan/zoom to cache more tiles for offline use.';

    clearCacheButton.className = 'btn btn-danger'; // Weist die neuen CSS-Klassen zu

    clearCacheButton.addEventListener('click', async () => {
        try {
            const size = await TileCache.getCacheSize();
            await TileCache.clearCache();
            Utils.handleMessage(`Tile cache cleared successfully (freed ${size.toFixed(2)} MB).`);
        } catch (error) {
            Utils.handleError('Failed to clear tile cache: ' + error.message);
        }
    });

    // Grid-Layout-Logik beibehalten
    buttonWrapper.appendChild(document.createElement('label'));
    buttonWrapper.appendChild(clearCacheButton);

    targetContainer.appendChild(buttonWrapper);
}

function setupCacheSettings() {
    const cacheRadiusInput = document.getElementById('cacheRadiusSelect');
    if (cacheRadiusInput) {
        // Setzt den Startwert aus den gespeicherten Einstellungen
        cacheRadiusInput.value = Settings.state.userSettings.cacheRadiusKm || 10;

        // Event-Listener für das Eingabefeld mit Validierung
        cacheRadiusInput.addEventListener('change', () => { // 'change' wird nach Verlassen des Feldes ausgelöst
            if (!Settings.state || !Settings.state.userSettings) {
                console.error('Settings not properly initialized');
                return;
            }

            let value = parseInt(cacheRadiusInput.value, 10);

            // Validierungslogik
            if (isNaN(value) || value < 1) {
                value = 1; // Auf Minimum setzen, wenn zu klein oder ungültig
                Utils.handleMessage("Cache radius must be at least 1 km.");
            } else if (value > 50) {
                value = 50; // Auf Maximum setzen, wenn zu groß
                Utils.handleMessage("Cache radius cannot exceed 50 km.");
            }

            // Korrigierten Wert im UI und in den Settings speichern
            cacheRadiusInput.value = value;
            Settings.state.userSettings.cacheRadiusKm = value;
            Settings.save();
            console.log('Updated cacheRadiusKm:', Settings.state.userSettings.cacheRadiusKm);
        });

        console.log('cacheRadiusSelect listener attached, initial value:', cacheRadiusInput.value);
    } else {
        console.warn('cacheRadiusSelect not found in DOM');
    }

    const zoomMinInput = document.getElementById('cacheZoomMin');
    const zoomMaxInput = document.getElementById('cacheZoomMax');

    if (zoomMinInput && zoomMaxInput) {
        // Hilfsfunktion zum Speichern der Zoom-Level
        const updateZoomLevels = () => {
            let minZoom = parseInt(zoomMinInput.value, 10);
            let maxZoom = parseInt(zoomMaxInput.value, 10);

            // Validierung
            if (isNaN(minZoom) || minZoom < 6) minZoom = 6;
            if (isNaN(maxZoom) || maxZoom > 15) maxZoom = 15;
            if (minZoom > maxZoom) {
                // Wenn min > max, setze max auf den gleichen Wert wie min
                maxZoom = minZoom;
                zoomMaxInput.value = maxZoom;
                Utils.handleMessage("Max zoom cannot be less than min zoom.");
            }

            // Stelle sicher, dass die UI die validierten Werte anzeigt
            zoomMinInput.value = minZoom;
            zoomMaxInput.value = maxZoom;

            // Erstelle das Array und speichere es
            const zoomLevels = Array.from({ length: maxZoom - minZoom + 1 }, (_, i) => minZoom + i);
            Settings.state.userSettings.cacheZoomLevels = zoomLevels;
            Settings.save();
            console.log('Updated cacheZoomLevels:', Settings.state.userSettings.cacheZoomLevels);
        };

        // Setze die initialen Werte aus den gespeicherten Einstellungen
        const savedLevels = Settings.state.userSettings.cacheZoomLevels || [11, 12, 13, 14];
        zoomMinInput.value = Math.min(...savedLevels);
        zoomMaxInput.value = Math.max(...savedLevels);

        // Füge Event-Listener hinzu
        zoomMinInput.addEventListener('change', updateZoomLevels);
        zoomMaxInput.addEventListener('change', updateZoomLevels);

    } else {
        console.warn('Zoom level input fields not found in DOM');
    }

    const recacheNowButton = document.getElementById('recacheNowButton');
    if (recacheNowButton) {
        recacheNowButton.addEventListener('click', () => {
            cacheTilesForDIP({
                map: AppState.map,
                lastLat: AppState.lastLat,
                lastLng: AppState.lastLng,
                baseMaps: AppState.baseMaps,
                onProgress: displayProgress,
                onComplete: (message) => {
                    hideProgress();
                    if (message) displayMessage(message);
                },
                onCancel: () => {
                    hideProgress();
                    displayMessage('Caching cancelled.');
                }
            });
        });
        console.log('recacheNowButton listener attached');
    } else {
        console.warn('recacheNowButton not found in DOM');
    }
}

// --- Live Tracking ---
function setupHarpCoordInputEvents() {
    const harpCoordInput = document.getElementById('harpCoordInput');
    const placeHarpCoordButton = document.getElementById('placeHarpCoordButton');
    const harpRadio = document.querySelector('input[name="jumpMasterLineTarget"][value="HARP"]');

    if (!harpCoordInput || !placeHarpCoordButton || !harpRadio) {
        console.warn('HARP coordinate input elements not found. Skipping setup.');
        return;
    }

    placeHarpCoordButton.addEventListener('click', async () => {
        const inputValue = harpCoordInput.value.trim();
        if (!inputValue) {
            Utils.handleError('Please enter coordinates.');
            return;
        }

        const parsedCoords = LocationManager.parseQueryAsCoordinates(inputValue);

        if (parsedCoords) {
            if (AppState.harpMarker) {
                AppState.map.removeLayer(AppState.harpMarker);
            }
            AppState.harpMarker = mapManager.createHarpMarker(parsedCoords.lat, parsedCoords.lng).addTo(AppState.map);
            AppState.map.panTo([parsedCoords.lat, parsedCoords.lng]);
            Settings.state.userSettings.harpLat = parsedCoords.lat;
            Settings.state.userSettings.harpLng = parsedCoords.lng;

            Settings.state.userSettings.jumpRunTrackOffset = 0;
            Settings.state.userSettings.jumpRunTrackForwardOffset = 0;
            console.log('HARP placed via coords. JRT offsets reset to 0.');

            Settings.save();
            Utils.handleMessage('HARP marker placed successfully.');
            harpRadio.disabled = false;
            harpRadio.checked = true;
            document.dispatchEvent(new CustomEvent('ui:jumpMasterLineTargetChanged'));
            document.dispatchEvent(new CustomEvent('ui:recalculateJump'));
            document.dispatchEvent(new CustomEvent('harp:updated'));

            //Sidebar schließen und Karte anpassen
            const mainLayout = document.querySelector('.main-layout');
            if (mainLayout) {
                mainLayout.classList.remove('sidebar-expanded', 'data-panel-visible');
            }
            document.querySelectorAll('.sidebar-icon.active').forEach(icon => icon.classList.remove('active'));

            setTimeout(() => {
                if (AppState.map) AppState.map.invalidateSize({ animate: true });
            }, 300);

        } else {
            Utils.handleError('Invalid coordinates. Please enter a valid MGRS or Decimal Degree format.');
        }
    });
}
/**
 * Richtet den Event-Listener für den ADSB "Find Jump Ship" Button ein.
 * @private
 */
function setupAdsbEvents() {
    const findShipButton = document.getElementById('findJumpShipBtn');
    if (findShipButton) {
        findShipButton.addEventListener('click', () => {
            // Löst die Logik im adsbManager aus
            AdsbManager.findAndSelectJumpShip();
        });
    }

    // Event-Listener für die Anzeige des Auswahl-Modals
    document.addEventListener('adsb:showSelection', (e) => {
        const { aircraftList } = e.detail;
        const modal = document.getElementById('adsbSelectionModal');
        const list = document.getElementById('aircraftList');
        const cancelBtn = document.getElementById('adsbCancel');

        if (!modal || !list || !cancelBtn) return;

        list.innerHTML = '';
        aircraftList.sort((a, b) => b.altitude - a.altitude);

        aircraftList.forEach(ac => {
            const li = document.createElement('li');
            li.textContent = `${ac.callsign} / ${ac.altitude} ft`;
            li.onclick = () => {
                modal.style.display = 'none';
                // Startet das Tracking über den adsbManager
                AdsbManager.startAircraftTracking(ac);
            };
            list.appendChild(li);
        });

        cancelBtn.onclick = () => {
            modal.style.display = 'none';
        };

        modal.style.display = 'flex';
    });

    // Event-Listener für das Erstellen/Aktualisieren des Flugzeug-Markers
    document.addEventListener('adsb:aircraftSelected', (e) => {
        const { aircraft, attribution } = e.detail;
        if (AppState.aircraftMarker) AppState.map.removeLayer(AppState.aircraftMarker);
        mapManager.clearAircraftTrack();
        const marker = mapManager.createAircraftMarker(aircraft.lat, aircraft.lon, aircraft.track);
        marker.bindTooltip("", { permanent: true, direction: 'top', offset: [0, -15], className: 'adsb-tooltip' });

        if (AppState.map && AppState.map.attributionControl) {
            AppState.map.attributionControl.addAttribution(attribution);
        }

        // Tooltip sofort aktualisieren
        document.dispatchEvent(new CustomEvent('adsb:aircraftUpdated', { detail: { aircraft } }));
    });

    document.addEventListener('adsb:aircraftUpdated', (e) => {
        const { aircraft } = e.detail;
        if (AppState.aircraftMarker && aircraft.lat && aircraft.lon) {
            AppState.aircraftMarker.setLatLng([aircraft.lat, aircraft.lon]);
            if (aircraft.track) {
                AppState.aircraftMarker.setRotationAngle(aircraft.track);
            }
            updateAircraftTooltip(aircraft);
            mapManager.drawAircraftTrack(AppState.adsbTrackPoints);
        }
    });

    // Event-Listener zum Beenden des Trackings
    document.addEventListener('adsb:trackingStopped', (e) => {
        const { attribution } = e.detail;
        if (AppState.aircraftMarker) {
            AppState.map.removeLayer(AppState.aircraftMarker);
            AppState.aircraftMarker = null;
        }
        mapManager.clearAircraftTrack();
        if (AppState.map && AppState.map.attributionControl) {
            AppState.map.attributionControl.removeAttribution(attribution);
        }
    });

    // Hilfsfunktion zum Aktualisieren des Tooltips (kann hier platziert werden)
    function updateAircraftTooltip(aircraftData) {
        if (!AppState.aircraftMarker) return;
        const heightUnit = Settings.getValue('heightUnit', 'm');
        const speedUnit = Settings.getValue('windUnit', 'kt');
        const altitudeFt = aircraftData.altitude;
        const altitudeText = heightUnit === 'm'
            ? `${Math.round(altitudeFt * 0.3048)} m`
            : `${altitudeFt} ft`;
        const speedKt = aircraftData.velocity;
        const speed = Utils.convertWind(speedKt, speedUnit, 'kt');
        const hasNumericSpeed = Number.isFinite(speed);
        const speedText = hasNumericSpeed
            ? `${speedUnit === 'bft' ? Math.round(speed) : speed.toFixed(0)} ${speedUnit}`
            : 'N/A';
        let verticalRateText = "Level";
        if (aircraftData.vertical_rate) {
            const rateFPM = aircraftData.vertical_rate;
            if (rateFPM > 100) verticalRateText = `+${rateFPM} ft/min`;
            else if (rateFPM < -100) verticalRateText = `${rateFPM} ft/min`;
        }
        const tooltipContent = `
            <strong>${aircraftData.callsign || 'N/A'}</strong><br>
            Altitude: ${altitudeText}<br>
            Speed: ${speedText}<br>
            V/S: ${verticalRateText}
        `;
        AppState.aircraftMarker.setTooltipContent(tooltipContent);
    }
}

// --- Ensemble-spezifische UI-Updates ---
export function updateEnsembleModelUI(availableModels) {
    const submenu = document.getElementById('ensembleModelsSubmenu');
    if (!submenu) return;
    submenu.innerHTML = '';
    availableModels.forEach(model => {
        const li = document.createElement('li');
        const label = document.createElement('label');
        label.className = 'radio-label';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.name = 'ensembleModel';
        checkbox.value = model;
        checkbox.checked = Settings.state.userSettings.selectedEnsembleModels.includes(model);

        // Den Event-Listener zu async machen
        checkbox.addEventListener('change', async () => {
            const selected = Array.from(submenu.querySelectorAll('input:checked')).map(cb => cb.value);
            Settings.state.userSettings.selectedEnsembleModels = selected;
            Settings.save();

            // 1. Daten abrufen und auf Erfolg warten
            const success = await fetchEnsembleWeatherData();

            // 2. Nur wenn die Daten erfolgreich geladen wurden, die Visualisierung anstoßen
            if (success) {
                const sliderIndex = getSliderValue(); // Den UI-Zustand hier abrufen
                processAndVisualizeEnsemble(sliderIndex); // Und an die Core-Funktion übergeben
            }
        });

        label.append(checkbox, ` ${model.replace(/_/g, ' ').toUpperCase()}`);
        li.appendChild(label);
        submenu.appendChild(li);
    });
}

// --- Search ---

function setupPoiSearchButton() {
    const poiButton = document.getElementById('findPoisInViewBtn');
    if (!poiButton) {
        console.warn('POI search button not found.');
        return;
    }

    poiButton.addEventListener('click', async () => {
        if (!AppState.map) {
            Utils.handleError("Map is not available.");
            return;
        }

        const currentZoom = AppState.map.getZoom();
        const minZoomForPoiSearch = 10;

        if (currentZoom < minZoomForPoiSearch) {
            displayWarning(`Please zoom in to Level ${minZoomForPoiSearch}+ to search for dropzones.`);
            return;
        }

        try {
            // KORREKTUR: Rufe toggleLoading mit dem spezifischen Text auf
            toggleLoading(true, 'Searching for Dropzones...');

            const bounds = AppState.map.getBounds();
            const sw = bounds.getSouthWest();
            const ne = bounds.getNorthEast();

            const poiResults = await LocationManager.findParachutingPOIs(
                sw.lat, sw.lng, ne.lat, ne.lng
            );

            mapManager.updatePoiMarkers(poiResults);

            // Der dynamische Import für renderResultsList bleibt unverändert
            const coordinatesModule = await import('./coordinates.js');
            if (coordinatesModule && typeof coordinatesModule.renderResultsList === 'function') {
                coordinatesModule.renderResultsList(poiResults);
            }
        } catch (error) {
            console.error("Error during POI search:", error);
            Utils.handleError("An error occurred during the search.");
        } finally {
            // KORREKTUR: Schalte den Spinner über die Funktion wieder aus
            toggleLoading(false);
        }
    });
}

// =================================================================
// 4. Haupt-Initialisierungsfunktion
// =================================================================

/**
 * Initialisiert alle Event-Listener für die Web-Anwendung.
 * Diese Funktion sollte nur einmal aufgerufen werden, wenn das DOM geladen ist.
 */
export function initializeEventListeners() {
    if (listenersInitialized) {
        return; // Bricht die Funktion sofort ab, wenn sie schon einmal lief
    }
    console.log("Initializing all UI event listeners...");

    // Logische Reihenfolge der Aufrufe
    // 1. Grund-Layout
    setupSidebarEvents();
    setupAccordionEvents();

    // 2. Globale Controls
    setupSliderEvents();
    setupModelSelectEvents();
    setupCoordinateEvents();
    setupModelInfoButtonEvents();
    setupInfoIcons();
    setupPopupFormatToggle();

    // 3. Einstellungen & Features
    setupCheckboxEvents();
    setupRadioEvents();
    setupSelectEvents();
    setupInputEvents();
    setupDownloadEvents();
    setupClearHistoricalDate();
    setupThemeToggle();
    setupAlertIconEvents();

    // 4. Spezifische Planner-Funktionen
    setupJumpRunTrackEvents();
    setupCutawayRadioButtons();
    setupResetCutAwayMarkerButton();
    setupDeselectAllEnsembleButton();
    setupTerrainAnalysisEvents();

    // 5. Datei- & Track-Management
    setupTrackEvents();
    setupGpxExportEvent();

    // 6. App-Management & Cache
    setupCacheManagement();
    setupCacheSettings();

    // 7. Live-Funktionen
    setupHarpCoordInputEvents();
    setupAdsbEvents();

    // 8. Search
    setupPoiSearchButton();

    // 9. Event Listener für Karten-Interaktionen
    setupMapEventListeners();

    document.addEventListener('loading:start', (e) => toggleLoading(true, e.detail.message));
    document.addEventListener('loading:stop', () => toggleLoading(false));

    listenersInitialized = true;
    console.log("Event listeners initialized successfully (first and only time).");
}