import { Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { commandMatchesQuery, commandShortcuts, EditorCommand, shortcutLabel } from "./commands";
import type { Translator } from "./i18n";
import { isolateOverlayContextMenu, isolateOverlayEvent } from "./overlayEvents";

export function CommandPalette(props: {
  open: boolean;
  commands: EditorCommand[];
  t: Translator;
  onClose(): void;
}): JSX.Element | null {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const visibleCommands = useMemo(
    () => props.commands.filter((command) => commandMatchesQuery(command, query)).slice(0, 48),
    [props.commands, query]
  );
  const groupedCommands = useMemo(() => groupCommands(visibleCommands), [visibleCommands]);

  useEffect(() => {
    if (!props.open) {
      setQuery("");
      setActiveIndex(0);
      return;
    }
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [props.open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  if (!props.open) {
    return null;
  }

  const runCommand = (command: EditorCommand) => {
    if (command.disabled) {
      return;
    }
    command.run();
    props.onClose();
  };

  return (
    <div
      className="command-palette-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          props.onClose();
        }
      }}
    >
      <section
        className="command-palette"
        role="dialog"
        aria-label={props.t("commandPalette.label")}
        onPointerDown={isolateOverlayEvent}
        onWheel={isolateOverlayEvent}
        onContextMenu={isolateOverlayContextMenu}
      >
        <label className="command-palette-search">
          <Search size={16} />
          <input
            ref={inputRef}
            value={query}
            placeholder={props.t("commandPalette.placeholder")}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                props.onClose();
              } else if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveIndex((current) => Math.min(current + 1, Math.max(0, visibleCommands.length - 1)));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveIndex((current) => Math.max(0, current - 1));
              } else if (event.key === "Enter") {
                event.preventDefault();
                const command = visibleCommands[activeIndex];
                if (command) {
                  runCommand(command);
                }
              }
            }}
          />
        </label>
        <div className="command-list">
          {visibleCommands.length ? groupedCommands.map((group) => (
            <div key={group.category} className="command-group">
              <div className="command-group-title">{group.category}</div>
              {group.commands.map((command) => {
                const index = visibleCommands.indexOf(command);
                return (
                  <button
                    key={command.id}
                    className={index === activeIndex ? "command-item active" : "command-item"}
                    disabled={command.disabled}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => runCommand(command)}
                  >
                    <span>{command.title}</span>
                    {commandShortcuts(command)[0] ? <kbd>{shortcutLabel(commandShortcuts(command)[0])}</kbd> : null}
                  </button>
                );
              })}
            </div>
          )) : <div className="command-empty">{props.t("commandPalette.empty")}</div>}
        </div>
      </section>
    </div>
  );
}

function groupCommands(commands: EditorCommand[]): Array<{ category: string; commands: EditorCommand[] }> {
  const groups = new Map<string, EditorCommand[]>();
  for (const command of commands) {
    groups.set(command.category, [...(groups.get(command.category) ?? []), command]);
  }
  return [...groups.entries()].map(([category, groupCommands]) => ({ category, commands: groupCommands }));
}
