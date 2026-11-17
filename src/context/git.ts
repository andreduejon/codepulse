/**
 * The Git port for the components below the app (the details, the diff dialog). The app provides the one it was
 * started with; without a provider (a component's own test) it is the registered one (context/ports.ts).
 */

import { createContext, useContext } from "solid-js";
import type { GitPort } from "../core/git/port";
import { defaultPorts } from "./ports";

export const GitContext = createContext<GitPort | undefined>(undefined);

export const useGit = (): GitPort => useContext(GitContext) ?? defaultPorts().git;
