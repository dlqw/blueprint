import type { BlueprintBreakpointSpec, BlueprintGraph, EditorToHostMessage } from "../shared/blueprint";
import type { EditorHostApi } from "./hostApi";

export interface EditorHostClient {
  getState(): unknown;
  setState(state: unknown): void;
  notifyReady(): void;
  notifyGraphChanged(graph: BlueprintGraph): void;
  requestUndo(): void;
  requestRedo(): void;
  requestTemplates(): void;
  requestValidation(graph: BlueprintGraph): void;
  requestCompileGraph(graph: BlueprintGraph): void;
  requestRunGraph(graph: BlueprintGraph, options?: { breakpoints?: BlueprintBreakpointSpec[]; stepMode?: boolean }): void;
  requestCancelRun(): void;
  requestRuntimeStep(): void;
  requestRuntimeContinue(): void;
  requestOpenGraph(graphPath: string): void;
  requestRenameSolutionGraph(graphPath: string, nextName: string): void;
  requestRenameGraphNodeId(oldNodeId: string, nextNodeId: string): void;
  requestExtractCollapsedUnitToProjectGraph(templateId: string, graphName: string): void;
  requestRenameSolutionBlackboardKey(oldKey: string, nextKey: string): void;
  requestRetargetSolutionTemplate(oldTemplateId: string, nextTemplateId: string): void;
  requestRetargetSolutionTemplateSource(oldSourcePath: string, nextSourcePath: string): void;
}

export function createEditorHostClient(hostApi: EditorHostApi | undefined): EditorHostClient {
  const post = (message: EditorToHostMessage): void => {
    hostApi?.postMessage(message);
  };

  return {
    getState() {
      return hostApi?.getState();
    },
    setState(state) {
      hostApi?.setState(state);
    },
    notifyReady() {
      post({ type: "ready" });
    },
    notifyGraphChanged(graph) {
      post({ type: "graphChanged", graph });
    },
    requestUndo() {
      post({ type: "requestUndo" });
    },
    requestRedo() {
      post({ type: "requestRedo" });
    },
    requestTemplates() {
      post({ type: "requestTemplates" });
    },
    requestValidation(graph) {
      post({ type: "requestValidation", graph });
    },
    requestCompileGraph(graph) {
      post({ type: "requestCompile", graph });
    },
    requestRunGraph(graph, options) {
      post({ type: "requestRun", graph, breakpoints: options?.breakpoints, stepMode: options?.stepMode });
    },
    requestCancelRun() {
      post({ type: "requestCancelRun" });
    },
    requestRuntimeStep() {
      post({ type: "requestRuntimeStep" });
    },
    requestRuntimeContinue() {
      post({ type: "requestRuntimeContinue" });
    },
    requestOpenGraph(graphPath) {
      post({ type: "requestOpenGraph", graphPath });
    },
    requestRenameSolutionGraph(graphPath, nextName) {
      post({ type: "requestRenameSolutionGraph", graphPath, nextName });
    },
    requestRenameGraphNodeId(oldNodeId, nextNodeId) {
      post({ type: "requestRenameGraphNodeId", oldNodeId, nextNodeId });
    },
    requestExtractCollapsedUnitToProjectGraph(templateId, graphName) {
      post({ type: "requestExtractCollapsedUnitToProjectGraph", templateId, graphName });
    },
    requestRenameSolutionBlackboardKey(oldKey, nextKey) {
      post({ type: "requestRenameSolutionBlackboardKey", oldKey, nextKey });
    },
    requestRetargetSolutionTemplate(oldTemplateId, nextTemplateId) {
      post({ type: "requestRetargetSolutionTemplate", oldTemplateId, nextTemplateId });
    },
    requestRetargetSolutionTemplateSource(oldSourcePath, nextSourcePath) {
      post({ type: "requestRetargetSolutionTemplateSource", oldSourcePath, nextSourcePath });
    }
  };
}
