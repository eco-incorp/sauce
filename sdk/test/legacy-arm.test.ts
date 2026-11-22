/**
 * The legacy arm (SAUCE_TEST_EVM_ARM / SAUCE_TEST_SVM_ARM = legacy, `release-arm.ts`) is the evidence
 * for `alsoRunsOn`: the engine-executing suites run again on the earlier release the installed row
 * lists, in CI on every PR. This holds the three things that make that evidence whole: the variables
 * mean only what `releaseArm` says, no engine-executing suite is left off the lists in
 * `legacy-arm.json`, and CI runs the lists for every earlier engine the row names. Nothing here starts
 * a chain.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { v12ReleaseSet } from "../src/deployments/index.js";
import { releaseArm } from "./release-arm.js";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const TARGETS = ["evm", "svm"] as const;
const COMPONENT = { evm: "v12-evm", svm: "v12-svm" } as const;
const VARIABLE = { evm: "SAUCE_TEST_EVM_ARM", svm: "SAUCE_TEST_SVM_ARM" } as const;
const SOURCE = /\.[cm]?[jt]s$/;

const read = (path: string) => readFileSync(join(REPO, path), "utf8");

/** Repository-relative paths of the files under `dir` whose names match `pattern`: every depth, or
 *  only the folder's own. */
function filesUnder(dir: string, pattern: RegExp, recursive: boolean): string[] {
  return readdirSync(join(REPO, dir), { recursive, withFileTypes: true })
    .filter((entry) => entry.isFile() && pattern.test(entry.name))
    .map((entry) => relative(REPO, join(entry.parentPath, entry.name)).split(sep).join("/"))
    .sort();
}

type Lists = Record<(typeof TARGETS)[number], { run: string[]; skip: Record<string, string> }>;
const manifest = JSON.parse(read("sdk/test/legacy-arm.json")) as Lists;

