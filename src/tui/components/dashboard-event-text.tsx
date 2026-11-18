import { For, type JSX, Show } from "solid-js";
import type { DashboardEvent } from "../../core/dashboard/events";
import { useProviderModules } from "../context/provider-modules";
import { eventMark } from "../dashboard/legend";
import { useT } from "../hooks/use-t";
import { severityColor } from "../providers/snyk/severity";

const SEVERITIES = ["critical", "high", "medium", "low"] as const;

/**
 * What happened: its mark (a commit has none), then its text, in a dashboard row (one line, cut) or the details'
 * headline (`wrap`, bold). A scan's counts take their severity's color, muted without findings, and a partial scan
 * ends in Snyk's warning `?`. `color` is the text's own (the selected row's); marks and counts keep theirs.
 */
export function DashboardEventText(
  props: Readonly<{ event: DashboardEvent; color?: string; wrap?: boolean; bold?: boolean }>,
) {
  const t = useT();
  const modules = useProviderModules();
  const event = () => props.event;
  const counts = () => {
    const found = event().counts;
    return found ? SEVERITIES.map(severity => [severity, found[severity]] as const) : null;
  };
  const body = () => (
    <Show when={counts()} fallback={event().text}>
      {found => (
        <>
          {event().text.split(" · ").slice(0, 2).join(" · ")}
          <For each={found()}>
            {([severity, count]) => (
              <>
                {" · "}
                <span style={{ fg: count > 0 ? severityColor(t(), severity) : t().foregroundMuted }}>
                  {`${count} ${severity}`}
                </span>
              </>
            )}
          </For>
          <Show when={event().partial}>
            <span style={{ fg: t().warning }}>{" ?"}</span>
          </Show>
        </>
      )}
    </Show>
  );
  const mark = () => eventMark(event(), modules);
  const strong = (content: JSX.Element) => (props.bold ? <strong>{content}</strong> : content);
  /**
   * A scan's headline wraps between its parts, never inside one (`0 medium` stays whole): each part is its own text
   * in a wrapping row, as the legend's items are. OpenTUI breaks a text at any space, a no-break space too.
   */
  const pieces = (): { text: string; fg?: string; mark?: boolean }[] | null => {
    const found = counts();
    if (!props.wrap || !found) return null;
    const [head, total] = event().text.split(" · ");
    return [
      { text: `${head} · `, mark: true },
      { text: `${total}` },
      ...found.map(([severity, count]) => ({
        text: `${count} ${severity}`,
        fg: count > 0 ? severityColor(t(), severity) : t().foregroundMuted,
      })),
    ];
  };
  return (
    <Show when={pieces()} fallback={line()}>
      {parts => (
        <box flexDirection="row" flexWrap="wrap" width="100%" flexShrink={0}>
          <For each={parts()}>
            {(part, index) => (
              <text wrapMode="none" flexShrink={0} fg={props.color ?? t().foreground}>
                <Show when={part.mark && mark()}>
                  {found => <span style={{ fg: found().color(t()) }}>{`${found().icon} `}</span>}
                </Show>
                {strong(part.fg ? <span style={{ fg: part.fg }}>{part.text}</span> : part.text)}
                {index() > 0 && index() < parts().length - 1 ? " · " : ""}
                <Show when={index() === parts().length - 1 && event().partial}>
                  <span style={{ fg: t().warning }}>{" ?"}</span>
                </Show>
              </text>
            )}
          </For>
        </box>
      )}
    </Show>
  );

  function line() {
    return (
      <text
        wrapMode={props.wrap ? "word" : "none"}
        truncate={!props.wrap}
        fg={props.color ?? t().foreground}
        flexShrink={props.wrap ? 0 : undefined}
      >
        <Show when={eventMark(event(), modules)}>
          {mark => <span style={{ fg: mark().color(t()) }}>{`${mark().icon} `}</span>}
        </Show>
        {strong(body())}
      </text>
    );
  }
}
