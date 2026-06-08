import { describe, expect, it } from "vitest";
import {
  defaultThemeId,
  editorThemes,
  normalizeCustomTheme,
  normalizeThemeId,
  readCustomThemeFromText,
  serializeCustomTheme,
  themeClassName,
  themeStyle
} from "./themes";

describe("themes", () => {
  it("normalizes theme ids and resolves theme classes", () => {
    expect(defaultThemeId).toBe("comfy-dark");
    expect(editorThemes.map((theme) => theme.id)).toEqual(["comfy-dark", "graphite", "high-contrast"]);
    expect(normalizeThemeId("graphite")).toBe("graphite");
    expect(normalizeThemeId("unknown")).toBe("comfy-dark");
    expect(themeClassName("high-contrast")).toBe("theme-high-contrast");
  });

  it("normalizes custom theme tokens and ignores unsupported or empty values", () => {
    expect(normalizeCustomTheme({
      name: "  Studio Contrast  ",
      tokens: {
        bg: " #101114 ",
        text: "#f5f7fb",
        cyan: "",
        unsupported: "#fff"
      }
    })).toEqual({
      name: "Studio Contrast",
      tokens: {
        bg: "#101114",
        text: "#f5f7fb"
      }
    });

    expect(normalizeCustomTheme({ tokens: { panel: "#181a20" } })).toEqual({
      name: "Custom",
      tokens: {
        panel: "#181a20"
      }
    });
    expect(normalizeCustomTheme({
      name: "Low Contrast",
      tokens: {
        bg: "#101114",
        text: "#1c1f26"
      }
    })).toBeUndefined();
    expect(normalizeCustomTheme(null)).toBeUndefined();
    expect(normalizeCustomTheme([])).toBeUndefined();
  });

  it("maps custom theme tokens to runtime CSS variables only for the custom theme", () => {
    expect(themeStyle("custom", {
      name: "Studio Contrast",
      tokens: {
        bg: "#101114",
        panelStrong: "#20242d",
        activeFg: "#ffffff"
      }
    })).toEqual({
      "--bg": "#101114",
      "--panel-strong": "#20242d",
      "--active-fg": "#ffffff"
    });

    expect(themeStyle("graphite", {
      name: "Ignored",
      tokens: { bg: "#000" }
    })).toBeUndefined();
    expect(themeStyle("custom")).toBeUndefined();
  });

  it("serializes and reads custom theme JSON from supported import shapes", () => {
    const theme = {
      name: "Studio Contrast",
      tokens: {
        bg: "#101114",
        text: "#f5f7fb"
      }
    };

    expect(readCustomThemeFromText(serializeCustomTheme(theme))).toEqual(theme);
    expect(readCustomThemeFromText(JSON.stringify(theme))).toEqual(theme);
    expect(readCustomThemeFromText(JSON.stringify({ customTheme: theme }))).toEqual(theme);
    expect(readCustomThemeFromText(JSON.stringify({ editorPrefs: { customTheme: theme } }))).toEqual(theme);
  });

  it("rejects invalid custom theme JSON", () => {
    expect(() => readCustomThemeFromText("{")).toThrow();
    expect(() => readCustomThemeFromText(JSON.stringify({ format: "blueprint-theme", version: 1 }))).toThrow("Invalid custom theme.");
    expect(() => readCustomThemeFromText(JSON.stringify({
      theme: {
        name: "Low Contrast",
        tokens: {
          bg: "#101114",
          text: "#1c1f26"
        }
      }
    }))).toThrow("Invalid custom theme.");
  });
});
