/**
 * `sauce reclaim`: what a Solana owner's cooks left open, listed and closed, on the released Kitchen
 * and engine in LiteSVM (`svm/rpc-shim.ts`, which checks every signature it is sent and scans the
 * accounts the cluster saw for `getProgramAccounts`).
 *
 * A plan's setup is sent and its cook never is: a code buffer and a lookup table stay open. With
 * the owner's address alone, `reclaim` lists both and returns the buffer's close and the table's
 * deactivation unsigned; signed elsewhere and sent with `sauce send`, the buffer's rent comes back.
 * The table then waits out its cooldown, named with the slot it closes from, and closes after it.
 * With the owner's keypair, `reclaim --yes` does the same itself; without --yes and no terminal,
 * it sends nothing.
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
  createKeyPairSignerFromBytes,
  getBase64Encoder,
  getBase64EncodedWireTransaction,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  lamports,
  signTransaction,
  type Address,
  type KeyPairSigner,
} from "@solana/kit";

import { v12SvmEngineProgramId } from "../src/deployments/index.js";
import { jsonOf, sauce, sauceWith } from "./cli-anvil.js";
import {
  describeSvm,
  ENGINE_SO,
  randomAddress,
  startEngine,
  type EngineHarness,
} from "./svm/engine-harness.js";
import { solanaShim, type SolanaShim } from "./svm/rpc-shim.js";

const RPC_URL = "http://127.0.0.1:65531/";
const WIDE_ACCOUNTS = 40;
/** A program staged in a code buffer, naming more accounts than a transaction lists. */
const WIDE = [
  `function main(${Array.from({ length: WIDE_ACCOUNTS }, (_, i) => `a${i}: Account`).join(", ")}): Uint256 {`,
  `  const blob = hex\`${"ab".repeat(1500)}\`;`,
  "  require(blob.length == 1500);",
  "  return 7;",
  "}",
  "",
].join("\n");

interface Listing {
  readonly buffers: ReadonlyArray<{ codeBuffer: string; finalized: boolean; lamports: string }>;
  readonly lookupTables: ReadonlyArray<{
    address: string;
    state: string;
    closableFromSlot?: string;
  }>;
  readonly transactions: ReadonlyArray<{ what: string; transaction: string; feePayer: string }>;
}

