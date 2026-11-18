import { expect, test } from "bun:test";
import { OPENSHIFT_BANNER } from "../../../core/openshift/banner";
import { liveListFrozen, type OpenShiftDetailSource } from "./detail-entry";

const source = (frozen: boolean, message: string): OpenShiftDetailSource => ({
  getCommitData: () => null,
  isFrozen: () => frozen,
  status: { kind: "error", message },
});

test("the live list is off when the service froze it, whatever the banner says", () => {
  expect(liveListFrozen(source(true, "Token expired, sign in again"))).toBe(true);
  expect(liveListFrozen(source(false, OPENSHIFT_BANNER.tokenExpired))).toBe(false);
});
