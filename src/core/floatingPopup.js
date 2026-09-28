/**
 * Positioniert ein Info-Popup so am Anker-Element, dass es immer vollständig
 * im Viewport liegt: über oder unter dem Anker (je nachdem, wo mehr Platz ist),
 * horizontal an den Bildschirmrand geklemmt, bei Platzmangel scrollbar.
 *
 * Das Popup wird dafür an <body> gehängt, weil Vorfahren mit transform oder
 * backdrop-filter (z. B. #slider-container mobil) sonst position: fixed brechen
 * bzw. den Inhalt abschneiden.
 */

const MARGIN = 8; // Mindestabstand zum Viewport-Rand
const GAP = 6;    // Abstand zwischen Anker und Popup

export function positionFloatingPopup(popup, anchor) {
    if (!popup || !anchor) return;
    if (popup.parentElement !== document.body) document.body.appendChild(popup);

    popup.classList.add('floating-popup');
    // Zurücksetzen, damit die natürliche Größe gemessen wird
    popup.style.maxHeight = '';
    popup.style.top = '0px';
    popup.style.left = '0px';

    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const a = anchor.getBoundingClientRect();

    const spaceAbove = a.top - GAP - MARGIN;
    const spaceBelow = vh - a.bottom - GAP - MARGIN;
    const naturalHeight = popup.offsetHeight;
    const placeBelow = naturalHeight > spaceAbove && spaceBelow > spaceAbove;
    const maxHeight = Math.max(60, placeBelow ? spaceBelow : spaceAbove);
    popup.style.maxHeight = `${maxHeight}px`;

    const height = popup.offsetHeight;
    const width = popup.offsetWidth;
    const centerX = a.left + a.width / 2;
    const left = Math.min(Math.max(MARGIN, centerX - width / 2), vw - width - MARGIN);
    const top = placeBelow ? a.bottom + GAP : a.top - GAP - height;

    popup.style.left = `${Math.round(left)}px`;
    popup.style.top = `${Math.round(top)}px`;
}

/**
 * Hält ein offenes Popup bei Resize/Scroll am Anker.
 */
export function keepFloatingPopupAnchored(popup, anchor) {
    const reposition = (event) => {
        // Scrollen im Popup selbst darf die Position nicht neu berechnen
        if (event?.target === popup) return;
        if (popup.style.display === 'block') positionFloatingPopup(popup, anchor);
    };
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return reposition;
}
