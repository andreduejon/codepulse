/**
 * The Git port for the components below the app (the details, the diff dialog). The app provides the one it was
 * started with; without a provider (a component's own test) it is the Git command line.
 */

import { createContext, useContext } from "solid-js";
import type { GitPort } from "../core/git/port";
import { terminalPorts } from "../ports";

export const GitContext = createContext<GitPort>(terminalPorts().git);

export const useGit = (): GitPort => useContext(GitContext);
