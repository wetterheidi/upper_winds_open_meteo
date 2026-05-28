import { AppState } from './state.js';
import { Settings } from './settings.js';
import { Utils } from './utils.js';
import { I18n } from './i18n.js';

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
        Utils.handleError(I18n.t('autoupdate.error_offline'));
        const autoupdateCheckbox = document.getElementById('autoupdateCheckbox');
        if (autoupdateCheckbox) autoupdateCheckbox.checked = false;
        Settings.state.userSettings.autoupdate = false;
        Settings.save();
        return;
    }

    console.log('[AutoupdateManager] Starting autoupdate interval.');
    document.dispatchEvent(new CustomEvent('autoupdate:tick', { detail: { isInitialTick: true } }));

    AppState.autoupdateInterval = setInterval(() => {
        console.log('[AutoupdateManager] Tick...');
        document.dispatchEvent(new CustomEvent('autoupdate:tick', { detail: { isInitialTick: false } }));
    }, 60 * 1000);

    Utils.handleMessage(I18n.t('autoupdate.enabled'));
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
        Utils.handleMessage(I18n.t('autoupdate.disabled'));
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
            // Ersetzt: 'Autoupdate cannot be enabled with a historical date set.'
            Utils.handleError(I18n.t('autoupdate.error_historical_date')); 
            return;
        }

        if (autoupdateCheckbox.checked) {
            startAutoupdate();
        } else {
            stopAutoupdate();
        }
    });

    if (Settings.state.userSettings.autoupdate && !document.getElementById('historicalDatePicker')?.value) {
        startAutoupdate();
    }
}