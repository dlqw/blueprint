export class BlueprintBlackboard {
  private readonly values = new Map<string, unknown>();

  get(key: string): unknown {
    return this.values.get(key);
  }

  set(key: string, value: unknown): void {
    this.values.set(key, value);
  }
}

export function createDefaultBlackboard(): BlueprintBlackboard {
  const blackboard = new BlueprintBlackboard();
  blackboard.set("score", 0);
  return blackboard;
}

const tracePrefix = "__BLUEPRINT_TRACE__";
let activeTraceNode: { graphId: string; nodeId: string; nodeName: string } | undefined;
const breakpointHits = new Map<string, number>();
type TraceContext = Record<string, unknown>;
let pendingStepResolvers: Array<() => void> = [];
let stdinStarted = false;
let continueRuntime = false;

interface TraceBreakpoint {
  nodeId: string;
  enabled?: boolean;
  condition?: string;
}

export async function traceBlueprintNode(graphId: string, nodeId: string, nodeName: string, context: TraceContext = {}): Promise<void> {
  if (process.env.BLUEPRINT_TRACE !== "1") {
    return;
  }
  activeTraceNode = { graphId, nodeId, nodeName };
  console.error(`${tracePrefix}${JSON.stringify({ graphId, nodeId, nodeName, status: "visited", context, timestamp: Date.now() })}`);
  await waitForRuntimeStep(graphId, nodeId, nodeName, context);
  const breakpoint = traceBlueprintBreakpoint(graphId, nodeId, nodeName, context);
  if (breakpoint) {
    activeTraceNode = undefined;
    const conditionSuffix = breakpoint.condition ? ` (${breakpoint.condition})` : "";
    const message = `Breakpoint hit at ${nodeName}${conditionSuffix}`;
    console.error(`${tracePrefix}${JSON.stringify({ graphId, nodeId, nodeName, status: "breakpoint", message, context, timestamp: Date.now() })}`);
    throw new Error(message);
  }
}

export async function traceBlueprintSkipped(graphId: string, nodeId: string, nodeName: string): Promise<void> {
  if (process.env.BLUEPRINT_TRACE !== "1") {
    return;
  }
  console.error(`${tracePrefix}${JSON.stringify({ graphId, nodeId, nodeName, status: "skipped", timestamp: Date.now() })}`);
  await waitForRuntimeStep(graphId, nodeId, nodeName);
}

async function waitForRuntimeStep(graphId: string, nodeId: string, nodeName: string, context: TraceContext = {}): Promise<void> {
  if (process.env.BLUEPRINT_STEP !== "1") {
    return;
  }
  startStepInput();
  if (continueRuntime) {
    return;
  }
  process.stdin.ref?.();
  process.stdin.resume();
  console.error(`${tracePrefix}${JSON.stringify({ graphId, nodeId, nodeName, status: "paused", context, timestamp: Date.now() })}`);
  await new Promise<void>((resolve) => pendingStepResolvers.push(resolve));
  process.stdin.pause();
  process.stdin.unref?.();
}

function startStepInput(): void {
  if (stdinStarted) {
    return;
  }
  stdinStarted = true;
  process.stdin.setEncoding("utf8");
  process.stdin.resume();
  let commandRemainder = "";
  process.stdin.on("data", (chunk) => {
    commandRemainder = `${commandRemainder}${String(chunk)}`;
    const commands = commandRemainder.split(/\r?\n/);
    commandRemainder = commands.pop() ?? "";
    for (const rawCommand of commands) {
      const command = rawCommand.trim().toLowerCase();
      if (command === "continue" || command === "resume") {
        continueRuntime = true;
        while (pendingStepResolvers.length) {
          pendingStepResolvers.shift()?.();
        }
        process.stdin.pause();
        process.stdin.unref?.();
        process.stdin.removeAllListeners("data");
        return;
      }
      if (command === "step") {
        pendingStepResolvers.shift()?.();
        if (!pendingStepResolvers.length) {
          process.stdin.pause();
          process.stdin.unref?.();
        }
      }
    }
  });
}

