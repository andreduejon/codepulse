import { createMemo, For, Show } from "solid-js";
import type { KnownRepoInfo } from "../config";
import { useT } from "../hooks/use-t";
import { groupMembersForRepo, repoDisplayName } from "../utils/group-repos";

export default function GroupStrip(props: Readonly<{ repos: KnownRepoInfo[]; currentRepo: string }>) {
  const t = useT();
  const members = createMemo(() => groupMembersForRepo(props.repos, props.currentRepo));

  return (
    <Show when={members().length > 1}>
      <box flexDirection="row" width="100%" paddingX={2} flexShrink={0}>
        <For each={members()}>
          {repo => (
            <text wrapMode="none" truncate fg={repo.path === props.currentRepo ? t().accent : t().foregroundMuted}>
              {repo.path === props.currentRepo ? ` · ${repoDisplayName(repo)} · ` : ` ${repoDisplayName(repo)} `}
            </text>
          )}
        </For>
      </box>
    </Show>
  );
}
