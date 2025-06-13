"use strict";

import { Settings } from './settings.js';

// Maps an AGL height to a color gradient (red -> yellow -> green)
function interpolateColor(aglHeight, minHeight = 0, maxHeight = 3000) {
    const ratio = Math.min(Math.max((aglHeight - minHeight) / (maxHeight - minHeight), 0), 1);
    if (aglHeight < 0 || isNaN(aglHeight)) return '#808080'; // Gray for invalid/negative heights
    if (ratio <= 0.5) {
        // Red (#FF0000) to Yellow (#FFFF00)
        const r = 255;
        const g = Math.round(255 * (ratio * 2));
        const b = 0;
        return `rgb(${r}, ${g}, ${b})`;
    } else {
        // Yellow (#FFFF00) to Green (#00FF00)
        const r = Math.round(255 * (1 - (ratio - 0.5) * 2));
        const g = 255;
        const b = 0;
        return `rgb(${r}, ${g}, ${b})`;
    }
}

// Generates a wind barb icon for weather table
function generateWindBarb(direction, speedKt, latitude = null) {
    // Convert speed to knots if not already (assuming speedKt is in knots)
    const speed = Math.round(speedKt);

    // SVG dimensions
    const width = 40;
    const height = 40;
    const centerX = width / 2;
    const centerY = height / 2;
    const staffLength = 20;

    // Determine hemisphere based on latitude (default to Northern if undefined)
    const isNorthernHemisphere = typeof latitude === 'number' && !isNaN(latitude) ? latitude >= 0 : true;
    const barbSide = isNorthernHemisphere ? -1 : 1; // -1 for left (Northern), 1 for right (Southern)

    // Calculate barb components
    let flags = Math.floor(speed / 50); // 50 kt flags
    let remaining = speed % 50;
    let fullBarbs = Math.floor(remaining / 10); // 10 kt full barbs
    let halfBarbs = Math.floor((remaining % 10) / 5); // 5 kt half barbs

    // Adjust for small speeds
    if (speed < 5) {
        fullBarbs = 0;
        halfBarbs = 0;
    } else if (speed < 10 && halfBarbs > 0) {
        halfBarbs = 1; // Ensure at least one half barb for 5-9 kt
    }

    // Start SVG
    let svg = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`;

    // Rotate based on wind direction (wind *from* direction)
    const rotation = direction + 180; // Staff points toward wind source (tip at origin)
    svg += `<g transform="translate(${centerX}, ${centerY}) rotate(${rotation})">`;

    // Draw the staff (vertical line, base at bottom, tip at top toward the source)
    svg += `<line x1="0" y1="${staffLength / 2}" x2="0" y2="${-staffLength / 2}" stroke="black" stroke-width="1"/>`;

    // Draw barbs on the appropriate side, at the base of the staff
    let yPos = staffLength / 2; // Start at the base (wind blowing toward this end)
    const barbSpacing = 4;

    // Flags (50 kt) - Triangle with side attached to staff, pointing to the correct side
    for (let i = 0; i < flags; i++) {
        svg += `<polygon points="0,${yPos - 5} 0,${yPos + 5} ${10 * barbSide},${yPos}" fill="black"/>`;
        yPos -= barbSpacing + 5; // Move up the staff (toward the tip)
    }

    // Full barbs (10 kt) - Straight to the correct side (perpendicular)
    for (let i = 0; i < fullBarbs; i++) {
        svg += `<line x1="0" y1="${yPos}" x2="${10 * barbSide}" y2="${yPos}" stroke="black" stroke-width="1"/>`;
        yPos -= barbSpacing;
    }

    // Half barbs (5 kt) - Straight to the correct side (perpendicular)
    if (halfBarbs > 0) {
        svg += `<line x1="0" y1="${yPos}" x2="${5 * barbSide}" y2="${yPos}" stroke="black" stroke-width="1"/>`;
    }

    // Circle for calm winds (< 5 kt)
    if (speed < 5) {
        svg += `<circle cx="0" cy="0" r="3" fill="none" stroke="black" stroke-width="1"/>`;
    }

    svg += `</g></svg>`;
    return svg;
}

export {
    interpolateColor,
    generateWindBarb,
};