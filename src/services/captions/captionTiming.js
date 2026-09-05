/**
 * captionTiming.js — proportional caption-chunk timing fallback.
 *
 * Used only when no TTS word-level timestamps are available: distributes a
 * scene's duration across its caption chunks proportionally to chunk length.
 */

/**
 * @param {string[]} chunks         - caption text chunks, in order
 * @param {number}   durationSeconds - total scene duration to distribute across chunks
 * @returns {Array<{ text: string, start: number, end: number }>}
 */
function buildProportionalTimedChunks(chunks, durationSeconds) {
  const totalChars = chunks.reduce((sum, c) => sum + c.length, 0);
  let cursor = 0;
  return chunks.map(chunk => {
    const ratio = totalChars > 0 ? (chunk.length / totalChars) : (1 / chunks.length);
    const chunkDuration = durationSeconds * ratio;
    const entry = { text: chunk, start: cursor, end: cursor + chunkDuration };
    cursor += chunkDuration;
    return entry;
  });
}

module.exports = { buildProportionalTimedChunks };
