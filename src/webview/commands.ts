export interface EditorCommand {
  id: string;
  title: string;
  category: string;
  run(): void;
  disabled?: boolean;
  shortcut?: string;
  alternateShortcuts?: string[];
  keywords?: string[];
}

export type ShortcutPrefs = Record<string, string>;

export function commandShortcuts(command: EditorCommand): string[] {
  return [command.shortcut, ...(command.alternateShortcuts ?? [])].filter((shortcut): shortcut is string => Boolean(shortcut));
}

export function applyShortcutPrefs(commands: EditorCommand[], prefs: ShortcutPrefs): EditorCommand[] {
  return commands.map((command) => {
    const shortcut = normalizeShortcutSpec(prefs[command.id]);
    return shortcut ? { ...command, shortcut, alternateShortcuts: [] } : command;
  });
}

export function shortcutConflictTitles(commands: EditorCommand[], commandId: string, shortcut: string, prefs: ShortcutPrefs): string[] {
  const normalized = normalizeShortcutSpec(shortcut);
  if (!normalized) {
    return [];
  }
  return applyShortcutPrefs(commands, prefs)
    .filter((command) => command.id !== commandId)
    .filter((command) => commandShortcuts(command).some((candidate) => normalizeShortcutSpec(candidate) === normalized))
    .map((command) => command.title);
}

export function normalizeShortcutSpec(shortcut: unknown): string | undefined {
  if (typeof shortcut !== "string") {
    return undefined;
  }
  const parts = shortcut.split("+").map((part) => part.trim()).filter(Boolean);
  const key = parts.at(-1);
  if (!key) {
    return undefined;
  }

  const modifiers = new Set<string>();
  for (const modifier of parts.slice(0, -1)) {
    const normalizedModifier = normalizeShortcutModifier(modifier);
    if (!normalizedModifier) {
      return undefined;
    }
    modifiers.add(normalizedModifier);
  }

  const orderedModifiers = ["ctrl", "shift", "alt", "meta"].filter((modifier) => modifiers.has(modifier));
  return [...orderedModifiers, normalizeShortcutKey(key)].join("+");
}

export function commandMatchesQuery(command: EditorCommand, query: string): boolean {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) {
    return true;
  }
  const haystack = [command.title, command.category, command.id, ...(command.keywords ?? []), ...commandShortcuts(command)]
    .join(" ")
    .toLowerCase();
  return tokens.every((token) => haystack.includes(token));
}

export function shortcutMatchesEvent(shortcut: string, event: KeyboardEvent): boolean {
  const parts = shortcut.toLowerCase().split("+").map((part) => part.trim()).filter(Boolean);
  const key = parts.at(-1);
  if (!key) {
    return false;
  }

  const expectsCtrl = parts.includes("ctrl") || parts.includes("cmd");
  const expectsShift = parts.includes("shift");
  const expectsAlt = parts.includes("alt") || parts.includes("option");
  const expectsMeta = parts.includes("meta");
  const actualCtrl = event.ctrlKey || event.metaKey;
  const normalizedKey = normalizeShortcutKey(event.key);

  return actualCtrl === expectsCtrl
    && event.shiftKey === expectsShift
    && event.altKey === expectsAlt
    && (!expectsMeta || event.metaKey)
    && normalizedKey === normalizeShortcutKey(key);
}

export function shortcutLabel(shortcut: string): string {
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  return shortcut
    .split("+")
    .map((part) => {
      const normalized = part.trim();
      const lower = normalized.toLowerCase();
      if (isMac && lower === "ctrl") {
        return "Cmd";
      }
      if (lower === "ctrl") {
        return "Ctrl";
      }
      if (lower === "shift") {
        return "Shift";
      }
      if (lower === "alt") {
        return "Alt";
      }
      if (lower === "meta") {
        return "Meta";
      }
      return normalized.length === 1 ? normalized.toUpperCase() : normalized;
    })
    .join(" ");
}

function normalizeShortcutKey(key: string): string {
  const normalized = key.toLowerCase();
  if (normalized === " ") {
    return "space";
  }
  if (normalized === "esc") {
    return "escape";
  }
  if (normalized === "arrowup") {
    return "up";
  }
  if (normalized === "arrowdown") {
    return "down";
  }
  return normalized;
}

function normalizeShortcutModifier(modifier: string): string | undefined {
  const normalized = modifier.toLowerCase();
  if (normalized === "ctrl" || normalized === "control" || normalized === "cmd" || normalized === "command") {
    return "ctrl";
  }
  if (normalized === "shift") {
    return "shift";
  }
  if (normalized === "alt" || normalized === "option") {
    return "alt";
  }
  if (normalized === "meta") {
    return "meta";
  }
  return undefined;
}
