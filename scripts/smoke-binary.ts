import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { stripVTControlCharacters } from "node:util";

const [binary, repository] = process.argv.slice(2);
if (!binary || !repository) throw new Error("Usage: bun scripts/smoke-binary.ts <binary> <repository>");

const root = await mkdtemp(join(tmpdir(), "codepulse smoke "));
const home = join(root, "home");
const empty = join(root, "not-a-repository");
let output = "";
const decoder = new TextDecoder();
let child: ReturnType<typeof Bun.spawn> | undefined;
const terminal = new Bun.Terminal({
  cols: 100,
  rows: 35,
  data(_terminal, data) {
    output = (output + decoder.decode(data, { stream: true })).slice(-1024 * 1024);
  },
});

async function waitFor(label: string, ready: () => boolean): Promise<void> {
  const deadline = Date.now() + 30000;
  while (!ready()) {
    if (Date.now() >= deadline || child?.exitCode != null) {
      throw new Error(
        `Smoke failed waiting for ${label} (exit ${child?.exitCode}):\n${stripVTControlCharacters(output)}`,
      );
    }
    await Bun.sleep(20);
  }
}

try {
  await mkdir(home);
  await mkdir(empty);
  child = Bun.spawn([resolve(binary), empty], {
    terminal,
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      APPDATA: join(home, "AppData", "Roaming"),
      LOCALAPPDATA: join(home, "AppData", "Local"),
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
    },
  });
  await waitFor("repository selector", () => stripVTControlCharacters(output).includes("Enter custom path"));
  output = "";
  terminal.resize(80, 24);
  if (process.platform !== "win32") child.kill("SIGWINCH");
  await waitFor("small-terminal screen", () => stripVTControlCharacters(output).includes("Terminal too small"));
  output = "";
  terminal.resize(100, 35);
  if (process.platform !== "win32") child.kill("SIGWINCH");
  await waitFor("selector resize recovery", () => stripVTControlCharacters(output).includes("Enter custom path"));
  output = "";
  terminal.write(`${resolve(repository)}\r`);
  await waitFor("repository re-exec", () =>
    stripVTControlCharacters(output).includes("Welcome to your git graph visualizer"),
  );
  terminal.write("q");
  const deadline = Date.now() + 30000;
  while (child.exitCode == null && Date.now() < deadline) await Bun.sleep(20);
  if (child.exitCode !== 0)
    throw new Error(`Smoke failed on exit: ${child.exitCode}\n${stripVTControlCharacters(output)}`);
  console.log("Executable smoke passed (selector, re-exec, resize, quit)");
} finally {
  if (child && child.exitCode == null) {
    if (process.platform === "win32") {
      await Bun.spawn(["taskkill.exe", "/PID", String(child.pid), "/T", "/F"], {
        stdout: "ignore",
        stderr: "ignore",
      }).exited;
    } else child.kill("SIGKILL");
    await child.exited;
  }
  terminal.close();
  await rm(root, { recursive: true, force: true });
}
