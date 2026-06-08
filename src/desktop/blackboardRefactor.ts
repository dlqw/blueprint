import type { BlueprintGraph, BlueprintNodeInstance, BlueprintProject } from "../shared/blueprint";

export interface RenameBlackboardKeyInGraphResult {
  graph: BlueprintGraph;
  changedNodeIds: string[];
}

export interface RenameBlackboardKeyInProjectResult {
  project: BlueprintProject;
  changedVariableIds: string[];
}

export function renameBlackboardKeyInGraph(
  graph: BlueprintGraph,
  oldKey: string,
  nextKey: string
): RenameBlackboardKeyInGraphResult {
  const from = oldKey.trim();
  const to = nextKey.trim();
  if (!from || !to || from === to) {
    return { graph, changedNodeIds: [] };
  }

  const changedNodeIds: string[] = [];
  const nodes = graph.nodes.map((node) => {
    if (!isBlackboardAccessNode(node)) {
      return node;
    }
    const keyBinding = node.inputBindings.key;
    if (keyBinding?.sourceKind !== "literal" || keyBinding.literalValue !== from) {
      return node;
    }
    changedNodeIds.push(node.id);
    return {
      ...node,
      inputBindings: {
        ...node.inputBindings,
        key: {
          ...keyBinding,
          literalValue: to
        }
      }
    };
  });

  return changedNodeIds.length ? { graph: { ...graph, nodes }, changedNodeIds } : { graph, changedNodeIds };
}

export function renameBlackboardKeyInProject(
  project: BlueprintProject,
  oldKey: string,
  nextKey: string
): RenameBlackboardKeyInProjectResult {
  const from = oldKey.trim();
  const to = nextKey.trim();
  const variables = project.blackboard?.variables ?? [];
  if (!from || !to || from === to || !variables.some((variable) => variable.id === from)) {
    return { project, changedVariableIds: [] };
  }
  if (variables.some((variable) => variable.id === to)) {
    throw new Error(`Blackboard variable '${to}' already exists in project '${project.name}'.`);
  }

  const changedVariableIds: string[] = [];
  const nextVariables = variables.map((variable) => {
    if (variable.id !== from) {
      return variable;
    }
    changedVariableIds.push(variable.id);
    return {
      ...variable,
      id: to,
      name: variable.name === from ? to : variable.name
    };
  });

  return {
    project: {
      ...project,
      blackboard: project.blackboard
        ? {
            ...project.blackboard,
            variables: nextVariables
          }
        : project.blackboard
    },
    changedVariableIds
  };
}

function isBlackboardAccessNode(node: BlueprintNodeInstance): boolean {
  return node.templateId === "builtin.blackboard.get" || node.templateId === "builtin.blackboard.set";
}
