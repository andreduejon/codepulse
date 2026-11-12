/**
 * Busy text: one vocabulary for the whole app. `fetching` is network work (Git remote, GitHub, Jenkins, OpenShift),
 * `reading` is local Git, `scanning` is Snyk. Standalone text ends in `...`; text next to a spinner has none
 * (`Git fetching`, `reading blame`). Truncation uses `…`, never `...`.
 */
export const BUSY = {
  fetchingRuns: "fetching runs...",
  fetchingBuilds: "fetching builds...",
  fetchingResources: "fetching resources...",
  fetchingJobs: "fetching jobs...",
  fetchingStages: "fetching stages...",
  fetchingLog: "fetching log...",
  fetchingObject: "fetching object...",
  fetchingEvents: "fetching events...",
  readingFiles: "reading files...",
  readingDiff: "reading diff...",
  readingFile: "reading file...",
  /** Shown next to the diff dialog's spinner, so no ellipsis. */
  readingBlame: "reading blame",
  scanning: "scanning...",
} as const;
