/**
 * @file openMeteoServers.js
 * @description Server-Ketten für die Open-Meteo-Abrufe mit ICON-Bezug und die
 * DEM90-Geländehöhe.
 *
 * Seit 2026-09 ist open-meteo.wetterheidi.de der bevorzugte Server: er hostet
 * ICON-D2, ICON-EU und ICON Global mit identischem API-Aufbau wie Michaels Server
 * (CORS offen), dazu Oberflächenfelder, meta.json und DEM90-Höhen. Michaels Server
 * und die öffentliche Instanz bleiben als Fallback.
 *
 * Bekannte Eigenheiten (Stichprobe 2026-09-27):
 *  - `elevation` in /v1/forecast-Antworten ist dort (wie auf Michaels Server) die
 *    MODELL-Geländehöhe, nicht DEM90 wie bei api.open-meteo.com. Wer DEM-bezogene
 *    Werte braucht (T2m, Bodendruck am DIP), muss `elevation=<DEM>` mitschicken.
 *  - `timezone=auto` lässt den Server abstürzen (≈20 s Hänger, dann HTTP 502 und
 *    kurzer Ausfall) -- Zeitzonen-Abfragen deshalb NICHT dorthin schicken.
 *  - Mit `cell_selection=nearest` + `elevation=<DEM>` sind die Oberflächenwerte
 *    wertgleich mit der öffentlichen Instanz; mit dem Default `land` kann ICON-EU
 *    in steilem Gelände eine andere Gitterzelle wählen.
 */

export const OM_PRIMARY = 'https://open-meteo.wetterheidi.de';
export const OM_LEGACY = 'https://open-meteo.mah.priv.at';
export const OM_LEGACY_ICON_GLOBAL = 'https://open-meteo-temp.mah.priv.at';
export const OM_PUBLIC = 'https://api.open-meteo.com';

/** Modelllevel-/ICON-Server je Modell in Prioritätsreihenfolge. */
export const ICON_SERVERS = {
    icon_d2:     [OM_PRIMARY, OM_LEGACY],
    icon_eu:     [OM_PRIMARY, OM_LEGACY],
    icon_global: [OM_PRIMARY, OM_LEGACY_ICON_GLOBAL],
};

/** DEM90-Geländehöhe (/v1/elevation): modellunabhängig. */
export const ELEVATION_SERVERS = [OM_PRIMARY, OM_LEGACY, OM_PUBLIC];

export const hostOf = (base) => new URL(base).host;

/**
 * Holt JSON vom ersten Server, der eine brauchbare Antwort liefert. Weiter zum
 * nächsten Server bei Netzwerkfehler, Timeout, HTTP ≠ 2xx, ungültigem JSON (z. B.
 * `{"elevation":[nan]}`), `error`-Feld oder wenn `validate(data)` false liefert.
 * @param {string[]} servers - Basis-URLs, bevorzugte zuerst.
 * @param {string} pathAndQuery - z. B. '/v1/forecast?latitude=…'
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs=30000]
 * @param {(data: object) => boolean} [opts.validate]
 * @returns {Promise<{data: object, server: string}>}
 */
export async function fetchJsonFromServers(servers, pathAndQuery, { timeoutMs = 30000, validate } = {}) {
    let lastError = null;
    for (const server of servers) {
        try {
            const response = await fetch(`${server}${pathAndQuery}`, { signal: AbortSignal.timeout(timeoutMs) });
            const text = await response.text();
            let data;
            try {
                data = JSON.parse(text);
            } catch {
                throw new Error(`HTTP ${response.status}: ungültiges JSON (${text.slice(0, 80)})`);
            }
            if (!response.ok || data.error) {
                throw new Error(data.reason ? `HTTP ${response.status}: ${data.reason}` : `HTTP ${response.status}`);
            }
            if (validate && !validate(data)) throw new Error('unbrauchbare Antwort');
            return { data, server };
        } catch (e) {
            console.warn(`[openMeteoServers] ${hostOf(server)}${pathAndQuery.split('?')[0]} nicht nutzbar:`, e.message);
            lastError = e;
        }
    }
    throw lastError ?? new Error('Kein Server konfiguriert');
}

const demCache = new Map();

/**
 * DEM90-Geländehöhe eines Punkts über ELEVATION_SERVERS (statisch, gecacht).
 * @returns {Promise<number|null>} Höhe in m MSL oder null, wenn kein Server liefert.
 */
export async function fetchDemElevation(lat, lng) {
    const key = `${Number(lat).toFixed(4)},${Number(lng).toFixed(4)}`;
    if (demCache.has(key)) return demCache.get(key);
    const first = (d) => (Array.isArray(d.elevation) ? d.elevation[0] : d.elevation);
    try {
        const { data } = await fetchJsonFromServers(
            ELEVATION_SERVERS,
            `/v1/elevation?latitude=${lat}&longitude=${lng}`,
            { timeoutMs: 15000, validate: (d) => Number.isFinite(first(d)) }
        );
        demCache.set(key, first(data));
        return first(data);
    } catch {
        return null; // nicht cachen -- nächster Aufruf versucht es erneut
    }
}
