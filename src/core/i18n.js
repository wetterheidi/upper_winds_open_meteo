/**
 * @file i18n.js
 * @description Modul zur Verwaltung von Übersetzungen (Internationalisierung).
 * Lädt Sprachdateien und stellt Funktionen zum Abrufen von Texten bereit.
 */

import { Settings } from './settings.js';

// Cache für geladene Übersetzungen
let translations = {};
let currentLang = 'en';
let isInitialized = false;

export const I18n = {
    /**
     * Initialisiert das i18n Modul.
     * Lädt die Sprache aus den Settings oder nutzt die Browsersprache als Fallback.
     * @returns {Promise<void>}
     */
    async initialize() {
        if (isInitialized) return;

        // 1. Sprache bestimmen (Settings > Browser > Default 'en')
        let userLang = Settings.getValue('language');

        if (!userLang) {
            // Versuche Browsersprache zu erkennen (z.B. "de-DE" -> "de")
            const browserLang = navigator.language.split('-')[0];
            userLang = ['de', 'en'].includes(browserLang) ? browserLang : 'en';

            // Speichere die erkannte Sprache direkt als Standard
            // Zugriff auf state direkt, um Loop mit Settings.save() zu vermeiden falls nötig
            if (Settings.state && Settings.state.userSettings) {
                Settings.state.userSettings.language = userLang;
            }
        }

        await this.loadLanguage(userLang);
        isInitialized = true;
        console.log(`I18n initialized with language: ${currentLang}`);
    },

    /**
     * Lädt die JSON-Datei für die angegebene Sprache.
     * @param {string} lang - Der Sprachcode (z.B. 'de', 'en').
     */
    async loadLanguage(lang) {
        try {
            // Cache-Busting mit Zeitstempel, um sicherzugehen, dass wir die neue Datei bekommen
            // (kann im Produktionsbetrieb entfernt werden)
            const response = await fetch(`./locales/${lang}.json?v=${new Date().getTime()}`);

            if (!response.ok) {
                throw new Error(`Could not load language file: ${lang}`);
            }

            translations = await response.json()
            currentLang = lang;

            // Setze das Attribut am HTML-Tag (gut für CSS Selektoren: html[lang="de"])
            document.documentElement.lang = lang;
            this.updateDom();
            
            // Event feuern, damit die UI weiß, dass sie sich aktualisieren muss
            document.dispatchEvent(new CustomEvent('i18n:loaded', { detail: { lang } }));

        } catch (error) {
            console.error('I18n Load Error:', error);
            // Fallback auf Englisch, falls Deutsch fehlschlägt und wir nicht schon auf EN sind
            if (lang !== 'en') {
                console.warn('Falling back to English...');
                await this.loadLanguage('en');
            }
        }
    },

    /**
     * Ändert die Sprache zur Laufzeit.
     * @param {string} lang - Die neue Sprache.
     */
    async setLanguage(lang) {
        if (lang === currentLang) return;
        await this.loadLanguage(lang);
        // Speichern geschieht im UI-Event-Handler via Settings.save()
    },

    /**
     * Ruft die aktuelle Sprache ab.
     * @returns {string}
     */
    getCurrentLanguage() {
        return currentLang;
    },

    /**
     * Holt einen übersetzten Text anhand des Schlüssels.
     * Unterstützt verschachtelte Schlüssel mit Punkt-Notation (z.B. "planner.title").
     * * @param {string} key - Der Schlüssel für den Text.
     * @param {object} [placeholders] - Optionale Ersetzungen (z.B. { value: 100 }).
     * @returns {string} Der übersetzte Text oder der Key, falls nicht gefunden.
     */
    t(key, placeholders = {}) {
        const keys = key.split('.');
        let result = translations;

        // Durch das Objekt traversieren (z.B. translations['planner']['title'])
        for (const k of keys) {
            if (result && result[k] !== undefined) {
                result = result[k];
            } else {
                console.warn(`Missing translation for key: ${key} (${currentLang})`);
                return key; // Fallback: Zeige den Key an
            }
        }

        // Platzhalter ersetzen (z.B. "Hallo {name}" -> "Hallo Welt")
        if (typeof result === 'string' && Object.keys(placeholders).length > 0) {
            for (const [phKey, phValue] of Object.entries(placeholders)) {
                result = result.replace(new RegExp(`{${phKey}}`, 'g'), phValue);
            }
        }

        return result;
    },

    /**
     * Scannt das gesamte Dokument nach Elementen mit 'data-i18n' Attribut
     * und ersetzt deren Inhalt durch die passende Übersetzung.
     */
    updateDom() {
        const elements = document.querySelectorAll('[data-i18n]');
        elements.forEach(el => {
            const key = el.getAttribute('data-i18n');
            const translation = this.t(key);

            if (translation !== key) {
                // Wenn das Element ein Input mit Placeholder ist
                if (el.tagName === 'INPUT' && el.placeholder) {
                    el.placeholder = translation;
                } else {
                    el.textContent = translation;
                }
            }
        });
        console.log(`DOM updated with language: ${currentLang}`);
    },
};