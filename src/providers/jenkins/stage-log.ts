const PIPELINE_OPEN = /^\[Pipeline\] \{/;
const PIPELINE_CLOSE = /^\[Pipeline\] \}/;

/**
 * One stage's part of a Pipeline console log: from its `[Pipeline] { (Name)` line to the `[Pipeline] }` that closes
 * it, nested blocks included (a running stage: up to the end). Null when the log has no such stage, so the caller can
 * show the whole log instead.
 */
export function sliceStageLog(consoleLog: string, stageName: string): string | null {
  const lines = consoleLog.split("\n");
  const start = lines.findIndex(line => line.trimEnd() === `[Pipeline] { (${stageName})`);
  if (start < 0) return null;
  let depth = 0;
  for (let index = start; index < lines.length; index++) {
    const line = lines[index] ?? "";
    if (PIPELINE_OPEN.test(line)) depth++;
    else if (PIPELINE_CLOSE.test(line)) depth--;
    if (depth === 0) return lines.slice(start, index + 1).join("\n");
  }
  return lines.slice(start).join("\n").trimEnd();
}
