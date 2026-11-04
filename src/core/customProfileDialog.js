/**
 * @file customProfileDialog.js
 * @description Rückfrage-Dialog beim Import eines Eigenen Profils (Web und Mobil).
 * Fragt Format, Zeitpunkt samt Zeitzone, ggf. Starthöhe (bei Höhen über Grund) und – nur wenn
 * im Profil kein bodennaher Wind steht – den Bodenwind ab. Prüft die Eingaben mit dem echten
 * Konverter, bevor er schließt. Baut sein DOM selbst (Klassen .modal/.modal-content aus beiden
 * Stylesheets), damit keine HTML-Änderungen pro Plattform nötig sind.
 */

import { DateTime } from 'luxon';
import { I18n } from './i18n.js';
import { Settings } from './settings.js';
import { Utils } from './utils.js';
import { CONVERSIONS } from './constants.js';
import {
    PROFILE_PRESETS, ProfileImportError, SURFACE_WIND_MAX_GAP_M,
    detectProfilePreset, parseProfileFilename, parseProfileText, buildCustomProfileWeatherData,
} from './customProfileImport.js';

const DEVICE_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

function _el(tag, attrs = {}, children = []) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (k === 'text') el.textContent = v;
        else if (k === 'style') el.style.cssText = v;
        else el.setAttribute(k, v);
    }
    for (const c of [].concat(children)) if (c) el.append(c);
    return el;
}

function _row(labelText, input, suffix) {
    const id = input.id;
    return _el('div', { class: 'custom-profile-row', style: 'display:flex;align-items:center;gap:8px;margin:6px 0;' }, [
        _el('label', { for: id, text: labelText, style: 'flex:0 0 45%;text-align:left;' }),
        input,
        suffix ? _el('span', { text: suffix }) : null,
    ]);
}

/** Wandelt Datum/Uhrzeit + Zeitzone in "YYYY-MM-DDTHH:MM" (UTC). */
export function toUtcIso(date, time, zone) {
    const dt = DateTime.fromISO(`${date}T${time}`, { zone: zone === 'local' ? DEVICE_TZ : 'utc' });
    return dt.isValid ? dt.toUTC().toFormat("yyyy-MM-dd'T'HH:mm") : null;
}

/**
 * Öffnet den Dialog.
 * @param {{filename: string, text: string, defaultGroundM?: number}} input
 * @returns {Promise<object|null>} Profil für setCustomProfile() oder null bei Abbruch
 */
