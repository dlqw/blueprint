import { describe, expect, it } from "vitest";
import { getBuiltinTemplates } from "../shared/builtins";
import { validateGraph } from "../shared/graph";
import { createWorkflowGraph, getWorkflowTemplates } from "./workflowTemplates";

describe("desktop workflow templates", () => {
  it("exposes example workflows for the desktop template browser", () => {
    expect(getWorkflowTemplates().map((template) => template.id)).toEqual([
      "empty-function",
      "log-message",
      "boolean-branch",
      "blackboard-write"
    ]);
  });

  it("creates valid blueprint graphs from every workflow template", () => {
    const builtins = getBuiltinTemplates();

    for (const template of getWorkflowTemplates()) {
      const graph = createWorkflowGraph(template.id, template.defaultGraphName);
      const issues = validateGraph(graph, builtins);

      expect(issues, template.id).toEqual([]);
      expect(graph.name).toBe(template.defaultGraphName);
      expect(graph.id).toMatch(/^[a-z0-9-]+$/);
      expect(template.preview).toEqual({
        nodeCount: graph.nodes.length,
        linkCount: graph.links.length,
        inputCount: graph.templateMetadata?.inputs.length ?? 0,
        outputCount: graph.templateMetadata?.outputs.length ?? 0,
        commentCount: graph.comments?.length ?? 0
      });
      expect(template.tags.length, template.id).toBeGreaterThan(0);
    }
  });

  it("throws for an unknown workflow template id", () => {
    expect(() => createWorkflowGraph("missing-template", "Missing")).toThrow("Unknown workflow template");
  });
});
