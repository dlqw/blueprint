import { BlueprintBlackboard, createDefaultBlackboard, traceBlueprintError, traceBlueprintNode, traceBlueprintNodeComplete, traceBlueprintSkipped } from "./runtime";
import { pathToFileURL } from "node:url";
import { GameplayMathNodes as Double_0 } from "../src/mathNodes";
import { GameplayMathNodes as Format_Score_1 } from "../src/mathNodes";
import { FormatScoreBlueprint as FormatScoreBlueprint_0 } from "./FormatScoreBlueprint";
import { Announce as Announce_1 } from "./Announce";

export async function Main(blackboard: BlueprintBlackboard = createDefaultBlackboard()): Promise<void> {
  // Node entry: Function Entry
  await traceBlueprintNode("main", "entry", "Function Entry");
  traceBlueprintNodeComplete("main", "entry", "Function Entry");
  // Node traceMacro1: Trace Macro
  await traceBlueprintNode("main", "traceMacro1", "Trace Macro");
  // Macro traceMacro1: Trace Macro
  // Node entry: Function Entry
  await traceBlueprintNode("trace-macro", "entry", "Function Entry");
  traceBlueprintNodeComplete("trace-macro", "entry", "Function Entry");
  // Node log1: Log
  await traceBlueprintNode("trace-macro", "log1", "Log", { "message": "Trace macro expanded" });
  console.log("Trace macro expanded");
  traceBlueprintNodeComplete("trace-macro", "log1", "Log");
  // Node end: Function End
  await traceBlueprintNode("trace-macro", "end", "Function End");
  traceBlueprintNodeComplete("trace-macro", "end", "Function End");
  traceBlueprintNodeComplete("main", "traceMacro1", "Trace Macro");
  // Node setScore1: Set Blackboard Value
  await traceBlueprintNode("main", "setScore1", "Set Blackboard Value", { "key": "score" });
  blackboard.set("score", Double_0.double(21));
  traceBlueprintNodeComplete("main", "setScore1", "Set Blackboard Value");
  // Node log1: Log
  await traceBlueprintNode("main", "log1", "Log");
  console.log(String((await FormatScoreBlueprint_0(blackboard, Number(blackboard.get("score"))))));
  traceBlueprintNodeComplete("main", "log1", "Log");
  // Node announce1: Announce
  await traceBlueprintNode("main", "announce1", "Announce");
  await Announce_1(blackboard);
  traceBlueprintNodeComplete("main", "announce1", "Announce");
  // Node end: Function End
  await traceBlueprintNode("main", "end", "Function End");
  traceBlueprintNodeComplete("main", "end", "Function End");
  return;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  Main().catch((error) => {
    traceBlueprintError(error);
    console.error(error);
    process.exitCode = 1;
  });
}