export function openCustomProfileDialog({ filename, text, defaultGroundM }) {
    const heightUnit = Settings.getValue('heightUnit', 'm');
    const windUnit = Settings.getValue('windUnit', 'kt');
    const toM = (v) => (heightUnit === 'ft' ? v * CONVERSIONS.FEET_TO_METERS : v);
    const fromM = (v) => (heightUnit === 'ft' ? v * CONVERSIONS.METERS_TO_FEET : v);

    const detected = detectProfilePreset(text);
    const fromName = parseProfileFilename(filename);

    // --- Felder ---
    const presetSelect = _el('select', { id: 'cpPreset' });
    if (!detected) presetSelect.append(_el('option', { value: '', text: I18n.t('custom_profile.choose') }));
    for (const p of Object.values(PROFILE_PRESETS)) presetSelect.append(_el('option', { value: p.id, text: p.label }));
    presetSelect.value = detected || '';

    const dateInput = _el('input', { id: 'cpDate', type: 'date', value: fromName?.date || '' });
    const timeInput = _el('input', { id: 'cpTime', type: 'time', value: fromName?.time || '' });

    const zoneSelect = _el('select', { id: 'cpZone' }, [
        _el('option', { value: '', text: I18n.t('custom_profile.choose') }),
        _el('option', { value: 'utc', text: 'UTC' }),
        _el('option', { value: 'local', text: I18n.t('custom_profile.local_time', { zone: DEVICE_TZ }) }),
    ]);
    zoneSelect.value = fromName?.timezoneHint === 'UTC' ? 'utc' : '';

    const groundInput = _el('input', { id: 'cpGround', type: 'number', step: '1', style: 'width:90px;' });
    if (Number.isFinite(defaultGroundM)) groundInput.value = Math.round(fromM(defaultGroundM));
    const groundRow = _row(I18n.t('custom_profile.launch_elevation'), groundInput, `${heightUnit} MSL`);

    const windDirInput = _el('input', { id: 'cpWindDir', type: 'number', min: '0', max: '360', style: 'width:70px;' });
    const windSpdInput = _el('input', { id: 'cpWindSpd', type: 'number', min: '0', step: '0.1', style: 'width:70px;' });
    const windBox = _el('div', { style: 'display:none;' }, [
        _el('p', { text: I18n.t('custom_profile.surface_wind_missing', { gap: SURFACE_WIND_MAX_GAP_M }), style: 'text-align:left;font-size:12px;' }),
        _row(I18n.t('custom_profile.surface_wind_dir'), windDirInput, '°'),
        _row(I18n.t('custom_profile.surface_wind_speed'), windSpdInput, windUnit),
    ]);

    const errorLine = _el('p', { style: 'color:var(--color-error, #c00);display:none;text-align:left;font-size:12px;' });
    const hintLine = _el('p', { text: I18n.t('custom_profile.time_hint'), style: 'text-align:left;font-size:12px;' });

    const okBtn = _el('button', { type: 'button', class: 'modal-btn', text: I18n.t('custom_profile.load') });
    const cancelBtn = _el('button', { type: 'button', class: 'modal-btn cancel', text: I18n.t('modals.cancel') });

    const content = _el('div', { class: 'modal-content', style: 'width:90%;max-width:420px;max-height:90vh;overflow:auto;' }, [
        _el('h3', { text: I18n.t('custom_profile.dialog_title') }),
        _el('p', { text: filename, style: 'text-align:left;font-size:12px;word-break:break-all;' }),
        _row(I18n.t('custom_profile.format'), presetSelect),
        _row(I18n.t('custom_profile.date'), dateInput),
        _row(I18n.t('custom_profile.time'), timeInput),
        _row(I18n.t('custom_profile.timezone'), zoneSelect),
        hintLine,
        groundRow,
        windBox,
        errorLine,
        _el('div', { class: 'modal-buttons', style: 'display:flex;gap:10px;justify-content:flex-end;' }, [cancelBtn, okBtn]),
    ]);
    const modal = _el('div', { class: 'modal', id: 'customProfileModal' }, [content]);

    const updateGroundVisibility = () => {
        const preset = PROFILE_PRESETS[presetSelect.value];
        groundRow.style.display = preset?.units.heightRef === 'AGL' ? 'flex' : 'none';
    };
    presetSelect.addEventListener('change', () => { windBox.style.display = 'none'; updateGroundVisibility(); });
    updateGroundVisibility();

    const showError = (msg) => { errorLine.textContent = msg; errorLine.style.display = msg ? 'block' : 'none'; };

    return new Promise((resolve) => {
        const close = (result) => { modal.remove(); resolve(result); };
        cancelBtn.addEventListener('click', () => close(null));

        okBtn.addEventListener('click', () => {
            showError('');
            const preset = PROFILE_PRESETS[presetSelect.value];
            if (!preset) return showError(I18n.t('custom_profile.error_format'));
            if (!dateInput.value || !timeInput.value || !zoneSelect.value) {
                return showError(I18n.t('custom_profile.error_time'));
            }
            const timeUtc = toUtcIso(dateInput.value, timeInput.value, zoneSelect.value);
            if (!timeUtc) return showError(I18n.t('custom_profile.error_time'));

            let groundElevationM;
            if (preset.units.heightRef === 'AGL') {
                const v = parseFloat(groundInput.value);
                if (!Number.isFinite(v)) return showError(I18n.t('custom_profile.error_ground'));
                groundElevationM = toM(v);
            }

            let surfaceWind;
            if (windBox.style.display !== 'none') {
                const dir = parseFloat(windDirInput.value);
                const spd = parseFloat(windSpdInput.value);
                if (Number.isFinite(dir) && Number.isFinite(spd)) {
                    surfaceWind = { direction: dir % 360, speedKmh: Utils.convertWind(spd, 'km/h', windUnit) };
                }
            }

            try {
                const parsed = parseProfileText(text, preset);
                const result = buildCustomProfileWeatherData(parsed, { timeUtc, groundElevationM, surfaceWind });
                close({
                    parsed, presetId: preset.id, presetLabel: preset.label, filename, timeUtc, groundElevationM,
                    surfaceWind, levelCount: result.levelCount,
                });
            } catch (e) {
                if (e instanceof ProfileImportError && e.code === 'SURFACE_WIND_MISSING') {
                    windBox.style.display = 'block';
                    return showError(I18n.t('custom_profile.error_surface_wind'));
                }
                const key = e instanceof ProfileImportError ? `custom_profile.error_${e.code.toLowerCase()}` : null;
                const msg = key && I18n.t(key) !== key ? I18n.t(key) : I18n.t('custom_profile.error_parse', { message: e.message });
                showError(msg);
            }
        });

        document.body.append(modal);
    });
}