function traceBlueprintBreakpoint(graphId: string, nodeId: string, nodeName: string, context: TraceContext): TraceBreakpoint | undefined {
  if (!process.env.BLUEPRINT_BREAKPOINTS) {
    return undefined;
  }
  try {
    const breakpoints = JSON.parse(process.env.BLUEPRINT_BREAKPOINTS) as unknown;
    if (!Array.isArray(breakpoints)) {
      return undefined;
    }
    const hitCount = (breakpointHits.get(nodeId) ?? 0) + 1;
    breakpointHits.set(nodeId, hitCount);
    for (const candidate of breakpoints) {
      const breakpoint = normalizeTraceBreakpoint(candidate);
      if (!breakpoint || breakpoint.nodeId !== nodeId || breakpoint.enabled === false) {
        continue;
      }
      if (matchesTraceBreakpointCondition(breakpoint.condition, hitCount, graphId, nodeId, nodeName, context)) {
        return breakpoint;
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function normalizeTraceBreakpoint(value: unknown): TraceBreakpoint | undefined {
  if (typeof value === "string") {
    return value ? { nodeId: value } : undefined;
  }
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.nodeId !== "string" || !record.nodeId) {
    return undefined;
  }
  return {
    nodeId: record.nodeId,
    enabled: typeof record.enabled === "boolean" ? record.enabled : undefined,
    condition: typeof record.condition === "string" ? record.condition.trim() || undefined : undefined
  };
}

function matchesTraceBreakpointCondition(condition: string | undefined, hitCount: number, graphId: string, nodeId: string, nodeName: string, context: TraceContext): boolean {
  const normalized = condition?.trim();
  if (!normalized) {
    return true;
  }
  if (normalized === nodeId || normalized === nodeName || normalized === graphId) {
    return true;
  }
  const comparison = /^(?:hit|hits)?\s*(>=|<=|==|=|>|<)\s*(\d+)$/.exec(normalized);
  if (comparison) {
    return compareBreakpointHitCount(hitCount, comparison[1], Number(comparison[2]));
  }
  const every = /^every\s+(\d+)$/.exec(normalized);
  if (every) {
    const interval = Number(every[1]);
    return interval > 0 && hitCount % interval === 0;
  }
  return matchesTraceContextCondition(normalized, context);
}

function compareBreakpointHitCount(hitCount: number, operator: string, expected: number): boolean {
  switch (operator) {
    case ">":
      return hitCount > expected;
    case ">=":
      return hitCount >= expected;
    case "<":
      return hitCount < expected;
    case "<=":
      return hitCount <= expected;
    case "=":
    case "==":
      return hitCount === expected;
    default:
      return false;
  }
}

function matchesTraceContextCondition(condition: string, context: TraceContext): boolean {
  const method = /^([A-Za-z_$][\w$.-]*)\.(includes|contains|startsWith|endsWith)\((["'`])([\s\S]*)\3\)$/.exec(condition);
  if (method) {
    const value = readTraceContextValue(context, method[1]);
    const expected = method[4];
    if (typeof value === "string") {
      if (method[2] === "contains" || method[2] === "includes") {
        return value.includes(expected);
      }
      if (method[2] === "startsWith") {
        return value.startsWith(expected);
      }
      if (method[2] === "endsWith") {
        return value.endsWith(expected);
      }
    }
    if (Array.isArray(value) && (method[2] === "contains" || method[2] === "includes")) {
      return value.includes(expected);
    }
    return false;
  }

  const comparison = /^([A-Za-z_$][\w$.-]*)\s*(===|!==|==|!=|>=|<=|>|<)\s*(.+)$/.exec(condition);
  if (comparison) {
    const left = readTraceContextValue(context, comparison[1]);
    const right = parseTraceConditionLiteral(comparison[3]);
    return compareTraceValues(left, comparison[2], right);
  }

  const truthy = /^!?[A-Za-z_$][\w$.-]*$/.exec(condition);
  if (truthy) {
    const negate = condition.startsWith("!");
    const key = negate ? condition.slice(1) : condition;
    const value = Boolean(readTraceContextValue(context, key));
    return negate ? !value : value;
  }

  return false;
}

function readTraceContextValue(context: TraceContext, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => {
    if (value && typeof value === "object" && key in value) {
      return (value as Record<string, unknown>)[key];
    }
    return undefined;
  }, context);
}

function parseTraceConditionLiteral(raw: string): unknown {
  const value = raw.trim();
  const quoted = /^(["'`])([\s\S]*)\1$/.exec(value);
  if (quoted) {
    return quoted[2];
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  if (value === "null") {
    return null;
  }
  if (/^-?\d+(?:\.\d+)?$/.test(value)) {
    return Number(value);
  }
  return value;
}

function compareTraceValues(left: unknown, operator: string, right: unknown): boolean {
  switch (operator) {
    case "===":
    case "==":
      return Object.is(left, right);
    case "!==":
    case "!=":
      return !Object.is(left, right);
    case ">":
      return typeof left === "number" && typeof right === "number" && left > right;
    case ">=":
      return typeof left === "number" && typeof right === "number" && left >= right;
    case "<":
      return typeof left === "number" && typeof right === "number" && left < right;
    case "<=":
      return typeof left === "number" && typeof right === "number" && left <= right;
    default:
      return false;
  }
}

export function traceBlueprintError(error: unknown): void {
  if (process.env.BLUEPRINT_TRACE !== "1" || !activeTraceNode) {
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  console.error(`${tracePrefix}${JSON.stringify({ ...activeTraceNode, status: "error", message, timestamp: Date.now() })}`);
}
