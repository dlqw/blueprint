import { describe, expect, it } from "vitest";
import { applyShortcutPrefs, commandMatchesQuery, EditorCommand, shortcutConflictTitles, shortcutMatchesEvent } from "./commands";

const commands: EditorCommand[] = [
  { id: "workbench.commandPalette", title: "Show Command Palette", category: "Workbench", shortcut: "Ctrl+K", run: () => undefined },
  { id: "graph.duplicate", title: "Duplicate Selection", category: "Edit", shortcut: "Ctrl+D", run: () => undefined },
  { id: "graph.delete", title: "Delete Selection", category: "Edit", shortcut: "Delete", alternateShortcuts: ["Backspace"], run: () => undefined }
];

describe("commands", () => {
  it("applies shortcut preferences and replaces default alternates", () => {
    const customized = applyShortcutPrefs(commands, { "graph.delete": "Ctrl+Alt+D" });
    const deleteCommand = customized.find((command) => command.id === "graph.delete");

    expect(deleteCommand?.shortcut).toBe("ctrl+alt+d");
    expect(deleteCommand?.alternateShortcuts).toEqual([]);
    expect(shortcutMatchesEvent(deleteCommand?.shortcut ?? "", keyEvent("d", { ctrlKey: true, altKey: true }))).toBe(true);
    expect(shortcutMatchesEvent("Backspace", keyEvent("Backspace"))).toBe(true);
    expect(shortcutMatchesEvent(deleteCommand?.shortcut ?? "", keyEvent("Backspace"))).toBe(false);
  });

  it("reports shortcut conflicts against default and customized commands", () => {
    expect(shortcutConflictTitles(commands, "graph.duplicate", "Ctrl+K", {})).toEqual(["Show Command Palette"]);
    expect(shortcutConflictTitles(commands, "graph.delete", "Ctrl+Alt+D", { "graph.duplicate": "Ctrl+Alt+D" })).toEqual(["Duplicate Selection"]);
  });

  it("matches command titles with pinyin queries", () => {
    const command: EditorCommand = { id: "graph.findNode", title: "查找节点", category: "图", run: () => undefined };

    expect(commandMatchesQuery(command, "chazhao")).toBe(true);
    expect(commandMatchesQuery(command, "czjd")).toBe(true);
  });
});

function keyEvent(key: string, init: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return new KeyboardEvent("keydown", { key, ...init });
}
