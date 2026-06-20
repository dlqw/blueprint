import { pinyin } from "pinyin-pro";

export interface FuzzySearchValue {
  label: string;
  value?: string;
}

export interface FuzzySearchScore {
  score: number;
  matchLabel?: string;
}

interface SearchIndex {
  normalized: string;
  compact: string;
  pinyinWords: string;
  pinyinCompact: string;
  initials: string;
}

const searchIndexCache = new Map<string, SearchIndex>();

export function fuzzySearchTokens(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

export function fuzzyTextMatches(values: Array<string | undefined>, query: string): boolean {
  const tokens = fuzzySearchTokens(query);
  if (!tokens.length) {
    return true;
  }
  return fuzzyValuesMatchTokens(values, tokens);
}

export function fuzzyValuesMatchTokens(values: Array<string | undefined>, tokens: string[]): boolean {
  if (!tokens.length) {
    return true;
  }
  return tokens.every((token) => values.some((value) => fuzzyValueScore(value, token) > 0));
}

export function scoreFuzzySearchValues(values: FuzzySearchValue[], tokens: string[]): FuzzySearchScore {
  if (!tokens.length) {
    return { score: 1 };
  }

  const candidates = values.filter((entry): entry is { label: string; value: string } => Boolean(entry.value));
  let score = 0;
  let bestMatch: { label: string; value: string; score: number } | undefined;

  for (const token of tokens) {
    const tokenMatch = candidates.reduce<{ label: string; value: string; score: number } | undefined>((best, entry) => {
      const entryScore = fuzzyValueScore(entry.value, token);
      return entryScore > (best?.score ?? 0) ? { label: entry.label, value: entry.value, score: entryScore } : best;
    }, undefined);
    if (!tokenMatch) {
      return { score: 0 };
    }
    score += tokenMatch.score;
    if (tokenMatch.score > (bestMatch?.score ?? 0)) {
      bestMatch = tokenMatch;
    }
  }

  return { score, matchLabel: bestMatch ? `${bestMatch.label}: ${bestMatch.value}` : undefined };
}

export function fuzzyValueScore(value: string | undefined, token: string): number {
  if (!value) {
    return 0;
  }
  const normalizedToken = token.trim().toLowerCase();
  if (!normalizedToken) {
    return 1;
  }
  const compactToken = compactText(normalizedToken);
  const index = searchIndexForValue(value);

  let score = 0;
  score = Math.max(score, rankMatch(index.normalized, normalizedToken, 48, 32, 16));
  if (compactToken !== normalizedToken) {
    score = Math.max(score, rankMatch(index.compact, compactToken, 44, 30, 14));
  }
  score = Math.max(score, rankMatch(index.pinyinWords, normalizedToken, 36, 26, 14));
  score = Math.max(score, rankMatch(index.pinyinCompact, compactToken, 34, 24, 13));
  score = Math.max(score, rankMatch(index.initials, compactToken, 30, 22, 12));
  return score;
}

function searchIndexForValue(value: string): SearchIndex {
  const cached = searchIndexCache.get(value);
  if (cached) {
    return cached;
  }

  const normalized = value.toLowerCase();
  const pinyinWords = pinyin(value, { toneType: "none", type: "array" })
    .map((part) => part.toLowerCase())
    .join(" ");
  const initials = pinyin(value, { pattern: "first", toneType: "none", type: "array" })
    .map((part) => part.toLowerCase())
    .join("");
  const index: SearchIndex = {
    normalized,
    compact: compactText(normalized),
    pinyinWords,
    pinyinCompact: compactText(pinyinWords),
    initials
  };
  searchIndexCache.set(value, index);
  return index;
}

function rankMatch(value: string, token: string, exactScore: number, prefixScore: number, containsScore: number): number {
  if (!value || !token) {
    return 0;
  }
  if (value === token) {
    return exactScore;
  }
  if (value.startsWith(token)) {
    return prefixScore;
  }
  return value.includes(token) ? containsScore : 0;
}

function compactText(value: string): string {
  return value.replace(/\s+/g, "");
}
