import { defaultLocale, normalizeLocale, type Locale } from "./i18n";
import { defaultThemeId, normalizeCustomTheme, normalizeThemeId, type CustomThemeConfig, type ThemeId } from "./themes";

export type LinkRenderMode = "spline" | "straight" | "orthogonal" | "hidden";
export type ActionBarPlacement = "bottom" | "top";

export interface GraphEditorPrefs {
  minimapVisible: boolean;
  linkRenderMode: LinkRenderMode;
  gridVisible: boolean;
  snapToGrid: boolean;
  actionBarPlacement: ActionBarPlacement;
  language: Locale;
  theme: ThemeId;
  customTheme?: CustomThemeConfig;
  shortcuts: Record<string, string>;
}

export const linkRenderModes: LinkRenderMode[] = ["spline", "straight", "orthogonal", "hidden"];
export const actionBarPlacements: ActionBarPlacement[] = ["bottom", "top"];

export const defaultGraphEditorPrefs: GraphEditorPrefs = {
  minimapVisible: true,
  linkRenderMode: "spline",
  gridVisible: true,
  snapToGrid: false,
  actionBarPlacement: "bottom",
  language: defaultLocale,
  theme: defaultThemeId,
  shortcuts: {}
};

export function readGraphEditorPrefs(state: unknown): GraphEditorPrefs {
  const editorPrefs = recordFromUnknown(recordFromUnknown(state).editorPrefs);
  const customTheme = normalizeCustomTheme(editorPrefs.customTheme);
  return {
    minimapVisible: typeof editorPrefs.minimapVisible === "boolean" ? editorPrefs.minimapVisible : defaultGraphEditorPrefs.minimapVisible,
    linkRenderMode: normalizeLinkRenderMode(editorPrefs.linkRenderMode),
    gridVisible: typeof editorPrefs.gridVisible === "boolean" ? editorPrefs.gridVisible : defaultGraphEditorPrefs.gridVisible,
    snapToGrid: typeof editorPrefs.snapToGrid === "boolean" ? editorPrefs.snapToGrid : defaultGraphEditorPrefs.snapToGrid,
    actionBarPlacement: normalizeActionBarPlacement(editorPrefs.actionBarPlacement),
    language: normalizeLocale(editorPrefs.language),
    theme: normalizeThemeId(editorPrefs.theme),
    ...(customTheme ? { customTheme } : {}),
    shortcuts: readShortcutPrefs(editorPrefs.shortcuts)
  };
}

export function mergeGraphEditorPrefsState(state: unknown, prefs: GraphEditorPrefs): Record<string, unknown> {
  const root = recordFromUnknown(state);
  const editorPrefs = recordFromUnknown(root.editorPrefs);
  const nextEditorPrefs = {
    ...editorPrefs,
    minimapVisible: prefs.minimapVisible,
    linkRenderMode: prefs.linkRenderMode,
    gridVisible: prefs.gridVisible,
    snapToGrid: prefs.snapToGrid,
    actionBarPlacement: prefs.actionBarPlacement,
    language: prefs.language,
    theme: prefs.theme,
    shortcuts: prefs.shortcuts
  };
  if (prefs.customTheme) {
    Object.assign(nextEditorPrefs, { customTheme: prefs.customTheme });
  } else {
    delete (nextEditorPrefs as Record<string, unknown>).customTheme;
  }
  return {
    ...root,
    editorPrefs: nextEditorPrefs
  };
}

export function serializeGraphEditorPrefs(prefs: GraphEditorPrefs): string {
  return JSON.stringify({
    format: "blueprint-editor-prefs",
    version: 1,
    editorPrefs: prefs
  }, null, 2);
}

export function readGraphEditorPrefsFromText(text: string): GraphEditorPrefs {
  const parsed = JSON.parse(text) as unknown;
  const record = recordFromUnknown(parsed);
  return readGraphEditorPrefs("editorPrefs" in record ? record : { editorPrefs: record });
}

export function normalizeLinkRenderMode(value: unknown): LinkRenderMode {
  return typeof value === "string" && linkRenderModes.includes(value as LinkRenderMode) ? value as LinkRenderMode : defaultGraphEditorPrefs.linkRenderMode;
}

export function normalizeActionBarPlacement(value: unknown): ActionBarPlacement {
  return typeof value === "string" && actionBarPlacements.includes(value as ActionBarPlacement)
    ? value as ActionBarPlacement
    : defaultGraphEditorPrefs.actionBarPlacement;
}

function recordFromUnknown(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readShortcutPrefs(value: unknown): Record<string, string> {
  const record = recordFromUnknown(value);
  return Object.fromEntries(
    Object.entries(record)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim().length > 0)
      .map(([commandId, shortcut]) => [commandId, shortcut.trim()])
  );
}
