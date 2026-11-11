/**
 * @file polyfills.js
 * @description Ergänzt Browser-APIs, die ältere Geräte noch nicht kennen.
 *
 * Muss als ERSTER Import in main-web.js und main-mobile.js stehen.
 *
 * Vite übersetzt beim Build nur die Syntax (Ziel Safari 14), fehlende
 * Laufzeit-APIs ergänzt es nicht. Diese Datei füllt die Lücken, die DZMaster
 * tatsächlich nutzt.
 */

// AbortSignal.timeout(): erst ab Safari/iOS 16.0. Auf iOS 15 (z. B. iPad
// Air 2, letztes Update 15.8.x) wirft jeder fetch(..., { signal:
// AbortSignal.timeout(ms) }) einen TypeError. Dann laden weder die
// Kartenkacheln (tileCache.js) noch die Wetterdaten.
if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout !== 'function') {
    AbortSignal.timeout = function timeout(ms) {
        const controller = new AbortController();
        setTimeout(() => {
            let reason;
            try {
                reason = new DOMException('signal timed out', 'TimeoutError');
            } catch {
                reason = undefined;
            }
            controller.abort(reason);
        }, ms);
        return controller.signal;
    };
}
