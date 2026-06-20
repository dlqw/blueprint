import { describe, expect, it } from "vitest";
import { fuzzySearchTokens, fuzzyTextMatches, scoreFuzzySearchValues } from "./fuzzySearch";

describe("fuzzySearch", () => {
  it("keeps regular text search behavior", () => {
    expect(fuzzyTextMatches(["Function Entry", "builtin.event.entry"], "entry")).toBe(true);
    expect(fuzzyTextMatches(["Function Entry"], "missing")).toBe(false);
  });

  it("matches Chinese text by full pinyin and compact pinyin", () => {
    expect(fuzzyTextMatches(["函数入口"], "han shu")).toBe(true);
    expect(fuzzyTextMatches(["函数入口"], "hanshurukou")).toBe(true);
  });

  it("matches Chinese text by pinyin initials", () => {
    expect(fuzzyTextMatches(["执行序列"], "zxxl")).toBe(true);
  });

  it("scores pinyin matches and reports the matched label", () => {
    const tokens = fuzzySearchTokens("rizhi");
    const result = scoreFuzzySearchValues([
      { label: "名称", value: "日志" },
      { label: "路径", value: "调试/日志" }
    ], tokens);

    expect(result.score).toBeGreaterThan(0);
    expect(result.matchLabel).toBe("名称: 日志");
  });
});
