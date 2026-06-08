import { BlueprintNodeTemplate, createPort } from "./blueprint";

export function getBuiltinTemplates(): BlueprintNodeTemplate[] {
  return [
    {
      id: "builtin.control.entry",
      name: "Function Entry",
      creationPath: "Control/Function",
      description: "Starts execution of a blueprint function.",
      inputs: [],
      outputs: [],
      controlInputs: [],
      controlOutputs: [createPort("then", "Then", "output", "control", "exec", "Next execution step.", "none")],
      bodyKind: "typescriptBuiltin",
      bodyRef: "control.entry"
    },
    {
      id: "builtin.control.end",
      name: "Function End",
      creationPath: "Control/Function",
      description: "Ends execution of a blueprint function.",
      inputs: [],
      outputs: [],
      controlInputs: [createPort("exec", "Exec", "input", "control", "exec", "Execution input.", "none")],
      controlOutputs: [],
      bodyKind: "typescriptBuiltin",
      bodyRef: "control.end"
    },
    {
      id: "builtin.control.branch",
      name: "Branch",
      creationPath: "Control/Flow",
      description: "Routes execution through true or false paths.",
      inputs: [createPort("condition", "Condition", "input", "data", "boolean", "Branch condition.", "boolean", false)],
      outputs: [],
      controlInputs: [createPort("exec", "Exec", "input", "control", "exec", "Execution input.", "none")],
      controlOutputs: [
        createPort("true", "True", "output", "control", "exec", "True execution path.", "none"),
        createPort("false", "False", "output", "control", "exec", "False execution path.", "none")
      ],
      bodyKind: "typescriptBuiltin",
      bodyRef: "control.branch"
    },
    {
      id: "builtin.control.forRange",
      name: "For Range",
      creationPath: "Control/Loop",
      description: "Runs the loop body for a numeric range.",
      inputs: [
        createPort("start", "Start", "input", "data", "number", "First index.", "number", 0),
        createPort("end", "End", "input", "data", "number", "Last index, exclusive.", "number", 10)
      ],
      outputs: [createPort("index", "Index", "output", "data", "number", "Current loop index.", "none")],
      controlInputs: [createPort("exec", "Exec", "input", "control", "exec", "Execution input.", "none")],
      controlOutputs: [
        createPort("loop", "Loop", "output", "control", "exec", "Loop body execution.", "none"),
        createPort("completed", "Completed", "output", "control", "exec", "After loop execution.", "none")
      ],
      bodyKind: "typescriptBuiltin",
      bodyRef: "control.forRange"
    },
    {
      id: "builtin.routing.controlHub",
      name: "Routing Hub",
      creationPath: "Routing",
      description: "A compact execution reroute node used to keep wires readable.",
      inputs: [],
      outputs: [],
      controlInputs: [createPort("exec", "Exec", "input", "control", "exec", "Execution input.", "none")],
      controlOutputs: [createPort("then", "Then", "output", "control", "exec", "Next execution step.", "none")],
      bodyKind: "typescriptBuiltin",
      bodyRef: "routing.controlHub",
      metadata: { routingHub: true }
    },
    {
      id: "builtin.routing.dataHub",
      name: "Data Hub",
      creationPath: "Routing",
      description: "A compact data reroute node used to keep wires readable.",
      inputs: [createPort("value", "Value", "input", "data", "unknown", "Rerouted value.", "json", "")],
      outputs: [createPort("out", "Value", "output", "data", "unknown", "Rerouted value.", "none")],
      controlInputs: [],
      controlOutputs: [],
      bodyKind: "typescriptBuiltin",
      bodyRef: "routing.dataHub",
      metadata: { routingHub: true }
    },
    {
      id: "builtin.blackboard.get",
      name: "Get Blackboard Value",
      creationPath: "Blackboard",
      description: "Reads a named global blackboard value.",
      inputs: [createPort("key", "Key", "input", "data", "string", "Blackboard variable id.", "text", "")],
      outputs: [createPort("value", "Value", "output", "data", "unknown", "Stored value.", "none")],
      controlInputs: [],
      controlOutputs: [],
      bodyKind: "typescriptBuiltin",
      bodyRef: "blackboard.get"
    },
    {
      id: "builtin.blackboard.set",
      name: "Set Blackboard Value",
      creationPath: "Blackboard",
      description: "Writes a named global blackboard value.",
      inputs: [
        createPort("key", "Key", "input", "data", "string", "Blackboard variable id.", "text", ""),
        createPort("value", "Value", "input", "data", "unknown", "Value to store.", "json", "")
      ],
      outputs: [],
      controlInputs: [createPort("exec", "Exec", "input", "control", "exec", "Execution input.", "none")],
      controlOutputs: [createPort("then", "Then", "output", "control", "exec", "Next execution step.", "none")],
      bodyKind: "typescriptBuiltin",
      bodyRef: "blackboard.set"
    },
    {
      id: "builtin.debug.log",
      name: "Log",
      creationPath: "Debug",
      description: "Writes a value to the runtime console.",
      inputs: [createPort("message", "Message", "input", "data", "string", "Message to log.", "text", "Hello Blueprint")],
      outputs: [],
      controlInputs: [createPort("exec", "Exec", "input", "control", "exec", "Execution input.", "none")],
      controlOutputs: [createPort("then", "Then", "output", "control", "exec", "Next execution step.", "none")],
      bodyKind: "typescriptBuiltin",
      bodyRef: "console.log"
    },
    {
      id: "builtin.math.add",
      name: "Add",
      creationPath: "Math/Number",
      description: "Adds two numbers.",
      inputs: [
        createPort("a", "A", "input", "data", "number", "First value.", "number", 0),
        createPort("b", "B", "input", "data", "number", "Second value.", "number", 0)
      ],
      outputs: [createPort("result", "Result", "output", "data", "number", "A plus B.", "none")],
      controlInputs: [],
      controlOutputs: [],
      bodyKind: "typescriptBuiltin",
      bodyRef: "math.add"
    },
    {
      id: "builtin.math.clamp",
      name: "Clamp",
      creationPath: "Math/Number",
      description: "Clamps a number between minimum and maximum values.",
      inputs: [
        createPort("value", "Value", "input", "data", "number", "Input value.", "number", 0),
        createPort("min", "Min", "input", "data", "number", "Minimum value.", "number", 0),
        createPort("max", "Max", "input", "data", "number", "Maximum value.", "number", 1)
      ],
      outputs: [createPort("result", "Result", "output", "data", "number", "Clamped result.", "none")],
      controlInputs: [],
      controlOutputs: [],
      bodyKind: "typescriptBuiltin",
      bodyRef: "Math.min(Math.max(value, min), max)"
    },
    {
      id: "builtin.string.concat",
      name: "Concat",
      creationPath: "String",
      description: "Concatenates two strings.",
      inputs: [
        createPort("a", "A", "input", "data", "string", "First string.", "text", ""),
        createPort("b", "B", "input", "data", "string", "Second string.", "text", "")
      ],
      outputs: [createPort("result", "Result", "output", "data", "string", "Combined string.", "none")],
      controlInputs: [],
      controlOutputs: [],
      bodyKind: "typescriptBuiltin",
      bodyRef: "string.concat"
    },
    {
      id: "builtin.json.stringify",
      name: "JSON Stringify",
      creationPath: "JSON",
      description: "Converts a value to a JSON string.",
      inputs: [createPort("value", "Value", "input", "data", "json", "Value to stringify.", "json", "{}")],
      outputs: [createPort("result", "Result", "output", "data", "string", "JSON string.", "none")],
      controlInputs: [],
      controlOutputs: [],
      bodyKind: "typescriptBuiltin",
      bodyRef: "JSON.stringify"
    }
  ];
}
