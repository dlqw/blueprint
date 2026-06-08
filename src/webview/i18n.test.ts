import { describe, expect, it } from "vitest";
import { createTranslator, defaultLocale, normalizeLocale, translate } from "./i18n";

describe("i18n", () => {
  it("defaults to Chinese and normalizes unsupported locales", () => {
    expect(defaultLocale).toBe("zh-CN");
    expect(normalizeLocale("zh-CN")).toBe("zh-CN");
    expect(normalizeLocale("en-US")).toBe("en-US");
    expect(normalizeLocale("fr-FR")).toBe("zh-CN");
  });

  it("translates catalog keys with fallback and params", () => {
    expect(translate("zh-CN", "settings.panel")).toBe("编辑器设置");
    expect(translate("zh-CN", "common.errors", { count: 3 })).toBe("3 个错误");
    expect(translate("zh-CN", "sidebar.showingNodesLimit", { visible: 160, total: 502 })).toBe("正在显示 160 / 502 个节点。筛选大纲可缩小结果。");
    expect(createTranslator("en-US")("settings.panel")).toBe("Editor Settings");
    expect(createTranslator("en-US")("sidebar.focusOutlineNode", { nodeId: "log-1" })).toBe("Focus outline node log-1");
  });

  it("makes missing keys visible", () => {
    expect(translate("zh-CN", "missing.key")).toBe("[[missing.key]]");
  });
});
