#!/usr/bin/env python3
"""Interactive debug launcher for Blueprint IDE.

This script intentionally uses only the Python standard library so it can be
run from a fresh checkout without installing additional TUI packages.
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Sequence


ROOT = Path(__file__).resolve().parent.parent


@dataclass(frozen=True)
class LauncherAction:
    key: str
    title: str
    description: str
    command: tuple[str, ...]
    long_running: bool = False


def npm_command() -> str:
    return "npm.cmd" if os.name == "nt" else "npm"


NPM = npm_command()

ACTION_GROUPS: tuple[tuple[str, tuple[LauncherAction, ...]], ...] = (
    (
        "Development",
        (
            LauncherAction(
                "desktop",
                "Desktop webview dev server",
                "Start Vite on http://127.0.0.1:1420 for browser debugging.",
                (NPM, "run", "desktop:dev"),
                long_running=True,
            ),
            LauncherAction(
                "tauri",
                "Tauri desktop shell",
                "Launch the full Tauri desktop app with the dev webview.",
                (NPM, "run", "tauri:dev"),
                long_running=True,
            ),
        ),
    ),
    (
        "Validation",
        (
            LauncherAction(
                "typecheck",
                "TypeScript typecheck",
                "Run strict shared and desktop TypeScript checks.",
                (NPM, "run", "typecheck"),
            ),
            LauncherAction(
                "webview-test",
                "Webview unit tests",
                "Run Vitest jsdom tests for shared, desktop, and webview code.",
                (NPM, "run", "test:webview"),
            ),
            LauncherAction(
                "layout-test",
                "Playwright layout tests",
                "Run browser-visible smoke and layout checks.",
                (NPM, "run", "test:layout"),
            ),
            LauncherAction(
                "smoke",
                "Gameplay smoke test",
                "Compile shared code and run the Gameplay example bridge.",
                (NPM, "run", "smoke"),
            ),
            LauncherAction(
                "tauri-check",
                "Tauri Rust check",
                "Run the Rust command bridge check through the project helper.",
                (NPM, "run", "tauri:check"),
            ),
        ),
    ),
    (
        "Build and packaged checks",
        (
            LauncherAction(
                "build",
                "Desktop build",
                "Compile shared TypeScript and the Vite desktop assets.",
                (NPM, "run", "build"),
            ),
            LauncherAction(
                "packaged-persistence",
                "Packaged persistence check",
                "Build and verify preference persistence after app restart.",
                (NPM, "run", "test:packaged-persistence"),
            ),
            LauncherAction(
                "packaged-profile",
                "Packaged large-graph profile",
                "Profile packaged large-graph rendering and culling budgets.",
                (NPM, "run", "test:packaged-profile"),
            ),
        ),
    ),
    (
        "Setup",
        (
            LauncherAction(
                "install",
                "Install npm dependencies",
                "Run npm install for this workspace.",
                (NPM, "install"),
            ),
            LauncherAction(
                "playwright-install",
                "Install Playwright Chromium",
                "Install the Chromium browser used by layout tests.",
                (NPM, "run", "playwright:install"),
            ),
        ),
    ),
)

ACTION_BY_KEY = {
    action.key: action
    for _, actions in ACTION_GROUPS
    for action in actions
}


def clear_screen() -> None:
    os.system("cls" if os.name == "nt" else "clear")


def format_command(command: Sequence[str]) -> str:
    return " ".join(command)


def iter_numbered_actions() -> Iterable[tuple[int, LauncherAction]]:
    index = 1
    for _, actions in ACTION_GROUPS:
        for action in actions:
            yield index, action
            index += 1


def print_menu() -> None:
    print("Blueprint IDE Debug Launcher")
    print("=" * 30)
    print(f"Workspace: {ROOT}")
    print()

    next_index = 1
    for group, actions in ACTION_GROUPS:
        print(group)
        for action in actions:
            marker = " (long running)" if action.long_running else ""
            print(f"  {next_index:>2}. {action.title}{marker}")
            print(f"      {action.description}")
            print(f"      {format_command(action.command)}")
            next_index += 1
        print()

    print("Commands: number/key to run, l to list keys, c to clear, q to quit")


def ensure_workspace() -> None:
    package_json = ROOT / "package.json"
    src_tauri = ROOT / "src-tauri"
    if not package_json.exists() or not src_tauri.exists():
        raise SystemExit(
            "scripts/debug-launcher.py must be run from the Blueprint IDE repository root."
        )


def ensure_tool_available(command: Sequence[str]) -> None:
    executable = command[0]
    if shutil.which(executable) is None:
        raise SystemExit(
            f"Required executable '{executable}' was not found on PATH."
        )


def run_action(action: LauncherAction, dry_run: bool = False) -> int:
    ensure_tool_available(action.command)
    print()
    print(f"> {action.title}")
    print(f"$ {format_command(action.command)}")
    print()
    if dry_run:
        return 0

    try:
        completed = subprocess.run(action.command, cwd=ROOT, check=False)
    except KeyboardInterrupt:
        print()
        print("Interrupted by user.")
        return 130

    return completed.returncode


def choose_action(selection: str) -> LauncherAction | None:
    normalized = selection.strip()
    if not normalized:
        return None

    if normalized.isdigit():
        index = int(normalized)
        for action_index, action in iter_numbered_actions():
            if action_index == index:
                return action
        return None

    return ACTION_BY_KEY.get(normalized)


def list_actions() -> None:
    for index, action in iter_numbered_actions():
        print(f"{index:>2}. {action.key:<20} {action.title}")


def interactive_loop() -> int:
    last_status = 0
    while True:
        print_menu()
        selection = input("> ").strip()
        if selection.lower() in {"q", "quit", "exit"}:
            return last_status
        if selection.lower() in {"c", "clear"}:
            clear_screen()
            continue
        if selection.lower() in {"l", "list"}:
            list_actions()
            print()
            input("Press Enter to continue...")
            clear_screen()
            continue

        action = choose_action(selection)
        if action is None:
            print("Unknown action. Choose a number or action key.")
            print()
            input("Press Enter to continue...")
            clear_screen()
            continue

        last_status = run_action(action)
        print()
        print(f"Exit code: {last_status}")
        if action.long_running:
            return last_status
        input("Press Enter to return to the launcher...")
        clear_screen()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Blueprint IDE interactive debug launcher."
    )
    parser.add_argument(
        "--list",
        action="store_true",
        help="List available action keys and exit.",
    )
    parser.add_argument(
        "--run",
        choices=sorted(ACTION_BY_KEY),
        metavar="KEY",
        help="Run a launcher action directly without showing the TUI.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the selected command without executing it.",
    )
    return parser.parse_args()


def main() -> int:
    ensure_workspace()
    args = parse_args()

    if args.list:
        list_actions()
        return 0

    if args.run:
        return run_action(ACTION_BY_KEY[args.run], dry_run=args.dry_run)

    clear_screen()
    return interactive_loop()


if __name__ == "__main__":
    raise SystemExit(main())
