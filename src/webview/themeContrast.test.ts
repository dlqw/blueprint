import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

interface RgbColor {
  r: number;
  g: number;
  b: number;
}

const stylesCss = readFileSync(join(process.cwd(), "src", "webview", "styles.css"), "utf8");

const auditedThemes = [
  { id: "comfy-dark", selector: ":root" },
  { id: "graphite", selector: ".theme-graphite" },
  { id: "high-contrast", selector: ".theme-high-contrast" }
];

describe("theme contrast", () => {
  it("keeps primary text readable across built-in theme surfaces", () => {
    for (const theme of auditedThemes) {
      const tokens = themeTokens(theme.selector);
      for (const surface of ["bg", "panel", "panel-2", "panel-strong", "input-bg", "hover-bg"]) {
        const ratio = contrast(resolveToken(tokens, "text"), resolveToken(tokens, surface));
        expect(ratio, `${theme.id} --text on --${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("keeps secondary and dim text distinguishable on operational panels", () => {
    for (const theme of auditedThemes) {
      const tokens = themeTokens(theme.selector);
      for (const foreground of ["muted", "dim"]) {
        for (const surface of ["panel", "panel-strong", "input-bg"]) {
          const ratio = contrast(resolveToken(tokens, foreground), resolveToken(tokens, surface));
          expect(ratio, `${theme.id} --${foreground} on --${surface}`).toBeGreaterThanOrEqual(3);
        }
      }
    }
  });

  it("keeps node and status accent colors legible on panel backgrounds", () => {
    for (const theme of auditedThemes) {
      const tokens = themeTokens(theme.selector);
      for (const foreground of ["amber", "cyan", "green", "red", "control", "data"]) {
        const ratio = contrast(resolveToken(tokens, foreground), resolveToken(tokens, "panel"));
        expect(ratio, `${theme.id} --${foreground} on --panel`).toBeGreaterThanOrEqual(3);
      }
    }
  });
});

function themeTokens(selector: string): Record<string, string> {
  return {
    ...declarationsFor(":root"),
    ...(selector === ":root" ? {} : declarationsFor(selector))
  };
}

function declarationsFor(selector: string): Record<string, string> {
  const match = stylesCss.match(new RegExp(`${escapeRegExp(selector)}\\s*\\{(?<body>[^}]+)\\}`));
  const body = match?.groups?.body ?? "";
  return Object.fromEntries(
    [...body.matchAll(/--([a-z0-9-]+):\s*([^;]+);/gi)]
      .map((entry) => [entry[1], entry[2].trim()])
  );
}

function resolveToken(tokens: Record<string, string>, name: string): RgbColor {
  const value = tokens[name];
  if (!value) {
    throw new Error(`Missing theme token --${name}`);
  }
  return resolveColor(value, tokens);
}

function resolveColor(value: string, tokens: Record<string, string>): RgbColor {
  const varMatch = value.match(/^var\(--([a-z0-9-]+)\)$/i);
  if (varMatch) {
    return resolveToken(tokens, varMatch[1]);
  }
  const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!hex) {
    throw new Error(`Unsupported color value ${value}`);
  }
  const normalizedHex = hex[1].length === 3
    ? [...hex[1]].map((character) => `${character}${character}`).join("")
    : hex[1];
  const int = Number.parseInt(normalizedHex, 16);
  return {
    r: (int >> 16) & 255,
    g: (int >> 8) & 255,
    b: int & 255
  };
}

function contrast(foreground: RgbColor, background: RgbColor): number {
  const light = relativeLuminance(foreground);
  const dark = relativeLuminance(background);
  const [lighter, darker] = light >= dark ? [light, dark] : [dark, light];
  return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance(color: RgbColor): number {
  const [r, g, b] = [color.r, color.g, color.b].map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
