/**
 * @file ui.js
 * @description Enthält allgemeine Hilfsfunktionen zur Steuerung der Benutzeroberfläche (UI).
 * Dies umfasst das Anzeigen von Nachrichten, Ladeindikatoren, die Aktualisierung von
 * UI-Elementen und die Erkennung des Gerätetyps.
 */

import { Utils } from '../core/utils.js';
import { Settings } from '../core/settings.js';
import { fetchEnsembleWeatherData, processAndVisualizeEnsemble } from '../core/ensembleManager.js';
import { UI_DEFAULTS, WEATHER_MODELS } from '../core/constants.js';

// ===================================================================
// 1. Geräte- & Style-Helfer
// ===================================================================

/**
 * Prüft, ob die Anwendung auf einem Touch-Gerät oder in einer nativen Capacitor-App läuft.
 * @returns {boolean} True, wenn es sich um ein mobiles Gerät handelt.
 */
export function isMobileDevice() {
    /**
     * Diese Prüfung ist deutlich zuverlässiger als die alte Methode.
     * Sie prüft auf echte Touch-Fähigkeiten des Browsers.
     */
    const hasTouchSupport = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

    /**
     * In der nativen App setzt Capacitor eine globale Variable.
     * Dies ist der sicherste Weg, die App-Umgebung zu erkennen.
     */
    const isCapacitorApp = window.Capacitor && window.Capacitor.isNativePlatform();

    return hasTouchSupport || isCapacitorApp;
}

/**
 * Fügt dem `<body>`-Tag eine CSS-Klasse hinzu, wenn ein Touch-Gerät erkannt wird.
 * Dies ermöglicht gerätespezifisches Styling (z.B. für das Fadenkreuz).
 */
export function applyDeviceSpecificStyles() {
    if (isMobileDevice()) {
        document.body.classList.add('touch-device');
    }
}

// ===================================================================
// 2. UI-Zustand abfragen
// ===================================================================

/**
 * Ruft den aktuellen numerischen Wert des Zeitschiebereglers ab.
 * @returns {number} Der Wert des Sliders, oder 0 als Fallback.
 */
export function getSliderValue() {
    return parseInt(document.getElementById('timeSlider')?.value) || 0;
}

// ===================================================================
// 3. Dynamische UI-Updates
// ===================================================================

/**
 * Aktualisiert die Optionen im Dropdown-Menü für die Wettermodelle.
 * @param {string[]} availableModels - Eine Liste der verfügbaren Modellnamen.
 */
export function updateModelSelectUI(availableModels) {
    const modelSelect = document.getElementById('modelSelect');
    if (!modelSelect) return;
    const currentSelected = modelSelect.value;
    modelSelect.innerHTML = '';
    availableModels.forEach(model => {
        const option = document.createElement('option');
        option.value = model;
        option.textContent = model.replace(/_/g, ' ').toUpperCase();
        modelSelect.appendChild(option);
    });
    if (availableModels.includes(Settings.state.userSettings.model)) {
        modelSelect.value = Settings.state.userSettings.model;
    } else if (availableModels.includes(currentSelected)) {
        modelSelect.value = currentSelected;
    } else if (availableModels.length > 0) {
        modelSelect.value = availableModels[0];
    }
}

/**
 * Aktualisiert die Liste der Checkboxen für die Ensemble-Modelle.
 * @param {string[]} availableModels - Eine Liste der verfügbaren Modellnamen.
 */
export function updateEnsembleModelUI(availableModels) {
    const submenu = document.getElementById('ensembleModelsSubmenu');
    if (!submenu) return;
    submenu.innerHTML = '';
    availableModels.forEach(model => {
        // ... (Code zum Erstellen von li, label, checkbox bleibt gleich)
        const li = document.createElement('li');
        const label = document.createElement('label');
        label.className = 'radio-label';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.name = 'ensembleModel';
        checkbox.value = model;
        checkbox.checked = Settings.state.userSettings.selectedEnsembleModels.includes(model);

        // Diesen Event-Listener anpassen
        checkbox.addEventListener('change', async () => {
            const selected = Array.from(submenu.querySelectorAll('input:checked')).map(cb => cb.value);
            Settings.state.userSettings.selectedEnsembleModels = selected;
            Settings.save();

            // 1. Daten abrufen und auf Erfolg warten
            const success = await fetchEnsembleWeatherData();

            // 2. NUR wenn die Daten erfolgreich waren, die Visualisierung anstoßen
            if (success) {
                const sliderIndex = getSliderValue(); // Den UI-Zustand HIER abrufen
                processAndVisualizeEnsemble(sliderIndex); // Und an die Core-Funktion übergeben
            }
        });

        label.append(checkbox, ` ${model.replace(/_/g, ' ').toUpperCase()}`);
        li.appendChild(label);
        submenu.appendChild(li);
    });
}

/**
 * Bereinigt die Liste der ausgewählten Ensemble-Modelle, falls einige nicht mehr verfügbar sind.
 * @param {string[]} availableModels - Eine Liste der verfügbaren Modellnamen.
 */
export function cleanupSelectedEnsembleModels(availableModels) {
    let selected = Settings.state.userSettings.selectedEnsembleModels || [];
    let updated = selected.filter(m => availableModels.includes(m));
    if (selected.length !== updated.length) {
        Settings.state.userSettings.selectedEnsembleModels = updated;
        Settings.save();
    }
}

// ===================================================================
// 4. Benachrichtigungen & Overlays
// ===================================================================


