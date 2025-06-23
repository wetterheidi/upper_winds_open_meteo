// === Settings Module ===
import { FEATURE_PASSWORD } from './constants.js';

export const getInterpolationStep = () => Settings.getValue('interpStepSelect', 'select', 200); // Umbenannt von getInterpStepSelect für Konsistenz

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
            calculateJump: false
        },
        isJumperSeparationManual: false,
        isLandingPatternUnlocked: false,
        isCalculateJumpUnlocked: false
    },

    /**
     * Initializes settings from localStorage or defaults.
     * Ensures stored settings are merged correctly with defaults.
     */
    initialize() {
        let storedSettings = {};
        let storedUnlockedFeatures = { landingPattern: false, calculateJump: false };

        // Load settings from localStorage
        try {
            const settingsRaw = localStorage.getItem('upperWindsSettings');
            if (settingsRaw) {
                storedSettings = JSON.parse(settingsRaw);
                console.log('Loaded settings from localStorage:', storedSettings);
            } else {
                console.log('No settings found in localStorage, using defaults');
            }
        } catch (error) {
            this.handleError(error, 'Failed to load settings. Using defaults.');
        }

        // Load unlocked features from localStorage
        try {
            const featuresRaw = localStorage.getItem('unlockedFeatures');
            if (featuresRaw) {
                storedUnlockedFeatures = JSON.parse(featuresRaw);
                console.log('Loaded unlocked features from localStorage:', storedUnlockedFeatures);
            } else {
                console.log('No unlocked features found in localStorage, using defaults');
            }
        } catch (error) {
            this.handleError(error, 'Failed to load unlocked features. Using defaults.');
        }

        // Merge stored settings with defaults
        this.state.userSettings = { ...this.defaultSettings, ...storedSettings };
        console.log('Initialized userSettings:', this.state.userSettings);

        // Reset HARP coordinates to null at startup
        this.state.userSettings.harpLat = null;
        this.state.userSettings.harpLng = null;
        console.log('Reset HARP coordinates to null at startup');

        // Reset jumpMasterLineTarget to DIP if it was HARP
        if (this.state.userSettings.jumpMasterLineTarget === 'HARP') {
            console.log('Reset jumpMasterLineTarget to DIP due to cleared HARP coordinates');
            this.state.userSettings.jumpMasterLineTarget = 'DIP';
        }

        // Reset ensemble models
        this.state.userSettings.selectedEnsembleModels = [...this.defaultSettings.selectedEnsembleModels]; // Setzt auf leeres Array (gemäß defaultSettings)
        this.state.userSettings.currentEnsembleScenario = this.defaultSettings.currentEnsembleScenario; // z.B. 'all_models'

        // Update unlocked features
        this.state.unlockedFeatures = {
            landingPattern: storedUnlockedFeatures.landingPattern || false,
            calculateJump: storedUnlockedFeatures.calculateJump || false
        };

        // Validate baseMaps
        const validBaseMaps = ['OpenStreetMap', 'OpenTopoMap', 'Esri Satellite', 'Esri Street', 'Esri Topo', 'Esri Satellite + OSM'];
        if (!validBaseMaps.includes(this.state.userSettings.baseMaps)) {
            console.warn(`Invalid baseMaps setting: ${this.state.userSettings.baseMaps}, resetting to default`);
            this.state.userSettings.baseMaps = this.defaultSettings.baseMaps;
        }

        // Save updated settings to persist the reset
        //this.save();
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
            if (feature === 'landingPattern') {
                this.state.unlockedFeatures.landingPattern = isUnlocked;
                this.state.isLandingPatternUnlocked = isUnlocked;
            } else if (feature === 'calculateJump') {
                this.state.unlockedFeatures.calculateJump = isUnlocked;
                this.state.isCalculateJumpUnlocked = isUnlocked;
            }
            this.saveUnlockedFeatures();
            console.log('Saved unlock status:', {
                landingPattern: this.state.isLandingPatternUnlocked,
                calculateJump: this.state.isCalculateJumpUnlocked
            });
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

        const featureName = feature === 'landingPattern' ? 'Landing Pattern' : 'Calculate Jump';
        header.textContent = `${featureName} Access`;
        message.textContent = `Please enter the password to enable ${featureName.toLowerCase()}:`;

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
     * NEU: Liest den Wert zuerst aus dem Settings-State. Nur wenn der nicht existiert,
     * wird als Fallback das DOM durchsucht.
     * @param {string} name - The name of the setting (key in userSettings).
     * @param {string} type - The UI element type ('radio', 'select', 'checkbox', 'number', 'text').
     * @param {*} defaultValue - The default value if not found anywhere.
     * @returns {*} The setting value.
     */
    getValue(name, type, defaultValue) {
        // 1. Priorität: Versuche, den Wert aus dem geladenen State zu lesen.
        if (this.state.userSettings && typeof this.state.userSettings[name] !== 'undefined') {
            return this.state.userSettings[name];
        }

        // 2. Priorität (Fallback): Wenn im State nichts gefunden wurde, durchsuche das DOM.
        // Das ist nur noch für Elemente nötig, die nicht explizit in den Settings gespeichert werden.
        const selector = type === 'radio' ? `input[name="${name}"]:checked` : `#${name}`;
        const element = document.querySelector(selector);

        if (!element) {
            // Diese Warnung erscheint jetzt nur noch, wenn ein Element WIRKLICH fehlt.
            console.warn(`Setting element not found in DOM for fallback: ${selector}`);
            return defaultValue;
        }

        let value;
        switch (type) {
            case 'checkbox':
                value = element.checked;
                break;
            case 'number':
                value = parseFloat(element.value);
                break;
            default:
                value = element.value;
        }
        return value;
    },

    /**
     * Updates unit-related labels (height, wind, reference) in the UI.
     */
    updateUnitLabels() {
        const heightUnit = this.getValue('heightUnit', 'radio', 'm');
        const windUnit = this.getValue('windUnit', 'radio', 'kt');
        const refLevel = this.getValue('refLevel', 'radio', 'AGL');

        // Update step label
        const stepLabel = document.querySelector('#controls-row label[for="interpStepSelect"]');
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
        return !!this.state.unlockedFeatures[feature];
    }
};