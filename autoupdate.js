const AutoUpdate = {
    autoupdateState: false,
    intervalId: null,
    keepAliveId: null,
    // Mock weather data timestamps (7 days from 2025-05-17T00:00Z)
    timestamps: Array.from({ length: 192 }, (_, i) => {
        const date = new Date('2025-05-17T00:00:00.000Z');
        date.setHours(date.getHours() + i);
        return date.toISOString().replace(':00.000Z', 'Z');
    }),

    applyButtonStyles(button, isOn) {
        if (!button) {
            console.warn('applyButtonStyles: Button not found');
            return;
        }
        button.setAttribute('data-autoupdate', isOn ? 'on' : 'off');
        button.style.cssText = isOn
            ? 'background-color: #4caf50 !important; color: white !important; opacity: 1 !important; z-index: 1000 !important; display: inline-block !important; visibility: visible !important;'
            : 'background-color: #ccc !important; color: black !important; opacity: 1 !important; z-index: 1000 !important; display: inline-block !important; visibility: visible !important;';
        console.log(`Applied autoupdate-${isOn ? 'on' : 'off'} inline styles`);
        const computedStyle = window.getComputedStyle(button);
        console.log('Computed button styles:', {
            backgroundColor: computedStyle.backgroundColor,
            color: computedStyle.color
        });
    },

    getLastFullHourUTC() {
        const now = new Date();
        now.setUTCMinutes(0, 0, 0);
        return now;
    },

    startAutoupdate() {
        if (this.intervalId) {
            console.log('Autoupdate already running, skipping');
            return;
        }

        const updateSlider = () => {
            if (!this.autoupdateState) {
                console.log('Autoupdate disabled, exiting');
                return;
            }

            console.log('Running updateSlider check at:', new Date().toISOString());
            const currentHour = this.getLastFullHourUTC();
            const currentHourStr = currentHour.toISOString().replace(':00.000Z', 'Z');
            console.log('Autoupdate checking current hour:', currentHourStr);

            // Calculate slider index from forecast start (2025-05-17T00:00Z)
            const forecastStart = new Date('2025-05-17T00:00:00.000Z');
            const hoursSinceStart = Math.floor((currentHour - forecastStart) / (1000 * 60 * 60));
            const sliderIndex = hoursSinceStart;
            console.log('Calculated slider index:', sliderIndex, 'for hour:', currentHourStr);

            // Validate timestamp
            if (!this.timestamps.includes(currentHourStr)) {
                console.warn('Current hour not in timestamps:', currentHourStr);
                return;
            }

            // Update slider
            const slider = document.getElementById('timeSlider');
            if (slider) {
                const maxIndex = parseInt(slider.max) || 191;
                const minIndex = parseInt(slider.min) || 0;
                if (sliderIndex >= minIndex && sliderIndex <= maxIndex) {
                    if (parseInt(slider.value) !== sliderIndex) {
                        slider.value = sliderIndex;
                        console.log('Updated slider to index:', sliderIndex, 'Time:', currentHourStr);
                        const inputEvent = new Event('input', { bubbles: true });
                        slider.dispatchEvent(inputEvent);
                        const changeEvent = new Event('change', { bubbles: true });
                        slider.dispatchEvent(changeEvent);
                    } else {
                        console.log('Slider already at correct index:', sliderIndex);
                    }
                } else {
                    console.warn('Slider index out of bounds:', { sliderIndex, minIndex, maxIndex });
                }
            } else {
                console.warn('Time slider not found');
            }
        };

        this.autoupdateState = true;
        updateSlider();
        this.intervalId = setInterval(() => {
            console.log('Interval running:', new Date().toISOString());
            updateSlider();
        }, 60 * 1000); // 1 minute
        console.log('Started autoupdate interval');

        // Keep-alive to prevent throttling
        const keepAlive = () => {
            if (this.autoupdateState) {
                console.debug('Keep-alive check:', document.visibilityState);
                this.keepAliveId = requestAnimationFrame(keepAlive);
            }
        };
        this.keepAliveId = requestAnimationFrame(keepAlive);
    },

    stopAutoupdate() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
            console.log('Stopped autoupdate interval');
        }
        if (this.keepAliveId) {
            cancelAnimationFrame(this.keepAliveId);
            this.keepAliveId = null;
            console.log('Stopped keep-alive');
        }
        this.autoupdateState = false;
    },

    toggleAutoupdate() {
        const button = document.getElementById('autoupdateButton');
        if (!button) {
            console.warn('Autoupdate button not found');
            return;
        }

        this.autoupdateState = !this.autoupdateState;
        console.log('Toggled autoupdateState:', this.autoupdateState);

        if (this.autoupdateState) {
            this.startAutoupdate();
            this.applyButtonStyles(button, true);
            button.title = 'Disable time slider autoupdate';
            console.log('Autoupdate enabled, button classes:', button.classList.toString());
        } else {
            this.stopAutoupdate();
            this.applyButtonStyles(button, false);
            button.title = 'Enable time slider autoupdate';
            console.log('Autoupdate disabled, button classes:', button.classList.toString());
        }
    },

    init() {
        const button = document.getElementById('autoupdateButton');
        if (button) {
            // Remove any existing listeners to prevent duplicates
            button.removeEventListener('click', this.toggleAutoupdate);
            button.addEventListener('click', () => this.toggleAutoupdate());
            this.applyButtonStyles(button, this.autoupdateState);
            console.log('Autoupdate initialized');
        } else {
            console.warn('Autoupdate button not found during init');
        }
    }
};

// Initialize on load
AutoUpdate.init();