import type { GitHubSettings } from "../../core/github/definition";
import type { JenkinsSettings } from "../../core/jenkins/definition";
import type { OpenShiftSettings } from "../../core/openshift/definition";
import type { SnykSettings } from "../../core/snyk/service";

export type MenuTab = "repository" | "branch" | "providers";

export type SettingItem =
  | { kind: "header"; label: string; tone?: "accent" | "muted"; get?: () => string }
  | { kind: "info"; label: string; get: () => string; valid?: () => boolean }
  | { kind: "copyable"; label: string; get: () => string; onForget?: () => void; visualPrefix?: string }
  | {
      kind: "toggle";
      label: string;
      hotkey?: string;
      get: () => boolean;
      set: (v: boolean) => void;
      disabled?: () => boolean;
      needsReload?: boolean;
    }
  | {
      kind: "cycle";
      label: string;
      hotkey?: string;
      options: string[];
      get: () => string;
      set: (v: string) => void;
      needsReload?: boolean;
    }
  | { kind: "dialog"; label: string; hotkey?: string; dialogId: "theme"; get: () => string }
  | { kind: "action"; label: string; hotkey?: string; get?: () => string; run: () => void; disabled?: () => boolean }
  | { kind: "section"; label: string; count: number; collapsed: () => boolean; toggle: () => void }
  | { kind: "badge"; name: string; colorIndex: number; dimmed?: boolean }
  | { kind: "branch"; name: string; run: () => void; upstream?: string; ahead?: number; behind?: number }
  | {
      kind: "editable";
      label: string;
      placeholder?: string;
      get: () => string;
      set: (v: string) => void;
      valid?: () => boolean;
      showValidity?: boolean;
      isDraftValid?: (v: string) => boolean;
      keepEditingOnSave?: boolean;
      staySelectedOnSave?: boolean;
      fullWidth?: boolean;
    };

/** Usable width for copyable text: dialog=70 - 2(paddingX=1) - 8(paddingX=4) = 60 */
export const COPYABLE_VISIBLE_WIDTH = 60;

/** Each provider's settings as its Menu rows change them: its definition's (core/<provider>/definition.ts). */
export type GitHubMenuConfig = GitHubSettings;
export type JenkinsMenuConfig = JenkinsSettings;
export type OpenShiftMenuConfig = OpenShiftSettings;
export type SnykMenuConfig = SnykSettings;
