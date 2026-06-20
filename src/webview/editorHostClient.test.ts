import { describe, expect, it } from "vitest";
import type { BlueprintGraph, EditorToHostMessage } from "../shared/blueprint";
import { createEditorHostClient } from "./editorHostClient";

const graph: BlueprintGraph = {
  format: "blueprint-graph",
  version: 1,
  id: "client-test",
  name: "Client Test",
  description: "",
  nodes: [],
  links: [],
  layout: { viewport: { x: 0, y: 0, zoom: 1 } }
};

describe("createEditorHostClient", () => {
  it("routes runtime requests to host messages without executing graph behavior", () => {
    const messages: EditorToHostMessage[] = [];
    const client = createEditorHostClient({
      postMessage: (message) => messages.push(message),
      getState: () => undefined,
      setState: () => undefined
    });

    client.requestCompileGraph(graph);
    client.requestRunGraph(graph, { breakpoints: [{ nodeId: "score", condition: "hit >= 2" }], stepMode: true });
    client.requestRuntimeStep();
    client.requestRuntimeContinue();
    client.requestCancelRun();
    client.requestRenameSolutionGraph("graphs/main.bpgraph", "Main Menu");
    client.requestRenameGraphNodeId("log1", "trace-log");
    client.requestExtractCollapsedUnitToProjectGraph("macro.trace-log", "Trace Log");
    client.requestRenameSolutionBlackboardKey("score", "totalScore");
    client.requestRetargetSolutionTemplate("ts.Math.Double", "ts.MathV2.Double");
    client.requestRetargetSolutionTemplateSource("src/math.ts", "src/math-v2.ts");

    expect(messages).toEqual([
      { type: "requestCompile", graph },
      { type: "requestRun", graph, runId: expect.stringMatching(/^run-/), breakpoints: [{ nodeId: "score", condition: "hit >= 2" }], stepMode: true },
      { type: "requestRuntimeStep" },
      { type: "requestRuntimeContinue" },
      { type: "requestCancelRun" },
      { type: "requestRenameSolutionGraph", graphPath: "graphs/main.bpgraph", nextName: "Main Menu" },
      { type: "requestRenameGraphNodeId", oldNodeId: "log1", nextNodeId: "trace-log" },
      { type: "requestExtractCollapsedUnitToProjectGraph", templateId: "macro.trace-log", graphName: "Trace Log" },
      { type: "requestRenameSolutionBlackboardKey", oldKey: "score", nextKey: "totalScore" },
      { type: "requestRetargetSolutionTemplate", oldTemplateId: "ts.Math.Double", nextTemplateId: "ts.MathV2.Double" },
      { type: "requestRetargetSolutionTemplateSource", oldSourcePath: "src/math.ts", nextSourcePath: "src/math-v2.ts" }
    ]);
  });

  it("keeps persisted editor state owned by the host adapter", () => {
    let state: unknown = { palette: { recentTemplateIds: ["old"], favoriteTemplateIds: [] } };
    const client = createEditorHostClient({
      postMessage: () => undefined,
      getState: () => state,
      setState: (next) => {
        state = next;
      }
    });

    expect(client.getState()).toEqual({ palette: { recentTemplateIds: ["old"], favoriteTemplateIds: [] } });

    client.setState({ palette: { recentTemplateIds: ["next"], favoriteTemplateIds: ["log"] } });

    expect(client.getState()).toEqual({ palette: { recentTemplateIds: ["next"], favoriteTemplateIds: ["log"] } });
  });
});
