// ui.js
import { Utils } from './utils.js';

export function isMobileDevice() {
    const isMobile = window.innerWidth < 768;
    console.log(`isMobileDevice check: window.innerWidth=${window.innerWidth}, isMobile=${isMobile}`);
    return isMobile;
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
    }, 3000);
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
    }, 3000);
}