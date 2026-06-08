export type ThemeId = "comfy-dark" | "graphite" | "high-contrast" | "custom";

export type ThemeTokenName =
  | "bg"
  | "panel"
  | "panel2"
  | "panel3"
  | "panelStrong"
  | "line"
  | "lineSoft"
  | "text"
  | "muted"
  | "dim"
  | "amber"
  | "cyan"
  | "green"
  | "red"
  | "control"
  | "data"
  | "inputBg"
  | "hoverBg"
  | "activeBg"
  | "activeFg"
  | "shadow"
  | "shadowInterface";

export interface CustomThemeConfig {
  name: string;
  tokens: Partial<Record<ThemeTokenName, string>>;
}

export interface EditorTheme {
  id: ThemeId;
  labelKey: string;
  className: string;
}

export const defaultThemeId: ThemeId = "comfy-dark";

export const editorThemes: EditorTheme[] = [
  { id: "comfy-dark", labelKey: "settings.theme.comfy-dark", className: "theme-comfy-dark" },
  { id: "graphite", labelKey: "settings.theme.graphite", className: "theme-graphite" },
  { id: "high-contrast", labelKey: "settings.theme.high-contrast", className: "theme-high-contrast" }
];

const themeTokenCssVars: Record<ThemeTokenName, string> = {
  bg: "--bg",
  panel: "--panel",
  panel2: "--panel-2",
  panel3: "--panel-3",
  panelStrong: "--panel-strong",
  line: "--line",
  lineSoft: "--line-soft",
  text: "--text",
  muted: "--muted",
  dim: "--dim",
  amber: "--amber",
  cyan: "--cyan",
  green: "--green",
  red: "--red",
  control: "--control",
  data: "--data",
  inputBg: "--input-bg",
  hoverBg: "--hover-bg",
  activeBg: "--active-bg",
  activeFg: "--active-fg",
  shadow: "--shadow",
  shadowInterface: "--shadow-interface"
};

export const defaultCustomTheme: CustomThemeConfig = {
  name: "Custom",
  tokens: {}
};

export function normalizeThemeId(value: unknown): ThemeId {
  return typeof value === "string" && (value === "custom" || editorThemes.some((theme) => theme.id === value))
    ? value as ThemeId
    : defaultThemeId;
}

export function themeClassName(themeId: ThemeId): string {
  return editorThemes.find((theme) => theme.id === themeId)?.className ?? "theme-custom";
}

export function themeStyle(themeId: ThemeId, customTheme?: CustomThemeConfig): Record<string, string> | undefined {
  if (themeId !== "custom" || !customTheme) {
    return undefined;
  }
  const style: Record<string, string> = {};
  for (const [key, value] of Object.entries(customTheme.tokens)) {
    if (typeof value === "string" && value.trim()) {
      const cssVariable = themeTokenCssVars[key as ThemeTokenName];
      if (cssVariable) {
        style[cssVariable] = value.trim();
      }
    }
  }
  return style;
}

export function normalizeCustomTheme(value: unknown): CustomThemeConfig | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const name = typeof record.name === "string" && record.name.trim() ? record.name.trim() : defaultCustomTheme.name;
  const tokensRecord = record.tokens && typeof record.tokens === "object" && !Array.isArray(record.tokens)
    ? record.tokens as Record<string, unknown>
    : {};
  const tokens: Partial<Record<ThemeTokenName, string>> = {};
  for (const key of [
    "bg",
    "panel",
    "panel2",
    "panel3",
    "panelStrong",
    "line",
    "lineSoft",
    "text",
    "muted",
    "dim",
    "amber",
    "cyan",
    "green",
    "red",
    "control",
    "data",
    "inputBg",
    "hoverBg",
    "activeBg",
    "activeFg",
    "shadow",
    "shadowInterface"
  ] as ThemeTokenName[]) {
    if (typeof tokensRecord[key] === "string" && tokensRecord[key].trim()) {
      tokens[key] = tokensRecord[key].trim();
    }
  }
  if (!customThemeContrastSafe(tokens)) {
    return undefined;
  }
  return { name, tokens };
}

export function serializeCustomTheme(theme: CustomThemeConfig): string {
  return JSON.stringify({
    format: "blueprint-theme",
    version: 1,
    theme
  }, null, 2);
}

export function readCustomThemeFromText(text: string): CustomThemeConfig {
  const parsed = JSON.parse(text) as unknown;
  const root = recordFromUnknown(parsed);
  const editorPrefs = recordFromUnknown(root.editorPrefs);
  const directTheme = "name" in root || "tokens" in root ? root : undefined;
  const theme = normalizeCustomTheme(root.theme ?? root.customTheme ?? editorPrefs.customTheme ?? directTheme);
  if (!theme) {
    throw new Error("Invalid custom theme.");
  }
  return theme;
}

function recordFromUnknown(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function customThemeContrastSafe(tokens: Partial<Record<ThemeTokenName, string>>): boolean {
  const surface = firstHexColor(tokens.bg) ?? firstHexColor(tokens.panelStrong) ?? firstHexColor(tokens.panel);
  const textSurface = firstHexColor(tokens.inputBg) ?? surface;
  const panelSurface = firstHexColor(tokens.panel) ?? surface;

  if (surface && !contrastSafe(tokens.text, surface, 4.5)) {
    return false;
  }
  if (textSurface && !contrastSafe(tokens.text, textSurface, 4.5)) {
    return false;
  }
  if (surface && !contrastSafe(tokens.muted, surface, 3)) {
    return false;
  }
  if (surface && !contrastSafe(tokens.dim, surface, 3)) {
    return false;
  }
  if (tokens.activeBg && !contrastSafe(tokens.activeFg, firstHexColor(tokens.activeBg), 4.5)) {
    return false;
  }
  for (const key of ["amber", "cyan", "green", "red", "control", "data"] as ThemeTokenName[]) {
    if (panelSurface && !contrastSafe(tokens[key], panelSurface, 3)) {
      return false;
    }
  }
  return true;
}

function contrastSafe(value: string | undefined, background: string | undefined, minimumRatio: number): boolean {
  const foreground = firstHexColor(value);
  if (!foreground || !background) {
    return true;
  }
  return contrastRatio(foreground, background) >= minimumRatio;
}

function firstHexColor(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  return /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(trimmed) ? trimmed : undefined;
}

function contrastRatio(a: string, b: string): number {
  const left = hexToRgb(a);
  const right = hexToRgb(b);
  if (!left || !right) {
    return 1;
  }
  const leftLuminance = relativeLuminance(left);
  const rightLuminance = relativeLuminance(right);
  const lighter = Math.max(leftLuminance, rightLuminance);
  const darker = Math.min(leftLuminance, rightLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function hexToRgb(value: string): { r: number; g: number; b: number } | undefined {
  const hex = value.replace(/^#/, "");
  if (hex.length === 3 || hex.length === 4) {
    return {
      r: Number.parseInt(hex[0] + hex[0], 16),
      g: Number.parseInt(hex[1] + hex[1], 16),
      b: Number.parseInt(hex[2] + hex[2], 16)
    };
  }
  if (hex.length === 6 || hex.length === 8) {
    return {
      r: Number.parseInt(hex.slice(0, 2), 16),
      g: Number.parseInt(hex.slice(2, 4), 16),
      b: Number.parseInt(hex.slice(4, 6), 16)
    };
  }
  return undefined;
}

function relativeLuminance(color: { r: number; g: number; b: number }): number {
  const channels = [color.r, color.g, color.b].map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}