describeSvm("sauce reclaim: a Solana owner's leftover code buffers and lookup tables", () => {
  let harness: EngineHarness;
  let shim: SolanaShim;
  let work: string;
  let wide: string;
  let owner: { path: string; signer: KeyPairSigner };
  const flags = Array.from({ length: WIDE_ACCOUNTS }, (_, i) => [
    "--account",
    `a${i}=${randomAddress()}`,
  ]).flat();

  const sign = (transactions: Listing["transactions"]): Promise<string[]> =>
    Promise.all(
      transactions.map(async ({ transaction }) =>
        getBase64EncodedWireTransaction(
          await signTransaction(
            [owner.signer.keyPair],
            getTransactionDecoder().decode(getBase64Encoder().encode(transaction)),
          ),
        ),
      ),
    );
  /** Sends a plan's setup and leaves it there: a buffer and a table open, the cook never sent. The
   *  cursor the plan would carry on from. */
  const abandonedSetup = async (salt: string): Promise<string> => {
    const step = jsonOf(
      await sauce(
        ...["tx", wide, "--chain", "solana", "--owner", owner.signer.address, "--salt", salt],
        ...flags,
        ...["--rpc-url", RPC_URL],
      ),
    ) as unknown as Listing & { step: string; cursor: string };
    expect(step.step).toBe("setup");
    const sent = await sauce(
      ...["send", ...(await sign(step.transactions)), "--cursor", step.cursor],
      ...["--rpc-url", RPC_URL, "--json"],
    );
    const out = jsonOf(sent) as { ok: boolean; next: { cursor: string } };
    expect(out.ok).toBe(true);

    return out.next.cursor;
  };
  const listing = async (): Promise<Listing> =>
    jsonOf(
      await sauce(
        ...["reclaim", "--chain", "solana", "--owner", owner.signer.address],
        ...["--rpc-url", RPC_URL, "--json"],
      ),
    ) as unknown as Listing;

  beforeAll(async () => {
    harness = await startEngine(
      1_700_000_000n,
      ENGINE_SO as string,
      address(v12SvmEngineProgramId()),
    );
    work = mkdtempSync(join(tmpdir(), "sauce-reclaim-"));
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const seed = privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32);
    const pub = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
    const bytes = new Uint8Array([...seed, ...pub]);
    const path = join(work, "owner.json");
    writeFileSync(path, JSON.stringify([...bytes]));
    owner = { path, signer: await createKeyPairSignerFromBytes(bytes) };
    harness.svm.airdrop(owner.signer.address, lamports(50_000_000_000n));
    wide = join(work, "wide.sauce.ts");
    writeFileSync(wide, WIDE);
    // The bank cannot list its accounts: a scan looks through every account a sent transaction names.
    shim = solanaShim(harness.svm, RPC_URL, () => [
      ...new Set(
        shim.sent.flatMap(
          (tx) =>
            (
              getCompiledTransactionMessageDecoder().decode(tx.messageBytes) as {
                staticAccounts: readonly Address[];
              }
            ).staticAccounts,
        ),
      ),
    ]);
    shim.install();
  }, 120_000);
  afterAll(() => {
    shim?.restore();
    if (work !== undefined) rmSync(work, { recursive: true, force: true });
  });

  it("lists what a plan left open, and closes it with transactions signed elsewhere", async () => {
    const cursor = await abandonedSetup("left-open");
    const found = await listing();
    expect(found.buffers).toHaveLength(1);
    expect(found.buffers[0]!.finalized).toBe(true);
    expect(found.lookupTables).toHaveLength(1);
    expect(found.lookupTables[0]!.state).toBe("active");
    expect(found.transactions.map((tx) => tx.what)).toEqual([
      `closing code buffer ${found.buffers[0]!.codeBuffer}`,
      `deactivating lookup table ${found.lookupTables[0]!.address}`,
    ]);
    expect(found.transactions.every((tx) => tx.feePayer === owner.signer.address)).toBe(true);

    const before = harness.svm.getBalance(owner.signer.address) ?? 0n;
    const sent = await sauce(
      ...["send", ...(await sign(found.transactions)), "--rpc-url", RPC_URL, "--json"],
    );
    expect(jsonOf(sent).ok).toBe(true);
    const buffer = address(found.buffers[0]!.codeBuffer);
    expect(harness.svm.getAccount(buffer).exists).toBe(false);
    // The plan it was staged for, past the blockhash of the cook it handed out, says its buffer is
    // gone and its cook never ran, rather than done.
    harness.svm.warpToSlot(harness.svm.getClock().slot + 200n);
    const gone = await sauce("send", "--cursor", cursor, "--rpc-url", RPC_URL, "--json");
    expect(gone.code).toBe(1);
    expect(gone.stdout + gone.stderr).toMatch(/is gone, and the plan's cook never ran/);
    // The buffer's rent came back, less two transactions' fees.
    expect((harness.svm.getBalance(owner.signer.address) ?? 0n) - before).toBe(
      BigInt(found.buffers[0]!.lamports) - 10_000n,
    );

    // The table waits out its cooldown, and says until when.
    const waiting = await listing();
    expect(waiting.buffers).toHaveLength(0);
    expect(waiting.lookupTables[0]).toMatchObject({ state: "deactivating" });
    expect(waiting.transactions).toHaveLength(0);
    harness.svm.warpToSlot(BigInt(waiting.lookupTables[0]!.closableFromSlot!) + 1n);
    const closable = await listing();
    expect(closable.lookupTables[0]!.state).toBe("closable");
    expect(closable.transactions.map((tx) => tx.what)).toEqual([
      `closing lookup table ${closable.lookupTables[0]!.address}`,
    ]);
    expect(
      jsonOf(
        await sauce("send", ...(await sign(closable.transactions)), "--rpc-url", RPC_URL, "--json"),
      ).ok,
    ).toBe(true);
    expect(harness.svm.getAccount(address(closable.lookupTables[0]!.address)).exists).toBe(false);
    expect((await listing()).lookupTables).toHaveLength(0);
  }, 300_000);

  it("closes them itself with the owner's keypair, once agreed to", async () => {
    await abandonedSetup("keyed");
    const argv = [
      ...["reclaim", "--chain", "solana", "--keypair", owner.path, "--keep-tables"],
      ...["--rpc-url", RPC_URL],
    ];
    // No terminal to ask on, and no --yes: nothing is sent.
    const asked = await sauceWith({ canAsk: () => false }, ...argv);
    expect(asked.code).toBe(1);
    expect(asked.stderr).toMatch(/nothing was sent: this run needs an approval/);
    const sent = shim.sent.length;
    expect((await listing()).buffers).toHaveLength(1);
    expect(shim.sent.length).toBe(sent);

    const done = await sauce(...argv, "--yes", "--json");
    const out = jsonOf(done) as { sent: Array<{ what: string; status: string }> };
    expect(out.sent.map((one) => one.status)).toEqual(["success"]);
    expect(out.sent[0]!.what).toMatch(/^closing code buffer /);
    // --keep-tables left the table for later cooks.
    const left = await listing();
    expect(left.buffers).toHaveLength(0);
    expect(left.lookupTables.map((table) => table.state)).toEqual(["active"]);
  }, 300_000);
});
