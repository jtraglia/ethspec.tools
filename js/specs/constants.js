/**
 * Constants and utilities for the specification viewer
 */

// Category types mapping
export const CATEGORY_TYPES = {
  'constant_vars': 'constants',
  'preset_vars': 'presets',
  'config_vars': 'configs',
  'custom_types': 'types',
  'dataclasses': 'dataclasses',
  'ssz_objects': 'ssz objects',
  'functions': 'functions'
};

// Category order for display (alphabetical by display name)
export const CATEGORY_ORDER = [
  'config_vars',      // configs
  'constant_vars',    // constants
  'dataclasses',      // dataclasses
  'functions',        // functions
  'preset_vars',      // presets
  'ssz_objects',      // ssz objects
  'custom_types'      // types
];

// Fork display names
export const FORK_DISPLAY_NAMES = {
  'PHASE0': 'phase0',
  'ALTAIR': 'altair',
  'BELLATRIX': 'bellatrix',
  'CAPELLA': 'capella',
  'DENEB': 'deneb',
  'ELECTRA': 'electra',
  'FULU': 'fulu'
};

// Fork colors - unique color per fork letter (A-Z) so future forks get distinct colors
export const FORK_COLORS = {
  'PHASE0': '#6c757d',     // gray
  'ALTAIR': '#28a745',     // green        A
  'BELLATRIX': '#007bff',  // blue         B
  'CAPELLA': '#6f42c1',    // purple       C
  'DENEB': '#e83e8c',      // pink         D
  'ELECTRA': '#ffc107',    // yellow       E
  'FULU': '#17a2b8',       // teal         F
  'GLOAS': '#fd7e14',      // orange       G
};

// Colors for future forks by first letter (H-Z)
const FORK_LETTER_COLORS = {
  'H': '#20c997',  // mint
  'I': '#6610f2',  // indigo
  'J': '#d63384',  // magenta
  'K': '#0d6efd',  // royal blue
  'L': '#198754',  // forest green
  'M': '#dc3545',  // red
  'N': '#0dcaf0',  // cyan
  'O': '#8b5cf6',  // violet
  'P': '#f59e0b',  // amber
  'Q': '#059669',  // emerald
  'R': '#e11d48',  // rose
  'S': '#7c3aed',  // grape
  'T': '#2563eb',  // sapphire
  'U': '#ca8a04',  // gold
  'V': '#0891b2',  // dark cyan
  'W': '#c026d3',  // fuchsia
  'X': '#65a30d',  // lime
  'Y': '#ea580c',  // tangerine
  'Z': '#4f46e5',  // slate blue
};

// Fork short labels for badges
export const FORK_SHORT_LABELS = {
  'PHASE0': '0',
  'ALTAIR': 'A',
  'BELLATRIX': 'B',
  'CAPELLA': 'C',
  'DENEB': 'D',
  'ELECTRA': 'E',
  'FULU': 'F',
  'GLOAS': 'G'
};

/**
 * Get fork display name
 */
export function getForkDisplayName(fork) {
  return FORK_DISPLAY_NAMES[fork] || fork.toLowerCase();
}

/**
 * Get fork color
 */
export function getForkColor(fork) {
  return FORK_COLORS[fork] || FORK_LETTER_COLORS[fork.charAt(0).toUpperCase()] || '#6c757d';
}

/**
 * Get fork short label for badges
 */
export function getForkShortLabel(fork) {
  return FORK_SHORT_LABELS[fork] || fork.charAt(0).toUpperCase();
}

/**
 * Get category display name
 */
export function getCategoryDisplayName(category) {
  return CATEGORY_TYPES[category] || category;
}
