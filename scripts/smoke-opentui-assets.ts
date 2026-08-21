import { getTreeSitterClient } from "@opentui/core";

const client = getTreeSitterClient();

try {
  const result = await client.highlightOnce("const answer: number = 42;", "typescript");
  if (result.error || !result.highlights?.length) {
    throw new Error(result.error ?? "Tree-sitter returned no highlights");
  }
  console.log(`OpenTUI asset smoke test passed (${result.highlights.length} highlights)`);
} finally {
  await client.destroy();
}
