/**
 * The demo's SSH (GIT_SSH_COMMAND, see world.ts): `git fetch` from `git@github.com:demo/shop.git` reaches a local
 * bare repository instead, so fetching works offline and the remote still looks like GitHub to the app.
 *
 * Git calls it as `fake-ssh.ts HOST "git-upload-pack 'demo/shop.git'"` (GIT_SSH_VARIANT=simple).
 */
import { join, relative, resolve } from "node:path";
import { REMOTES_ENV } from "./scenario";

const command = process.argv.at(-1) ?? "";
const match = /^(git-upload-pack|git-receive-pack) '?\/?([^']+?)'?$/.exec(command);
const remotes = process.env[REMOTES_ENV];
const path = match && remotes ? resolve(join(remotes, match[2])) : null;
if (!match || !remotes || !path || relative(remotes, path).startsWith("..")) {
  console.error(`demo ssh: cannot run "${command}"`);
  process.exit(128);
}
const service = match[1] === "git-upload-pack" ? "upload-pack" : "receive-pack";
const git = Bun.spawn(["git", service, path], { stdio: ["inherit", "inherit", "inherit"] });
process.exit(await git.exited);
