// eventManager.js
"use strict";

import { AppState } from '../core/state.js';
import { Settings } from '../core/settings.js';
import { Utils } from '../core/utils.js';
import * as displayManager from './displayManager.js';
import * as mapManager from './mapManager.js';
import * as Coordinates from './coordinates.js';
import * as JumpPlanner from '../core/jumpPlanner.js';
import { TileCache, cacheTilesForDIP, cacheVisibleTiles } from '../core/tileCache.js';
import { loadGpxTrack, loadCsvTrackUTC } from '../core/trackManager.js';
import * as weatherManager from '../core/weatherManager.js';
import * as liveTrackingManager from '../core/liveTrackingManager.js';
import { fetchEnsembleWeatherData, processAndVisualizeEnsemble, clearEnsembleVisualizations } from '../core/ensembleManager.js';
import { getSliderValue, displayMessage, hideProgress, displayProgress } from './ui.js';
import * as AutoupdateManager from '../core/autoupdateManager.js';
import { UI_DEFAULTS } from '../core/constants.js';
import { updateModelSelectUI, cleanupSelectedEnsembleModels } from './ui.js';
import 'leaflet-gpx';

let listenersInitialized = false;

function dispatchAppEvent(eventName, detail = {}) {
    console.log(`[EventManager] Dispatching event: ${eventName}`, detail);
    const event = new CustomEvent(eventName, { detail, bubbles: true, cancelable: true });
    document.dispatchEvent(event);
}

