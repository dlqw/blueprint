import { describe, expect, it } from "vitest";
import type { BlueprintGraph, BlueprintNodeInstance, BlueprintProject } from "../shared/blueprint";
import { renameBlackboardKeyInGraph, renameBlackboardKeyInProject } from "./blackboardRefactor";

describe("blackboard refactors", () => {
  it("renames literal blackboard get/set keys without touching dynamic or unrelated bindings", () => {
    const graph: BlueprintGraph = {
      format: "blueprint-graph",
      version: 1,
      id: "score-graph",
      name: "Score Graph",
      description: "",
      nodes: [
        blackboardNode("get-score", "builtin.blackboard.get", "score"),
        blackboardNode("set-score", "builtin.blackboard.set", "score"),
        blackboardNode("get-health", "builtin.blackboard.get", "health"),
        {
          id: "dynamic-key",
          templateId: "builtin.blackboard.get",
          position: { x: 0, y: 0 },
          inputBindings: {
            key: { portId: "key", sourceKind: "link", linkId: "key-link" }
          }
        },
        {
          id: "string-node",
          templateId: "builtin.string.concat",
          position: { x: 0, y: 0 },
          inputBindings: {
            key: { portId: "key", sourceKind: "literal", literalValue: "score" }
          }
        }
      ],
      links: [],
      layout: { viewport: { x: 0, y: 0, zoom: 1 } }
    };

    const result = renameBlackboardKeyInGraph(graph, "score", "totalScore");

    expect(result.changedNodeIds).toEqual(["get-score", "set-score"]);
    expect(result.graph.nodes.find((node) => node.id === "get-score")?.inputBindings.key.literalValue).toBe("totalScore");
    expect(result.graph.nodes.find((node) => node.id === "set-score")?.inputBindings.key.literalValue).toBe("totalScore");
    expect(result.graph.nodes.find((node) => node.id === "get-health")?.inputBindings.key.literalValue).toBe("health");
    expect(result.graph.nodes.find((node) => node.id === "dynamic-key")?.inputBindings.key).toEqual({
      portId: "key",
      sourceKind: "link",
      linkId: "key-link"
    });
    expect(result.graph.nodes.find((node) => node.id === "string-node")?.inputBindings.key.literalValue).toBe("score");
  });

  it("returns the original graph when no blackboard keys match", () => {
    const graph: BlueprintGraph = {
      format: "blueprint-graph",
      version: 1,
      id: "score-graph",
      name: "Score Graph",
      description: "",
      nodes: [blackboardNode("get-score", "builtin.blackboard.get", "score")],
      links: [],
      layout: { viewport: { x: 0, y: 0, zoom: 1 } }
    };

    const result = renameBlackboardKeyInGraph(graph, "health", "totalHealth");

    expect(result.graph).toBe(graph);
    expect(result.changedNodeIds).toEqual([]);
  });

  it("renames project blackboard variable ids and preserves distinct display names", () => {
    const project: BlueprintProject = {
      format: "blueprint-project",
      version: 1,
      name: "Gameplay",
      graphs: [],
      templateSources: [],
      blackboard: {
        scope: "project",
        variables: [
          { id: "score", name: "Score Total", type: "number", defaultValue: 0, description: "" },
          { id: "health", name: "health", type: "number", defaultValue: 100, description: "" }
        ]
      },
      compiler: {
        outDir: "dist",
        module: "ESNext",
        target: "ES2022",
        runtime: "runtime.ts"
      }
    };

    const renamedScore = renameBlackboardKeyInProject(project, "score", "totalScore");
    const renamedHealth = renameBlackboardKeyInProject(renamedScore.project, "health", "hp");

    expect(renamedScore.changedVariableIds).toEqual(["score"]);
    expect(renamedScore.project.blackboard?.variables[0]).toMatchObject({ id: "totalScore", name: "Score Total" });
    expect(renamedHealth.project.blackboard?.variables[1]).toMatchObject({ id: "hp", name: "hp" });
  });

  it("blocks project blackboard variable id collisions", () => {
    const project: BlueprintProject = {
      format: "blueprint-project",
      version: 1,
      name: "Gameplay",
      graphs: [],
      templateSources: [],
      blackboard: {
        scope: "project",
        variables: [
          { id: "score", name: "Score", type: "number", defaultValue: 0, description: "" },
          { id: "totalScore", name: "Total Score", type: "number", defaultValue: 0, description: "" }
        ]
      },
      compiler: {
        outDir: "dist",
        module: "ESNext",
        target: "ES2022",
        runtime: "runtime.ts"
      }
    };

    expect(() => renameBlackboardKeyInProject(project, "score", "totalScore")).toThrow(
      "Blackboard variable 'totalScore' already exists in project 'Gameplay'."
    );
  });
});

function blackboardNode(id: string, templateId: "builtin.blackboard.get" | "builtin.blackboard.set", key: string): BlueprintNodeInstance {
  return {
    id,
    templateId,
    position: { x: 0, y: 0 },
    inputBindings: {
      key: { portId: "key", sourceKind: "literal", literalValue: key }
    }
  };
}
