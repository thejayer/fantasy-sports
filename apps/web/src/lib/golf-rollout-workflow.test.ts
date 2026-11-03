import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assertGolfWritesEnabled, golfWritesEnabled, GolfWritesPausedError } from "./golf-rollout-gate";

type Workflow = {
  on: { push: { branches: string[]; paths: string[] }; workflow_dispatch: {
    inputs: Record<string, { required?: boolean; default?: string }>;
  } };
  jobs: { deploy: { if?: string; steps: Array<{ name?: string; run?: string }> } };
};
const root = path.resolve(__dirname, "../../../..");
const source = readFileSync(path.join(root, ".github/workflows/deploy-hub.yml"), "utf8");
const yaml = createRequire(import.meta.url)("js-yaml") as { load: (value: string) => Workflow };
const workflow = yaml.load(source);
const deploy = workflow.jobs.deploy.steps.find(step => step.name === "Resolve AUTH_URL and deploy")!.run!;
const validate = workflow.jobs.deploy.steps.find(step => step.name === "Validate inputs")!.run!;
const binding = deploy.match(/--set-env-vars\s+"([^"]+)"/)![1]
  .split(",").find(value => value.startsWith("SJ_GOLF_WRITES_ENABLED="))!;

afterEach(() => vi.unstubAllEnvs());

function executedArguments(event: "push" | "workflow_dispatch", bucket: string,
  authUrl = "https://fixture.invalid", expectedStatus = 0, defaultBucket = "offline-bucket"): string[] {
  const directory = mkdtempSync(path.join(os.tmpdir(), "sj-golf-rollout-"));
  const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "/bin/bash";
  if (!existsSync(bash)) throw new Error("Bash is required to execute the offline deployment-policy test");
  try {
    writeFileSync(path.join(directory, "deploy.sh"), `set -e\n${validate}\n${deploy}`, "utf8");
    writeFileSync(path.join(directory, "gcloud"), `#!/usr/bin/env bash
set -eu
if [ "$1 $2 $3" = "run services describe" ]; then
  printf '%s\\n' 'https://fixture.run.app'
elif [ "$1 $2" = "run deploy" ]; then
  printf '%s\\n' "$@" > "$CAPTURE"
else
  echo 'unexpected gcloud operation in offline test' >&2
  exit 98
fi
`, "utf8");
    chmodSync(path.join(directory, "gcloud"), 0o700);
    const result = spawnSync(bash, ["--noprofile", "--norc", "-c", `
set -eu
task_bin="$1"
if command -v cygpath >/dev/null 2>&1; then task_bin="$(cygpath -u "$task_bin")"; fi
export PATH="$task_bin:$PATH"
test "$(command -v gcloud)" = "$task_bin/gcloud"
export CAPTURE="$task_bin/capture"
export GITHUB_ENV="$task_bin/environment"
bash "$task_bin/deploy.sh"
`, "offline-rollout-test", directory], {
      encoding: "utf8", timeout: 15_000, windowsHide: true,
      env: { ...process.env, EVENT_NAME: event, BUCKET: bucket, DEFAULT_BUCKET: defaultBucket,
        PROJECT_ID: "offline-project", REGION: "offline-region", SERVICE: "offline-hub", IMAGE: "offline-image",
        AUTH_URL_INPUT: authUrl, GCP_PROJECT_NUMBER: "123", MIN_INSTANCES: "0",
        HOCKEY_INJURY_DISCORD: "0", HUB_BUCKET: "", SJ_GOLF_WRITES_ENABLED: "1" },
    });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(expectedStatus);
    return existsSync(path.join(directory, "capture"))
      ? readFileSync(path.join(directory, "capture"), "utf8").trim().split(/\r?\n/)
      : [];
  } finally {
    const target = path.resolve(directory);
    if (path.dirname(target) !== path.resolve(os.tmpdir()) || !path.basename(target).startsWith("sj-golf-rollout-")) {
      throw new Error("refusing to remove a path outside this test's temporary directory");
    }
    rmSync(target, { recursive: true, force: true });
  }
}

