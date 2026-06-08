function BlueprintNode(_metadata: {
  name: string;
  path: string;
  description: string;
}): MethodDecorator {
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

  @BlueprintNode({
    name: "Format Score",
    path: "TypeScript/String",
    description: "Formats a numeric score for display."
  })
  static formatScore(score: number): string {
    return `Score: ${score}`;
  }
}
