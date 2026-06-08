import { describe, expect, it } from "vitest";
import { getBuiltinTemplates } from "../shared/builtins";
import { BlueprintGraph, BlueprintNodeInstance } from "../shared/blueprint";
import { getEffectiveTemplateForNode } from "../shared/graph";
import { applyAutoLayout, renderedNodeHeight, renderedNodeWidth } from "./autoLayout";

describe("applyAutoLayout", () => {
  it("lays out a large linear graph left-to-right without overlapping regular nodes", () => {
    const graph = largeLinearGraph(80);
    const laidOut = applyAutoLayout(graph, getBuiltinTemplates());
    const regularNodes = laidOut.nodes.filter((node) => !node.displayOverrides?.autoLayoutHub);

    expect(regularNodes).toHaveLength(82);
    expect(laidOut.links).toHaveLength(81);
    for (let index = 1; index < regularNodes.length; index += 1) {
      expect(regularNodes[index].position.x).toBeGreaterThanOrEqual(regularNodes[index - 1].position.x);
    }
    for (let a = 0; a < regularNodes.length; a += 1) {
      for (let b = a + 1; b < regularNodes.length; b += 1) {
        expect(overlaps(regularNodes[a], regularNodes[b])).toBe(false);
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

function overlaps(a: BlueprintNodeInstance, b: BlueprintNodeInstance): boolean {
  const width = 268;
  const height = 102;
  return !(
    a.position.x + width <= b.position.x ||
    b.position.x + width <= a.position.x ||
    a.position.y + height <= b.position.y ||
    b.position.y + height <= a.position.y
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
