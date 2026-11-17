/**
 * Every dialog of the main screen, each shown while the dialog host has it open: the Menu, help, themes, Debug, a
 * file's diff, the compact details (the graph's and the Dashboard's), a job's log and an OpenShift resource.
 */

import type { ScrollBoxRenderable } from "@opentui/core";
import type { Accessor } from "solid-js";
import { batch, Show } from "solid-js";
import type { AppContentProps } from "../app-types";
import type { DetailPanelProps } from "../components/detail-panel";
import type { DetailNavRef } from "../components/detail-types";
import { DashboardEventDialog } from "../components/dialogs/dashboard-event-dialog";
import DebugDialog from "../components/dialogs/debug-dialog";
import { DetailDialog } from "../components/dialogs/detail-dialog";
import DiffBlameDialog from "../components/dialogs/diff-blame-dialog";
import HelpDialog from "../components/dialogs/help-dialog";
import MenuDialog from "../components/dialogs/menu-dialog";
import ThemeDialog from "../components/dialogs/theme-dialog";
import type { UIMessage } from "../components/message-box";
import { writeConfig } from "../config-write";
import { useAppState } from "../context/state";
import { useT } from "../hooks/use-t";
import OpenShiftResourceDialog from "../providers/openshift/resource-dialog";
import JobLogDialog from "../providers/shared/job-log-dialog";
import type { SnykProviderConfig } from "../providers/snyk/use-snyk";
import type { DashboardController } from "./dashboard-controller";
import type { DialogHost } from "./dialogs";
import type { ProviderHost } from "./providers";
import type { RepoSettings } from "./repo-settings";

