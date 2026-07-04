import type { BlueprintBreakpoint, BlueprintGraph, BlueprintLink, BlueprintNodeInstance, RuntimeTraceEvent } from "./blueprint";

export interface GraphEngineSpikeFixture {
  graph: BlueprintGraph;
  selectedNodeId: string;
  disabledNodeId: string;
  breakpointNodeId: string;
  runtimeTraces: RuntimeTraceEvent[];
  breakpoints: BlueprintBreakpoint[];
}

export function createGraphEngineSpikeFixture(): GraphEngineSpikeFixture {
  const nodes: BlueprintNodeInstance[] = [
    {
      id: "entry",
      templateId: "builtin.control.entry",
      position: { x: 80, y: 180 },
      inputBindings: {}
    },
    {
      id: "branch",
      templateId: "builtin.control.branch",
      position: { x: 340, y: 180 },
      inputBindings: {
        condition: { portId: "condition", sourceKind: "literal", literalValue: true }
      }
    },
    {
      id: "concat",
      templateId: "builtin.string.concat",
      position: { x: 330, y: 430 },
      inputBindings: {
        left: { portId: "left", sourceKind: "literal", literalValue: "score " },
        right: { portId: "right", sourceKind: "literal", literalValue: "42" }
      }
    },
    {
      id: "data-hub",
      templateId: "builtin.routing.dataHub",
      position: { x: 620, y: 440 },
      inputBindings: {},
      displayOverrides: { manualRoutingHub: true }
    },
    {
      id: "log-active",
      templateId: "builtin.debug.log",
      position: { x: 640, y: 90 },
      inputBindings: {
        message: { portId: "message", sourceKind: "literal", literalValue: "true path" }
      }
    },
    {
      id: "log-error",
      templateId: "builtin.debug.log",
      position: { x: 900, y: 190 },
      inputBindings: {
        message: { portId: "message", sourceKind: "link", linkId: "link-hub-error" }
      }
    },
    {
      id: "log-disabled",
      templateId: "builtin.debug.log",
      position: { x: 640, y: 300 },
      inputBindings: {
        message: { portId: "message", sourceKind: "literal", literalValue: "disabled path" }
      },
      displayOverrides: { disabled: true }
    },
    {
      id: "end",
      templateId: "builtin.control.end",
      position: { x: 1180, y: 190 },
      inputBindings: {}
    },
    ...Array.from({ length: 16 }, (_, index) => ({
      id: `offscreen-log-${index}`,
      templateId: "builtin.debug.log",
      position: { x: 1580 + index * 260, y: index % 2 === 0 ? -420 : 820 },
      inputBindings: {
        message: { portId: "message", sourceKind: "literal" as const, literalValue: `offscreen ${index}` }
      }
    }))
  ];

  const links: BlueprintLink[] = [
    {
      id: "link-entry-branch",
      fromNodeId: "entry",
      fromPortId: "then",
      toNodeId: "branch",
      toPortId: "exec",
      flowKind: "control" as const
    },
    {
      id: "link-branch-active",
      fromNodeId: "branch",
      fromPortId: "true",
      toNodeId: "log-active",
      toPortId: "exec",
      flowKind: "control" as const
    },
    {
      id: "link-branch-disabled",
      fromNodeId: "branch",
      fromPortId: "false",
      toNodeId: "log-disabled",
      toPortId: "exec",
      flowKind: "control" as const
    },
    {
      id: "link-active-error",
      fromNodeId: "log-active",
      fromPortId: "then",
      toNodeId: "log-error",
      toPortId: "exec",
      flowKind: "control" as const
    },
    {
      id: "link-error-end",
      fromNodeId: "log-error",
      fromPortId: "then",
      toNodeId: "end",
      toPortId: "exec",
      flowKind: "control" as const
    },
    {
      id: "link-concat-hub",
      fromNodeId: "concat",
      fromPortId: "result",
      toNodeId: "data-hub",
      toPortId: "value",
      flowKind: "data" as const
    },
    {
      id: "link-hub-error",
      fromNodeId: "data-hub",
      fromPortId: "out",
      toNodeId: "log-error",
      toPortId: "message",
      flowKind: "data" as const
    }
  ];

  const graph: BlueprintGraph = {
    format: "blueprint-graph",
    version: 1,
    kind: "function",
    id: "graph-engine-spike-fixture",
    name: "Graph Engine Spike Fixture",
    description: "Representative BlueprintGraph fixture for isolated graph engine spikes.",
    templateMetadata: {
      creationPath: "Blueprints",
      inputs: [],
      outputs: []
    },
    nodes,
    links,
    debug: {
      breakpoints: [{ nodeId: "log-error", condition: "hit >= 1" }]
    },
    layout: {
      viewport: { x: -40, y: -24, zoom: 0.92 }
    }
  };

  const runtimeTraces: RuntimeTraceEvent[] = [
    { graphId: graph.id, nodeId: "entry", nodeName: "Entry", status: "visited", timestamp: 1 },
    { graphId: graph.id, nodeId: "branch", nodeName: "Branch", status: "visited", timestamp: 2 },
    { graphId: graph.id, nodeId: "log-active", nodeName: "Log Active", status: "active", timestamp: 3 },
    { graphId: graph.id, nodeId: "log-error", nodeName: "Log Error", status: "error", message: "Fixture runtime error", timestamp: 4 }
  ];

  return {
    graph,
    selectedNodeId: "log-active",
    disabledNodeId: "log-disabled",
    breakpointNodeId: "log-error",
    runtimeTraces,
    breakpoints: graph.debug?.breakpoints ?? []
  };
}
