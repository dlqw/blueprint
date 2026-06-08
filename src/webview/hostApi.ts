import { EditorToHostMessage } from "../shared/blueprint";

export interface EditorHostApi {
  postMessage(message: EditorToHostMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare global {
  interface Window {
    blueprintEditorHostApi?: EditorHostApi;
  }
}

export function getEditorHostApi(): EditorHostApi | undefined {
  return window.blueprintEditorHostApi;
}
