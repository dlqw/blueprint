import { describe, expect, it } from "vitest";
import { isBlueprintGraph, isBlueprintProject } from "./blueprintFileGuards";
import { desktopSampleGraph } from "./sampleGraph";

describe("desktop Blueprint file guards", () => {
  it("accepts .bpgraph-shaped graph JSON", () => {
    expect(isBlueprintGraph(desktopSampleGraph)).toBe(true);
  });

  it("rejects solution and project JSON as directly loadable graphs", () => {
    expect(isBlueprintGraph({ format: "blueprint-solution", version: 1, name: "Sample", projects: [] })).toBe(false);
    expect(isBlueprintGraph({ format: "blueprint-project", version: 1, name: "Sample", graphs: [] })).toBe(false);
  });

  it("accepts .bproj-shaped project JSON for template source management", () => {
    expect(isBlueprintProject({
      format: "blueprint-project",
      version: 1,
      name: "Gameplay",
      graphs: ["graphs/main.bpgraph"],
      templateSources: ["src/**/*.ts"],
      compiler: { outDir: "generated", module: "ESNext", target: "ES2022", runtime: "tsx" }
    })).toBe(true);
  });
});