function setupTabBarEvents() {
    const tabBar = document.getElementById('tab-bar');
    if (!tabBar) return;

    const setPlannerLockState = () => {
        const plannerTabButton = document.getElementById('planner-tab-button');
        if (!plannerTabButton) return;
        if (Settings.isFeatureUnlocked('planner')) {
            plannerTabButton.style.opacity = '1';
            plannerTabButton.title = 'Open Planner';
        } else {
            plannerTabButton.style.opacity = '0.5';
            plannerTabButton.title = 'Feature locked. Tap to enter password.';
        }
    };

    setPlannerLockState();

    tabBar.addEventListener('click', (e) => {
        const button = e.target.closest('.tab-button');
        if (!button) return;

        const panelId = button.dataset.panel;

        if (panelId === 'planner' && !Settings.isFeatureUnlocked('planner')) {
            Settings.showPasswordModal('planner', () => {
                Settings.saveUnlockStatus('planner', true);
                setPlannerLockState();
                document.querySelectorAll('.content-panel').forEach(p => p.classList.add('hidden'));
                document.getElementById(`panel-${panelId}`).classList.remove('hidden');
                document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
                button.classList.add('active');
                if (AppState.map) {
                    setTimeout(() => AppState.map.invalidateSize(), 100);
                }
            }, () => {});
            return;
        }

        document.querySelectorAll('.content-panel').forEach(p => p.classList.add('hidden'));
        if (panelId !== 'map') {
            const panelToShow = document.getElementById(`panel-${panelId}`);
            if (panelToShow) {
                panelToShow.classList.remove('hidden');
            }
        }

        document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
        button.classList.add('active');

        // Only call invalidateSize when showing a panel
        if (AppState.map && panelId !== 'map') {
            setTimeout(() => AppState.map.invalidateSize(), 100);
        }
    });
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

function setupAccordionEvents() {
    const accordionHeaders = document.querySelectorAll('.accordion-header');
    const allAccordionItems = document.querySelectorAll('.accordion-item'); // Alle Elemente holen

    accordionHeaders.forEach(header => {
        header.addEventListener('click', () => {
            const currentItem = header.parentElement;
            const isOpen = currentItem.classList.contains('active');

            // Zuerst alle Elemente schließen
            allAccordionItems.forEach(item => {
                item.classList.remove('active');
            });

            // Das geklickte Element nur dann öffnen, wenn es vorher geschlossen war.
            // Dies ermöglicht das Schließen des aktuell offenen Elements durch erneutes Klicken.
            if (!isOpen) {
                currentItem.classList.add('active');
            }
        });
    });
}

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

           // KORREKTUR: Liest den Wert direkt vom ausgewählten Radio-Button
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
                // Die Zeile "const landingDirection = ..." ist nicht mehr nötig, wir haben `newValue`

                if (customLL) customLL.disabled = newValue !== 'LL'; // KORREKTUR
                if (customRR) customRR.disabled = newValue !== 'RR'; // KORREKTUR

                if (newValue === 'LL' && customLL && !customLL.value && Settings.state.userSettings.customLandingDirectionLL === '') { // KORREKTUR
                    customLL.value = Math.round(AppState.landingWindDir || 0);
                    Settings.state.userSettings.customLandingDirectionLL = parseInt(customLL.value);
                    Settings.save();
                    console.log(`Set customLandingDirectionLL to ${customLL.value}`);
                }
                if (newValue === 'RR' && customRR && !customRR.value && Settings.state.userSettings.customLandingDirectionRR === '') { // KORREKTUR
                    customRR.value = Math.round(AppState.landingWindDir || 0);
                    Settings.state.userSettings.customLandingDirectionRR = parseInt(customRR.value);
                    Settings.save();
                    console.log(`Set customLandingDirectionRR to ${customRR.value}`);
                }
            }
            // NEU: Event auslösen, um die Anwendung über die Änderung zu informieren
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

        // Führen Sie die Validierung aus, falls eine übergeben wurde.
        // Die Validierung kann `false` zurückgeben, um das Senden des Events zu stoppen.
        if (validationCallback && validationCallback(value) === false) {
            return; // Abbruch bei ungültiger Eingabe
        }

        Settings.state.userSettings[id] = value;
        Settings.save();
        console.log(`${id} changed to: ${value} and saved to localStorage`);

        // Event auslösen, anstatt Logik direkt auszuführen
        document.dispatchEvent(new CustomEvent('ui:inputChanged', {
            detail: { name: id, value: value }
        }));
    }, debounceTime));
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

    setupCheckbox('showExitAreaCheckbox', 'showExitArea', (checkbox) => {
        Settings.state.userSettings.showExitArea = checkbox.checked;
        Settings.save();
        // Event auslösen, anstatt Logik auszuführen
        document.dispatchEvent(new CustomEvent('ui:jumpFeatureChanged'));
    });

    setupCheckbox('showCanopyAreaCheckbox', 'showCanopyArea', (checkbox) => {
        Settings.state.userSettings.showCanopyArea = checkbox.checked;
        Settings.save();
        // Dasselbe Event auslösen
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
    });

    setupCheckbox('trackPositionCheckbox', 'trackPosition', (checkbox) => {
        Settings.state.userSettings.trackPosition = checkbox.checked;
        Settings.save();

        document.dispatchEvent(new CustomEvent('ui:trackPositionToggled', {
            detail: { checked: checkbox.checked }
        }));
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

    setupRadioGroup('jumpMasterLineTarget', () => {
        // Holt den neuen Wert und speichert ihn
        const newValue = Settings.getValue('jumpMasterLineTarget', 'radio', 'DIP');
        Settings.state.userSettings.jumpMasterLineTarget = newValue;
        Settings.save();
        console.log('jumpMasterLineTarget changed:', newValue);

        // Event auslösen
        document.dispatchEvent(new CustomEvent('ui:jumpMasterLineTargetChanged'));
    });

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

function setupRadioEvents() {
    setupRadioGroup('refLevel', () => Settings.updateUnitLabels());

    setupRadioGroup('heightUnit', () => {
        Settings.updateUnitLabels(); // Passt die Labels der UI an
        // Der Rest wird durch das Event im main-Modul erledigt
    });

    setupRadioGroup('temperatureUnit', () => { }); // Löst nur das Event aus

    setupRadioGroup('windUnit', () => {
        Settings.updateUnitLabels(); // Lokale UI-Aktion, kann bleiben
        // Der Rest wird vom Event-Listener im main-Modul erledigt
    });
    setupRadioGroup('timeZone', () => { }); // Löst nur das Event aus

    setupRadioGroup('coordFormat', () => { });

    setupRadioGroup('downloadFormat', () => { }); // Löst nur das Event aus

    setupRadioGroup('landingDirection', () => { });
    setupRadioGroup('jumpMasterLineTarget', () => {
        // dispatchAppEvent('jml:targetChanged') wird zu:
        document.dispatchEvent(new CustomEvent('ui:jumpMasterLineTargetChanged'));
    });

    //Ensemble stuff
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

function setupInputEvents() {
    // Jeder Aufruf speichert jetzt nur noch den Wert und löst das 'ui:inputChanged' Event aus.
    // Die Validierungslogik bleibt als Callback erhalten.

    // Helfer-Funktion, die den Event-Listener für die Bein-Höhen erstellt
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

    // Die neuen Listener für die Bein-Höhen erstellen
    createLegHeightListener('legHeightFinal', 100);
    createLegHeightListener('legHeightBase', 200);
    createLegHeightListener('legHeightDownwind', 300);

    setupInput('lowerLimit', 'change', 300);
    setupInput('upperLimit', 'change', 300);

    setupInput('openingAltitude', 'change', 300, (value) => {
        if (isNaN(value) || value < 500 || value > 15000) {
            Utils.handleError('Opening altitude must be between 500 and 15000 meters.');

            // NEU: Event auslösen, um die UI zurückzusetzen
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

            // NEU: Event auslösen, um die UI zurückzusetzen
            document.dispatchEvent(new CustomEvent('ui:invalidInput', {
                detail: { id: 'exitAltitude', defaultValue: 3000 }
            }));
            return false;
        }
        return true;
    });

    setupInput('canopySpeed', 'change', 300);
    setupInput('descentRate', 'change', 300);
    setupInput('interpStepSelect', 'change', 300);

    setupInput('customLandingDirectionLL', 'input', 100);
    setupInput('customLandingDirectionRR', 'input', 100);

    setupInput('jumpRunTrackDirection', 'change', 0);
    setupInput('jumpRunTrackOffset', 'change', 0);
    setupInput('jumpRunTrackForwardOffset', 'change', 0);

    setupInput('aircraftSpeedKt', 'change', 300);
    setupInput('numberOfJumpers', 'change', 300);
    setupInput('jumperSeparation', 'change', 300);

    setupInput('cutAwayAltitude', 'change', 300);
    setupInput('historicalDatePicker', 'change', 300);
}

function setupDownloadEvents() {
    const downloadButton = document.getElementById('downloadButton');
    if (downloadButton) {
        downloadButton.addEventListener('click', () => {
            // Event auslösen
            document.dispatchEvent(new CustomEvent('ui:downloadClicked'));
        });
    }
}

function setupClearHistoricalDate() {
    const clearButton = document.getElementById('clearHistoricalDate');
    if (clearButton) {
        clearButton.addEventListener('click', () => {
            // Event auslösen
            document.dispatchEvent(new CustomEvent('ui:clearDateClicked'));
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
                document.dispatchEvent(new CustomEvent('ui:recalculateJump'));

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

    const debouncedMapMoveHandler = Utils.debounce(mapMoveHandler, 500); // 500ms Verzögerung

    // Wir registrieren den einen, zentralen Handler für beide Events
    AppState.map.on('zoomend', mapMoveHandler);
    AppState.map.on('moveend', mapMoveHandler);
    AppState.map.on('moveend', debouncedCacheHandler); // Caching kann parallel laufen

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
}


function setupCacheManagement() {
    const targetContainer = document.getElementById('app-management-settings');
    if (!targetContainer) {
        console.error('Ziel-Container für App-Management-Buttons nicht gefunden.');
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
    targetContainer.appendChild(buttonWrapper);
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
        recacheNowButton.addEventListener('click', () => {
            cacheTilesForDIP({
                map: AppState.map,
                lastLat: AppState.lastLat,
                lastLng: AppState.lastLng,
                baseMaps: AppState.baseMaps,
                // NEU: Die Callback-Funktionen übergeben
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

function setupSettingsPanels() {
    console.log("Setting up settings panel interactions...");

    // Eine Hilfsfunktion, um die Logik nicht zu wiederholen
    const setupSelectControl = (elementId, settingPath) => {
        const selectElement = document.getElementById(elementId);
        if (!selectElement) {
            console.error(`Settings element not found: #${elementId}`);
            return;
        }

        // --- Teil 1: Initialen Wert aus den Settings setzen (bleibt gleich) ---
        let currentValue = Settings.state.userSettings;
        const pathKeys = settingPath.split('.');
        pathKeys.forEach(key => {
            currentValue = currentValue ? currentValue[key] : undefined;
        });

        if (currentValue !== undefined) {
            selectElement.value = currentValue;
        }

        // --- Teil 2: Event-Listener mit NEUER, ROBUSTER Speicherlogik ---
        selectElement.addEventListener('change', (event) => {
            let settingRef = Settings.state.userSettings;

            // Gehe den Pfad entlang bis zum vorletzten Schlüssel
            for (let i = 0; i < pathKeys.length - 1; i++) {
                const key = pathKeys[i];
                // NEU: Wenn ein Teil des Pfades nicht existiert, erstelle ihn als leeres Objekt
                if (settingRef[key] === undefined || typeof settingRef[key] !== 'object') {
                    console.warn(`Creating missing settings path: ${key}`);
                    settingRef[key] = {};
                }
                settingRef = settingRef[key];
            }

            // Der letzte Schlüssel im Pfad (z.B. 'refLevel')
            const finalKey = pathKeys[pathKeys.length - 1];

            // Jetzt ist sichergestellt, dass settingRef ein gültiges Objekt ist
            if (settingRef) {
                settingRef[finalKey] = event.target.value;
                Settings.save(); // Speichern
                console.log(`Setting '${settingPath}' changed to:`, event.target.value);
                document.dispatchEvent(new CustomEvent('setting:changed', { detail: { key: settingPath, value: event.target.value } }));
            } else {
                console.error(`Failed to save setting. Parent object for path '${settingPath}' is not valid.`);
            }
        });
    };

    // Jetzt rufen wir die Hilfsfunktion für jedes Setting auf
    // Units Panel
    setupSelectControl('refLevel', 'units.refLevel');
    setupSelectControl('heightUnit', 'units.heightUnit');
    setupSelectControl('temperatureUnit', 'units.temperatureUnit');
    setupSelectControl('windUnit', 'units.windUnit');
    setupSelectControl('timeZone', 'timeZone'); // Dies ist kein verschachteltes Setting
    setupSelectControl('coordFormat', 'coordFormat'); // Ebenfalls nicht verschachtelt

    // Download Panel
    setupSelectControl('downloadFormat', 'downloadFormat');
    // Event-Listener für Buttons können hier auch hinzugefügt werden
    // document.getElementById('downloadButton').addEventListener('click', () => { ... });

    // Cache Panel
    setupSelectControl('cacheRadiusSelect', 'cache.radius');
    setupSelectControl('cacheZoomLevelsSelect', 'cache.zoomLevels');
    // document.getElementById('recacheNowButton').addEventListener('click', () => { ... });

    // Usw. für die anderen Panels...
}

function setupInfoIcons() {
    // Findet alle Elemente mit der Klasse .info-icon
    const infoIcons = document.querySelectorAll('.info-icon');

    infoIcons.forEach(icon => {
        icon.addEventListener('click', (event) => {
            // Verhindert, dass durch den Klick auch das Label/Input aktiviert wird
            event.preventDefault();
            event.stopPropagation();

            const infoText = icon.dataset.info; // Holt den Text aus dem data-info Attribut
            if (infoText) {
                // Zeigt eine einfache System-Benachrichtigung an.
                // Für eine schönere Darstellung könnte man hier ein eigenes Modal-Fenster öffnen.
                alert(infoText);
            }
        });
    });
}

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

            // KORREKTUR: Die Logik aufteilen
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
    setupModelInfoButtonEvents(); // <-- HIER DIE NEUE ZEILE EINFÜGEN
    setupRadioEvents();
    setupInputEvents();
    setupDownloadEvents();
    setupTrackEvents();
    setupClearHistoricalDate();
    setupCoordinateEvents();
    setupCutawayRadioButtons();
    setupJumpRunTrackEvents();
    setupMapEventListeners();
    setupResetCutAwayMarkerButton();
    setupCacheManagement();
    setupCacheSettings();
    setupTabBarEvents();
    setupAccordionEvents();
    setupSettingsPanels();
    setupInfoIcons();
    listenersInitialized = true;
    console.log("Event listeners initialized successfully (first and only time).");

}