import { expect, test } from "bun:test";
import { fastImportStream } from "./history";

test("an empty file can be deleted like any other", () => {
  const stream = new TextDecoder().decode(
    fastImportStream(
      {
        commits: [
          {
            key: "add",
            parents: [],
            ago: 2000,
            subject: "add an empty file",
            author: "Demo Dev",
            files: { "empty.txt": "" },
          },
          { key: "drop", parents: ["add"], ago: 1000, subject: "drop it", author: "Demo Dev", deletes: ["empty.txt"] },
        ],
        refs: { "refs/heads/main": "drop" },
      },
      10_000,
    ),
  );
  expect(stream).toContain("D empty.txt");
});
