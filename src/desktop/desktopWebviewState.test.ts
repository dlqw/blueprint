import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDesktopWebviewApi, desktopStateKey, readJsonStorage, writeJsonStorage } from "./desktopWebviewState";

describe("desktop webview state storage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("persists editor host state through the desktop localStorage key", () => {
    const api = createDesktopWebviewApi(vi.fn());
    const state = {
      editorPrefs: {
        gridVisible: false,
        shortcuts: {
          "graph.duplicate": "Ctrl+Alt+D"
        }
      }
    };

    api.setState(state);

    expect(JSON.parse(window.localStorage.getItem(desktopStateKey) ?? "{}")).toEqual(state);
    expect(api.getState()).toEqual(state);
  });

  it("ignores invalid stored JSON and still writes valid state", () => {
    window.localStorage.setItem(desktopStateKey, "{not-json");
    expect(readJsonStorage(desktopStateKey)).toBeUndefined();

    writeJsonStorage(desktopStateKey, { editorPrefs: { minimapVisible: false } });
    expect(readJsonStorage(desktopStateKey)).toEqual({ editorPrefs: { minimapVisible: false } });
  });
});
