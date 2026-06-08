import { describe, expect, it } from "vitest";
import { graphToNodeTemplate } from "./projectGraphTemplates";
import type { BlueprintGraph } from "./blueprint";

describe("graphToNodeTemplate", () => {
  it("converts project function graphs into blueprintGraph templates", () => {
    const graph = projectGraph("function");

    const template = graphToNodeTemplate(graph, "graphs/score.bpgraph");

    expect(template).toMatchObject({
      id: "graph.score",
      name: "Score",
      creationPath: "Blueprints/Utility",
      bodyKind: "blueprintGraph",
      bodyRef: "graphs/score.bpgraph",
      metadata: {
        source: "graphs/score.bpgraph"
      }
    });
    expect(template.controlInputs.map((port) => port.id)).toEqual(["exec"]);
    expect(template.controlOutputs.map((port) => port.id)).toEqual(["then"]);
  });

  it("carries macro output sources from graph template metadata", () => {
    const graph: BlueprintGraph = {
      ...projectGraph("macro"),
      templateMetadata: {
        creationPath: "Macros/Utility",
        inputs: [],
        outputs: [
          {
            id: "message",
            name: "Message",
            direction: "output",
            flowKind: "data",
            type: "string",
            description: "Message output.",
            editor: "none"
          }
        ],
        outputSources: {
          message: { nodeId: "text", portId: "result" }
        }
      }
    };

    const template = graphToNodeTemplate(graph, "graphs/trace.bpgraph");

    expect(template).toMatchObject({
      id: "macro.score",
      bodyKind: "macroExpansion",
      metadata: {
        source: "graphs/trace.bpgraph",
        outputSources: {
          message: { nodeId: "text", portId: "result" }
        }
      }
    });
  });
});

function projectGraph(kind: "function" | "macro"): BlueprintGraph {
  return {
    format: "blueprint-graph",
    version: 1,
    kind,
    id: "score",
    name: "Score",
    description: "Score graph.",
    templateMetadata: {
      creationPath: "Blueprints/Utility",
      inputs: [],
      outputs: []
    },
    nodes: [
      { id: "entry", templateId: "builtin.control.entry", position: { x: 80, y: 120 }, inputBindings: {} },
      { id: "end", templateId: "builtin.control.end", position: { x: 520, y: 120 }, inputBindings: {} }
    ],
    links: [
      { id: "link-entry-end", fromNodeId: "entry", fromPortId: "then", toNodeId: "end", toPortId: "exec", flowKind: "control" }
    ],
    layout: {
      viewport: { x: 0, y: 0, zoom: 1 }
    }
  };
}
