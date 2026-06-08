import { describe, expect, it } from "vitest";
import { getBuiltinTemplates } from "../shared/builtins";
import { BlueprintGraph, BlueprintNodeInstance } from "../shared/blueprint";
import { getEffectiveTemplateForNode } from "../shared/graph";
import { applyAutoLayout, NODE_WIDTH, portLocalPoint, renderedNodeHeight, renderedNodeWidth } from "./autoLayout";

describe("applyAutoLayout", () => {
  it("lays out a large linear graph left-to-right without overlapping regular nodes", () => {
    const graph = largeLinearGraph(80);
    const templates = getBuiltinTemplates();
    const laidOut = applyAutoLayout(graph, templates);
    const regularNodes = laidOut.nodes.filter((node) => !node.displayOverrides?.autoLayoutHub);

    expect(regularNodes).toHaveLength(82);
    expect(laidOut.links).toHaveLength(81);
    for (let index = 1; index < regularNodes.length; index += 1) {
      expect(regularNodes[index].position.x).toBeGreaterThanOrEqual(regularNodes[index - 1].position.x);
    }
    for (let a = 0; a < regularNodes.length; a += 1) {
      for (let b = a + 1; b < regularNodes.length; b += 1) {
        expect(overlaps(laidOut, templates, regularNodes[a], regularNodes[b])).toBe(false);
      }
    }
  });

  it("keeps comment boxes wrapped around their nodes after layout", () => {
    const templates = getBuiltinTemplates();
    const graph = largeLinearGraph(2);
    const graphWithComment: BlueprintGraph = {
      ...graph,
      comments: [
        {
          id: "comment-startup",
          title: "Startup",
          position: { x: -800, y: -800 },
          size: { width: 80, height: 60 },
          nodeIds: ["entry", "log-0"],
          color: "#48b9c7"
        }
      ]
    };

    const laidOut = applyAutoLayout(graphWithComment, templates);
    const comment = laidOut.comments?.find((candidate) => candidate.id === "comment-startup");

    expect(comment).toBeDefined();
    expect(comment?.title).toBe("Startup");
    expect(comment?.color).toBe("#48b9c7");
    expect(comment?.nodeIds).toEqual(["entry", "log-0"]);
    for (const nodeId of comment?.nodeIds ?? []) {
      const node = laidOut.nodes.find((candidate) => candidate.id === nodeId);
      expect(node).toBeDefined();
      expect(commentContainsNode(laidOut, node as BlueprintNodeInstance, comment!)).toBe(true);
    }
  });

  it("aligns port geometry to node edges and rendered port sections", () => {
    const templates = getBuiltinTemplates();
    const log = templates.find((template) => template.id === "builtin.debug.log");
    const branch = templates.find((template) => template.id === "builtin.control.branch");
    expect(log).toBeDefined();
    expect(branch).toBeDefined();

    expect(portLocalPoint(log!, log!.controlInputs[0])).toEqual({ x: 0, y: 58 });
    expect(portLocalPoint(log!, log!.controlOutputs[0])).toEqual({ x: NODE_WIDTH, y: 58 });
    expect(portLocalPoint(log!, log!.inputs[0])).toEqual({ x: 0, y: 98 });
    expect(portLocalPoint(branch!, branch!.controlOutputs[0])).toEqual({ x: NODE_WIDTH, y: 58 });
    expect(portLocalPoint(branch!, branch!.controlOutputs[1])).toEqual({ x: NODE_WIDTH, y: 88 });
    expect(portLocalPoint(branch!, branch!.inputs[0])).toEqual({ x: 0, y: 128 });
  });
});

function largeLinearGraph(logCount: number): BlueprintGraph {
  const nodes: BlueprintNodeInstance[] = [
    {
      id: "entry",
      templateId: "builtin.control.entry",
      position: { x: 0, y: 0 },
      inputBindings: {}
    }
  ];
  for (let index = 0; index < logCount; index += 1) {
    nodes.push({
      id: `log-${index}`,
      templateId: "builtin.debug.log",
      position: { x: 0, y: 0 },
      inputBindings: {
        message: { portId: "message", sourceKind: "literal", literalValue: `Message ${index}` }
      }
    });
  }
  nodes.push({
    id: "end",
    templateId: "builtin.control.end",
    position: { x: 0, y: 0 },
    inputBindings: {}
  });

  return {
    format: "blueprint-graph",
    version: 1,
    kind: "function",
    id: "large-linear",
    name: "Large Linear",
    description: "Large graph for layout testing.",
    templateMetadata: {
      creationPath: "Blueprints",
      inputs: [],
      outputs: []
    },
    nodes,
    links: nodes.slice(0, -1).map((node, index) => ({
      id: `link-${index}`,
      fromNodeId: node.id,
      fromPortId: node.id === "entry" ? "then" : "then",
      toNodeId: nodes[index + 1].id,
      toPortId: nodes[index + 1].id === "end" ? "exec" : "exec",
      flowKind: "control" as const
    })),
    layout: {
      viewport: { x: 0, y: 0, zoom: 1 }
    }
  };
}

function overlaps(graph: BlueprintGraph, templates: ReturnType<typeof getBuiltinTemplates>, a: BlueprintNodeInstance, b: BlueprintNodeInstance): boolean {
  const aTemplate = getEffectiveTemplateForNode(graph, templates, a);
  const bTemplate = getEffectiveTemplateForNode(graph, templates, b);
  const aWidth = renderedNodeWidth(aTemplate, a);
  const bWidth = renderedNodeWidth(bTemplate, b);
  const aHeight = renderedNodeHeight(aTemplate, a);
  const bHeight = renderedNodeHeight(bTemplate, b);
  return !(
    a.position.x + aWidth <= b.position.x ||
    b.position.x + bWidth <= a.position.x ||
    a.position.y + aHeight <= b.position.y ||
    b.position.y + bHeight <= a.position.y
  );
}

function commentContainsNode(graph: BlueprintGraph, node: BlueprintNodeInstance, comment: NonNullable<BlueprintGraph["comments"]>[number]): boolean {
  const template = getEffectiveTemplateForNode(graph, getBuiltinTemplates(), node);
  const nodeRight = node.position.x + renderedNodeWidth(template, node);
  const nodeBottom = node.position.y + renderedNodeHeight(template, node);
  const commentRight = comment.position.x + comment.size.width;
  const commentBottom = comment.position.y + comment.size.height;
  return comment.position.x <= node.position.x && comment.position.y <= node.position.y && commentRight >= nodeRight && commentBottom >= nodeBottom;
}
