import { Show, For } from "solid-js";
import { useAppState } from "../context/state";
import { useTheme } from "../context/theme";
import type { FileChange } from "../git/types";

function FileLine(props: { file: FileChange }) {
  const { theme } = useTheme();
  const t = () => theme();

  return (
    <box flexDirection="row" width="100%" paddingLeft={2}>
      <text fg={t().foreground} flexGrow={1} wrapMode="none" truncate>
        {props.file.path}
      </text>
      <text flexShrink={0} paddingRight={1} wrapMode="none">
        <Show when={props.file.additions > 0}>
          <span fg={t().diffAdded}>+{props.file.additions}</span>
        </Show>
        <Show when={props.file.additions > 0 && props.file.deletions > 0}>
          <span fg={t().foregroundMuted}> </span>
        </Show>
        <Show when={props.file.deletions > 0}>
          <span fg={t().diffRemoved}>-{props.file.deletions}</span>
        </Show>
      </text>
    </box>
  );
}

export default function CommitDetailView() {
  const { state } = useAppState();
  const { theme } = useTheme();
  const t = () => theme();

  const commit = () => state.selectedCommit();
  const detail = () => state.commitDetail();

  // Split refs into branches (branch/remote/head) and tags
  const branchRefs = () => {
    const c = commit();
    if (!c) return [];
    return c.refs.filter((r) => r.type !== "tag");
  };

  const tagRefs = () => {
    const c = commit();
    if (!c) return [];
    return c.refs.filter((r) => r.type === "tag");
  };

  // Ref color: current branch = success, others = primary
  const refColor = (ref: { type: string; isCurrent: boolean }) => {
    return ref.isCurrent ? t().success : t().primary;
  };

  return (
    <box flexDirection="column" flexGrow={1}>
      <Show
        when={commit()}
        fallback={
          <box flexGrow={1} alignItems="center" justifyContent="center">
            <text fg={t().foregroundMuted}>No commit selected</text>
          </box>
        }
      >
        {(c) => (
          <>
            {/* ── Branch sub-header ── */}
            <Show when={branchRefs().length > 0}>
              <text wrapMode="none">
                <strong><span fg={t().accent}>Branch</span></strong>
              </text>
              <text wrapMode="word" paddingLeft={2} fg={t().primary}>
                {branchRefs().map((r, i) =>
                  (i > 0 ? ", " : "") + r.name
                ).join("")}
              </text>
              <box height={1} />
            </Show>

            {/* ── Commit info block ── */}
            <text wrapMode="none">
              <span fg={t().foregroundMuted}>Commit  </span>
              <span fg={t().primary}>{c().shortHash}</span>
            </text>

            <Show when={c().parents.length > 0}>
              <text wrapMode="none">
                <span fg={t().foregroundMuted}>
                  {c().parents.length > 1 ? "Parents " : "Parent  "}
                </span>
                <For each={c().parents}>
                  {(parent, i) => (
                    <>
                      <span fg={t().primary}>{parent.substring(0, 7)}</span>
                      <Show when={i() < c().parents.length - 1}>
                        <span fg={t().foregroundMuted}>{" "}</span>
                      </Show>
                    </>
                  )}
                </For>
              </text>
            </Show>

            <text wrapMode="none">
              <span fg={t().foregroundMuted}>Author  </span>
              <span fg={t().foreground}>{c().author}</span>
            </text>

            <text wrapMode="none">
              <span fg={t().foregroundMuted}>Email   </span>
              <span fg={t().foregroundMuted}>{c().authorEmail}</span>
            </text>

            <text wrapMode="none">
              <span fg={t().foregroundMuted}>Date    </span>
              <span fg={t().foreground}>{formatDate(c().authorDate)}</span>
            </text>

            <box height={1} />

            {/* ── Tags sub-header ── */}
            <Show when={tagRefs().length > 0}>
              <text wrapMode="none">
                <strong><span fg={t().accent}>Tags</span></strong>
              </text>
              <text wrapMode="word" paddingLeft={2} fg={t().warning}>
                {tagRefs().map((r, i) =>
                  (i > 0 ? ", " : "") + r.name
                ).join("")}
              </text>
              <box height={1} />
            </Show>

            {/* ── Subject ── */}
            <text fg={t().foreground} wrapMode="word">
              {c().subject}
            </text>

            {/* ── Body ── */}
            <Show when={detail()?.body}>
              <box height={1} />
              <text fg={t().foregroundMuted} wrapMode="word">
                {detail()!.body}
              </text>
            </Show>

            {/* ── Files changed ── */}
            <Show when={detail() && detail()!.files.length > 0}>
              <box height={1} />
              <box width="100%" border={["top"]} borderStyle="single" borderColor={t().border} />
              <text fg={t().foreground} wrapMode="none">
                <span fg={t().info}>
                  {detail()!.files.length} file{detail()!.files.length !== 1 ? "s" : ""} changed
                </span>
                {(() => {
                  const d = detail()!;
                  const totalAdded = d.files.reduce((sum, f) => sum + f.additions, 0);
                  const totalDeleted = d.files.reduce((sum, f) => sum + f.deletions, 0);
                  return (
                    <>
                      <Show when={totalAdded > 0}>
                        <span fg={t().diffAdded}> +{totalAdded}</span>
                      </Show>
                      <Show when={totalDeleted > 0}>
                        <span fg={t().diffRemoved}> -{totalDeleted}</span>
                      </Show>
                    </>
                  );
                })()}
              </text>
              <box height={1} />
              <For each={detail()!.files}>
                {(file) => <FileLine file={file} />}
              </For>
            </Show>

            {/* Loading indicator for detail */}
            <Show when={!detail() && commit()}>
              <box height={1} />
              <text fg={t().foregroundMuted}>Loading commit details...</text>
            </Show>
          </>
        )}
      </Show>
    </box>
  );
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleString("en-US", {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