describe("the legacy arm", () => {
  it("releaseArm reads only its two variables and refuses any other value", () => {
    const saved = Object.values(VARIABLE).map((name) => [name, process.env[name]] as const);
    try {
      for (const name of Object.values(VARIABLE)) delete process.env[name];
      expect([releaseArm("evm"), releaseArm("svm")]).toEqual(["default", "default"]);

      // Each target reads its own variable and no other.
      process.env.SAUCE_TEST_EVM_ARM = "legacy";
      expect([releaseArm("evm"), releaseArm("svm")]).toEqual(["legacy", "default"]);
      process.env.SAUCE_TEST_EVM_ARM = "default";
      process.env.SAUCE_TEST_SVM_ARM = "legacy";
      expect([releaseArm("evm"), releaseArm("svm")]).toEqual(["default", "legacy"]);

      // Any other value is refused by name, exactly as written, and does not move the other target.
      process.env.SAUCE_TEST_EVM_ARM = "bogus";
      expect(() => releaseArm("evm")).toThrow(/SAUCE_TEST_EVM_ARM is "bogus"/);
      expect(releaseArm("svm")).toBe("legacy");
      process.env.SAUCE_TEST_SVM_ARM = "Legacy";
      expect(() => releaseArm("svm")).toThrow(/SAUCE_TEST_SVM_ARM is "Legacy"/);
      process.env.SAUCE_TEST_SVM_ARM = "";
      expect(() => releaseArm("svm")).toThrow(/SAUCE_TEST_SVM_ARM is ""/);
    } finally {
      for (const [name, value] of saved) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }

    // Test code only: no shipped source names either variable, and no test reads one but `releaseArm`.
    const named = ["sdk/src", "mcp/src", "actions/src", "dev-tools/src"]
      .flatMap((dir) => filesUnder(dir, SOURCE, true))
      .filter((path) => /SAUCE_TEST_(?:EVM|SVM)_ARM/.test(read(path)));
    expect(named).toEqual([]);
    const readers = ["sdk/test", "mcp/test", "actions/tests", "dev-tools/test"]
      .flatMap((dir) => filesUnder(dir, SOURCE, true))
      .filter(
        (path) => path !== "sdk/test/release-arm.ts" && path !== "sdk/test/legacy-arm.test.ts",
      )
      .filter((path) => /process\.env(?:\.|\[\s*["'`])SAUCE_TEST_(?:EVM|SVM)_ARM/.test(read(path)));
    expect(readers).toEqual([]);
  });

  it("every engine-executing suite is on one legacy-arm list of its target", () => {
    // A suite starts an EVM chain through one of the harness starters, and a Solana engine through
    // `startEngine` or the exact-input harness.
    const executes = {
      evm: /\b(?:startGatedEngine|startUpgradedChain|startChain|startAnvil)\(/,
      svm: /\bstartEngine\(|from\s+["'][^"']*exact-in-harness(?:\.js)?["']/,
    };
    const suites = [
      ...filesUnder("sdk/test", /\.test\.ts$/, true),
      ...filesUnder("mcp/test", /\.test\.ts$/, false),
      ...filesUnder("actions/tests", /\.test\.ts$/, false),
    ].filter((path) => path !== "sdk/test/legacy-arm.test.ts");

    const found = Object.fromEntries(
      TARGETS.map((target) => {
        const executing = suites.filter((path) => executes[target].test(read(path)));
        const { run, skip } = manifest[target];
        const listed = [...run, ...Object.keys(skip)];

        return [
          target,
          {
            // On neither list.
            missing: executing.filter((path) => !listed.includes(path)),
            // On both, or twice on `run`.
            twice: listed.filter((path, i) => listed.indexOf(path) !== i),
            // Listed, but not a suite that exists and executes an engine for this target.
            notExecuting: listed.filter((path) => !executing.includes(path)),
            // Left off with no reason.
            noReason: Object.keys(skip).filter((path) => skip[path]!.trim() === ""),
          },
        ];
      }),
    );
    const none = { missing: [], twice: [], notExecuting: [], noReason: [] };
    expect(found).toEqual({ evm: none, svm: none });
  });

  it("CI runs the legacy arm for every earlier engine the installed row lists", () => {
    const lines = read(".github/workflows/ci.yml").split("\n");
    /** The text of one job: its key, up to the next job's. */
    const job = (name: string): string | undefined => {
      const start = lines.indexOf(`  ${name}:`);
      if (start < 0) return undefined;
      const next = lines.findIndex((line, i) => i > start && /^ {2}[\w-]+:/.test(line));

      return lines.slice(start, next < 0 ? undefined : next).join("\n");
    };
    const workspaces = { evm: ["sdk", "actions", "mcp"], svm: ["sdk"] };
    const needs = /^ {4}needs:\s*\[([^\]]*)\]/m
      .exec(job("ci") ?? "")?.[1]
      ?.split(",")
      .map((name) => name.trim());

    const row = v12ReleaseSet();
    for (const target of TARGETS) {
      const listed = row.alsoRunsOn?.[COMPONENT[target]] ?? [];
      // The arm runs one earlier engine per target (`legacyRow` takes the first).
      expect(listed.length).toBeLessThanOrEqual(1);
      if (listed.length === 0) continue;

      const name = `legacy-${target}`;
      const block = job(name);
      expect({ job: name, defined: block !== undefined }).toEqual({ job: name, defined: true });
      for (const workspace of workspaces[target]) {
        expect(block).toContain(`run: pnpm --filter './${workspace}' test:${target}-legacy`);
      }
      // The same three setup steps as `sdk-e2e`: the sync that writes src/artifacts/legacy/ is setup's.
      for (const step of [
        "actions/checkout@v4",
        "./.github/actions/setup",
        "./.github/actions/build",
      ]) {
        expect(block).toContain(`uses: ${step}`);
      }
      expect({ job: name, neededByCi: needs?.includes(name) }).toEqual({
        job: name,
        neededByCi: true,
      });
    }

    // The scripts those jobs run, as the runner's usage line has them.
    const scripts = [
      [
        "sdk",
        "test:evm-legacy",
        "node scripts/gen-embedded-sources.mjs && node scripts/run-arm-suites.mjs evm sdk",
      ],
      [
        "sdk",
        "test:svm-legacy",
        "node scripts/gen-embedded-sources.mjs && node scripts/run-arm-suites.mjs svm sdk",
      ],
      ["actions", "test:evm-legacy", "node ../sdk/scripts/run-arm-suites.mjs evm actions"],
      ["mcp", "test:evm-legacy", "node ../sdk/scripts/run-arm-suites.mjs evm mcp"],
    ] as const;
    for (const [workspace, script, command] of scripts) {
      const manifestOf = JSON.parse(read(`${workspace}/package.json`)) as {
        scripts: Record<string, string>;
      };
      expect({ workspace, script, command: manifestOf.scripts[script] }).toEqual({
        workspace,
        script,
        command,
      });
    }
  });
});
