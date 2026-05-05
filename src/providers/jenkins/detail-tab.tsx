import type { Renderable } from "@opentui/core";
import { createEffect, createMemo, createSignal, For } from "solid-js";
import type { DetailNavRef } from "../../components/detail-types";
import { useT } from "../../hooks/use-t";
import { formatDuration, formatRelativeDate } from "../../utils/date";
import { categorize, statusColor } from "../github-actions/status";
import type { JenkinsCommitData, JenkinsJob, JenkinsJobFetchResult, JenkinsRun } from "./types";

type FlatItem =
  | { kind: "run"; run: JenkinsRun; flatIndex: number }
  | { kind: "job"; job: JenkinsJob; run: JenkinsRun; flatIndex: number };

export interface JenkinsDetailTabProps {
  sha: string;
  getCommitData: (sha: string) => JenkinsCommitData | null;
  fetchJobsForRun: (run: JenkinsRun) => Promise<JenkinsJobFetchResult>;
  fetchCommitData?: (sha: string) => Promise<void>;
  unavailableReason?: string | null;
  loading?: boolean;
  navRef?: DetailNavRef;
  detailCursorIndex: () => number;
  detailFocused: () => boolean;
  setDetailCursorAction: (action: string | null) => void;
  setDetailCursorIndex: (idx: number) => void;
}

export function JenkinsDetailTab(props: Readonly<JenkinsDetailTabProps>) {
  const t = useT();
  const data = () => props.getCommitData(props.sha);
  const [requestedSha, setRequestedSha] = createSignal<string | null>(null);
  const [expandedRuns, setExpandedRuns] = createSignal<Set<string>>(new Set());
  const [fetchedJobs, setFetchedJobs] = createSignal<Map<string, JenkinsJob[]>>(new Map());
  const [jobErrors, setJobErrors] = createSignal<Map<string, string>>(new Map());
  const [loadingRuns, setLoadingRuns] = createSignal<Set<string>>(new Set());
  const itemRefs: Renderable[] = [];

  createEffect(() => {
    const sha = props.sha;
    if (props.loading || data() || requestedSha() === sha) return;
    setRequestedSha(sha);
    void props.fetchCommitData?.(sha);
  });

  if (props.unavailableReason) {
    return (
      <box flexDirection="column" flexGrow={1} paddingX={2} paddingTop={2}>
        <text fg={t().foregroundMuted} wrapMode="word">
          Jenkins provider unavailable.
        </text>
        <box height={1} />
        <text fg={t().accent} wrapMode="word">
          {props.unavailableReason}
        </text>
        <box height={1} />
        <text fg={t().foregroundMuted} wrapMode="word">
          Configure jobs and token env in Menu → Providers.
        </text>
      </box>
    );
  }

  const statusMark = (status: string, conclusion: string | null) => {
    const cat = categorize(
      status,
      conclusion === "success" ? "success" : conclusion === "failure" ? "failure" : conclusion,
    );
    switch (cat) {
      case "pass":
        return "✓";
      case "fail":
        return "✕";
      case "running":
        return "●";
      case "cancelled":
        return "○";
      default:
        return "?";
    }
  };

  const flatItems = createMemo((): FlatItem[] => {
    const runs = data()?.runs ?? [];
    const expanded = expandedRuns();
    const jobs = fetchedJobs();
    const items: FlatItem[] = [];
    let idx = 0;
    for (const run of runs) {
      items.push({ kind: "run", run, flatIndex: idx++ });
      if (expanded.has(run.id))
        for (const job of jobs.get(run.id) ?? []) items.push({ kind: "job", job, run, flatIndex: idx++ });
    }
    return items;
  });

  const toggleRun = (run: JenkinsRun) => {
    const opening = !expandedRuns().has(run.id);
    setExpandedRuns(prev => {
      const next = new Set(prev);
      if (opening) next.add(run.id);
      else next.delete(run.id);
      return next;
    });
    if (opening && !fetchedJobs().has(run.id) && !loadingRuns().has(run.id)) {
      setLoadingRuns(prev => new Set([...prev, run.id]));
      props.fetchJobsForRun(run).then(({ jobs, error }) => {
        setFetchedJobs(prev => new Map(prev).set(run.id, jobs));
        setJobErrors(prev => {
          const next = new Map(prev);
          if (error) next.set(run.id, error);
          else next.delete(run.id);
          return next;
        });
        setLoadingRuns(prev => {
          const next = new Set(prev);
          next.delete(run.id);
          return next;
        });
      });
    }
  };

  createEffect(() => {
    const items = flatItems();
    if (!props.navRef) return;
    props.navRef.itemCount = items.length;
    props.navRef.itemRefs = itemRefs;
    props.navRef.activateCurrentItem = () => {
      const item = items[props.detailCursorIndex()];
      if (!item) return false;
      if (item.kind === "run") {
        toggleRun(item.run);
        return true;
      }
      return false;
    };
    const current = items[props.detailCursorIndex()];
    props.setDetailCursorAction(current?.kind === "run" ? "expand" : null);
  });

  const runs = () => data()?.runs ?? [];
  if (props.loading && !data()) return <text fg={t().foregroundMuted}>Loading Jenkins runs…</text>;
  if (runs().length === 0) return <text fg={t().foregroundMuted}>......</text>;

  return (
    <box flexDirection="column" paddingTop={1}>
      <For each={flatItems()}>
        {item => {
          const selected = () => props.detailFocused() && props.detailCursorIndex() === item.flatIndex;
          if (item.kind === "run") {
            const cat = () =>
              categorize(item.run.status, item.run.conclusion === "success" ? "success" : item.run.conclusion);
            return (
              <box
                ref={el => (itemRefs[item.flatIndex] = el)}
                flexDirection="row"
                paddingX={1}
                backgroundColor={selected() ? t().backgroundElementActive : undefined}
              >
                <text width={2} fg={statusColor(t(), cat())}>
                  {statusMark(item.run.status, item.run.conclusion)}
                </text>
                <text
                  flexGrow={1}
                  wrapMode="none"
                  truncate
                  fg={selected() ? t().accent : t().foreground}
                >{`${item.run.name} #${item.run.runNumber}`}</text>
                <text fg={t().foregroundMuted} wrapMode="none">
                  {formatRelativeDate(item.run.updatedAt)}
                </text>
              </box>
            );
          }
          return (
            <box
              ref={el => (itemRefs[item.flatIndex] = el)}
              flexDirection="row"
              paddingLeft={3}
              paddingRight={1}
              backgroundColor={selected() ? t().backgroundElementActive : undefined}
            >
              <text flexGrow={1} wrapMode="none" truncate>
                {item.job.name}
              </text>
              <text fg={t().foregroundMuted}>{formatDuration(item.job.startedAt, item.job.completedAt)}</text>
            </box>
          );
        }}
      </For>
      <For each={Array.from(jobErrors().entries())}>{([, error]) => <text fg={t().error}>{error}</text>}</For>
    </box>
  );
}
