/**
 * Normalizes an item description into a stable matching key.
 *
 * Why this exists:
 * The PO/GRN in this assignment share vendor SKU codes (e.g. "11423"),
 * but the Invoice uses a different internal SKU scheme (e.g. "FG-P-F-0503")
 * for the same physical item. itemCode is therefore NOT a reliable join key
 * across all three document types. Normalized description is the one field
 * that is present and roughly consistent everywhere, so it is used as the
 * canonical itemKey.
 *
 * Normalization steps (in order):
 *  1. lowercase everything
 *  2. drop parenthetical notes like "(5%)"
 *  3. collapse "450.0" -> "450" so "450.0 g" and "450g" use the same number
 *  4. expand a few common unit abbreviations so "24 Pcs" and "24 Pieces" align
 *  5. strip all whitespace and punctuation entirely, so "450 g" and "450g"
 *     end up identical
 *
 * This is a heuristic, not a guaranteed match. If real Gemini output produces
 * descriptions that still don't align across PO/GRN/Invoice for the same
 * physical item, extend SYNONYMS below or adjust the regex steps - the rest
 * of the matching engine doesn't need to change, since it only consumes
 * itemKey as an opaque grouping string.
 */

const SYNONYMS = [
  [/\bpieces\b/g, 'pcs'],
  [/\bpiece\b/g, 'pcs'],
  [/\bgrams?\b/g, 'g'],
  [/\bkilograms?\b/g, 'kg'],
];

function normalizeItemKey(description) {
  if (!description) return '';

  let key = description.toLowerCase();

  // 1. drop parenthetical notes like "(5%)"
  key = key.replace(/\(.*?\)/g, ' ');

  // 2. "450.0" -> "450"
  key = key.replace(/(\d+)\.0\b/g, '$1');

  // 3. unit synonyms
  for (const [pattern, replacement] of SYNONYMS) {
    key = key.replace(pattern, replacement);
  }

  // 4. strip everything that isn't a letter or digit (removes spaces too,
  //    so "450 g" and "450g" become identical)
  key = key.replace(/[^a-z0-9]/g, '');

  return key;
}

module.exports = { normalizeItemKey };
