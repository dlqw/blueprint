import { describe, expect, it } from "vitest";
import type { BlueprintGraph, BlueprintNodeTemplate } from "./blueprint";
import {
  createTemplateSourceRetargetPlan,
  retargetTemplateIdInGraph,
  retargetTemplateSourceInGraph,
  templateSourcePath
} from "./templateRefactor";

describe("template refactors", () => {
  it("retargets template ids in a graph without mutating unrelated nodes", () => {
    const graph = graphWithTemplates(["old.template", "other.template", "old.template"]);

    const result = retargetTemplateIdInGraph(graph, "old.template", "next.template");

    expect(result.changedNodeIds).toEqual(["node-0", "node-2"]);
    expect(result.graph.nodes.map((node) => node.templateId)).toEqual(["next.template", "other.template", "next.template"]);
    expect(graph.nodes.map((node) => node.templateId)).toEqual(["old.template", "other.template", "old.template"]);
  });

  it("builds a compatible source retarget map and applies it to graph nodes", () => {
    const oldDouble = template("ts.Math.Double", "Double", "src/math.ts", "double");
    const oldRound = template("ts.Math.Round", "Round", "src/math.ts", "round");
    const nextDouble = template("ts.MathV2.Double", "Double", "src/math-v2.ts", "double");
    const incompatibleRound = {
      ...template("ts.MathV2.Round", "Round", "src/math-v2.ts", "round"),
      outputs: []
    };
    const graph = graphWithTemplates(["ts.Math.Double", "ts.Math.Round", "builtin.debug.log"]);

    const plan = createTemplateSourceRetargetPlan([oldDouble, oldRound, nextDouble, incompatibleRound], "src\\math.ts", "src/math-v2.ts");
    const result = retargetTemplateSourceInGraph(graph, plan.templateIdMap);

    expect(plan.oldSourcePath).toBe("src/math.ts");
    expect(plan.templateIdMap).toEqual(new Map([["ts.Math.Double", "ts.MathV2.Double"]]));
    expect(plan.unmatchedTemplateIds).toEqual(["ts.Math.Round"]);
    expect(result.changedNodeIds).toEqual(["node-0"]);
    expect(result.graph.nodes.map((node) => node.templateId)).toEqual(["ts.MathV2.Double", "ts.Math.Round", "builtin.debug.log"]);
  });

  it("reads TypeScript template source paths from metadata or body refs", () => {
    expect(templateSourcePath(template("ts.Math.Double", "Double", "src/math.ts", "double"))).toBe("src/math.ts");
    expect(templateSourcePath({ ...template("ts.Math.Round", "Round", "src/math.ts", "round"), metadata: undefined })).toBe("src/math.ts");
  });
});

function graphWithTemplates(templateIds: string[]): BlueprintGraph {
  return {
    format: "blueprint-graph",
    version: 1,
    id: "test",
    name: "Test",
    description: "Test graph.",
    nodes: templateIds.map((templateId, index) => ({
      id: `node-${index}`,
      templateId,
      position: { x: index * 100, y: 0 },
      inputBindings: {}
    })),
    links: [],
    layout: {
      viewport: { x: 0, y: 0, zoom: 1 }
    }
  };
}

function template(id: string, name: string, source: string, memberName: string): BlueprintNodeTemplate {
  return {
    id,
    name,
    creationPath: "TypeScript/Math",
    description: `${name} helper.`,
    inputs: [{
      id: "value",
      name: "value",
      direction: "input",
      flowKind: "data",
      type: "number",
      description: "Value.",
      editor: "number"
    }],
    outputs: [{
      id: "result",
      name: "Result",
      direction: "output",
      flowKind: "data",
      type: "number",
      description: "Result.",
      editor: "none"
    }],
    controlInputs: [],
    controlOutputs: [],
    bodyKind: "typescriptFunction",
    bodyRef: `${source}#${memberName}`,
    metadata: {
      source,
      memberName
    }
  };
}
