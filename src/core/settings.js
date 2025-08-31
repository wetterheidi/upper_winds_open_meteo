// src/core/settings.js

import { FEATURE_PASSWORD_PLANNER, FEATURE_PASSWORD_DATA } from './config.js';

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
    FEATURE_PASSWORD_PLANNER: FEATURE_PASSWORD_PLANNER,
    FEATURE_PASSWORD_DATA: FEATURE_PASSWORD_DATA,

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
        isInteractionLocked: false,
    },

    state: {
        userSettings: null,
        // DIES IST JETZT DIE EINZIGE QUELLE DER WAHRHEIT FÜR DEN SPERRSTATUS
        unlockedFeatures: {
            planner: false,
            plannerHash: null,
            data: false,
            dataHash: null
        }
    },

    initialize() {
        // 1. Hashes für beide Passwörter erstellen
        const plannerPasswordHash = this.FEATURE_PASSWORD_PLANNER.split('').reduce((acc, char) => (char.charCodeAt(0) + ((acc << 5) - acc)), 0);
        const dataPasswordHash = this.FEATURE_PASSWORD_DATA.split('').reduce((acc, char) => (char.charCodeAt(0) + ((acc << 5) - acc)), 0);

        // 2. Gespeicherte Freischaltungen laden
        let features = { planner: false, plannerHash: null, data: false, dataHash: null };
        try {
            const raw = localStorage.getItem('unlockedFeatures');
            if (raw) {
                features = { ...features, ...JSON.parse(raw) };
            }
        } catch (error) {
            this.handleError(error, 'Failed to load unlocked features.');
        }

        // 3. Status basierend auf den geladenen Daten und aktuellen Hashes validieren
        const isPlannerStillUnlocked = features.planner && features.plannerHash === plannerPasswordHash;
        const isDataStillUnlocked = features.data && features.dataHash === dataPasswordHash;
        
        // 4. Den finalen, bereinigten Zustand direkt im state-Objekt setzen
        this.state.unlockedFeatures = {
            planner: isPlannerStillUnlocked,
            plannerHash: isPlannerStillUnlocked ? plannerPasswordHash : null,
            data: isDataStillUnlocked,
            dataHash: isDataStillUnlocked ? dataPasswordHash : null
        };

        // 5. Den bereinigten Zustand immer zurück in den localStorage schreiben
        this.saveUnlockedFeatures();
        
        // --- Laden der User-Settings (unverändert) ---
        let storedSettings = {};
        try {
            const settingsRaw = localStorage.getItem('upperWindsSettings');
            if (settingsRaw) storedSettings = JSON.parse(settingsRaw);
        } catch (error) {
            this.handleError(error, 'Failed to load settings.');
        }
        this.state.userSettings = { ...this.defaultSettings, ...storedSettings };
        
        // Nicht-persistente Einstellungen zurücksetzen
        this.state.userSettings.isInteractionLocked = false;
        this.state.userSettings.harpLat = null;
        this.state.userSettings.harpLng = null;
        this.state.userSettings.jumpRunTrackOffset = 0;
        this.state.userSettings.jumpRunTrackForwardOffset = 0;
        this.state.userSettings.showCutAwayFinder = false;
    },

    saveUnlockStatus(feature, isUnlocked) {
        if (feature === 'planner') {
            const hash = this.FEATURE_PASSWORD_PLANNER.split('').reduce((acc, char) => (char.charCodeAt(0) + ((acc << 5) - acc)), 0);
            this.state.unlockedFeatures.planner = isUnlocked;
            this.state.unlockedFeatures.plannerHash = isUnlocked ? hash : null;
        } else if (feature === 'data') {
            const hash = this.FEATURE_PASSWORD_DATA.split('').reduce((acc, char) => (char.charCodeAt(0) + ((acc << 5) - acc)), 0);
            this.state.unlockedFeatures.data = isUnlocked;
            this.state.unlockedFeatures.dataHash = isUnlocked ? hash : null;
        }
        this.saveUnlockedFeatures();
    },

    isFeatureUnlocked(feature) {
        if (feature === 'planner') {
            return this.state.unlockedFeatures.planner;
        }
        if (feature === 'data') {
            return this.state.unlockedFeatures.data;
        }
        if (['landingPattern', 'calculateJump'].includes(feature)) {
            return true;
        }
        return false;
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

        const correctPassword = feature === 'planner' ? this.FEATURE_PASSWORD_PLANNER : this.FEATURE_PASSWORD_DATA;

        const featureName = feature.charAt(0).toUpperCase() + feature.slice(1);
        header.textContent = `${featureName} Access`;
        message.textContent = `Please enter the password to enable the ${featureName.toLowerCase()} functionality:`;
        input.value = '';
        error.style.display = 'none';
        modal.style.display = 'flex';

        const submitHandler = () => {
            if (input.value === correctPassword) {
                modal.style.display = 'none';
                this.saveUnlockStatus(feature, true);
                // NEU: Ein Event auslösen, auf das die UI hören kann
                document.dispatchEvent(new CustomEvent('ui:lockStateChanged'));
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

    saveUnlockedFeatures(featuresToSave = this.state.unlockedFeatures) {
        try {
            const featuresString = JSON.stringify(featuresToSave);
            localStorage.setItem('unlockedFeatures', featuresString);
        } catch (error) {
            this.handleError(error, 'Failed to save unlocked features to localStorage.');
        }
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

    updateUnitLabels() {},
    updateModelRunInfo(lastModelRun, lastLat, lastLng) {},
    handleError(error, userMessage = 'An error occurred.') {
        console.error('Settings Error:', error);
        // Utils.handleError(userMessage); // Auskommentiert, falls Utils hier nicht verfügbar ist
    },
};