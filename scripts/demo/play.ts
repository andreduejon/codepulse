/**
 * The app process of `bun run demo --play`: registers the Solid transform first (like src/index.tsx), then plays.
 * The launcher (run.ts) starts it with the fake servers and the fixed clock preloaded.
 */
import "@opentui/solid/preload";
import { plugin } from "bun";
import { PLAY_ENV } from "./scenario";

// Long text in the selected row scrolls sideways on a timer. Headless, it stays still (like screenshot tools that
// pause animations), so a shot shows the same text however long the play took to get there.
plugin({
  name: "codepulse-demo-still-text",
  setup(build) {
    build.onLoad({ filter: /[/\\]src[/\\]hooks[/\\]use-banner-scroll\.ts$/ }, () => ({
      contents: "export function useBannerScroll() { return () => 0; }",
      loader: "ts",
    }));
  },
});

const { play } = await import("./player");
const config = JSON.parse(process.env[PLAY_ENV] ?? "null");
if (!config) {
  console.error(`${PLAY_ENV} is not set. Start the headless demo with: bun run demo --play "…"`);
  process.exit(2);
}
process.exit(await play(config));
