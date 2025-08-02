// In: src/core/settings.js

import { FEATURE_PASSWORD } from './config.js'; 

export const getInterpolationStep = () => {
    const selectElement = document.getElementById('interpStep');
    if (selectElement) {
        return selectElement.value;
    }
    return '200';
};

let IS_MOBILE_APP = false;

export function setAppContext(isMobile) {
    IS_MOBILE_APP = isMobile;
    console.log(`App context set to: ${IS_MOBILE_APP ? 'Mobile' : 'Web'}`);
}

export const Settings = {
    FEATURE_PASSWORD: 'DZMasterTest',

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
        selectedEnsembleModels: [],
        currentEnsembleScenario: 'all_models',
    },

    state: {
        userSettings: null,
        unlockedFeatures: {
            planner: false,
            plannerHash: null // Nur noch der Planner ist relevant
        },
        isPlannerUnlocked: false // Nur noch dieser Status zählt
    },

    initialize() {
        // 1. Passwort-Hash des aktuellen Passworts in der Konfiguration erstellen
        const currentPasswordHash = this.FEATURE_PASSWORD.split('').reduce((acc, char) => {
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
            this.handleError(error, 'Failed to load unlocked features.');
        }

        // 3. Planner-Feature validieren
        const isPlannerUnlocked = storedUnlockedFeatures.planner && storedUnlockedFeatures.plannerHash === currentPasswordHash;
        if (storedUnlockedFeatures.planner && !isPlannerUnlocked) {
            console.warn("Password for 'planner' has changed. Re-locking feature.");
            storedUnlockedFeatures = { planner: false, plannerHash: null };
            this.saveUnlockedFeatures();
        }

        // 4. Den finalen, validierten Zustand setzen
        this.state.unlockedFeatures = storedUnlockedFeatures;
        this.state.isPlannerUnlocked = isPlannerUnlocked;
        
        // Laden der Benutzereinstellungen
        let storedSettings = {};
        try {
            const settingsRaw = localStorage.getItem('upperWindsSettings');
            if (settingsRaw) storedSettings = JSON.parse(settingsRaw);
        } catch (error) {
            this.handleError(error, 'Failed to load settings.');
        }

        this.state.userSettings = { ...this.defaultSettings, ...storedSettings };
        
        // Zurücksetzen der nicht-persistenten Einstellungen
        this.state.userSettings.harpLat = null;
        this.state.userSettings.harpLng = null;
        this.state.userSettings.jumpRunTrackOffset = 0;
        this.state.userSettings.jumpRunTrackForwardOffset = 0;
        this.state.userSettings.showCutAwayFinder = false;

        console.log('Final initialized state:', {
            isPlannerUnlocked: this.state.isPlannerUnlocked,
        });
    },

    save() {
        const settingsToSave = { ...this.state.userSettings };
        delete settingsToSave.customJumpRunDirection;
        try {
            localStorage.setItem('upperWindsSettings', JSON.stringify(settingsToSave));
        } catch (error) {
            console.error('Failed to save settings to localStorage:', error);
        }
    },

    saveUnlockStatus(feature, isUnlocked) {
        try {
            const passwordHash = this.FEATURE_PASSWORD.split('').reduce((acc, char) => (char.charCodeAt(0) + ((acc << 5) - acc)), 0);

            if (feature === 'planner') {
                this.state.unlockedFeatures.planner = isUnlocked;
                this.state.unlockedFeatures.plannerHash = isUnlocked ? passwordHash : null;
                this.state.isPlannerUnlocked = isUnlocked;
            }
            
            this.saveUnlockedFeatures();
            console.log('Saved unlock status:', this.state.unlockedFeatures);
        } catch (error) {
            Utils.handleError('Failed to save unlock status.');
        }
    },

    showPasswordModal(feature, onSuccess, onCancel) {
        const modal = document.getElementById('passwordModal');
        const input = document.getElementById('passwordInput');
        const error = document.getElementById('passwordError');
        const submitBtn = document.getElementById('passwordSubmit');
        const cancelBtn = document.getElementById('passwordCancel');
        const header = document.getElementById('modalHeader');
        const message = document.getElementById('modalMessage');

        if (!modal || !input || !submitBtn || !cancelBtn || !header || !message) return;

        const featureName = feature.charAt(0).toUpperCase() + feature.slice(1);
        header.textContent = `${featureName} Access`;
        message.textContent = `Please enter the password to enable the ${featureName.toLowerCase()} functionality:`;
        input.value = '';
        error.style.display = 'none';
        modal.style.display = 'flex';

        const submitHandler = () => {
            if (input.value === this.FEATURE_PASSWORD) {
                modal.style.display = 'none';
                this.saveUnlockStatus(feature, true);
                onSuccess();
            } else {
                error.textContent = 'Incorrect password';
                error.style.display = 'block';
            }
        };

        submitBtn.onclick = submitHandler;
        input.onkeypress = (e) => { if (e.key === 'Enter') submitHandler(); };
        cancelBtn.onclick = () => {
            modal.style.display = 'none';
            onCancel();
        };
    },

    saveUnlockedFeatures() {
        try {
            const featuresString = JSON.stringify(this.state.unlockedFeatures);
            localStorage.setItem('unlockedFeatures', featuresString);
        } catch (error) {
            this.handleError(error, 'Failed to save unlocked features to localStorage.');
        }
    },
    
    getValue(name, type, defaultValue) {
        if (defaultValue === undefined && typeof type !== 'string') {
            defaultValue = type;
            type = null;
        }
        if (this.state.userSettings && typeof this.state.userSettings[name] !== 'undefined') {
            return this.state.userSettings[name];
        }
        const radioElement = document.querySelector(`input[name="${name}"]:checked`);
        if (radioElement) return radioElement.value;
        const selectElement = document.getElementById(name);
        if (selectElement && selectElement.tagName === 'SELECT') return selectElement.value;
        const checkboxElement = document.getElementById(name);
        if (checkboxElement && checkboxElement.type === 'checkbox') return checkboxElement.checked;
        return defaultValue;
    },

    updateUnitLabels() {
        // Diese Funktion bleibt unverändert
    },

    updateModelRunInfo(lastModelRun, lastLat, lastLng) {
        // Diese Funktion bleibt unverändert
    },

    handleError(error, userMessage = 'An error occurred.') {
        console.error('Settings Error:', error);
        Utils.handleError(userMessage);
    },

isFeatureUnlocked(feature) {
        if (feature === 'planner') {
            return this.state.isPlannerUnlocked;
        }
        // Alle anderen Features sind jetzt nicht mehr separat gesperrt.
        // Ihre Verfügbarkeit wird nur durch die Sichtbarkeit des Planner-Tabs gesteuert.
        if (feature === 'landingPattern' || feature === 'calculateJump') {
            return true;
        }
        return !!this.state.unlockedFeatures[feature] || false;
    }
};