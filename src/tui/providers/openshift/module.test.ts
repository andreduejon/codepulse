import { expect, test } from "bun:test";
import { eventsNotice } from "./module";

test("the Events tab names the namespaces whose events it lacks: no permission, or a list that failed", () => {
  expect(eventsNotice([], [])).toBeNull();
  expect(eventsNotice(["shop-prod"], [])).toMatchObject({
    title: "No permission to list events in shop-prod",
    detail: ["The token needs list on events."],
  });
  expect(eventsNotice([], ["shop-test"])).toMatchObject({
    title: "Could not list events in shop-test",
    detail: ["Its warnings are the ones listed before."],
  });
  expect(eventsNotice(["shop-prod"], ["shop-test"])?.detail).toEqual([
    "The token needs list on events.",
    "Could not list events in shop-test: its warnings are the ones listed before.",
  ]);
});
