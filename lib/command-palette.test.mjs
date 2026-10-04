import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { paletteScore } = await jiti.import("./command-palette.ts");

const words = (query) => query.toLowerCase().split(/\s+/).filter(Boolean);

test("every query word must match somewhere", () => {
  assert.equal(paletteScore({ label: "Settings: Usage" }, words("usage nope")), -1);
  assert.ok(paletteScore({ label: "Settings: Usage" }, words("set usa")) >= 0);
});

test("a word-start label match beats a mid-word one, which beats a keyword-only one", () => {
  const wordStart = paletteScore({ label: "Settings: Usage" }, words("usage"));
  const midWord = paletteScore({ label: "Reviewing misusage" }, words("usage"));
  const keywordOnly = paletteScore({ label: "Fix the build", keywords: "usage report" }, words("usage"));
  assert.ok(wordStart < midWord, `${wordStart} < ${midWord}`);
  assert.ok(midWord < keywordOnly, `${midWord} < ${keywordOnly}`);
});

test("ties go to the shorter, more specific label", () => {
  const short = paletteScore({ label: "Theme: Dark" }, words("dark"));
  const long = paletteScore({ label: "Theme: Dark mode for the whole workspace" }, words("dark"));
  assert.ok(short < long);
});

test("regex characters in the query are matched literally", () => {
  assert.ok(paletteScore({ label: "fix (c++) build" }, words("(c++)")) >= 0);
});
