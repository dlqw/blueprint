import { describe, expect, it } from "vitest";
import { createGraphEngineSpikeFixture } from "./graphEngineSpikeFixture";

describe("graph engine spike fixture", () => {
  it("provides the representative graph required by isolated graph-engine spikes", () => {
    const fixture = createGraphEngineSpikeFixture();
    const { graph } = fixture;

    expect(graph.format).toBe("blueprint-graph");
    expect(graph.version).toBe(1);
    expect(graph.nodes.length).toBeGreaterThanOrEqual(20);
    expect(graph.links.some((link) => link.flowKind === "control")).toBe(true);
    expect(graph.links.some((link) => link.flowKind === "data")).toBe(true);
    expect(graph.nodes.some((node) => node.id === fixture.selectedNodeId)).toBe(true);
    expect(graph.nodes.find((node) => node.id === fixture.disabledNodeId)?.displayOverrides?.disabled).toBe(true);
    expect(fixture.breakpoints).toEqual(expect.arrayContaining([expect.objectContaining({ nodeId: fixture.breakpointNodeId })]));
    expect(fixture.runtimeTraces).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: "active" }),
      expect.objectContaining({ status: "error" })
    ]));
    expect(graph.nodes.some((node) => node.templateId === "builtin.routing.dataHub")).toBe(true);
    expect(graph.nodes.some((node) => node.position.x > 3000 || node.position.y < 0 || node.position.y > 700)).toBe(true);
  });

  it("keeps every link and runtime trace anchored to stable Blueprint node ids", () => {
    const fixture = createGraphEngineSpikeFixture();
    const nodeIds = new Set(fixture.graph.nodes.map((node) => node.id));

    for (const link of fixture.graph.links) {
      expect(nodeIds.has(link.fromNodeId), `${link.id} from node`).toBe(true);
      expect(nodeIds.has(link.toNodeId), `${link.id} to node`).toBe(true);
    }

    for (const trace of fixture.runtimeTraces) {
      expect(trace.graphId).toBe(fixture.graph.id);
      expect(nodeIds.has(trace.nodeId), `${trace.status} trace node`).toBe(true);
    }
  });
});
