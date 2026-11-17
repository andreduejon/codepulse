/**
 * The app's screens as the terminal draws them: too small, setup, the project selector, the cache screen, and the main
 * screen (graph or Dashboard, command bar and footer on the left, their details on the right, dialogs over it). It only
 * draws: the root (app-content.tsx) builds the controllers it shows and hands them over.
 */
import { useRenderer, useTerminalDimensions } from "@opentui/solid";
import { type Accessor, Show } from "solid-js";
import type { ConfigInfo } from "../../core/settings/config";
import CacheScreen from "../components/cache-screen";
import CommandBar from "../components/command-bar";
import { DashboardDetail } from "../components/dashboard-detail";
import { DashboardView } from "../components/dashboard-view";
import DetailPanel, { type DetailPanelProps } from "../components/detail-panel";
import type { DetailNavRef } from "../components/detail-types";
import ErrorScreen from "../components/error-screen";
import Footer from "../components/footer";
import GraphView, { ColumnHeader } from "../components/graph";
import MessageBox from "../components/message-box";
import ProjectSelector from "../components/project-selector";
import SetupScreen from "../components/setup-screen";
import { MIN_TERMINAL_HEIGHT, MIN_TERMINAL_WIDTH } from "../constants";
import { useAppState } from "../context/state";
import type { Theme } from "../context/theme";
import { openGraphDetails } from "../hooks/handle-graph-keys";
import type { useCommandBar } from "./command-bar";
import type { useDashboardController } from "./dashboard-controller";
import { DialogLayer } from "./dialog-layer";
import type { DialogHost, LayoutMode } from "./dialogs";
import type { useGraphController } from "./graph-controller";
import type { useMessageCenter } from "./messages";
import type { ProviderHost } from "./providers";
import type { RepoSession } from "./repo-session";
import type { RepoSettings } from "./repo-settings";

export interface AppLayoutProps {
  /** The theme without the provider view's accent, for the screen's backgrounds. */
  baseTheme: Accessor<Theme>;
  layoutMode: Accessor<LayoutMode>;
  repoPath: Accessor<string>;
  configInfo?: ConfigInfo;
  setup: { visible: Accessor<boolean>; onComplete: () => void };
  session: RepoSession;
  cacheScreenVisible: Accessor<boolean>;
  settings: RepoSettings;
  providers: ProviderHost;
  dialogs: DialogHost;
  messages: ReturnType<typeof useMessageCenter>;
  commandBar: ReturnType<typeof useCommandBar>;
  graph: ReturnType<typeof useGraphController>;
  dashboard: ReturnType<typeof useDashboardController>;
  /** The footer's Enter and Esc: the same as the keys. */
  keys: { onEnter: () => void; onEscape: () => void };
  /** Reload, fetch and pull for the Menu. */
  run: { reloadAll: () => Promise<void>; fetchAll: () => Promise<void>; pullAll: () => Promise<void> };
  detail: {
    navRef: DetailNavRef;
    /** Provider data and dialogs for the detail panel and the compact detail dialog. */
    providerProps: Pick<DetailPanelProps, "memory" | "providers" | "tabNotice" | "onDismissTabNotice">;
  };
}

