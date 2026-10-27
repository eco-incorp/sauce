/**
 * The SDK releases a refusal of a Pot names (`cli/pots.ts#pairedSdkReleases`) are the changelog's
 * "Which versions work together" table, parsed and validated when the SDK is built
 * (`scripts/lib/sdk-releases.mjs`, written by `scripts/gen-embedded-sources.mjs` into
 * `src/embedded/sdk-releases.generated.ts`) and read from memory at run time: no module the SDK
 * ships reads the docs. Every released row is kept exactly as the table gives it; the Unreleased
 * row names no version, and none is made up for it.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { sdkReleasesOf } from "../scripts/lib/sdk-releases.mjs";
import { SDK_RELEASES } from "../src/embedded/sdk-releases.generated.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SDK = resolve(HERE, "..");
const CHANGELOG = readFileSync(resolve(SDK, "..", "docs", "changelog.md"), "utf8");

/** Every TypeScript source the SDK ships, as paths under `src/`. */
function sources(dir = join(SDK, "src")): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);

    return name.endsWith(".ts") ? [path] : [];
  });
}

/** A changelog whose version table is `table`. */
const withTable = (table: string): string =>
  `# Changelog\n\n## Which versions work together\n\n${table}\n\n## SDK Unreleased\n`;

const HEADER =
  "| SDK | Compiler | v12-evm | kitchen-evm | v12-svm | kitchen-svm |\n| --- | --- | --- | --- | --- | --- |";
const ROW = "| 0.99.9 | 2.5.0 | 1.2.0 | 1.2.0 | 1.3.0 | 1.0.0 |";
const RELEASE_0_99_9 = {
  sdk: "0.99.9",
  compiler: "2.5.0",
  "v12-evm": "1.2.0",
  "kitchen-evm": "1.2.0",
  "v12-svm": "1.3.0",
  "kitchen-svm": "1.0.0",
};

describe("the SDK releases a refusal names", () => {
  it("are not read from the docs at run time", () => {
    const readers = sources()
      .filter((path) => !path.endsWith(".generated.ts"))
      .filter((path) => readFileSync(path, "utf8").includes("changelog.md"));
    expect(readers.map((path) => path.slice(SDK.length + 1))).toEqual([]);
  });

  it("are the changelog table's released rows, exactly as it gives them", () => {
    expect(SDK_RELEASES).toEqual(sdkReleasesOf(CHANGELOG));
    expect(SDK_RELEASES).toContainEqual(RELEASE_0_99_9);
    expect(SDK_RELEASES).toContainEqual({
      sdk: "0.99.0",
      compiler: "2.2.0",
      "v12-evm": "0.8.0",
      "kitchen-evm": "0.5.0",
      "v12-svm": "0.8.0",
      "kitchen-svm": "0.4.0",
    });
    // The Unreleased row is not a version, and none is given it.
    const sdks = SDK_RELEASES.map((row) => row.sdk!);
    expect(sdks.every((sdk) => /^\d+\.\d+\.\d+$/.test(sdk))).toBe(true);
    expect(new Set(sdks).size).toBe(sdks.length);
  });

  it("refuse a table the build cannot read, naming what is wrong", () => {
    expect(
      sdkReleasesOf(
        withTable(`${HEADER}\n| Unreleased | 2.6.0 | 1.3.0 | 1.3.0 | 1.4.0 | 1.1.0 |\n${ROW}`),
      ),
    ).toEqual([RELEASE_0_99_9]);
    expect(() => sdkReleasesOf("# Changelog\n\nNo table here.\n")).toThrow(
      /no "## Which versions work together" section/,
    );
    expect(() =>
      sdkReleasesOf(
        withTable("| SDK | Compiler | v12-evm |\n| --- | --- | --- |\n| 0.99.9 | 2.5.0 | 1.2.0 |"),
      ),
    ).toThrow(/columns SDK, Compiler, v12-evm; it needs SDK, Compiler, v12-evm, kitchen-evm/);
    expect(() =>
      sdkReleasesOf(withTable(`${HEADER}\n| 0.99.9 | 2.5 | 1.2.0 | 1.2.0 | 1.3.0 | 1.0.0 |`)),
    ).toThrow(/0\.99\.9: its Compiler cell, "2\.5", is not a version/);
    expect(() =>
      sdkReleasesOf(withTable(`${HEADER}\n| next | 2.5.0 | 1.2.0 | 1.2.0 | 1.3.0 | 1.0.0 |`)),
    ).toThrow(/SDK cell, "next", is neither a version nor Unreleased/);
    expect(() => sdkReleasesOf(withTable(`${HEADER}\n${ROW}\n${ROW}`))).toThrow(
      /0\.99\.9 has two rows/,
    );
    expect(() => sdkReleasesOf(withTable(`${HEADER}\n| 0.99.9 | 2.5.0 | 1.2.0 |`))).toThrow(
      /0\.99\.9: 3 cells, and the table has 6 columns/,
    );
  });

  it("refuse a table row they would skip, rather than drop a released SDK without saying so", () => {
    const row = (sdk: string, lead = "| ") =>
      `${lead}${sdk} | 2.5.0 | 1.2.0 | 1.2.0 | 1.3.0 | 1.0.0 |`;
    const notARow = /the line "0\.99\.9 \| 2\.5\.0[^"]*" in the version table is not a row/;
    // A released row that lost its leading pipe, between rows that kept theirs, and as the last.
    expect(() =>
      sdkReleasesOf(
        withTable([HEADER, row("0.99.10"), row("0.99.9", ""), row("0.99.8")].join("\n")),
      ),
    ).toThrow(notARow);
    expect(() =>
      sdkReleasesOf(withTable([HEADER, row("0.99.10"), row("0.99.9", "")].join("\n"))),
    ).toThrow(notARow);
    // A row a blank line cuts off from the table, which a renderer shows as text.
    expect(() =>
      sdkReleasesOf(withTable([HEADER, row("0.99.10"), "", row("0.99.9")].join("\n"))),
    ).toThrow(/the row "\| 0\.99\.9 \| 2\.5\.0[^"]*" follows a blank line/);
  });
});
