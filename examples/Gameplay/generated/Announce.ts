import { BlueprintBlackboard, createDefaultBlackboard, traceBlueprintError, traceBlueprintNode, traceBlueprintSkipped } from "./runtime";
import { pathToFileURL } from "node:url";
import { GameplayMathNodes as Double_0 } from "../src/mathNodes";
import { GameplayMathNodes as Format_Score_1 } from "../src/mathNodes";

export async function Announce(blackboard: BlueprintBlackboard = createDefaultBlackboard()): Promise<void> {
  // Node entry: Function Entry
  await traceBlueprintNode("announce", "entry", "Function Entry");
  // Node log1: Log
  await traceBlueprintNode("announce", "log1", "Log", { "message": "Announce blueprint called" });
  console.log("Announce blueprint called");
  // Node end: Function End
  await traceBlueprintNode("announce", "end", "Function End");
  return;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  Announce().catch((error) => {
    traceBlueprintError(error);
    console.error(error);
    process.exitCode = 1;
  });
}
