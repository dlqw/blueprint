import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = process.cwd();

function readRepoFile(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

function toRepoPath(path: string): string {
  return path.replace(`${repoRoot}\\`, "").replaceAll("\\", "/");
}

function rawElementLines(source: string, elementName: string): string[] {
  return source.split(/\r?\n/).filter((line) => line.includes(`<${elementName}`));
}

function sourceFiles(dir = join(repoRoot, "src"), extensions = new Set([".ts", ".tsx", ".rs"])): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(path, extensions);
    }
    if (!entry.isFile() || ![...extensions].some((extension) => entry.name.endsWith(extension))) {
      return [];
    }
    return [toRepoPath(path)];
  });
}

function webviewTsxFiles(dir = join(repoRoot, "src/webview")): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return webviewTsxFiles(path);
    }
    if (!entry.isFile() || !entry.name.endsWith(".tsx")) {
      return [];
    }
    return [toRepoPath(path)];
  });
}

function shippedSourceFiles(): string[] {
  return [
    "package.json",
    "package-lock.json",
    ...sourceFiles().filter((path) =>
      !path.endsWith(".test.ts") &&
      !path.endsWith(".test.tsx") &&
      path !== "src/webview/ui/refactorBoundary.test.ts" &&
      path !== "src/webview/test/setup.ts"
    )
  ];
}

const canvasCoreBoundaryFiles = [
  "src/webview/GraphCanvas.tsx",
  "src/webview/canvasController.ts",
  "src/webview/interactionState.ts",
  "src/webview/autoLayout.ts",
  "src/webview/graphEditActions.ts",
  "src/shared/blueprint.ts",
  "src/shared/graph.ts"
];

function rawButtonBlocks(source: string): string[] {
  const blocks = source.match(/<button\b[\s\S]*?(?:\/>|<\/button>)/g);
  return blocks ?? [];
}

function primitiveClassNames(source: string): string[] {
  return [...source.matchAll(/["'](ui-[a-z0-9-]+)["']/g)].map((match) => match[1]);
}

describe("progressive UI refactor boundaries", () => {
  it("documents the local primitive architecture and contribution rules", () => {
    const guide = readRepoFile("docs/workbench-ui-primitives.md");
    const plan = readRepoFile("docs/progressive-ui-refactor-plan.md");

    for (const phrase of [
      "src/webview/ui/primitives.tsx",
      "Compose non-canvas controls from local primitives",
      "Keep raw form controls inside primitive internals",
      "Style primitives and migrated surfaces through existing CSS tokens",
      "Do not import UI primitives from canvas or graph core modules",
      "Do not add FlowGram, litegraph.js, React Flow, or `@xyflow/react` to this branch"
    ]) {
      expect(guide).toContain(phrase);
    }

    expect(plan).toContain("docs/workbench-ui-primitives.md");
  });

  it("keeps exported primitive class names backed by CSS rules", () => {
    const primitiveSource = readRepoFile("src/webview/ui/primitives.tsx");
    const styles = readRepoFile("src/webview/styles.css");
    const missing = [...new Set(primitiveClassNames(primitiveSource))]
      .filter((className) => !styles.includes(`.${className}`));

    expect(missing).toEqual([]);
  });

  it("keeps primitive state attributes backed by CSS selectors", () => {
    const styles = readRepoFile("src/webview/styles.css");

    for (const selector of [
      '.ui-command-button[data-state="active"]',
      '.ui-icon-button[data-state="active"]',
      '.ui-list-action[data-state="active"]',
      '.ui-tabs-trigger[data-state="active"]',
      '.ui-segmented-button[data-state="active"]',
      ".ui-command-button[data-disabled]",
      ".ui-icon-button[data-disabled]",
      ".ui-list-action[data-disabled]",
      ".ui-menu-action[data-disabled]",
      ".ui-tabs-trigger[data-disabled]",
      ".ui-segmented-button[data-disabled]",
      ".ui-text-input[data-disabled]",
      ".ui-number-input[data-disabled]",
      ".ui-select-input[data-disabled]",
      ".ui-checkbox-input[data-disabled]",
      ".ui-color-input[data-disabled]",
      ".ui-checkbox-row[data-disabled]"
    ]) {
      expect(styles).toContain(selector);
    }
  });

  it("keeps raw buttons limited to specialized canvas pointer targets and primitive internals", () => {
    const rawButtonsByFile = Object.fromEntries(
      webviewTsxFiles()
        .filter((path) => !path.endsWith(".test.tsx") && path !== "src/webview/ui/primitives.tsx")
        .map((path) => [path, rawButtonBlocks(readRepoFile(path))])
        .filter(([, blocks]) => blocks.length)
    );

    expect(Object.keys(rawButtonsByFile)).toEqual(["src/webview/App.tsx"]);
    expect(rawButtonsByFile["src/webview/App.tsx"]).toHaveLength(4);
    expect(rawButtonsByFile["src/webview/App.tsx"]).toEqual([
      expect.stringContaining('className="comment-resize"'),
      expect.stringContaining('className="minimap"'),
      expect.stringContaining("className={className}"),
      expect.stringContaining('className="node-panel-resize"')
    ]);
  });

  it("keeps raw form controls isolated to local UI primitive internals", () => {
    const nonPrimitiveSources = webviewTsxFiles()
      .filter((path) => !path.endsWith(".test.tsx") && path !== "src/webview/ui/primitives.tsx")
      .map((path) => [path, readRepoFile(path)] as const);
    const primitiveSource = readRepoFile("src/webview/ui/primitives.tsx");

    for (const elementName of ["input", "select", "textarea"]) {
      const offenders = nonPrimitiveSources.flatMap(([path, source]) =>
        rawElementLines(source, elementName).map((line) => `${path}: ${line.trim()}`)
      );
      expect(offenders).toEqual([]);
    }
    expect(rawElementLines(primitiveSource, "input").length).toBeGreaterThan(0);
    expect(rawElementLines(primitiveSource, "select").length).toBeGreaterThan(0);
  });

  it("keeps canvas and graph core modules independent from workbench UI primitives", () => {
    const offenders = canvasCoreBoundaryFiles.filter((path) =>
      /ui\/primitives|\.\/ui\/primitives|\.\.\/ui\/primitives/.test(readRepoFile(path))
    );

    expect(offenders).toEqual([]);
  });

  it("keeps graph engine candidates out of shipped source and manifests", () => {
    const offenders = shippedSourceFiles().filter((path) =>
      /flowgram|litegraph|@xyflow|react-flow/i.test(readRepoFile(path))
    );

    expect(offenders).toEqual([]);
  });
});