/**
 * Zeigt eine Snackbar-Benachrichtigung am unteren Bildschirmrand an.
 * @param {string} message - Die anzuzeigende Nachricht.
 * @param {'default'|'success'|'error'|'warning'} [type='default'] - Der Typ der Nachricht, der das Aussehen steuert.
 * @private
 */
function showSnackbar(message, type = 'default') {
    let snackbar = document.getElementById('snackbar');
    if (!snackbar) {
        snackbar = document.createElement('div');
        snackbar.id = 'snackbar';
        document.body.appendChild(snackbar);
    }

    snackbar.textContent = message;
    // Setze die Klassen basierend auf dem Typ
    snackbar.className = 'show'; // Startet immer mit 'show'
    if (type === 'success') {
        snackbar.classList.add('success');
    } else if (type === 'error') {
        snackbar.classList.add('error');
    } else if (type === 'warning') { // NEUE Bedingung
        snackbar.classList.add('warning');
    }

    if (window.snackbarTimeout) {
        clearTimeout(window.snackbarTimeout);
    }

    window.snackbarTimeout = setTimeout(() => {
        snackbar.className = snackbar.className.replace('show', '');
    }, 3000);
}

/** Zeigt eine Erfolgsmeldung an. */
export function displayMessage(message) {
    console.log('displayMessage called with:', message);
    // Die neue Funktion mit dem Typ 'success' aufrufen
    showSnackbar(message, 'success');
}

/** Zeigt eine Fehlermeldung an. */
export function displayError(message) {
    console.log('displayError called with:', message);
    // Die neue Funktion mit dem Typ 'error' aufrufen
    showSnackbar(message, 'error');
}

/** Zeigt eine Warnung an. */
export function displayWarning(message) {
    console.log('displayWarning called with:', message);
    showSnackbar(message, 'warning');
}


/**
 * Zeigt eine Fortschritts-Snackbar am unteren Bildschirmrand an.
 * @param {number} current - Der aktuelle Fortschrittswert.
 * @param {number} total - Der Gesamtwert für die Prozentberechnung.
 * @param {function} cancelCallback - Funktion, die bei Klick auf "Abbrechen" aufgerufen wird.
 */
export function displayProgress(current, total, cancelCallback) {
    let progressSnackbar = document.getElementById('progress-snackbar');

    // Erstellt die Snackbar, falls sie noch nicht existiert
    if (!progressSnackbar) {
        progressSnackbar = document.createElement('div');
        progressSnackbar.id = 'progress-snackbar';
        
        const content = document.createElement('div');
        content.className = 'progress-snackbar-content';
        
        const text = document.createElement('div');
        text.className = 'progress-snackbar-text';
        
        const barContainer = document.createElement('div');
        barContainer.className = 'progress-bar-container';
        const bar = document.createElement('div');
        bar.className = 'progress-bar';
        barContainer.appendChild(bar);

        content.appendChild(text);
        content.appendChild(barContainer);

        const cancelButton = document.createElement('button');
        cancelButton.className = 'cancel-button';
        cancelButton.textContent = 'Cancel';
        cancelButton.onclick = () => {
            if (cancelCallback) cancelCallback();
            hideProgress(); // Versteckt die Snackbar beim Abbrechen
        };

        progressSnackbar.appendChild(content);
        progressSnackbar.appendChild(cancelButton);
        document.body.appendChild(progressSnackbar);
    }

    // Aktualisiert den Inhalt der Snackbar
    const percentage = total > 0 ? Math.round((current / total) * 100) : 0;
    progressSnackbar.querySelector('.progress-snackbar-text').textContent = `Caching (${current}/${total})... ${percentage}%`;
    progressSnackbar.querySelector('.progress-bar').style.width = `${percentage}%`;

    // Zeigt die Snackbar an (löst die CSS-Animation aus)
    if (!progressSnackbar.classList.contains('show')) {
        progressSnackbar.classList.add('show');
    }
}

/** Versteckt die Fortschritts-Snackbar. */
export function hideProgress() {
    const progressSnackbar = document.getElementById('progress-snackbar');
    if (progressSnackbar) {
        progressSnackbar.classList.remove('show');
    }
}

/**
 * Zeigt einen Offline-Indikator an oder versteckt ihn.
 */
export function updateOfflineIndicator() {
    console.log('updateOfflineIndicator called, navigator.onLine:', navigator.onLine);
    let offlineIndicator = document.getElementById('offline-indicator');
    
    // Erstellt den Indikator, falls er noch nicht existiert
    if (!offlineIndicator) {
        offlineIndicator = document.createElement('div');
        offlineIndicator.id = 'offline-indicator';
        offlineIndicator.textContent = 'Offline Mode'; // Text muss nur einmal gesetzt werden
        document.body.appendChild(offlineIndicator);
        console.log('Offline indicator created and appended');
    }

    // Steuert die Sichtbarkeit über die CSS-Klasse 'show'
    if (navigator.onLine) {
        offlineIndicator.classList.remove('show');
    } else {
        offlineIndicator.classList.add('show');
    }
}

/**
 * Zeigt den globalen Lade-Spinner an oder versteckt ihn.
 * @param {boolean} show - True, um den Spinner anzuzeigen.
 * @param {string} [message='Loading...'] - Die anzuzeigende Nachricht.
 */
export function toggleLoading(show, message = 'Loading...') {
    const loadingElement = document.getElementById('loading');
    if (!loadingElement) return;

    const textElement = loadingElement.querySelector('p');
    if (show) {
        if (textElement) {
            textElement.textContent = message;
        }
        loadingElement.style.display = 'flex';
    } else {
        loadingElement.style.display = 'none';
    }
}
