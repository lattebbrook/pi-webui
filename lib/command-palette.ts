// Ranking for the ⌘K command palette (components/CommandPalette.tsx).

/**
 * Every query word must appear somewhere in the item's text. Lower is better:
 * a word starting a label word scores 0, inside a label word 1, only in the
 * hint or keywords 3. Ties go to the shorter (more specific) label.
 */
export function paletteScore(item: { label: string; hint?: string; keywords?: string }, words: string[]): number {
  if (words.length === 0) return 0;
  const label = item.label.toLowerCase();
  const haystack = `${label} ${item.hint ?? ""} ${item.keywords ?? ""}`.toLowerCase();
  let total = 0;
  for (const word of words) {
    if (!haystack.includes(word)) return -1;
    const startsWord = label.startsWith(word) || new RegExp(`[^\\p{L}\\p{N}]${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "u").test(label);
    total += startsWord ? 0 : label.includes(word) ? 1 : 3;
  }
  return total + Math.min(label.length, 200) / 1000;
}
