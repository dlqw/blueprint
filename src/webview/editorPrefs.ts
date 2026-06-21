import { defaultLocale, normalizeLocale, type Locale } from "./i18n";
import { defaultThemeId, normalizeCustomTheme, normalizeThemeId, type CustomThemeConfig, type ThemeId } from "./themes";

export type LinkRenderMode = "spline" | "straight" | "orthogonal" | "hidden";
export type ActionBarPlacement = "bottom" | "top";
export type ToolbarAlignment = "left" | "center" | "right";
export type NodeLabelMode = "localized" | "source" | "both";
export type MainToolbarActionId =
  | "commandPalette"
  | "compile"
  | "validate"
  | "findNode"
  | "fitGraph"
  | "resetZoom"
  | "run"
  | "stepRun"
  | "minimap"
  | "links"
  | "templateRegistry"
  | "prefsPanel"
  | "overflow";

export interface GraphEditorPrefs {
  minimapVisible: boolean;
  linkRenderMode: LinkRenderMode;
  gridVisible: boolean;
  snapToGrid: boolean;
  actionBarPlacement: ActionBarPlacement;
  toolbarAlignment: ToolbarAlignment;
  nodeLabelMode: NodeLabelMode;
  language: Locale;
  theme: ThemeId;
  customTheme?: CustomThemeConfig;
  shortcuts: Record<string, string>;
  mainToolbarActions: MainToolbarActionId[];
}

export const linkRenderModes: LinkRenderMode[] = ["spline", "straight", "orthogonal", "hidden"];
export const actionBarPlacements: ActionBarPlacement[] = ["bottom", "top"];
export const toolbarAlignments: ToolbarAlignment[] = ["left", "center", "right"];
export const nodeLabelModes: NodeLabelMode[] = ["localized", "source", "both"];
export const mainToolbarActionIds: MainToolbarActionId[] = [
  "commandPalette",
  "compile",
  "validate",
  "findNode",
  "fitGraph",
  "resetZoom",
  "run",
  "stepRun",
  "minimap",
  "links",
  "templateRegistry",
  "prefsPanel",
  "overflow"
];
export const defaultMainToolbarActions: MainToolbarActionId[] = [
  "commandPalette",
  "compile",
  "validate",
  "fitGraph",
  "resetZoom",
  "minimap",
  "links",
  "prefsPanel",
  "overflow"
];

export const defaultGraphEditorPrefs: GraphEditorPrefs = {
  minimapVisible: true,
  linkRenderMode: "spline",
  gridVisible: true,
  snapToGrid: false,
  actionBarPlacement: "bottom",
  toolbarAlignment: "center",
  nodeLabelMode: "localized",
  language: defaultLocale,
  theme: defaultThemeId,
  shortcuts: {},
  mainToolbarActions: defaultMainToolbarActions
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
    toolbarAlignment: normalizeToolbarAlignment(editorPrefs.toolbarAlignment),
    nodeLabelMode: normalizeNodeLabelMode(editorPrefs.nodeLabelMode),
    language: normalizeLocale(editorPrefs.language),
    theme: normalizeThemeId(editorPrefs.theme),
    ...(customTheme ? { customTheme } : {}),
    shortcuts: readShortcutPrefs(editorPrefs.shortcuts),
    mainToolbarActions: normalizeMainToolbarActions(editorPrefs.mainToolbarActions)
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
    toolbarAlignment: prefs.toolbarAlignment,
    nodeLabelMode: prefs.nodeLabelMode,
    language: prefs.language,
    theme: prefs.theme,
    shortcuts: prefs.shortcuts,
    mainToolbarActions: prefs.mainToolbarActions
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

export function normalizeToolbarAlignment(value: unknown): ToolbarAlignment {
  return typeof value === "string" && toolbarAlignments.includes(value as ToolbarAlignment)
    ? value as ToolbarAlignment
    : defaultGraphEditorPrefs.toolbarAlignment;
}

export function normalizeNodeLabelMode(value: unknown): NodeLabelMode {
  return typeof value === "string" && nodeLabelModes.includes(value as NodeLabelMode)
    ? value as NodeLabelMode
    : defaultGraphEditorPrefs.nodeLabelMode;
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

function normalizeMainToolbarActions(value: unknown): MainToolbarActionId[] {
  if (!Array.isArray(value)) {
    return defaultGraphEditorPrefs.mainToolbarActions;
  }
  const seen = new Set<MainToolbarActionId>();
  for (const item of value) {
    if (typeof item === "string" && mainToolbarActionIds.includes(item as MainToolbarActionId)) {
      seen.add(item as MainToolbarActionId);
    }
  }
  return seen.size ? mainToolbarActionIds.filter((id) => seen.has(id)) : defaultGraphEditorPrefs.mainToolbarActions;
}
