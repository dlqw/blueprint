import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CommandPalette } from "./CommandPalette";
import type { EditorCommand } from "./commands";
import { createTranslator } from "./i18n";

describe("CommandPalette", () => {
  it("isolates dialog pointer events while keeping commands clickable", () => {
    const onCanvasPointerDown = vi.fn();
    const onClose = vi.fn();
    const run = vi.fn();
    const commands: EditorCommand[] = [
      {
        id: "test.command",
        title: "Test Command",
        category: "Test",
        run
      }
    ];

    render(
      <div data-testid="canvas" onPointerDown={onCanvasPointerDown}>
        <CommandPalette open={true} commands={commands} t={createTranslator("en-US")} onClose={onClose} />
      </div>
    );

    fireEvent.pointerDown(screen.getByRole("dialog", { name: "Command palette" }), { button: 0 });
    expect(onCanvasPointerDown).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Test Command" }));
    expect(run).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });
});
