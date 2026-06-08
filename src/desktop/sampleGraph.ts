import { BlueprintGraph } from "../shared/blueprint";

export const desktopSampleGraph: BlueprintGraph = {
  format: "blueprint-graph",
  version: 1,
  id: "desktop-main",
  name: "桌面主图",
  description: "Tauri 2 桌面壳层启动示例图。",
  templateMetadata: {
    creationPath: "Desktop",
    inputs: [],
    outputs: []
  },
  nodes: [
    {
      id: "entry",
      templateId: "builtin.control.entry",
      position: { x: 80, y: 120 },
      inputBindings: {}
    },
    {
      id: "message",
      templateId: "builtin.string.concat",
      position: { x: 360, y: 40 },
      inputBindings: {
        a: {
          portId: "a",
          sourceKind: "literal",
          literalValue: "Tauri 2"
        },
        b: {
          portId: "b",
          sourceKind: "literal",
          literalValue: " Blueprint IDE"
        }
      }
    },
    {
      id: "log",
      templateId: "builtin.debug.log",
      position: { x: 620, y: 120 },
      inputBindings: {
        message: {
          portId: "message",
          sourceKind: "link",
          linkId: "link-message-log"
        }
      }
    },
    {
      id: "end",
      templateId: "builtin.control.end",
      position: { x: 900, y: 120 },
      inputBindings: {}
    }
  ],
  links: [
    {
      id: "link-entry-log",
      fromNodeId: "entry",
      fromPortId: "then",
      toNodeId: "log",
      toPortId: "exec",
      flowKind: "control"
    },
    {
      id: "link-log-end",
      fromNodeId: "log",
      fromPortId: "then",
      toNodeId: "end",
      toPortId: "exec",
      flowKind: "control"
    },
    {
      id: "link-message-log",
      fromNodeId: "message",
      fromPortId: "result",
      toNodeId: "log",
      toPortId: "message",
      flowKind: "data",
      contextVariableId: "desktopMessage"
    }
  ],
  layout: {
    viewport: {
      x: 40,
      y: 120,
      zoom: 0.9
    }
  }
};
