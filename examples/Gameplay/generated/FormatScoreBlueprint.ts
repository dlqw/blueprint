import { BlueprintBlackboard, createDefaultBlackboard, traceBlueprintError, traceBlueprintNode, traceBlueprintNodeComplete, traceBlueprintSkipped } from "./runtime";
import { pathToFileURL } from "node:url";
import { GameplayMathNodes as Double_0 } from "../src/mathNodes";
import { GameplayMathNodes as Format_Score_1 } from "../src/mathNodes";

export async function FormatScoreBlueprint(blackboard: BlueprintBlackboard = createDefaultBlackboard(), score: number = 0): Promise<string> {
  // Node entry: Function Entry
  await traceBlueprintNode("format-score", "entry", "Function Entry");
  traceBlueprintNodeComplete("format-score", "entry", "Function Entry");
  // Node end: Function End
  await traceBlueprintNode("format-score", "end", "Function End");
  traceBlueprintNodeComplete("format-score", "end", "Function End");
  return String(Format_Score_1.formatScore(Number(score)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  FormatScoreBlueprint().catch((error) => {
    traceBlueprintError(error);
    console.error(error);
    process.exitCode = 1;
  });
}
