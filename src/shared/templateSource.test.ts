import { describe, expect, it } from "vitest";
import { extractBlueprintTemplatesFromTypeScript } from "./templateSource";

describe("template source extraction", () => {
  it("extracts static BlueprintNode methods into TypeScript function templates", () => {
    const templates = extractBlueprintTemplatesFromTypeScript(`
      function BlueprintNode(_metadata: { name: string; path: string; description: string }): MethodDecorator {
        return () => undefined;
      }

      export class GameplayMathNodes {
        @BlueprintNode({
          name: "Double",
          path: "TypeScript/Math",
          description: "Multiplies a number by two."
        })
        static double(value: number): number {
          return value * 2;
        }
      }
    `, "examples/Gameplay/src/mathNodes.ts");

    expect(templates).toEqual([expect.objectContaining({
      id: "ts.TypeScript.Math.Double",
      name: "Double",
      creationPath: "TypeScript/Math",
      description: "Multiplies a number by two.",
      bodyKind: "typescriptFunction",
      bodyRef: "examples/Gameplay/src/mathNodes.ts#GameplayMathNodes.double",
      metadata: {
        source: "examples/Gameplay/src/mathNodes.ts",
        exportName: "GameplayMathNodes",
        memberName: "double"
      },
      inputs: [expect.objectContaining({ id: "value", type: "number", editor: "number", defaultValue: 0 })],
      outputs: [expect.objectContaining({ id: "result", type: "number", editor: "none" })]
    })]);
  });
});
