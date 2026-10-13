/**
 * `sauce reclaim`: what a Solana owner's cooks left open, listed and closed, on the released Kitchen
 * and engine in LiteSVM (`svm/rpc-shim.ts`, which checks every signature it is sent and scans the
 * accounts the cluster saw for `getProgramAccounts`).
 *
 * A plan's setup is sent and its cook never is: a code buffer and a lookup table stay open. While
 * the cook the plan handed out can still land, `reclaim` lists both in use and closes neither, and
 * a plan given with --keep keeps both past that. Then, with the owner's address alone, it returns
 * the buffer's close and the table's deactivation unsigned; signed elsewhere and sent with
 * `sauce send`, the buffer's rent comes back. The table then waits out its cooldown, named with the
 * slot it closes from, and closes after it. With the owner's keypair, `reclaim --yes` leaves a
 * handed-out cook's buffer alone, so the cook lands, then closes it; without --yes and no terminal,
 * it sends nothing. An endpoint that will not scan the lookup-table program finds no table, and
 * says so, and a table named with --lookup-table is found all the same. A close the cluster
 * refuses leaves the others to go.
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

import { ADDRESS_LOOKUP_TABLE_PROGRAM_ADDRESS } from "@solana-program/address-lookup-table";

import { decodeCursor, readPlanTx } from "../src/cli/svm-plan.js";
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

interface Use {
  readonly inUse?: boolean;
  readonly freeFromSlot?: string;
  readonly kept?: boolean;
}

interface Listing {
  readonly buffers: ReadonlyArray<
    { codeBuffer: string; finalized: boolean; lamports: string } & Use
  >;
  readonly lookupTables: ReadonlyArray<
    {
      address: string;
      state: string;
      closableFromSlot?: string;
    } & Use
  >;
  readonly transactions: ReadonlyArray<{ what: string; transaction: string; feePayer: string }>;
}

interface Step {
  readonly step: string;
  readonly cursor: string;
  readonly transactions: Listing["transactions"];
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
   *  step the plan hands out next: its cook. */
  const abandonedSetup = async (salt: string): Promise<Step> => {
    const step = jsonOf(
      await sauce(
        ...["tx", wide, "--chain", "solana", "--owner", owner.signer.address, "--salt", salt],
        ...flags,
        ...["--rpc-url", RPC_URL],
      ),
    ) as unknown as Step;
    expect(step.step).toBe("setup");
    const sent = await sauce(
      ...["send", ...(await sign(step.transactions)), "--cursor", step.cursor],
      ...["--rpc-url", RPC_URL, "--json"],
    );
    const out = jsonOf(sent) as { ok: boolean; next: Step };
    expect(out.ok).toBe(true);
    expect(out.next.step).toBe("cook");

    return out.next;
  };
  const listing = async (...more: string[]): Promise<Listing> =>
    jsonOf(
      await sauce(
        ...["reclaim", "--chain", "solana", "--owner", owner.signer.address, ...more],
        ...["--rpc-url", RPC_URL, "--json"],
      ),
    ) as unknown as Listing;
  /** Runs `run` with the endpoint answering a `method` request that `when` picks with `answer`. */
  const answering = async <T>(
    method: string,
    when: (params: unknown[]) => boolean,
    answer: Record<string, unknown>,
    run: () => Promise<T>,
  ): Promise<T> => {
    const shimmed = globalThis.fetch;
    globalThis.fetch = (async (input: unknown, init?: { body?: string }) => {
      if (String(input) === RPC_URL && init?.body !== undefined) {
        const asked = JSON.parse(init.body) as { id: unknown; method: string; params: unknown[] };
        if (asked.method === method && when(asked.params)) {
          return Response.json({ jsonrpc: "2.0", id: asked.id, ...answer });
        }
      }

      return shimmed(input as string, init as RequestInit);
    }) as typeof fetch;
    try {
      return await run();
    } finally {
      globalThis.fetch = shimmed;
    }
  };
  /** Past the slot each of `found`'s buffers and tables in use is free from. */
  const warpPast = (found: Listing): void => {
    const free = [...found.buffers, ...found.lookupTables].flatMap((one) =>
      one.freeFromSlot === undefined ? [] : [BigInt(one.freeFromSlot)],
    );
    expect(free.length).toBeGreaterThan(0);
    harness.svm.warpToSlot(free.reduce((a, b) => (b > a ? b : a)));
  };

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
    const { cursor } = await abandonedSetup("left-open");
    // The cook the plan handed out can still land: its buffer and table are in use, and left open.
    const fresh = await sauce(
      ...["reclaim", "--chain", "solana", "--owner", owner.signer.address],
      ...["--rpc-url", RPC_URL, "--json"],
    );
    const inUse = jsonOf(fresh) as unknown as Listing;
    expect(inUse.buffers).toHaveLength(1);
    expect(inUse.buffers[0]).toMatchObject({ inUse: true });
    expect(inUse.lookupTables).toHaveLength(1);
    expect(inUse.lookupTables[0]).toMatchObject({ state: "active", inUse: true });
    expect(inUse.transactions).toHaveLength(0);
    expect(fresh.stderr).toMatch(
      new RegExp(
        `code buffer ${inUse.buffers[0]!.codeBuffer} is left open: a transaction named it ` +
          `lately, and a cook built for it may still land; reclaim from slot ` +
          `${inUse.buffers[0]!.freeFromSlot} `,
      ),
    );
    // Past that, a plan given to keep keeps both.
    warpPast(inUse);
    const kept = await listing("--keep", cursor);
    expect(kept.buffers[0]).toMatchObject({ inUse: true, kept: true });
    expect(kept.lookupTables[0]).toMatchObject({ inUse: true, kept: true });
    expect(kept.transactions).toHaveLength(0);

    const found = await listing();
    expect(found.buffers).toHaveLength(1);
    expect(found.buffers[0]!.inUse).toBeUndefined();
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
    const cook = await abandonedSetup("keyed");
    const argv = [
      ...["reclaim", "--chain", "solana", "--keypair", owner.path, "--keep-tables"],
      ...["--rpc-url", RPC_URL],
    ];
    // The cook handed out can still land: --yes closes nothing, and the cook lands after it.
    const early = await sauce(...argv, "--yes", "--json");
    expect(early.code).toBe(0);
    expect((jsonOf(early) as unknown as Listing).transactions).toHaveLength(0);
    expect(early.stderr).toMatch(/there is nothing to close now/);
    const cooked = jsonOf(
      await sauce(
        ...["send", ...(await sign(cook.transactions)), "--cursor", cook.cursor],
        ...["--rpc-url", RPC_URL, "--json"],
      ),
    ) as { ok: boolean; sent: Array<{ returned?: string }> };
    expect(cooked.ok).toBe(true);
    expect(cooked.sent.map((one) => one.returned)).toContain("7");
    warpPast(await listing());

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

  it("finds no table where the endpoint will not scan for them, says so, and finds one named", async () => {
    const cook = await abandonedSetup("unscanned");
    const table = decodeCursor(cook.cursor).table!.address!;
    warpPast(await listing());
    const noScan = <T>(run: () => Promise<T>) =>
      answering(
        "getProgramAccounts",
        (params) => params[0] === ADDRESS_LOOKUP_TABLE_PROGRAM_ADDRESS,
        { error: { code: -32603, message: "this endpoint does not scan that program" } },
        run,
      );
    const argv = [
      ...["reclaim", "--chain", "solana", "--owner", owner.signer.address],
      ...["--rpc-url", RPC_URL, "--json"],
    ];
    const unscanned = await noScan(() => sauce(...argv));
    expect((jsonOf(unscanned) as unknown as Listing).lookupTables).toEqual([]);
    expect(unscanned.stderr).toMatch(
      /the endpoint did not scan the lookup-table program, so no table was found: name one with --lookup-table <address>/,
    );
    // Named, it is found all the same, and no scan is missed.
    const named = await noScan(() => sauce(...argv, "--lookup-table", table));
    const found = jsonOf(named) as unknown as Listing;
    expect(found.lookupTables).toEqual([
      expect.objectContaining({ address: table, state: "active" }),
    ]);
    expect(found.transactions.map((tx) => tx.what)).toContain(`deactivating lookup table ${table}`);
    expect(named.stderr).not.toMatch(/did not scan/);
  }, 300_000);

  it("sends every close but one the cluster refuses, and says which", async () => {
    await abandonedSetup("refused-close");
    warpPast(await listing());
    const run = await answering(
      "simulateTransaction",
      (params) =>
        readPlanTx(getTransactionDecoder().decode(getBase64Encoder().encode(String(params[0]))))
          ?.what === "closing the code buffer",
      {
        result: {
          context: { slot: 1 },
          value: {
            err: { InstructionError: [0, { Custom: 1 }] },
            logs: ["Program log: refused here"],
            accounts: null,
            unitsConsumed: 0,
            returnData: null,
          },
        },
      },
      () =>
        sauce(
          ...["reclaim", "--chain", "solana", "--keypair", owner.path, "--yes"],
          ...["--rpc-url", RPC_URL, "--json"],
        ),
    );
    expect(run.code).toBe(1);
    const out = JSON.parse(run.stdout) as {
      buffers: Listing["buffers"];
      sent: Array<{ what: string; status: string; reason?: string }>;
    };
    const [refused, ...rest] = out.sent;
    expect(refused!.what).toMatch(/^closing code buffers? /);
    expect(refused).toMatchObject({
      status: "failed",
      reason: expect.stringMatching(/^not sent: /),
    });
    // The tables' deactivations went all the same.
    expect(rest.length).toBeGreaterThan(0);
    expect(
      rest.every((one) => one.status === "success" && one.what.startsWith("deactivating")),
    ).toBe(true);
    for (const buffer of out.buffers) {
      expect(harness.svm.getAccount(address(buffer.codeBuffer)).exists).toBe(true);
    }
  }, 300_000);
});
