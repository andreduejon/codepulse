import { createSignal, Show, For } from "solid-js";
import { useAppState } from "../context/state";
import { useTheme } from "../context/theme";

export default function SearchDialog(props: { onClose: () => void }) {
  const { state, actions } = useAppState();
  const { theme } = useTheme();
  const t = () => theme();
  const [query, setQuery] = createSignal(state.searchQuery());

  const handleSubmit = () => {
    actions.setSearchQuery(query());
    actions.setSelectedIndex(0);
    props.onClose();
  };

  const handleClear = () => {
    setQuery("");
    actions.setSearchQuery("");
    actions.setSelectedIndex(0);
    props.onClose();
  };

  return (
    <box
      position="absolute"
      top="30%"
      left="25%"
      width="50%"
      height={7}
      backgroundColor={t().backgroundPanel}
      border={true}
      borderColor={t().borderActive}
      borderStyle="rounded"
      flexDirection="column"
      paddingX={1}
      paddingY={1}
    >
      <text wrapMode="none">
        <span fg={t().primary}>Search Commits</span>
      </text>
      <box height={1} />
      <input
        focused
        width="100%"
        placeholder="Filter by message, author, or hash..."
        value={query()}
        onInput={(v) => setQuery(v)}
        onSubmit={handleSubmit}
        fg={t().foreground}
        backgroundColor={t().backgroundElement}
      />
      <box height={1} />
      <text wrapMode="none">
        <span fg={t().foregroundMuted}>Enter to search · Esc to cancel</span>
      </text>
    </box>
  );
}
