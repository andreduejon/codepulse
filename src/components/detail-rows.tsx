import type { MouseEvent, Renderable } from "@opentui/core";
import type { JSXElement } from "solid-js";
import { createEffect, createSignal, Show } from "solid-js";
import type { CopyableField, InteractiveItem } from "../hooks/use-detail-cursor";
import { useT } from "../hooks/use-t";
import Badge from "./badge";
import { SHORT_HASH_LEN } from "./detail-types";

/** What the Info tab rows read from the detail view: cursor, highlight, mouse activation and banner scroll. */
export interface DetailRowsView {
  mouseEnabled: () => boolean | undefined;
  findItemIndex: (type: InteractiveItem["type"], keyOrSection?: string, idx?: number) => number;
  isCursored: (itemIndex: number) => boolean;
  highlightBg: (itemIndex: number) => string | undefined;
  activate: (event: MouseEvent, itemIndex: number) => void;
  copiedField: () => CopyableField | null;
  /** Banner-scrolled text for a copyable field, or null when it isn't scrolling. */
  scrolledCopyableText: (field: CopyableField) => string | null;
  /** Banner scroll of the cursored item when it shows `text`, or null. */
  bannerScroll: (text: string) => { visibleWidth: number; bannerOffset: number } | null;
  getTagForHash: (hash: string) => string | null;
}

/** One copyable row with cursor highlight, banner scroll, and "✓ copied" feedback. */
export function CopyableRow(
  props: Readonly<{
    view: DetailRowsView;
    field: CopyableField;
    /** Fallback content shown when not banner-scrolling. */
    children: JSXElement;
    /** Text color when not cursored. Defaults to t().foreground. */
    fg?: string;
    /** wrapMode for the text element. Defaults to "none". */
    wrapMode?: "none" | "char" | "word";
    /** Optional ref callback forwarded to the outer box for scroll-into-view. */
    ref?: (el: Renderable) => void;
  }>,
) {
  const t = useT();
  const [hovered, setHovered] = createSignal(false);
  const itemIdx = () => props.view.findItemIndex("copyable", props.field);
  const cursored = () => props.view.isCursored(itemIdx());
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: TUI rows also support cursor navigation and Enter.
    // biome-ignore lint/a11y/useKeyWithMouseEvents: Hover does not change keyboard focus.
    <box
      ref={props.ref}
      flexDirection="row"
      backgroundColor={
        props.view.highlightBg(itemIdx()) ??
        (props.view.mouseEnabled() && hovered() ? t().backgroundElement : undefined)
      }
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
      onMouseDown={event => props.view.activate(event, itemIdx())}
    >
      <text
        selectable={!props.view.mouseEnabled()}
        flexGrow={1}
        flexShrink={1}
        fg={cursored() ? t().accent : (props.fg ?? t().foreground)}
        wrapMode={props.wrapMode ?? "none"}
        truncate={props.wrapMode !== "word" && !cursored()}
      >
        {props.view.scrolledCopyableText(props.field) ?? props.children}
      </text>
      <Show when={props.view.copiedField() === props.field}>
        <text
          selectable={!props.view.mouseEnabled()}
          flexShrink={0}
          bg={t().primary}
          fg={t().background}
          wrapMode="none"
        >
          {" ✓ copied "}
        </text>
      </Show>
    </box>
  );
}

/** A collapsible section header (Children, Parents) with interactive highlight. */
export function InteractiveSectionHeader(
  props: Readonly<{
    view: DetailRowsView;
    title: string;
    count: number;
    expanded: boolean;
    section: "children" | "parents";
    ref?: (el: Renderable) => void;
  }>,
) {
  const t = useT();
  const itemIdx = () => props.view.findItemIndex("section-header", props.section);
  const [hovered, setHovered] = createSignal(false);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: TUI headers also support cursor navigation and Enter.
    // biome-ignore lint/a11y/useKeyWithMouseEvents: Hover does not change keyboard focus.
    <box
      ref={props.ref}
      backgroundColor={
        props.view.highlightBg(itemIdx()) ??
        (props.view.mouseEnabled() && hovered() ? t().backgroundElement : undefined)
      }
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
      onMouseDown={event => props.view.activate(event, itemIdx())}
    >
      <text selectable={!props.view.mouseEnabled()} fg={t().accent} wrapMode="none">
        <strong>
          {props.expanded ? "▾" : "▸"} {props.title} ({props.count})
        </strong>
      </text>
    </box>
  );
}

/** A child or parent commit row: short hash plus its branch (or tag) badge. */
export function InteractiveCommitEntry(
  props: Readonly<{
    view: DetailRowsView;
    hash: string;
    entryIndex: number;
    type: "child" | "parent";
    branchName: string;
    colorIndex: number;
    ref?: (el: Renderable) => void;
  }>,
) {
  const t = useT();
  const itemIdx = () => props.view.findItemIndex(props.type, undefined, props.entryIndex);
  const cursored = () => props.view.isCursored(itemIdx());
  const [hovered, setHovered] = createSignal(false);
  let entry: Renderable | undefined;
  const tag = () => props.view.getTagForHash(props.hash);

  /** Resolved badge name for this entry */
  const badgeName = () => {
    if (props.branchName !== "") return props.branchName;
    return tag() ?? "deleted";
  };

  // Badge text is also part of this action's hit area; other badges stay selectable.
  createEffect(() => {
    badgeName();
    for (const child of entry?.getChildren() ?? []) child.selectable = !props.view.mouseEnabled();
  });

  /** Banner scroll props: only applied to the badge of the cursored entry */
  const badgeScrollProps = () => (cursored() ? (props.view.bannerScroll(badgeName()) ?? {}) : {});

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: TUI entries also support cursor navigation and Enter.
    // biome-ignore lint/a11y/useKeyWithMouseEvents: Hover does not change keyboard focus.
    <box
      ref={el => {
        entry = el;
        props.ref?.(el);
      }}
      flexDirection="row"
      flexWrap="wrap"
      gap={1}
      paddingLeft={2}
      backgroundColor={
        props.view.highlightBg(itemIdx()) ??
        (props.view.mouseEnabled() && hovered() ? t().backgroundElement : undefined)
      }
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
      onMouseDown={event => props.view.activate(event, itemIdx())}
    >
      <text fg={cursored() ? t().accent : t().foreground} wrapMode="none">
        {props.hash.substring(0, SHORT_HASH_LEN)}
      </text>
      <Show
        when={props.branchName !== ""}
        fallback={
          <Show when={tag()} fallback={<Badge name="deleted" colorIndex={0} dimmed />}>
            <Badge name={tag() as string} colorIndex={props.colorIndex} {...badgeScrollProps()} />
          </Show>
        }
      >
        <Badge name={props.branchName} colorIndex={props.colorIndex} {...badgeScrollProps()} />
      </Show>
    </box>
  );
}
