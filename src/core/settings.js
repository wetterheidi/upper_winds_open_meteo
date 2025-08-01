// === Settings Module ===
import { FEATURE_PASSWORD } from './config.js';

export const getInterpolationStep = () => {
    const selectElement = document.getElementById('interpStep');
    // Direkter Zugriff auf den aktuellen Wert des UI-Elements
    if (selectElement) {
        return selectElement.value;
    }
    // Fallback, falls das Element nicht gefunden wird
    return '200';
};

// Kontextkonstante (muss von main-mobile.js oder main-web.js gesetzt werden)
let IS_MOBILE_APP = false; // Standardmäßig false, wird in main-mobile.js überschrieben

// Funktion zum Setzen des Kontexts
export function setAppContext(isMobile) {
    IS_MOBILE_APP = isMobile;
    console.log(`App context set to: ${IS_MOBILE_APP ? 'Mobile' : 'Web'}`);
}

export const Settings = {
    // Constants
    FEATURE_PASSWORD: 'skydiver2025',



    defaultSettings: {
        model: 'icon_global',
        refLevel: 'AGL',
        heightUnit: 'm',
        temperatureUnit: 'C',
        windUnit: 'kt',
        timeZone: 'Z',
        coordFormat: 'Decimal',
        downloadFormat: 'HEIDIS',
        showTable: false,
        canopySpeed: 20,
        descentRate: 3.5,
        showLandingPattern: false,
        landingDirection: 'LL',
        customLandingDirectionLL: '',
        customLandingDirectionRR: '',
        legHeightDownwind: 300,
        legHeightBase: 200,
        legHeightFinal: 100,
        interpStep: '200',
        lowerLimit: 0,
        upperLimit: 3000,
        baseMaps: 'Esri Street',
        calculateJump: true,
        openingAltitude: 1200,
        exitAltitude: 3000,
        showJumpRunTrack: false,
        showExitArea: false,
        showCanopyArea: false,
        showCutAwayFinder: false,
        jumpRunTrackOffset: 0,
        jumpRunTrackForwardOffset: 0,
        aircraftSpeedKt: 90,
        jumperSeparation: 5,
        numberOfJumpers: 5,
        cutAwayAltitude: 1000,
        cutAwayState: 'Partially',
        trackPosition: false,
        showJumpMasterLine: false,
        jumpMasterLineTarget: 'DIP',
        harpLat: null,
        harpLng: null,
        cacheRadiusKm: 10,
        cacheZoomLevels: [11, 12, 13, 14],
        autoupdate: false,
        selectedEnsembleModels: [], // Standardmäßig keine Ensemble-Modelle ausgewählt
        currentEnsembleScenario: 'all_models', // Standard-Szenario
    },

    // State
    state: {
        userSettings: null,
        unlockedFeatures: {
            landingPattern: false,
            calculateJump: false,
            planner: false
        },
        isJumperSeparationManual: false,
        isLandingPatternUnlocked: false,
        isCalculateJumpUnlocked: false,
        isPlannerUnlocked: false
    },

    /**
     * Initializes settings from localStorage or defaults.
     * Ensures stored settings are merged correctly with defaults.
     */
    initialize() {
        // 1. Passwort-Hash des aktuellen Passworts in der Konfiguration erstellen
        const currentPasswordHash = FEATURE_PASSWORD.split('').reduce((acc, char) => {
            return char.charCodeAt(0) + ((acc << 5) - acc);
        }, 0);

        // 2. Gespeicherte Freischaltungen laden
        let storedUnlockedFeatures = { planner: false, plannerHash: null };
        try {
            const featuresRaw = localStorage.getItem('unlockedFeatures');
            if (featuresRaw) {
                storedUnlockedFeatures = { ...storedUnlockedFeatures, ...JSON.parse(featuresRaw) };
            }
        } catch (error) {
            this.handleError(error, 'Failed to load unlocked features. Using defaults.');
        }

        // 3. Jedes Feature validieren
        const isPlannerUnlocked = storedUnlockedFeatures.planner && storedUnlockedFeatures.plannerHash === currentPasswordHash;

        if (storedUnlockedFeatures.planner && !isPlannerUnlocked) {
            console.warn("Password for 'planner' has changed. Re-locking feature.");
            storedUnlockedFeatures = { planner: false, plannerHash: null }; // Komplett zurücksetzen
            this.saveUnlockedFeatures(); // Den neuen, gesperrten Zustand sofort speichern
        }

        // 4. Den finalen, validierten Zustand setzen
        this.state.unlockedFeatures = storedUnlockedFeatures;
        this.state.isPlannerUnlocked = isPlannerUnlocked;
        
        // Laden der Benutzereinstellungen (unverändert)
        let storedSettings = {};
        try {
            const settingsRaw = localStorage.getItem('upperWindsSettings');
            if (settingsRaw) {
                storedSettings = JSON.parse(settingsRaw);
            }
        } catch (error) {
            this.handleError(error, 'Failed to load settings. Using defaults.');
        }

        this.state.userSettings = { ...this.defaultSettings, ...storedSettings };

        // ... (Ihr restlicher Code zum Zurücksetzen von HARP, Offsets, etc. bleibt hier)
        this.state.userSettings.harpLat = null;
        this.state.userSettings.harpLng = null;
        if (this.state.userSettings.jumpMasterLineTarget === 'HARP') {
            this.state.userSettings.jumpMasterLineTarget = 'DIP';
        }
        this.state.userSettings.jumpRunTrackOffset = 0;
        this.state.userSettings.jumpRunTrackForwardOffset = 0;
        this.state.userSettings.showCutAwayFinder = false;
        
        console.log('Final initialized state:', {
            isPlannerUnlocked: this.state.isPlannerUnlocked,
            userSettings: this.state.userSettings
        });
    },

    /**
     * Saves settings and feature unlock status to localStorage.
     * Includes validation to ensure data is serializable.
     */
    save() {
        const settingsToSave = { ...this.state.userSettings };
        // Entferne customJumpRunDirection, um es nicht zu persistieren
        delete settingsToSave.customJumpRunDirection;
        try {
            localStorage.setItem('upperWindsSettings', JSON.stringify(settingsToSave));
            console.log('Settings saved to localStorage:', settingsToSave);
        } catch (error) {
            console.error('Failed to save settings to localStorage:', error);
        }
    },


    saveUnlockStatus(feature, isUnlocked) {
        try {
            // Erstellen eines einfachen Hash-Wertes des aktuellen Passworts
            const passwordHash = this.FEATURE_PASSWORD.split('').reduce((acc, char) => {
                return char.charCodeAt(0) + ((acc << 5) - acc);
            }, 0);

            if (feature === 'landingPattern') {
                this.state.unlockedFeatures.landingPattern = isUnlocked;
                this.state.unlockedFeatures.landingPatternHash = isUnlocked ? passwordHash : null; // Hash speichern
                this.state.isLandingPatternUnlocked = isUnlocked;
            } else if (feature === 'calculateJump') {
                this.state.unlockedFeatures.calculateJump = isUnlocked;
                this.state.unlockedFeatures.calculateJumpHash = isUnlocked ? passwordHash : null; // Hash speichern
            } else if (feature === 'planner') {
                this.state.unlockedFeatures.planner = isUnlocked;
                this.state.unlockedFeatures.plannerHash = isUnlocked ? passwordHash : null; // Hash speichern
                this.state.isPlannerUnlocked = isUnlocked;
            }

            this.saveUnlockedFeatures(); // Diese Funktion speichert das ganze unlockedFeatures-Objekt
            console.log('Saved unlock status with password hash:', this.state.unlockedFeatures);
        } catch (error) {
            Utils.handleError('Failed to save unlock status.');
        }
    },

    showPasswordModal(feature, onSuccess, onCancel) {
        console.log('Entering showPasswordModal for feature:', feature);
        const modal = document.getElementById('passwordModal');
        const input = document.getElementById('passwordInput');
        const error = document.getElementById('passwordError');
        const submitBtn = document.getElementById('passwordSubmit');
        const cancelBtn = document.getElementById('passwordCancel');
        const header = document.getElementById('modalHeader');
        const message = document.getElementById('modalMessage');

        if (!modal || !input || !submitBtn || !cancelBtn || !header || !message) {
            console.error('Modal elements not found:', { modal, input, submitBtn, cancelBtn, header, message });
            return;
        }

        const featureName = feature.charAt(0).toUpperCase() + feature.slice(1); // Macht aus 'planner' -> 'Planner'
        header.textContent = `${featureName} Access`;
        message.textContent = `Please enter the password to enable the ${featureName.toLowerCase()} functionality:`;

        input.value = '';
        error.style.display = 'none';
        modal.style.display = 'flex';
        console.log('Password modal should now be visible:', { modalDisplay: modal.style.display });

        const submitHandler = () => {
            console.log('Password modal submit clicked, entered value:', input.value);
            if (input.value === FEATURE_PASSWORD) {
                modal.style.display = 'none';
                this.saveUnlockStatus(feature, true);
                if (feature === 'landingPattern') {
                    const checkbox = document.getElementById('showLandingPattern');
                    if (checkbox) {
                        checkbox.style.opacity = '1';
                        checkbox.title = '';
                    }
                } else if (feature === 'calculateJump') {
                    const menuItem = document.querySelector('.menu-label[data-label="calculateJump"]');
                    if (menuItem) {
                        menuItem.style.opacity = '1';
                        menuItem.title = '';
                    }
                }
                console.log('Feature unlocked:', feature);
                onSuccess();
            } else {
                error.textContent = 'Incorrect password';
                error.style.display = 'block';
                console.log('Incorrect password entered');
            }
        };

        submitBtn.onclick = submitHandler;
        input.onkeypress = (e) => { if (e.key === 'Enter') submitHandler(); };
        cancelBtn.onclick = () => {
            modal.style.display = 'none';
            console.log('Password modal cancelled');
            onCancel();
        };
    },

    saveUnlockedFeatures() {
        try {
            const featuresString = JSON.stringify(this.state.unlockedFeatures);
            localStorage.setItem('unlockedFeatures', featuresString);
            console.log('Unlocked features saved:', JSON.parse(featuresString));
        } catch (error) {
            this.handleError(error, 'Failed to save unlocked features to localStorage.');
        }
    },

    /**
     * Retrieves the value of a setting.
     * FINAL & ROBUST: This version is backward-compatible.
     * It handles calls with 2 arguments (name, defaultValue) from the refactored mobile app
     * and calls with 3 arguments (name, type, defaultValue) from the legacy web app.
     *
     * @param {string} name - The name of the setting.
     * @param {string|any} [type] - Optional. The type of the element ('radio', 'select', etc.) OR the default value if the third argument is omitted.
     * @param {any} [defaultValue] - Optional. The default value.
     * @returns {*} The setting value.
     */
    getValue(name, type, defaultValue) {
        // Handle flexible arguments: If called as getValue(name, defaultValue)
        if (defaultValue === undefined && typeof type !== 'string') {
            defaultValue = type;
            type = null; // Indicates that the type was not explicitly provided
        }

        // 1. Priority: Always try to read from the loaded state first. This is the most reliable source.
        if (this.state.userSettings && typeof this.state.userSettings[name] !== 'undefined') {
            return this.state.userSettings[name];
        }

        // 2. Fallback: Query the DOM. This is crucial for the web app's initial load
        //    and for cases where a setting is not explicitly saved in userSettings.

        // Try radio buttons first (for ui-web)
        const radioElement = document.querySelector(`input[name="${name}"]:checked`);
        if (radioElement) {
            return radioElement.value;
        }

        // Try select elements next (for ui-mobile)
        const selectElement = document.getElementById(name);
        if (selectElement && selectElement.tagName === 'SELECT') {
            return selectElement.value;
        }

        // Try a checkbox by its ID
        const checkboxElement = document.getElementById(name);
        if (checkboxElement && checkboxElement.type === 'checkbox') {
            return checkboxElement.checked;
        }

        // If nothing is found in state or DOM, return the provided default value.
        return defaultValue;
    },

    /**
     * Updates unit-related labels (height, wind, reference) in the UI.
     */
    updateUnitLabels() {
        const heightUnit = this.getValue('heightUnit', 'radio', 'm');
        const windUnit = this.getValue('windUnit', 'radio', 'kt');
        const refLevel = this.getValue('refLevel', 'radio', 'AGL');

        // Update step label
        const stepLabel = document.querySelector('#controls-row label[for="interpStep"]');
        if (stepLabel) {
            stepLabel.textContent = `Step (${heightUnit}):`;
            console.log(`Updated step label to: Step (${heightUnit})`);
        }

        // Update limit labels
        const lowerLabel = document.querySelector('label[for="lowerLimit"]');
        const upperLabel = document.querySelector('label[for="upperLimit"]');
        if (lowerLabel) {
            lowerLabel.textContent = `Lower Limit (${heightUnit}):`;
            console.log(`Updated lower limit label to: Lower Limit (${heightUnit})`);
        }
        if (upperLabel) {
            upperLabel.textContent = `Upper Limit (${heightUnit}):`;
            console.log(`Updated upper limit label to: Upper Limit (${heightUnit})`);
        }

        // Update mean wind result
        const meanWindResult = document.getElementById('meanWindResult');
        if (meanWindResult?.innerHTML) {
            let updatedText = meanWindResult.innerHTML;

            // Update height and reference
            const heightRegex = /\((\d+)-(\d+) m\b[^)]*\)/;
            if (heightRegex.test(updatedText)) {
                const [_, lower, upper] = updatedText.match(heightRegex);
                const newLower = this.convertHeight(parseFloat(lower), heightUnit);
                const newUpper = this.convertHeight(parseFloat(upper), heightUnit);
                updatedText = updatedText.replace(heightRegex, `(${Math.round(newLower)}-${Math.round(newUpper)} ${heightUnit} ${refLevel})`);
                console.log(`Updated mean wind height: (${Math.round(newLower)}-${Math.round(newUpper)} ${heightUnit} ${refLevel})`);
            }

            // Update wind speed
            const windRegex = /: (\d+(?:\.\d+)?)\s*([a-zA-Z\/]+)$/;
            if (windRegex.test(updatedText)) {
                const [_, speedValue, currentUnit] = updatedText.match(windRegex);
                const numericSpeed = parseFloat(speedValue);
                if (!isNaN(numericSpeed)) {
                    const newSpeed = this.convertWind(numericSpeed, windUnit, currentUnit);
                    const formattedSpeed = newSpeed === 'N/A' ? 'N/A' : (windUnit === 'bft' ? Math.round(newSpeed) : newSpeed.toFixed(1));
                    updatedText = updatedText.replace(windRegex, `: ${formattedSpeed} ${windUnit}`);
                    console.log(`Updated mean wind speed: ${formattedSpeed} ${windUnit}`);
                }
            }

            meanWindResult.innerHTML = updatedText;
        }
    },

    /**
     * Updates the model run information label.
     * @param {string} lastModelRun - The last model run timestamp.
     * @param {number} lastLat - Last latitude.
     * @param {number} lastLng - Last longitude.
     */
    updateModelRunInfo(lastModelRun, lastLat, lastLng) {
        const modelLabel = document.getElementById('modelLabel');
        const modelSelect = document.getElementById('modelSelect');
        if (!modelLabel || !modelSelect) {
            console.warn('Model run info elements missing:', { modelLabel, modelSelect, lastModelRun, lastLat, lastLng });
            return;
        }
        if (!lastModelRun) {
            console.log('lastModelRun is falsy, setting default model run info:', { lastModelRun, lastLat, lastLng });
            modelLabel.title = `Model: ${modelSelect.value.replace('_', ' ').toUpperCase()}\nRun: Not available`;
            return;
        }
        const model = modelSelect.value;
        const titleContent = `Model: ${model.replace('_', ' ').toUpperCase()}\nRun: ${lastModelRun}`;
        modelLabel.title = titleContent;
        console.log(`Updated model run info: ${titleContent}`, { lastModelRun, model, lastLat, lastLng });
    },

    /**
     * Centralized error handler for settings operations.
     * @param {Error|string} error - The error object or message.
     * @param {string} userMessage - The message to display to the user.
     */
    handleError(error, userMessage = 'An error occurred. Please try again.') {
        console.error('Settings Error:', error);
        Utils.handleError(userMessage);
    },

    /**
     * Converts height between units.
     * @param {number} value - Height value.
     * @param {string} targetUnit - Target unit ('m', 'ft').
     * @returns {number} Converted height.
     */
    convertHeight(value, targetUnit) {
        if (isNaN(value)) return value;
        return targetUnit === 'ft' ? value * 3.28084 : value;
    },

    /**
     * Converts wind speed between units.
     * @param {number} value - Wind speed.
     * @param {string} targetUnit - Target unit ('kt', 'm/s', 'km/h', 'mph', 'bft').
     * @param {string} currentUnit - Current unit.
     * @returns {number|string} Converted speed or 'N/A'.
     */
    convertWind(value, targetUnit, currentUnit) {
        if (isNaN(value)) return 'N/A';
        const conversions = {
            'kt': { 'm/s': value => value * 0.514444, 'km/h': value => value * 1.852, 'mph': value => value * 1.15078, 'bft': value => this.ktToBeaufort(value) },
            'm/s': { 'kt': value => value / 0.514444, 'km/h': value => value * 3.6, 'mph': value => value * 2.23694, 'bft': value => this.ktToBeaufort(value / 0.514444) },
            // Add other conversions as needed
        };
        return conversions[currentUnit]?.[targetUnit]?.(value) || value;
    },

    /**
     * Converts knots to Beaufort scale (stub).
     * @param {number} kt - Speed in knots.
     * @returns {number} Beaufort scale value.
     */
    ktToBeaufort(knots) {
        // Implement Beaufort conversion logic
        if (knots < 1) return 0;
        if (knots <= 3) return 1;
        if (knots <= 6) return 2;
        if (knots <= 10) return 3;
        if (knots <= 16) return 4;
        if (knots <= 21) return 5;
        if (knots <= 27) return 6;
        if (knots <= 33) return 7;
        if (knots <= 40) return 8;
        if (knots <= 47) return 9;
        if (knots <= 55) return 10;
        if (knots <= 63) return 11;
        return 12;
    },

    /**
     * Checks if a feature is unlocked.
     * @param {string} feature - Feature name ('landingPattern', 'calculateJump').
     * @returns {boolean} True if unlocked.
     */
isFeatureUnlocked(feature) {
        // Diese Funktion prüft jetzt einfach den finalen Zustand, der in `initialize` festgelegt wurde.
        if (feature === 'planner') {
            return this.state.isPlannerUnlocked;
        }
        // Für andere Features (falls Sie welche hinzufügen)
        return !!this.state.unlockedFeatures[feature] || false;
    }
};