import { createMemo, For, Show } from "solid-js";
import type { KnownRepoInfo } from "../config";
import { useT } from "../hooks/use-t";
import { groupMembersForRepo, repoDisplayName } from "../utils/group-repos";
import Badge from "./badge";

export default function GroupStrip(
  props: Readonly<{ repos: KnownRepoInfo[]; currentRepo: string; currentGroup?: string; currentAppName?: string }>,
) {
  const t = useT();
  const members = createMemo(() =>
    groupMembersForRepo(props.repos, props.currentRepo, { group: props.currentGroup, appName: props.currentAppName }),
  );

  return (
    <Show when={members().length > 1}>
      <box flexDirection="column" width="100%" flexShrink={0}>
        <box width="100%" border={["top"]} borderStyle="single" borderColor={t().border} />
        <box flexDirection="row" width="100%">
        <For each={members()}>
          {repo => (
            <Badge
              name={repoDisplayName(repo)}
              color={repo.path === props.currentRepo ? t().accent : undefined}
              dimmed={repo.path !== props.currentRepo}
              noShrink
            />
          )}
        </For>
        </box>
      </box>
    </Show>
  );
}
