# TODO

Offene Punkte, die bewusst zurückgestellt wurden.

---

## Bibliotheken von CDNs auf lokale npm-Importe umstellen

**Status:** offen · angelegt 2026-07-30 · Priorität: mittel (Datenschutz, kein Funktionsfehler)

Beide `index.html` laden neun Bibliotheken per `<script src>` bzw. `<link>` von externen CDNs.
Jeder App-Start übermittelt dadurch die IP-Adresse der Nutzer an diese Anbieter (teils USA) —
dasselbe DSGVO-Thema wie bei Google Fonts, nur weniger prominent.

Betroffen (in `src/ui-web/index.html` und `src/ui-mobile/index.html`):

| Bibliothek | CDN |
|---|---|
| Leaflet (JS + CSS) | unpkg |
| Leaflet-Geoman (JS + CSS) | unpkg |
| leaflet.heat | unpkg |
| leaflet-rotatedmarker | unpkg |
| togeojson | unpkg |
| PapaParse | cdnjs (Cloudflare) |
| leaflet-gpx | cdnjs (Cloudflare) |
| Chart.js | jsDelivr |
| geomag | jsDelivr |

Dazu: `src/ui-web/mapManager.js` lädt das Marker-Schattenbild von cdnjs.

**Warum nicht nebenbei erledigt:** Die Bibliotheken werden im gesamten Code als globale Variablen
verwendet (`L`, `Papa`, `Chart`, `geomag`). Die Umstellung auf npm-Importe berührt viele Dateien
und braucht einen Testdurchlauf auf Web *und* Mobile. Die meisten Pakete stehen bereits als
Dependencies in `package.json`.

**Wenn erledigt:** Den Eintrag „unpkg, cdnjs (Cloudflare), jsDelivr" aus der Datenschutzerklärung
(`public/privacy.html`, Abschnitt 5 in beiden Sprachen) entfernen.

**Bereits erledigt (2026-07-30):** Google Fonts wurde auf lokales Hosting umgestellt — Roboto liegt
jetzt in `src/fonts/`, die `@font-face`-Regeln stehen am Anfang beider `styles.css`.

---

## Datenschutzerklärung: Postanschrift

**Status:** bewusst offen gelassen

`public/privacy.html` nennt als Verantwortliche nur Name und E-Mail, keine Postanschrift.
Für Google Play ausreichend. Falls sich später eine c/o-Adresse ergibt: An beiden Stellen
(deutscher und englischer Abschnitt 1) steht ein auskommentiertes Beispiel im HTML.
