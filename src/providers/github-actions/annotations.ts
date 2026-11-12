import type { ProviderTreeNote } from "../shared/provider-run-tree";
import type { GitHubAnnotation } from "./types";

/** The first line of an annotation's message: the rest is usually a stack. */
export function annotationMessage(annotation: GitHubAnnotation): string {
  return annotation.message.split("\n")[0]?.trim() ?? "";
}

/**
 * A failed job's annotations as rows under it: failures and warnings (notices say nothing about the failure), with
 * their file and line. Workflow-level ones (`.github`) name no file.
 */
export function annotationNotes(annotations: readonly GitHubAnnotation[]): ProviderTreeNote[] {
  return annotations.flatMap((annotation, index): ProviderTreeNote[] => {
    if (annotation.level === "notice") return [];
    const place =
      annotation.path && annotation.path !== ".github"
        ? `${annotation.path}${annotation.line ? `:${annotation.line}` : ""}  `
        : "";
    return [
      {
        id: String(index),
        mark: annotation.level === "failure" ? "fail" : "warning",
        text: `${place}${annotationMessage(annotation)}`,
        search: annotationMessage(annotation),
      },
    ];
  });
}
