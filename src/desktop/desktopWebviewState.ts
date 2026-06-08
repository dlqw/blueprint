import type { EditorHostApi } from "../webview/hostApi";

export const desktopStateKey = "blueprint.desktop.webviewState";
export const desktopGraphKey = "blueprint.desktop.activeGraph";
export const desktopSolutionKey = "blueprint.desktop.activeSolution";

export function createDesktopWebviewApi(
  handleEditorMessage: EditorHostApi["postMessage"],
  storage: Storage = window.localStorage
): EditorHostApi {
  return {
    postMessage(message) {
      handleEditorMessage(message);
    },
    getState() {
      return readJsonStorage(desktopStateKey, storage);
    },
    setState(state) {
      writeJsonStorage(desktopStateKey, state, storage);
    }
  };
}

export function readJsonStorage(key: string, storage: Storage = window.localStorage): unknown {
  const text = storage.getItem(key);
  if (!text) {
    return undefined;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

export function writeJsonStorage(key: string, value: unknown, storage: Storage = window.localStorage): void {
  storage.setItem(key, JSON.stringify(value));
}
