const PIPELINE_OPEN = /^\[Pipeline\] \{/;
const PIPELINE_CLOSE = /^\[Pipeline\] \}/;

/** A stage's part of the console, or why there is none: a stage in a parallel branch, or one the log does not have. */
export type StageLog = { log: string; missing?: undefined } | { log?: undefined; missing: "parallel" | "absent" };

const PIPELINE_BRANCH = /^\[Pipeline\] \{ \(Branch: /;

/**
 * One stage's part of a Pipeline console log: from its `[Pipeline] { (Name)` line to the `[Pipeline] }` that closes
 * it, nested blocks included (a running stage: up to the end). A stage inside a parallel branch has none: the
 * branches write to the console at the same time, so its block holds the other branches' lines too.
 */
export function sliceStageLog(consoleLog: string, stageName: string): StageLog {
  const lines = consoleLog.split("\n");
  const start = lines.findIndex(line => line.trimEnd() === `[Pipeline] { (${stageName})`);
  if (start < 0) return { missing: "absent" };
  // The blocks open where the stage starts; closes are counted from the innermost, which is enough to know whether
  // a parallel branch is still open.
  const open: boolean[] = [];
  for (const line of lines.slice(0, start)) {
    if (PIPELINE_OPEN.test(line)) open.push(PIPELINE_BRANCH.test(line));
    else if (PIPELINE_CLOSE.test(line)) open.pop();
  }
  if (open.includes(true)) return { missing: "parallel" };
  let depth = 0;
  for (let index = start; index < lines.length; index++) {
    const line = lines[index] ?? "";
    if (PIPELINE_OPEN.test(line)) depth++;
    else if (PIPELINE_CLOSE.test(line)) depth--;
    if (depth === 0) return { log: lines.slice(start, index + 1).join("\n") };
  }
  return { log: lines.slice(start).join("\n").trimEnd() };
}
