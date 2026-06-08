import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { catalogs } from "./i18n";

function walkFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) {
      return walkFiles(path);
    }
    if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith(".test.ts") && !entry.endsWith(".test.tsx") && !entry.endsWith(".test.js") && !entry.endsWith(".test.jsx")) {
      return [path];
    }
    return [];
  });
}

describe("i18n audit", () => {
  it("keeps hardcoded UI phrases out of webview and desktop sources", () => {
    const root = process.cwd();
    const files = [...walkFiles(join(root, "src", "webview")), ...walkFiles(join(root, "src", "desktop"))];
    const scanned = files.filter((file) => !file.endsWith(join("src", "webview", "i18n.ts")));
    const candidates = scanned.map((file) => ({
      file,
      texts: extractUiStringCandidates(readFileSync(file, "utf8"))
    }));

    for (const phrase of auditedCatalogPhrases()) {
      const normalizedPhrase = normalizeUiText(phrase);
      for (const { file, texts } of candidates) {
        const match = texts.find((text) => text.includes(normalizedPhrase));
        expect(match, `${file} should not hardcode "${phrase}"`).toBeUndefined();
      }
    }
  });
});

function extractUiStringCandidates(source: string): string[] {
  const candidates: string[] = [];

  for (const match of source.matchAll(/>([^<>{}]+)</g)) {
    candidates.push(match[1]);
  }

  for (const match of source.matchAll(/\b(?:title|aria-label|placeholder|alt)=\s*(["'`])([\s\S]*?)\1/g)) {
    candidates.push(match[2]);
  }

  return candidates.map(normalizeUiText).filter(isAuditableCandidate);
}

function auditedCatalogPhrases(): string[] {
  return [...new Set(Object.values(catalogs).flatMap((catalog) => Object.values(catalog)))]
    .map((phrase) => phrase.trim())
    .filter(Boolean)
    .filter((phrase) => !/[{}]/.test(phrase))
    .filter((phrase) => /[\p{L}\p{N}]/u.test(phrase))
    .filter((phrase) => !/^[a-z][a-z0-9-]*$/.test(phrase))
    .filter((phrase) => phrase.length >= 8 || cjkCharacterCount(phrase) >= 4)
    .filter((phrase) => !lowSignalPhrases.has(phrase));
}

const lowSignalPhrases = new Set([
  "Blueprints",
  "English",
  "Function Entry",
  "Template package",
  "TypeScript builtin",
  "TypeScript function"
]);

function cjkCharacterCount(value: string): number {
  return [...value].filter((character) => /\p{Script=Han}/u.test(character)).length;
}

function normalizeUiText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isAuditableCandidate(value: string): boolean {
  return Boolean(value) && /[\p{L}\p{N}]/u.test(value) && !/[;={}\[\]]/.test(value);
}