export function AppLayout(props: Readonly<AppLayoutProps>) {
  const { state, actions } = useAppState();
  const renderer = useRenderer();
  const dimensions = useTerminalDimensions();
  /** The mouse works on the graph, the dashboard and their panels while no dialog covers them. */
  const mouseEnabled = () => props.dialogs.dialog() == null;
  const dashboard = () => props.dashboard.dashboard;
  const display = () => props.settings.display();

  return (
    <Show
      when={props.cacheScreenVisible() || props.layoutMode() !== "too-small"}
      fallback={
        <ErrorScreen
          error={`Terminal too small (${dimensions().width}×${dimensions().height})\nResize to at least ${MIN_TERMINAL_WIDTH} columns and ${MIN_TERMINAL_HEIGHT} rows.`}
        />
      }
    >
      <Show
        when={!props.setup.visible()}
        fallback={
          <SetupScreen
            repoPath={props.repoPath()}
            onComplete={props.setup.onComplete}
            onQuit={() => renderer.destroy()}
          />
        }
      >
        <Show
          when={!props.session.selectorVisible() && !props.cacheScreenVisible()}
          fallback={
            <Show
              when={props.cacheScreenVisible()}
              fallback={
                <ProjectSelector
                  knownRepos={props.session.knownRepos()}
                  currentRepo={props.repoPath()}
                  onSelectRepo={props.session.switchTo}
                  onCancel={() => props.session.setSelectorVisible(false)}
                />
              }
            >
              <CacheScreen
                currentRepo={props.repoPath()}
                onEvict={props.session.evictCache}
                onClose={props.session.closeCacheScreen}
              />
            </Show>
          }
        >
          <box flexDirection="column" width="100%" height="100%" backgroundColor={props.baseTheme().background}>
            {/* Main content area */}
            <box flexDirection="row" flexGrow={1}>
              {/* Left panel - graph + search + footer, all on grey background */}
              <box
                flexDirection="column"
                flexGrow={1}
                flexShrink={1}
                backgroundColor={props.baseTheme().backgroundPanel}
                paddingX={2}
              >
                <Show when={props.dashboard.dashboardShown()}>
                  <box flexDirection="column" flexGrow={1} paddingBottom={1}>
                    <DashboardView
                      dashboard={dashboard()}
                      mouseEnabled={mouseEnabled}
                      onRowClick={() => actions.setDetailFocused(false)}
                    />
                  </box>
                </Show>
                {/* Graph area: kept behind the dashboard, so it comes back where it was */}
                <box flexDirection="column" flexGrow={1} paddingBottom={1} visible={!props.dashboard.dashboardShown()}>
                  {/* Sticky column headers - above scrollbox */}
                  <ColumnHeader />

                  <GraphView
                    mouseEnabled={mouseEnabled}
                    onSelectRow={props.graph.selectRow}
                    onLoadMore={props.graph.loadMoreData}
                    snykGetCommitData={props.providers.snyk.getCommitData}
                    snykIsScanning={props.providers.snyk.isScanning}
                    scrollboxRef={props.graph.setGraphScrollbox}
                    suppressAutoScroll={() => props.session.pendingGraphScrollTop() != null}
                  />
                </box>

                <box flexDirection="column" flexShrink={0} width="100%">
                  <Show when={props.messages.screenMessage()}>
                    {msg => (
                      <box flexDirection="column" width="100%" flexShrink={0}>
                        <MessageBox
                          kind={msg().kind}
                          source={msg().source}
                          title={msg().title}
                          message={msg().message}
                          detail={msg().detail}
                          onDismiss={props.messages.clearScreenMessage}
                          mouseEnabled={mouseEnabled()}
                        />
                        <box height={1} />
                      </box>
                    )}
                  </Show>

                  {/* Command bar section */}
                  <CommandBar
                    onSelectMode={props.commandBar.selectMode}
                    onSelectProject={props.session.switchTo}
                    mouseEnabled={mouseEnabled}
                    commandBarMode={props.commandBar.commandBarMode}
                    commandBarValue={props.commandBar.commandBarValue}
                    searchInputValue={props.commandBar.searchInputValue}
                    searchFocused={props.commandBar.searchFocused}
                    onInput={props.commandBar.onInput}
                    detailFocused={state.detailFocused}
                    knownRepos={props.session.knownRepos()}
                    currentRepo={props.repoPath()}
                    currentGroup={display().group}
                    currentAppName={display().appName}
                    dashboard={dashboard()}
                  />

                  {/* Footer - hotkey hints, 1 char gap above, right-aligned */}
                  <box height={1} />
                  <Footer
                    onConfirm={props.keys.onEnter}
                    onClose={props.keys.onEscape}
                    mouseEnabled={mouseEnabled()}
                    onOpenDetails={() => {
                      if (!mouseEnabled()) return;
                      openGraphDetails({
                        state,
                        actions,
                        layoutMode: props.layoutMode,
                        setDialog: props.dialogs.setDialog,
                        detailNavRef: props.detail.navRef,
                      });
                    }}
                    commandBarMode={props.commandBar.commandBarMode}
                    filterActive={!!state.highlightSet() || !!state.viewingBranch()}
                    compact={props.layoutMode() === "compact"}
                    dashboard={dashboard()}
                    onDashboardRefresh={props.dashboard.refreshDashboard}
                  />
                </box>
              </box>

              {/* Dashboard details - right, like the commit details beside the graph */}
              <Show when={props.layoutMode() === "normal" && props.dashboard.dashboardShown()}>
                <box flexDirection="column" width="25%" minWidth={60} flexShrink={0} paddingX={2} paddingBottom={1}>
                  <DashboardDetail
                    event={dashboard().selected}
                    appName={props.dashboard.dashboardAppName}
                    onShowInGraph={props.dashboard.showSelectedInGraph}
                    mouseEnabled={mouseEnabled}
                    scrollboxRef={element => {
                      props.dashboard.setDetailScrollbox(element);
                    }}
                    {...props.dashboard.dashboardTabProps()}
                  />
                </box>
              </Show>
              {/* Detail panel - right, hidden in compact/too-small mode */}
              <Show when={props.layoutMode() === "normal" && !props.dashboard.dashboardShown()}>
                <box flexDirection="column" width="25%" minWidth={60} flexShrink={0} paddingX={2} paddingBottom={1}>
                  <DetailPanel
                    mouseEnabled={mouseEnabled()}
                    onMouseFocus={() => {
                      props.commandBar.leave();
                      actions.setDetailFocused(true);
                    }}
                    scrollboxRef={props.graph.setDetailScrollbox}
                    navRef={props.detail.navRef}
                    searchFocused={props.commandBar.searchFocused()}
                    onJumpToCommit={props.graph.jumpToCommit}
                    onOpenDiff={props.dialogs.openDiff}
                    {...props.detail.providerProps}
                  />
                </box>
              </Show>
            </box>

            <DialogLayer
              dialogs={props.dialogs}
              settings={props.settings}
              dashboard={props.dashboard}
              openShift={props.providers.openShift}
              repoPath={props.repoPath}
              configInfo={props.configInfo}
              menu={{
                onReload: () => void props.run.reloadAll(),
                onFetch: () => void props.run.fetchAll(),
                onPull: () => void props.run.pullAll(),
                onOpenCache: props.session.openCacheScreen,
                onViewBranch: props.graph.viewBranch,
                onSwitchRepo: () => {
                  props.dialogs.setDialog(null);
                  props.session.setSelectorVisible(true);
                },
              }}
              details={{
                navRef: props.detail.navRef,
                setScrollbox: props.graph.setDetailScrollbox,
                searchFocused: props.commandBar.searchFocused,
                onJumpToCommit: props.graph.jumpToCommit,
                providerProps: props.detail.providerProps,
                message: props.messages.screenMessage,
                onDismissMessage: props.messages.clearScreenMessage,
              }}
            />
          </box>
        </Show>
      </Show>
    </Show>
  );
}
