/**
 * `sauce run --chain solana --remaining … --lookup-table …`, executed: a program that CPIs with the
 * accounts it reads after its named ones (`svm.remainingAccounts()`), the way a Jupiter route's
 * instruction will be carried, cooked through the released Kitchen and engine in LiteSVM behind
 * the JSON-RPC shim (`svm/rpc-shim.ts`). The Pot signs its CPI as a remaining account, through the
 * Kitchen; a lookup table, fabricated active in the bank (`fabricateAlt`), compresses the
 * transaction. No cluster, no network.
 *
 * GATED on the engine artifacts like every engine-executing suite, and a hard failure without them
 * in CI.
 */
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  address,
  getAddressDecoder,
  getCompiledTransactionMessageDecoder,
  lamports,
  type Address,
} from "@solana/kit";

import { nodeIo, runCli, type CliIo } from "../src/cli/run.js";
import { v12SvmEngineProgramId, v12SvmKitchenProgramId } from "../src/deployments/index.js";
import { derivePotPda } from "../src/svm/index.js";
import {
  describeSvm,
  ENGINE_SO,
  fabricateAlt,
  randomAddress,
  setMint,
  setTokenAccount,
  startEngine,
  TOKEN_PROGRAM,
  tokenAmount,
  type EngineHarness,
} from "./svm/engine-harness.js";
import { solanaShim, type SolanaShim } from "./svm/rpc-shim.js";

const RPC_URL = "http://127.0.0.1:65533/";
const KITCHEN = address(v12SvmKitchenProgramId());

/** SPL Token's `Transfer` (3) of `amount`, its accounts the program's remaining ones: the source,
 *  the destination, and the authority, the Pot. */
const PASS_THROUGH = `function main(tokenProgram: Account, amount: Uint256) {
  const rest = svm.remainingAccounts();
  const transfer = hex\`03\`;
  svm.call(tokenProgram, rest, transfer.concat(amount.toBytesLe(8)));
}
`;

describeSvm("sauce run on Solana with remaining accounts and a lookup table", () => {
  let harness: EngineHarness;
  let shim: SolanaShim;
  let work: string;
  let keypair: string;
  let program: string;
  let owner: Address;
  let pot: Address;
  const mint = randomAddress();

  async function sauce(...argv: string[]) {
    let stdout = "";
    let stderr = "";
    const io: CliIo = {
      ...nodeIo(),
      confirm: async () => undefined,
      stdout: (text) => void (stdout += text),
      stderr: (text) => void (stderr += text),
    };

    return { code: await runCli(argv, io), stdout, stderr };
  }

  beforeAll(async () => {
    harness = await startEngine(
      1_700_000_000n,
      ENGINE_SO as string,
      address(v12SvmEngineProgramId()),
    );
    setMint(harness, mint, 6);
    work = mkdtempSync(join(tmpdir(), "sauce-solana-remaining-"));
    // A throwaway keypair, the owner of the Pot the cook runs on.
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const seed = privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32);
    const pub = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
    keypair = join(work, "owner.json");
    writeFileSync(keypair, JSON.stringify([...seed, ...pub]));
    owner = address(getAddressDecoder().decode(new Uint8Array(pub)));
    harness.svm.airdrop(owner, lamports(5_000_000_000n));
    pot = (await derivePotPda(KITCHEN, owner, new Uint8Array(32))).address;
    program = join(work, "pass-through.sauce.ts");
    writeFileSync(program, PASS_THROUGH);
    shim = solanaShim(harness.svm, RPC_URL);
    shim.install();
    const deployed = await sauce(
      ...["pot", "--deploy", "--chain", "solana", "--rpc-url", RPC_URL, "--keypair", keypair],
    );
    expect(deployed.code).toBe(0);
  }, 120_000);

  afterAll(() => {
    shim?.restore();
    if (work !== undefined) rmSync(work, { recursive: true, force: true });
  });

  const run = (source: Address, dest: Address, extra: readonly string[] = []) =>
    sauce(
      ...["run", program, "--chain", "solana", "--rpc-url", RPC_URL, "--keypair", keypair],
      ...["--account", `tokenProgram=${TOKEN_PROGRAM}`],
      ...["--remaining", `${source},writable`, "--remaining", `${dest},writable`],
      ...["--remaining", "pot,signer", ...extra, "--json", "--args", "400"],
    );

  it("CPIs with the accounts given after the named ones, the Pot signing through the Kitchen", async () => {
    const source = setTokenAccount(harness, randomAddress(), mint, pot, 1_000n);
    const dest = setTokenAccount(harness, randomAddress(), mint, randomAddress(), 0n);

    const done = await run(source, dest);
    expect(done.stderr).not.toMatch(/error/i);
    expect(done.code).toBe(0);
    expect(tokenAmount(harness, source)).toBe(600n);
    expect(tokenAmount(harness, dest)).toBe(400n);
  }, 120_000);

  it("compresses the cook's accounts with a lookup table read from the cluster", async () => {
    const source = setTokenAccount(harness, randomAddress(), mint, pot, 1_000n);
    const dest = setTokenAccount(harness, randomAddress(), mint, randomAddress(), 0n);
    const [table] = Object.keys(fabricateAlt(harness, [source, dest, TOKEN_PROGRAM]));
    const before = shim.sent.length;

    const done = await run(source, dest, ["--lookup-table", table!]);
    expect(done.code).toBe(0);
    expect(tokenAmount(harness, dest)).toBe(400n);
    // The cook landed as a v0 transaction that names the table.
    const cook = shim.sent.slice(before).at(-1)!;
    const message = getCompiledTransactionMessageDecoder().decode(cook.messageBytes);
    expect(message.version).toBe(0);
    expect(
      (
        message as { addressTableLookups?: { lookupTableAddress: string }[] }
      ).addressTableLookups?.map((lookup) => lookup.lookupTableAddress),
    ).toEqual([table]);
  }, 120_000);

  it("refuses remaining accounts for a program that reads none, and --remaining on EVM", async () => {
    const plain = join(work, "plain.sauce.ts");
    writeFileSync(plain, "function main(amount: Uint256): Uint256 { return amount; }\n");
    const refused = await sauce(
      ...["run", plain, "--chain", "solana", "--rpc-url", RPC_URL, "--keypair", keypair],
      ...["--remaining", "pot", "--args", "1"],
    );
    expect(refused.code).toBe(2);
    expect(refused.stderr).toMatch(/reads no account after its named ones/);

    const evm = await sauce(
      ...["tx", plain, "--chain", "base", "--owner", "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"],
      ...["--value", "0", "--remaining", "pot", "--args", "1"],
    );
    expect(evm.code).toBe(2);
    expect(evm.stderr).toMatch(/--remaining names a Solana program.s accounts/);
  }, 120_000);
});
