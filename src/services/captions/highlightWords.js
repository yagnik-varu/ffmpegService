














































































































































/**
 * highlightWords.js — Caption word highlighting service
 *
 * Single Responsibility: transform a raw caption string into an HTML string
 * where important words/phrases are wrapped in <mark class="word-highlight">.
 *
 * This is a pure function — no side effects, no I/O, easily testable.
 */

/**
 * Escape special HTML characters in a plain string so it is safe to inject
 * into innerHTML without XSS risk.
 *
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * Build an HTML string from a plain caption text, wrapping any occurrences of
 * the given important words/phrases with <mark class="word-highlight">.
 *
 * Rules:
 *   - HTML-escapes the raw text first to prevent injection.
 *   - Matching is case-insensitive.
 *   - Longer phrases are matched before shorter words to avoid partial overlaps
 *     (e.g. "nested objects" is matched before "objects").
 *   - Returns the plain escaped text when importantWords is empty/undefined.
 *
 * @param {string}    text           - Raw caption chunk text
 * @param {string[]}  importantWords - List of words/phrases to highlight
 * @returns {string}                 - Safe HTML string ready for innerHTML
 */
function buildHighlightedHTML(text, importantWords) {
    if (!text) return '';

    const escaped = escapeHtml(text);

    if (!importantWords || importantWords.length === 0) {
        return escaped;
    }

    // Sort longest phrases first to prevent short-word matches consuming part of a phrase
    const sorted = [...importantWords].sort((a, b) => b.length - a.length);

    // Build a single combined regex: /(nested objects|primitives|memory references)/gi
    const pattern = sorted
        .map(word => escapeHtml(word).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('|');

    const regex = new RegExp(`(${pattern})`, 'gi');

    return escaped.replace(regex, '<mark class="word-highlight">$1</mark>');
}

module.exports = { buildHighlightedHTML };