export function DialogLayer(
  props: Readonly<{
    dialogs: DialogHost;
    settings: RepoSettings;
    dashboard: DashboardController;
    openShift: ProviderHost["openShift"];
    repoPath: Accessor<string>;
    configInfo: AppContentProps["configInfo"];
    /** What the Menu's actions do. */
    menu: {
      onReload: () => void;
      onFetch: () => void;
      onPull: () => void;
      onOpenCache: () => void;
      onViewBranch: (branch: string | null) => void;
      onSwitchRepo: () => void;
    };
    /** The graph's details, for the compact details dialog. */
    details: {
      navRef: DetailNavRef;
      setScrollbox: (element: ScrollBoxRenderable) => void;
      searchFocused: Accessor<boolean>;
      onJumpToCommit: DetailPanelProps["onJumpToCommit"];
      providerProps: Pick<DetailPanelProps, "memory" | "providers" | "tabNotice" | "onDismissTabNotice">;
      message: Accessor<UIMessage | null>;
      onDismissMessage: () => void;
    };
  }>,
) {
  const { actions } = useAppState();
  const t = useT();
  const settings = props.settings;
  const dashboard = props.dashboard;
  const {
    dialog,
    setDialog,
    diffTarget,
    setDiffTarget,
    jobLogTarget,
    openShiftResourceTarget,
    openDiff: handleOpenDiff,
    openFromMenu: handleOpenDialog,
    closeToDetail,
    compactDetailUnderChild,
    setLogSearchScope,
  } = props.dialogs;
  return (
    <>
      {/* Dialogs */}
      <Show when={dialog() === "menu"}>
        <MenuDialog
          onClose={() => setDialog(null)}
          onReload={props.menu.onReload}
          onFetch={props.menu.onFetch}
          onPull={props.menu.onPull}
          onOpenDialog={handleOpenDialog}
          onOpenCache={props.menu.onOpenCache}
          onViewBranch={props.menu.onViewBranch}
          configInfo={props.configInfo}
          onSwitchRepo={props.menu.onSwitchRepo}
          githubConfig={settings.github()}
          onGithubConfigChange={settings.setGithub}
          jenkinsConfig={settings.jenkins()}
          onJenkinsConfigChange={settings.setJenkins}
          openshiftConfig={settings.openShift()}
          onOpenShiftConfigChange={settings.setOpenShift}
          {...{
            snykConfig: settings.snyk(),
            onSnykConfigChange: (config: SnykProviderConfig) => settings.setSnyk(config),
          }}
          dashboardConfig={settings.dashboard()}
          onDashboardConfigChange={settings.setDashboard}
          startView={settings.startView()}
          onStartViewChange={settings.setStartView}
          autoFastForward={settings.autoFastForward()}
          onAutoFastForwardChange={settings.setAutoFastForward}
          onRepoDisplayConfigChange={settings.setDisplay}
        />
      </Show>
      <Show when={dialog() === "help"}>
        <HelpDialog onClose={() => setDialog(null)} />
      </Show>
      <Show when={dialog() === "theme"}>
        <ThemeDialog
          onClose={() => setDialog(null)}
          onSelect={name => writeConfig({ theme: name }, props.repoPath())}
        />
      </Show>
      <Show when={dialog() === "debug"}>
        <DebugDialog onClose={() => setDialog(null)} gitColor={t().gitBg} />
      </Show>
      <Show when={dialog() === "diff-blame" && diffTarget()}>
        {target => (
          <DiffBlameDialog
            target={target()}
            onClose={closeToDetail}
            onNavigate={t => {
              setDiffTarget(t);
              props.details.navRef.scrollToFile(t.filePath);
            }}
          />
        )}
      </Show>
      {/* Detail dialog, compact mode only. Under a dialog opened from it, it stays mounted but hidden, so
          closing that dialog comes back to the details as they were (open runs, attempts, cursor). */}
      <Show when={dialog() === "detail" || compactDetailUnderChild()}>
        <DetailDialog
          visible={dialog() === "detail"}
          scrollboxRef={props.details.setScrollbox}
          navRef={props.details.navRef}
          searchFocused={props.details.searchFocused()}
          onJumpToCommit={props.details.onJumpToCommit}
          onOpenDiff={handleOpenDiff}
          onClose={() => {
            // Same as Esc (handle-cascade-close): leaving compact details also leaves detail focus.
            batch(() => {
              actions.setDetailFocused(false);
              setDialog(null);
            });
          }}
          {...props.details.providerProps}
          message={props.details.message()}
          onDismissMessage={props.details.onDismissMessage}
        />
      </Show>
      {/* The dashboard's details, compact mode only */}
      <Show when={dialog() === "dashboard-event"}>
        <DashboardEventDialog
          event={dashboard.dashboard.selected}
          appName={dashboard.dashboardAppName}
          onClose={() => {
            actions.setDetailFocused(false);
            setDialog(null);
          }}
          onShowInGraph={dashboard.showSelectedInGraph}
          onOpen={dashboard.openFromDashboardDialog}
          canOpen={() => !!dashboard.dashboard.selected()?.url || dashboard.dashboardRowOpens()}
          tabProps={dashboard.dashboardTabProps()}
          scrollboxRef={dashboard.setDialogScrollbox}
        />
      </Show>
      {/* Job log dialog */}
      <Show when={dialog() === "job-log" && jobLogTarget()}>
        {target => (
          <JobLogDialog
            provider={target().provider}
            job={target().job}
            jobs={target().jobs}
            run={target().run}
            fetchLog={target().fetchLog}
            entryNoun={target().noun}
            initialSearch={target().search}
            onClose={closeToDetail}
            onSearchActive={setLogSearchScope}
          />
        )}
      </Show>
      <Show when={dialog() === "openshift-resource" && openShiftResourceTarget()}>
        {resource => (
          <OpenShiftResourceDialog
            resource={resource()}
            loadLog={async (item, force) =>
              item.kind === "Pod" ? props.openShift.loadPodLog(item) : props.openShift.loadBuildLog(item, force)
            }
            followLog={props.openShift.followLog}
            consoleUrl={settings.openShift().consoleUrl}
            loadEvents={item => props.openShift.loadResourceEvents(item)}
            loadObject={(item, force) => props.openShift.loadResourceObject(item, force)}
            onClose={closeToDetail}
            onSearchActive={setLogSearchScope}
          />
        )}
      </Show>
    </>
  );
}
