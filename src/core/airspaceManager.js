// FAA-Luftraumdaten (offizielle ArcGIS-Feature-Services der FAA, kein API-Key
// nötig). Deckt nur die USA ab; analog zur Umsetzung in droneforecast/app.js
// und trajectories. Vektor-Polygone statt Kachel-Bild; Farben sind eine
// vereinfachte Annäherung an die Sectional-Chart-Konvention (kein Ersatz für
// die echte FAA-Symbologie).
const FAA_CLASS_AIRSPACE_URL = 'https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/ArcGIS/rest/services/Class_Airspace/FeatureServer/0';
const FAA_SPECIAL_USE_AIRSPACE_URL = 'https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/ArcGIS/rest/services/Special_Use_Airspace/FeatureServer/0';

const FAA_CLASS_COLORS = { B: '#0057b8', C: '#c800c8', D: '#0057b8', E: '#c800c8' };
const FAA_SUA_COLORS = { R: '#c81e1e', P: '#8b0000', MOA: '#b45f06', W: '#1155a3', A: '#b45f06' };

function faaClassAirspaceStyle(feature) {
    const cls = feature.properties.CLASS;
    return {
        color: FAA_CLASS_COLORS[cls] || '#888',
        weight: cls === 'B' ? 2.5 : cls === 'C' ? 2 : 1.3,
        opacity: 0.85,
        fillOpacity: 0,
        dashArray: (cls === 'D' || cls === 'E') ? '6 4' : null,
    };
}

function faaSpecialUseStyle(feature) {
    const color = FAA_SUA_COLORS[feature.properties.TYPE_CODE] || '#c81e1e';
    return { color, weight: 1.3, opacity: 0.8, fillOpacity: 0.06, fillColor: color, dashArray: '5 3' };
}

function faaLimitLabel(val, uom, code) {
    if (code === 'SFC') return 'SFC';
    if (uom === 'FL') return `FL${val}`;
    return `${val ?? '?'} ${uom || ''} ${code || ''}`.trim();
}

function faaAirspacePopup(layer) {
    const p = layer.feature.properties;
    const title = p.NAME || p.IDENT || 'Luftraum';
    const cls = p.CLASS || p.TYPE_CODE || '';
    const lower = faaLimitLabel(p.LOWER_VAL, p.LOWER_UOM, p.LOWER_CODE);
    const upper = faaLimitLabel(p.UPPER_VAL, p.UPPER_UOM, p.UPPER_CODE);
    return `<b>${title}</b>${cls ? ` (${cls})` : ''}<br>${lower} – ${upper}`;
}

/**
 * Erstellt die FAA-Luftraum-Layer (Class B/C/D/E + Special Use Airspace) als
 * Leaflet-LayerGroup. minZoom verhindert das Laden tausender Polygone bei
 * Kontinent-Ansicht; precision/simplifyFactor reduzieren die Geometriegröße.
 * esri-leaflet lädt selbstständig nur Features im aktuellen Kartenausschnitt.
 * @returns {L.LayerGroup}
 */
export function createFaaAirspaceLayer() {
    const classLayer = L.esri.featureLayer({
        url: FAA_CLASS_AIRSPACE_URL,
        where: "CLASS IN ('B','C','D','E')",
        style: faaClassAirspaceStyle,
        minZoom: 6,
        precision: 5,
        simplifyFactor: 0.5,
        attribution: 'FAA Aeronautical Information Services',
    }).bindPopup(faaAirspacePopup);

    const specialUseLayer = L.esri.featureLayer({
        url: FAA_SPECIAL_USE_AIRSPACE_URL,
        style: faaSpecialUseStyle,
        minZoom: 6,
        precision: 5,
        simplifyFactor: 0.5,
        attribution: 'FAA Aeronautical Information Services',
    }).bindPopup(faaAirspacePopup);

    return L.layerGroup([classLayer, specialUseLayer]);
}
