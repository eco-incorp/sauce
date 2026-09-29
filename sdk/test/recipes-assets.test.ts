/**
 * The assertions in `verify.compile.test.ts`'s neighbourhood that need no compiler at all.
 *
 * They are about the SHIPPED ASSETS: the recipe the SDK hands partners must be the file on disk, its
 * token write must be the SDK's one SafeERC20 lowering, and the SDK's resolver must serve the ABI
 * that file imports. The second one is load-bearing —
 * `src/artifacts/` is generated and gitignored, and a dozen suites fail with nothing naming the cause
 * when it is absent. Whether those assets COMPILE to the pinned program is `verify.compile.test.ts`.
 */
import { readFileSync } from "fs";
import { join, resolve } from "path";

import { resolveSdkModule } from "../src/embedded/resolve.js";
import { settleSource } from "../src/recipes/index.js";
import { safeTransferStatements } from "../src/token/safe.js";

describe("shipped recipe assets", () => {
  it("settleSource() returns the exact on-disk settle.sauce.ts", () => {
    const onDisk = readFileSync(resolve(process.cwd(), "src/recipes/settle.sauce.ts"), "utf-8");
    expect(settleSource()).toBe(onDisk);
  });

  // `settle.sauce.ts` is a static asset partners compile themselves, so it cannot call the generator
  // at compile time; it carries the generator's output instead. This is what keeps that output and
  // `token/safe.ts` one mechanism: a change to either side fails here, before it changes the pin.
  it("the sweep's transfer is exactly token/safe.ts's SafeERC20 transfer, and the only write", () => {
    const emitted = safeTransferStatements(
      "sweep_",
      "tokens[i]",
      { local: "recipient" },
      { local: "bal" },
    );
    const body = emitted.map((line) => `      ${line}`).join("\n");

    expect(settleSource()).toContain(`    if (bal > 0) {\n${body}\n    }\n`);
    expect(settleSource().match(/evm\.call\(/g)).toHaveLength(1);
    expect(settleSource()).not.toMatch(/\.(transfer|transferFrom|approve)\(/);
  });

  it("resolveSdkModule serves the program's ./artifacts/IERC20.json import, as synced", () => {
    const served = resolveSdkModule("./artifacts/IERC20.json");
    expect(served).toBeDefined();
    const onDisk = readFileSync(join(process.cwd(), "src", "artifacts", "IERC20.json"), "utf-8");
    expect(JSON.parse(new TextDecoder().decode(served))).toEqual(JSON.parse(onDisk));
  });
});
