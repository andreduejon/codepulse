import { expect, test } from "bun:test";
import { themes } from "../src/context/theme";
import { providerAccent, providerColors } from "../src/providers/colors";

test("Git badge defaults to original accent and supports its own color independently", () => {
  for (const theme of Object.values(themes)) {
    expect(providerColors(theme, "git").bg).toBe(theme.accent);
    expect(providerAccent(theme, "git")).toBe(theme.gitBg);
    expect(providerColors({ ...theme, accent: "#ffffff", gitBg: "#123456" }, "git")).toEqual({
      bg: "#123456",
      fg: theme.background,
    });
  }
});

test("OpenCode Git keeps original yellow distinct from Jenkins orange", () => {
  const theme = themes["open-code-original"];
  expect(providerColors(theme, "git").bg).toBe("#e5b567");
  expect(providerColors(theme, "git").bg).not.toBe(providerColors(theme, "jenkins").bg);
});
