// autoupdateManager.js
"use strict";

import { AppState } from './state.js';
import { Settings } from './settings.js';
import { Utils } from './utils.js';
import { displayError, displayMessage } from '../ui-web/ui.js';

/**
 * Startet den Intervall-Timer für die automatische Aktualisierung.
 * Löst sofort ein initiales Update aus und prüft danach minütlich,
 * ob eine neue Stunde begonnen hat, um dann ein 'autoupdate:tick'-Event auszulösen.
 * @returns {void}
 * @private
 */
function startAutoupdate() {
    if (AppState.autoupdateInterval) {
        console.log('[AutoupdateManager] Autoupdate is already running.');
        return; 
    }
    if (!navigator.onLine) {
        Utils.handleError('Cannot enable autoupdate while offline.');
        const autoupdateCheckbox = document.getElementById('autoupdateCheckbox');
        if (autoupdateCheckbox) autoupdateCheckbox.checked = false;
        Settings.state.userSettings.autoupdate = false;
        Settings.save();
        return;
    }

    console.log('[AutoupdateManager] Starting autoupdate interval.');
    // Trigger an immediate update check on start
    document.dispatchEvent(new CustomEvent('autoupdate:tick', { detail: { isInitialTick: true } }));
    
    // Check every minute for hour changes
    AppState.autoupdateInterval = setInterval(() => {
        console.log('[AutoupdateManager] Tick...');
        document.dispatchEvent(new CustomEvent('autoupdate:tick', { detail: { isInitialTick: false } }));
    }, 60 * 1000); // Every minute

    displayMessage('Autoupdate enabled');
}

/**
 * Stoppt den laufenden Intervall-Timer für die automatische Aktualisierung.
 * @returns {void}
 */
export function stopAutoupdate() {
    if (AppState.autoupdateInterval) {
        clearInterval(AppState.autoupdateInterval);
        AppState.autoupdateInterval = null;
        console.log('[AutoupdateManager] Stopped autoupdate interval.');
        displayMessage('Autoupdate disabled');
    }
}

/**
 * Initialisiert die Autoupdate-Funktionalität.
 * Richtet den Event-Listener für die Autoupdate-Checkbox in der UI ein
 * und startet den Autoupdate-Prozess, falls er beim Laden der Seite bereits aktiviert war.
 * @returns {void}
 */
export function setupAutoupdate() {
    const autoupdateCheckbox = document.getElementById('autoupdateCheckbox');
    if (!autoupdateCheckbox) {
        console.warn('[AutoupdateManager] Autoupdate checkbox not found.');
        return;
    }

    autoupdateCheckbox.checked = Settings.state.userSettings.autoupdate;

    autoupdateCheckbox.addEventListener('change', () => {
        Settings.state.userSettings.autoupdate = autoupdateCheckbox.checked;
        Settings.save();

        const historicalDatePicker = document.getElementById('historicalDatePicker');
        if (autoupdateCheckbox.checked && historicalDatePicker?.value) {
            autoupdateCheckbox.checked = false;
            Settings.state.userSettings.autoupdate = false;
            Settings.save();
            displayError('Autoupdate cannot be enabled with a historical date set.');
            return;
        }

        if (autoupdateCheckbox.checked) {
            startAutoupdate();
        } else {
            stopAutoupdate();
        }
    });

    // Start autoupdate if it was enabled on page load
    if (Settings.state.userSettings.autoupdate && !document.getElementById('historicalDatePicker')?.value) {
        startAutoupdate();
    }
}