describe("hub deployment rollout policy", () => {
  it("preserves automatic main deployment for unrelated hub changes", () => {
    expect(workflow.on.push.branches).toEqual(["main"]);
    expect(workflow.on.push.paths).toContain("apps/web/**");
    expect(workflow.jobs.deploy.if).toBeUndefined();
    expect(deploy).toContain('gcloud run deploy "$SERVICE" "${ARGS[@]}"');
  });

  it("forces an unconditional literal pause in the actual deployed environment", () => {
    expect(binding).toBe("SJ_GOLF_WRITES_ENABLED=0");
    expect(deploy.match(/--set-env-vars\s+"([^"]+)"/)![1].endsWith(binding)).toBe(true);
    expect(deploy.match(/SJ_GOLF_WRITES_ENABLED=/g)).toHaveLength(1);
    expect(deploy).not.toContain("--env-vars-file");
    expect(deploy).not.toMatch(/SJ_GOLF_WRITES_ENABLED=\$|SJ_GOLF_WRITES_ENABLED=1/);
  });

  it("offers no manual activation or evidence-checkbox shortcut", () => {
    const inputs = workflow.on.workflow_dispatch.inputs;
    expect(Object.keys(inputs).filter(name => /golf|activat|staging|drain/i.test(name))).toEqual([]);
    expect(inputs.bucket.required).toBe(false);
    expect(inputs.bucket.default).toBe("");
    expect(deploy).toContain("leaving Cloud Run volumes unchanged");
    expect(deploy).not.toContain("Specify bucket: concurrent golf writes require");
  });

  it.each([
    ["push", "", true],
    ["workflow_dispatch", "", false],
    ["workflow_dispatch", "manual-fixture-bucket", true],
  ] as const)("executes %s bucket=%j with paused writes and expected mounts", (event, bucket, mounted) => {
    const args = executedArguments(event, bucket);
    const environment = args[args.indexOf("--set-env-vars") + 1];
    expect(environment.split(",")).toContain("SJ_GOLF_WRITES_ENABLED=0");
    expect(environment).not.toContain("SJ_GOLF_WRITES_ENABLED=1");
    expect(args.includes("--add-volume")).toBe(mounted);
    if (mounted) expect(environment).toContain(`SJ_HUB_GCS_BUCKET=${bucket || "offline-bucket"}`);
    else expect(args).not.toContain("--clear-volumes");
  });

  it.each([",SJ_GOLF_WRITES_ENABLED=1", "\nSJ_GOLF_WRITES_ENABLED=1", "\rSJ_GOLF_WRITES_ENABLED=1"])(
    "rejects AUTH_URL delimiter injection %j before deploy", suffix => {
      expect(executedArguments("workflow_dispatch", "", `https://fixture.invalid${suffix}`, 1)).toEqual([]);
    });

  it("rejects a manual bucket delimiter override before deploy", () => {
    expect(executedArguments("workflow_dispatch", "fixture,SJ_GOLF_WRITES_ENABLED=1", undefined, 1)).toEqual([]);
  });

  it("rejects a repository default-bucket delimiter override before deploy", () => {
    expect(executedArguments("push", "", undefined, 1, "fixture,SJ_GOLF_WRITES_ENABLED=1")).toEqual([]);
  });

  it("overrides inherited activation even when the storage bucket is configured", () => {
    vi.stubEnv("SJ_GOLF_WRITES_ENABLED", "1");
    vi.stubEnv("SJ_HUB_GCS_BUCKET", "configured-does-not-mean-approved");
    vi.stubEnv("K_SERVICE", "production-fixture");
    // Apply the exact binding extracted from the real workflow, not a test copy.
    const [key, value] = binding.split("=");
    vi.stubEnv(key, value);
    expect(golfWritesEnabled()).toBe(false);
    expect(() => assertGolfWritesEnabled()).toThrow(GolfWritesPausedError);
  });

  it("also defaults the production image to paused", () => {
    const docker = readFileSync(path.join(root, "apps/web/Dockerfile"), "utf8");
    expect(docker.match(/SJ_GOLF_WRITES_ENABLED=/g)).toHaveLength(1);
    expect(docker).toMatch(/SJ_GOLF_WRITES_ENABLED=0\s*\\/);
  });

  it("opts in only the disposable Playwright fixture server", () => {
    const playwright = readFileSync(path.join(root, "apps/web/playwright.config.ts"), "utf8");
    expect(playwright).toContain('SJ_GOLF_WRITES_ENABLED: "1"');
    expect(playwright).toContain('".playwright-hub-data"');
    expect(playwright).toContain('HOSTNAME: "127.0.0.1"');
    expect(source).not.toContain("SJ_GOLF_WRITES_ENABLED=1");
  });
});
