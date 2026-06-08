import { describe, expect, it } from "vitest";
import { defaultGraphEditorPrefs, mergeGraphEditorPrefsState, readGraphEditorPrefs, readGraphEditorPrefsFromText, serializeGraphEditorPrefs } from "./editorPrefs";

describe("editorPrefs", () => {
  it("normalizes unknown or invalid editor preference state", () => {
    expect(readGraphEditorPrefs({
      editorPrefs: {
        minimapVisible: "yes",
        linkRenderMode: "curved",
        gridVisible: 1,
        snapToGrid: "false",
        actionBarPlacement: "left",
        language: "de-DE",
        theme: "purple-orb",
        shortcuts: {
          "graph.duplicate": "Ctrl+Alt+D",
          "graph.delete": "",
          "graph.copy": 12
        }
      }
    })).toEqual({
      ...defaultGraphEditorPrefs,
      shortcuts: {
        "graph.duplicate": "Ctrl+Alt+D"
      }
    });
  });

  it("merges editor preferences without dropping unrelated host state", () => {
    expect(mergeGraphEditorPrefsState({
      palette: { recentTemplateIds: ["builtin.debug.log"] },
      editorPrefs: {
        customSetting: "kept"
      }
    }, {
      minimapVisible: false,
      linkRenderMode: "orthogonal",
      gridVisible: false,
      snapToGrid: true,
      actionBarPlacement: "top",
      language: "en-US",
      theme: "graphite",
      shortcuts: {
        "graph.duplicate": "Ctrl+Alt+D"
      }
    })).toEqual({
      palette: { recentTemplateIds: ["builtin.debug.log"] },
      editorPrefs: {
        customSetting: "kept",
        minimapVisible: false,
        linkRenderMode: "orthogonal",
        gridVisible: false,
        snapToGrid: true,
        actionBarPlacement: "top",
        language: "en-US",
        theme: "graphite",
        shortcuts: {
          "graph.duplicate": "Ctrl+Alt+D"
        }
      }
    });
  });

  it("persists custom theme preferences and removes stale custom theme data on reset", () => {
    const customTheme = {
      name: "Studio Contrast",
      tokens: {
        bg: "#101114",
        text: "#f5f7fb"
      }
    };

    expect(readGraphEditorPrefs({
      editorPrefs: {
        theme: "custom",
        customTheme
      }
    })).toEqual({
      ...defaultGraphEditorPrefs,
      theme: "custom",
      customTheme
    });

    expect(mergeGraphEditorPrefsState({
      editorPrefs: {
        customTheme: {
          name: "Previous",
          tokens: { bg: "#000" }
        }
      }
    }, {
      ...defaultGraphEditorPrefs,
      theme: "custom",
      customTheme
    })).toEqual({
      editorPrefs: expect.objectContaining({
        theme: "custom",
        customTheme
      })
    });

    expect(mergeGraphEditorPrefsState({
      editorPrefs: {
        customTheme,
        theme: "custom"
      }
    }, defaultGraphEditorPrefs)).toEqual({
      editorPrefs: expect.not.objectContaining({
        customTheme: expect.anything()
      })
    });
  });

  it("serializes and imports editor preferences", () => {
    const prefs = {
      minimapVisible: false,
      linkRenderMode: "straight" as const,
      gridVisible: false,
      snapToGrid: true,
      actionBarPlacement: "top" as const,
      language: "en-US" as const,
      theme: "high-contrast" as const,
      shortcuts: {
        "graph.duplicate": "Ctrl+Alt+D"
      },
      customTheme: {
        name: "Studio Contrast",
        tokens: {
          bg: "#101114",
          text: "#f5f7fb"
        }
      }
    };

    expect(readGraphEditorPrefsFromText(serializeGraphEditorPrefs(prefs))).toEqual(prefs);
    expect(readGraphEditorPrefsFromText(JSON.stringify(prefs))).toEqual(prefs);
  });
});
