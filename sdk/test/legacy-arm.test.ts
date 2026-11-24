/**
 * The legacy arms (SAUCE_TEST_EVM_ARM / SAUCE_TEST_SVM_ARM = an earlier engine version, `release-arm.ts`)
 * are the evidence for `alsoRunsOn`: the engine-executing suites run again on each earlier release the
 * installed row lists, in CI on every PR, one job per version. This holds the three things that make
 * that evidence whole: the variables mean only what `releaseArm` says, no engine-executing suite is
 * left off the lists in `legacy-arm.json` for any listed version, and CI runs the lists for every
 * earlier engine the row names and for no other. Nothing here starts a chain.
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

type Lists = Record<
  (typeof TARGETS)[number],
  Record<string, { run: string[]; skip: Record<string, string> }>
>;
const manifest = JSON.parse(read("sdk/test/legacy-arm.json")) as Lists;

/** The earlier engine versions the installed row lists for `target`, in its order. */
const listedFor = (target: (typeof TARGETS)[number]): readonly string[] =>
  v12ReleaseSet().alsoRunsOn?.[COMPONENT[target]] ?? [];

describe("the legacy arms", () => {
  it("releaseArm reads only its two variables and takes only a version the installed row lists", () => {
    const saved = Object.values(VARIABLE).map((name) => [name, process.env[name]] as const);
    try {
      for (const name of Object.values(VARIABLE)) delete process.env[name];
      expect([releaseArm("evm"), releaseArm("svm")]).toEqual(["default", "default"]);

      // Each target reads its own variable and no other.
      process.env.SAUCE_TEST_EVM_ARM = "1.4.0";
      expect([releaseArm("evm"), releaseArm("svm")]).toEqual(["1.4.0", "default"]);
      process.env.SAUCE_TEST_EVM_ARM = "1.3.0";
      expect([releaseArm("evm"), releaseArm("svm")]).toEqual(["1.3.0", "default"]);
      process.env.SAUCE_TEST_EVM_ARM = "default";
      process.env.SAUCE_TEST_SVM_ARM = "1.4.0";
      expect([releaseArm("evm"), releaseArm("svm")]).toEqual(["default", "1.4.0"]);

      // Any other value is refused by name, exactly as written, and does not move the other target.
      // "legacy" named the one earlier release before there were several: it is not a version.
      process.env.SAUCE_TEST_EVM_ARM = "bogus";
      expect(() => releaseArm("evm")).toThrow(/SAUCE_TEST_EVM_ARM is "bogus"/);
      process.env.SAUCE_TEST_EVM_ARM = "legacy";
      expect(() => releaseArm("evm")).toThrow(/SAUCE_TEST_EVM_ARM is "legacy"/);
      // A version the row lists for the other target only is not this one's.
      process.env.SAUCE_TEST_SVM_ARM = "1.3.0";
      expect(() => releaseArm("svm")).toThrow(
        /SAUCE_TEST_SVM_ARM is "1\.3\.0": set it to one of 1\.4\.0/,
      );
      expect(() => releaseArm("evm")).toThrow(/SAUCE_TEST_EVM_ARM is "legacy"/);
      process.env.SAUCE_TEST_EVM_ARM = "1.4.0";
      process.env.SAUCE_TEST_SVM_ARM = "Legacy";
      expect(() => releaseArm("svm")).toThrow(/SAUCE_TEST_SVM_ARM is "Legacy"/);
      expect(releaseArm("evm")).toBe("1.4.0");
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

  it("every engine-executing suite is on one list of each listed version of its target", () => {
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
        const versions = Object.fromEntries(
          Object.entries(manifest[target]).map(([version, { run, skip }]) => {
            const listed = [...run, ...Object.keys(skip)];

            return [
              version,
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

        return [target, versions];
      }),
    );
    const none = { missing: [], twice: [], notExecuting: [], noReason: [] };
    expect(found).toEqual(
      Object.fromEntries(
        TARGETS.map((target) => [
          target,
          Object.fromEntries(listedFor(target).map((version) => [version, none])),
        ]),
      ),
    );
    // The file holds a list for each version the row lists and for no other.
    for (const target of TARGETS) {
      expect([target, Object.keys(manifest[target]).sort()]).toEqual([
        target,
        [...listedFor(target)].sort(),
      ]);
    }
  });

  it("CI runs the legacy arm for every earlier engine the installed row lists, and for no other", () => {
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

    // One job per version: `legacy-<target>-<version with dashes>`.
    const expected: string[] = [];
    for (const target of TARGETS) {
      for (const version of listedFor(target)) {
        const name = `legacy-${target}-${version.replaceAll(".", "-")}`;
        expected.push(name);
        const block = job(name);
        expect({ job: name, defined: block !== undefined }).toEqual({ job: name, defined: true });
        for (const workspace of workspaces[target]) {
          expect(block).toContain(
            `run: pnpm --filter './${workspace}' test:${target}-legacy ${version}`,
          );
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
    }
    // No `legacy-` job names a version the row does not list.
    const jobs = lines
      .map((line) => /^ {2}(legacy-[\w-]+):/.exec(line)?.[1])
      .filter((name): name is string => name !== undefined);
    expect([...jobs].sort()).toEqual([...expected].sort());
    expect((needs ?? []).filter((name) => name.startsWith("legacy-")).sort()).toEqual(
      [...expected].sort(),
    );

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
