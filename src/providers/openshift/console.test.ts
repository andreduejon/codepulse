import { expect, test } from "bun:test";
import { openShiftConsoleUrl } from "./console";
import type { OpenShiftResource } from "./types";

const resource = (kind: OpenShiftResource["kind"], name: string): OpenShiftResource => ({
  id: `${kind}/${name}`,
  kind,
  namespace: "payments-dev",
  name,
  status: "pass",
  imageRefs: [],
});

test("console links follow the web console's routes for each kind and for a namespace", () => {
  const base = "https://console-openshift-console.apps.example.com/";
  expect(openShiftConsoleUrl(base, { namespace: "payments-dev" })).toBe(
    "https://console-openshift-console.apps.example.com/k8s/cluster/projects/payments-dev",
  );
  const cases: [OpenShiftResource, string][] = [
    [resource("Pod", "api-7f9c-x2k4"), "/k8s/ns/payments-dev/pods/api-7f9c-x2k4"],
    [resource("Deployment", "api"), "/k8s/ns/payments-dev/deployments/api"],
    [resource("DeploymentConfig", "api"), "/k8s/ns/payments-dev/deploymentconfigs/api"],
    [resource("Build", "api-41"), "/k8s/ns/payments-dev/builds/api-41"],
    // A tag has no page of its own; its image stream lists the tags.
    [resource("ImageStreamTag", "api:latest"), "/k8s/ns/payments-dev/imagestreams/api"],
  ];
  for (const [item, path] of cases) {
    expect(openShiftConsoleUrl(base, { namespace: item.namespace, resource: item })).toBe(
      `https://console-openshift-console.apps.example.com${path}`,
    );
  }
});

test("no console link without a valid console URL", () => {
  expect(openShiftConsoleUrl("", { namespace: "dev" })).toBeNull();
  expect(openShiftConsoleUrl("http://console.example.com", { namespace: "dev" })).toBeNull();
});
