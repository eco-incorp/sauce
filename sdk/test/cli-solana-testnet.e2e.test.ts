/**
 * `sauce simulate --chain solana-testnet` through the released Kitchen and engine in LiteSVM,
 * behind `svm/rpc-shim.ts` answering testnet's genesis hash: the rehearsal takes the engine build
 * testnet runs (devnet's), and a program compiled for the chain reads 1399811150 both as the
 * compiled `chainId` and from `ctx.chainId()` at run time — the same value, though the SDK's key
 * for the chain is 1399811151. An endpoint of the other test cluster is refused either way round:
 * a devnet endpoint for `solana-testnet`, and a testnet one for `solana-devnet`, before anything
 * else is read from it.
 *
 * GATED on the engine artifacts like every engine-executing suite, and a hard failure without them
 * in CI.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { address, lamports } from "@solana/kit";

import { nodeIo, runCli, type CliIo } from "../src/cli/run.js";
import { v12SvmEngineProgramId } from "../src/deployments/index.js";
import {
  describeSvm,
  ENGINE_SO,
  randomAddress,
  startEngine,
  type EngineHarness,
} from "./svm/engine-harness.js";
import { solanaShim, type SolanaShim } from "./svm/rpc-shim.js";

const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const TESTNET_GENESIS = "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY";
const TESTNET_URL = "http://127.0.0.1:65529/testnet";
const DEVNET_URL = "http://127.0.0.1:65529/devnet";

describeSvm("solana-testnet's chain id, rehearsed on the released engine", () => {
  let harness: EngineHarness;
  let shims: SolanaShim[] = [];
  let work: string;
  const owner = randomAddress();

  async function sauce(
    ...argv: string[]
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    let stdout = "";
    let stderr = "";
    const io: CliIo = {
      ...nodeIo(),
      canAsk: () => false,
      confirm: async () => undefined,
      stdout: (text) => void (stdout += text),
      stderr: (text) => void (stderr += text),
    };

    return { code: await runCli(argv, io), stdout, stderr };
  }

  /**
   * A program returning `body`. A staged one carries a constant too large for one transaction,
   * which a live read keeps, so the command rehearses it in a local copy with the engine build it
   * picks for the endpoint's cluster; a small one the endpoint simulates, on the bank's engine.
   */
  const program = (name: string, body: string, staged: boolean): string => {
    const path = join(work, `${name}.sauce.ts`);
    const blob = staged
      ? [
          `  const blob = hex\`${"ab".repeat(1500)}\`;`,
          "  const at = ctx.timestamp() % 1500;",
          "  require(blob.slice(at, at + 1).toBe() == 171);",
        ]
      : [];
    writeFileSync(
      path,
      ["function main(): Uint256 {", ...blob, `  return ${body};`, "}", ""].join("\n"),
    );

    return path;
  };

  beforeAll(async () => {
    harness = await startEngine(
      1_700_000_000n,
      ENGINE_SO as string,
      address(v12SvmEngineProgramId()),
    );
    work = mkdtempSync(join(tmpdir(), "sauce-solana-testnet-"));
    // The owner pays the cook and its Pot's rent, in a simulation too.
    harness.svm.airdrop(owner, lamports(5_000_000_000n));
    // Two endpoints on one bank, each saying it serves its own cluster. Each is installed before
    // the next is made, so the second hands the first's URL on to it.
    for (const [url, genesis] of [
      [TESTNET_URL, TESTNET_GENESIS],
      [DEVNET_URL, DEVNET_GENESIS],
    ] as const) {
      const shim = solanaShim(harness.svm, url, undefined, genesis);
      shim.install();
      shims.push(shim);
    }
  }, 120_000);
  afterAll(() => {
    for (const shim of shims.reverse()) shim.restore();
    shims = [];
    if (work !== undefined) rmSync(work, { recursive: true, force: true });
  });

  it.each([
    ["ctx.chainId()", "small"],
    ["chainId", "small"],
    ["ctx.chainId()", "staged"],
    ["chainId", "staged"],
  ])(
    "reads %s as 1399811150 in a %s cook",
    async (body, size) => {
      const staged = size === "staged";
      const path = program(`${size}-${body === "chainId" ? "compiled" : "running"}`, body, staged);
      const sent = shims.map((shim) => shim.sent.length);
      const simulated = await sauce(
        ...["simulate", path, "--chain", "solana-testnet", "--owner", owner],
        ...["--rpc-url", TESTNET_URL, "--json"],
      );
      expect(simulated.stderr).not.toMatch(/give a testnet endpoint|is refused/);
      if (simulated.code !== 0) throw new Error(`exit ${simulated.code}\n${simulated.stderr}`);
      expect(JSON.parse(simulated.stdout)).toMatchObject({
        ok: true,
        returned: "1399811150",
        ...(staged ? { path: "local copy (LiteSVM)" } : {}),
      });
      // A rehearsal sends nothing.
      expect(shims.map((shim) => shim.sent.length)).toEqual(sent);
    },
    120_000,
  );

  it.each([
    ["solana-testnet", DEVNET_URL, "testnet", "devnet"],
    ["solana-devnet", TESTNET_URL, "devnet", "testnet"],
  ])(
    "refuses %s against an endpoint of the other test cluster",
    async (chain, url, named, served) => {
      const handed = shims.map((shim) => shim.handed.length);
      const run = await sauce(
        ...["simulate", program("refused", "ctx.chainId()", false), "--chain", chain],
        ...["--owner", owner, "--rpc-url", url],
      );
      expect(run.code).toBe(1);
      expect(run.stderr).toContain(
        `${chain} is Solana's ${named} cluster, and the endpoint serves ${served}: give a ` +
          `${named} endpoint`,
      );
      expect(run.stderr).not.toContain(url);
      expect(shims.map((shim) => shim.handed.length)).toEqual(handed);
    },
    120_000,
  );
});
