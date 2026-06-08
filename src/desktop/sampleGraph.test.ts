import { describe, expect, it } from "vitest";
import { getBuiltinTemplates } from "../shared/builtins";
import { validateGraph } from "../shared/graph";
import { desktopSampleGraph } from "./sampleGraph";

describe("desktop sample graph", () => {
  it("is valid against built-in templates for the Tauri bootstrap screen", () => {
    const issues = validateGraph(desktopSampleGraph, getBuiltinTemplates());

    expect(issues).toEqual([]);
    expect(desktopSampleGraph.nodes.map((node) => node.templateId)).toContain("builtin.string.concat");
  });
});
