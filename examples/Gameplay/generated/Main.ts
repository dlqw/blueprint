import { BlueprintBlackboard, createDefaultBlackboard, traceBlueprintError, traceBlueprintNode, traceBlueprintSkipped } from "./runtime";
import { pathToFileURL } from "node:url";
import { GameplayMathNodes as Double_0 } from "../src/mathNodes";
import { GameplayMathNodes as Format_Score_1 } from "../src/mathNodes";
import { FormatScoreBlueprint as FormatScoreBlueprint_0 } from "./FormatScoreBlueprint";
import { Announce as Announce_1 } from "./Announce";

export async function Main(blackboard: BlueprintBlackboard = createDefaultBlackboard()): Promise<void> {
  // Node entry: Function Entry
  await traceBlueprintNode("main", "entry", "Function Entry");
  // Node traceMacro1: Trace Macro
  await traceBlueprintNode("main", "traceMacro1", "Trace Macro");
  // Macro traceMacro1: Trace Macro
  // Node entry: Function Entry
  await traceBlueprintNode("trace-macro", "entry", "Function Entry");
  // Node log1: Log
  await traceBlueprintNode("trace-macro", "log1", "Log", { "message": "Trace macro expanded" });
  console.log("Trace macro expanded");
  // Node end: Function End
  await traceBlueprintNode("trace-macro", "end", "Function End");
  // Node setScore1: Set Blackboard Value
  await traceBlueprintNode("main", "setScore1", "Set Blackboard Value", { "key": "score", "value": Double_0.double(21) });
  blackboard.set("score", Double_0.double(21));
  // Node log1: Log
  await traceBlueprintNode("main", "log1", "Log", { "message": String((await FormatScoreBlueprint_0(blackboard, Number(blackboard.get("score"))))) });
  console.log(String((await FormatScoreBlueprint_0(blackboard, Number(blackboard.get("score"))))));
  // Node announce1: Announce
  await traceBlueprintNode("main", "announce1", "Announce");
  await Announce_1(blackboard);
  // Node end: Function End
  await traceBlueprintNode("main", "end", "Function End");
  return;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  Main().catch((error) => {
    traceBlueprintError(error);
    console.error(error);
    process.exitCode = 1;
  });
}
