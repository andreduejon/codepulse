import { useAppState } from "../../context/state";
import { useTheme } from "../../context/theme";

export default function BranchDialog(props: {
  onClose: () => void;
  onSelect: (branch: string) => void;
}) {
  const { state } = useAppState();
  const { theme } = useTheme();
  const t = () => theme();

  const localBranches = () =>
    state.branches().filter((b) => !b.isRemote);

  const options = () =>
    localBranches().map((b) => ({
      name: b.name,
      description: b.isCurrent ? "current" : "",
    }));

  return (
    <box
      position="absolute"
      top={0}
      left={0}
      width="100%"
      height="100%"
      backgroundColor={"#00000080"}
      alignItems="center"
      justifyContent="center"
    >
      <box
        width={70}
        height="60%"
        backgroundColor={t().backgroundPanel}
        flexDirection="column"
        paddingX={1}
        paddingY={1}
      >
        {/* Title bar */}
        <box flexDirection="row" width="100%" paddingX={4}>
          <text flexGrow={1} wrapMode="none">
            <strong><span fg={t().foreground}>Switch Branch</span></strong>
          </text>
          <text flexShrink={0} wrapMode="none" fg={t().foregroundMuted}>
            {"esc".padStart(9)}
          </text>
        </box>
        <box height={1} />

        {/* Branch list */}
        <select
          focused
          flexGrow={1}
          options={options()}
          backgroundColor={t().backgroundPanel}
          textColor={t().foreground}
          selectedBackgroundColor={t().backgroundElement}
          selectedTextColor={t().primary}
          focusedBackgroundColor={t().backgroundPanel}
          focusedTextColor={t().foreground}
          descriptionColor={t().foregroundMuted}
          selectedDescriptionColor={t().success}
          onSelect={(idx) => {
            const branch = localBranches()[idx];
            if (branch) {
              props.onSelect(branch.name);
              props.onClose();
            }
          }}
        />
      </box>
    </box>
  );
}
