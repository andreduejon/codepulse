import { useAppState } from "../../context/state";
import { useTheme } from "../../context/theme";
import { DialogOverlay, DialogTitleBar } from "./dialog-chrome";

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
    <DialogOverlay>
      <box
        width={70}
        height="60%"
        backgroundColor={t().backgroundPanel}
        flexDirection="column"
        paddingX={1}
        paddingY={1}
      >
        <DialogTitleBar title="Switch Branch" />

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
    </DialogOverlay>
  );
}
