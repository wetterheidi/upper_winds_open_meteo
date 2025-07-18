// ui.js
import { Utils } from '../core/utils.js';
import { Settings } from '../core/settings.js';
import { fetchEnsembleWeatherData, processAndVisualizeEnsemble } from '../core/ensembleManager.js';
import { UI_DEFAULTS } from '../core/constants.js';

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

export function applyDeviceSpecificStyles() {
    if (isMobileDevice()) {
        document.body.classList.add('touch-device');
    }
}

export function displayMessage(message) {
    console.log('displayMessage called with:', message);
    let messageElement = document.getElementById('message');
    if (!messageElement) {
        messageElement = document.createElement('div');
        messageElement.id = 'message';
        messageElement.style.position = 'fixed';
        messageElement.style.top = '5px';
        messageElement.style.right = '5px';
        messageElement.style.width = isMobileDevice() ? '70%' : '30%';
        messageElement.style.backgroundColor = '#ccffcc';
        messageElement.style.borderRadius = '5px 5px 5px 5px';
        messageElement.style.color = '#000000';
        messageElement.style.padding = '6px';
        messageElement.style.zIndex = '9998';
        messageElement.style.textAlign = 'center';
        document.body.appendChild(messageElement);
        window.addEventListener('resize', () => {
            messageElement.style.width = isMobileDevice() ? '70%' : '30%';
        });
    }
    messageElement.textContent = message;
    messageElement.style.display = 'block';
    clearTimeout(window.messageTimeout);
    window.messageTimeout = setTimeout(() => {
        messageElement.style.display = 'none';
    }, UI_DEFAULTS.MESSAGE_TIMEOUT_MS);
}

export function displayProgress(current, total, cancelCallback) {
    const percentage = Math.round((current / total) * 100);
    let progressElement = document.getElementById('progress');
    if (!progressElement) {
        progressElement = document.createElement('div');
        progressElement.id = 'progress';
        progressElement.style.position = 'fixed';
        progressElement.style.top = '5px';
        progressElement.style.right = '5px';
        progressElement.style.width = isMobileDevice() ? '70%' : '30%';
        progressElement.style.backgroundColor = '#ccffcc';
        progressElement.style.borderRadius = '5px 5px 5px 5px';
        progressElement.style.color = '#000000';
        progressElement.style.padding = '6px';
        progressElement.style.zIndex = '9998';
        progressElement.style.display = 'flex';
        progressElement.style.alignItems = 'center';
        progressElement.style.gap = '10px';
        document.body.appendChild(progressElement);
        window.addEventListener('resize', () => {
            progressElement.style.width = isMobileDevice() ? '70%' : '30%';
        });
    }
    const progressContainer = document.createElement('div');
    progressContainer.style.flex = '1';
    progressContainer.style.display = 'flex';
    progressContainer.style.flexDirection = 'column';
    progressContainer.style.gap = '3px';
    const progressText = document.createElement('div');
    progressText.textContent = `Caching (${current}/${total}, ${percentage}%)`;
    progressText.style.fontSize = '12px';
    progressText.style.textAlign = 'center';
    const progressBarContainer = document.createElement('div');
    progressBarContainer.style.width = '100%';
    progressBarContainer.style.height = '8px';
    progressBarContainer.style.backgroundColor = '#e0e0e0';
    progressBarContainer.style.borderRadius = '3px';
    progressBarContainer.style.overflow = 'hidden';
    const progressBar = document.createElement('div');
    progressBar.style.width = `${percentage}%`;
    progressBar.style.height = '100%';
    progressBar.style.backgroundColor = '#4caf50';
    progressBar.style.transition = 'width 0.3s ease-in-out';
    progressBarContainer.appendChild(progressBar);
    progressContainer.appendChild(progressText);
    progressContainer.appendChild(progressBarContainer);
    let cancelButton = document.getElementById('cancel-caching');
    if (!cancelButton) {
        cancelButton = document.createElement('button');
        cancelButton.id = 'cancel-caching';
        cancelButton.textContent = 'Cancel';
        cancelButton.style.backgroundColor = '#ff4444';
        cancelButton.style.color = '#ffffff';
        cancelButton.style.border = 'none';
        cancelButton.style.borderRadius = '3px';
        cancelButton.style.padding = '5px 3px';
        cancelButton.style.cursor = 'pointer';
        cancelButton.style.fontSize = '12px';
        cancelButton.addEventListener('click', () => {
            cancelCallback();
            progressElement.style.display = 'none';
            Utils.handleMessage('Caching cancelled.');
        });
    }
    progressElement.innerHTML = '';
    progressElement.appendChild(progressContainer);
    progressElement.appendChild(cancelButton);
    progressElement.style.display = 'flex';
}

export function hideProgress() {
    const progressElement = document.getElementById('progress');
    if (progressElement) {
        progressElement.style.display = 'none';
    }
}

export function updateOfflineIndicator() {
    console.log('updateOfflineIndicator called, navigator.onLine:', navigator.onLine);
    let offlineIndicator = document.getElementById('offline-indicator');
    if (!offlineIndicator) {
        offlineIndicator = document.createElement('div');
        offlineIndicator.id = 'offline-indicator';
        document.body.appendChild(offlineIndicator);
        console.log('Offline indicator created and appended');
    }
    offlineIndicator.style.display = navigator.onLine ? 'none' : 'block';
    offlineIndicator.textContent = 'Offline Mode';
}

export function displayError(message) {
    console.log('displayError called with:', message);
    let errorElement = document.getElementById('error-message');
    if (!errorElement) {
        errorElement = document.createElement('div');
        errorElement.id = 'error-message';
        document.body.appendChild(errorElement);
        window.addEventListener('resize', () => {
            errorElement.style.width = isMobileDevice() ? '70%' : '30%';
        });
    }
    errorElement.textContent = message;
    errorElement.style.display = 'block';
    console.log('Error element state:', {
        display: errorElement.style.display,
        text: errorElement.textContent,
        position: errorElement.style.position,
        zIndex: errorElement.style.zIndex
    });
    clearTimeout(window.errorTimeout);
    window.errorTimeout = setTimeout(() => {
        errorElement.style.display = 'none';
        console.log('Error hidden after 3s');
    }, UI_DEFAULTS.MESSAGE_TIMEOUT_MS);
}

export function getSliderValue() {
    return parseInt(document.getElementById('timeSlider')?.value) || 0;
}

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

export function cleanupSelectedEnsembleModels(availableModels) {
    let selected = Settings.state.userSettings.selectedEnsembleModels || [];
    let updated = selected.filter(m => availableModels.includes(m));
    if (selected.length !== updated.length) {
        Settings.state.userSettings.selectedEnsembleModels = updated;
        Settings.save();
    }
}
