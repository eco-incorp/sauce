/**
 * The client's own instruction bytes, executed on the REAL gated engine.
 *
 * `SauceSvmClient` builds a kitchen cook now, because a released engine refuses anything else — and
 * until this suite existed nothing checked that claim: `client-ensure-lookup-table` constructs a
 * client but never runs a program with it, so the cook could have been malformed in any of the ways
 * the harnesses had to be fixed (a missing `pot`, the fee accounts in the wrong order, an absent
 * `max_execution_fee`) and every test would still have passed.
 *
 * The seam is `globalThis.fetch`, as in the sibling client suite: `simulateTransaction` decodes the
 * wire transaction the client actually signed and feeds it to LiteSVM, which is running the real
 * `kitchen.so` and `engine-devnet.so`. So the assertion is not "the client built something
 * plausible" — it is "the gate accepted what the client built".
 */
import {
  address,
  getAddressDecoder,
  getBase64Encoder,
  getTransactionDecoder,
  lamports,
  some,
  type Address,
} from "@solana/kit";
import { getAddressLookupTableEncoder } from "@solana-program/address-lookup-table";
import type { AccountManifest } from "sauce-compiler";
import {
  buildComputeBudgetPrepend,
  buildExecuteInstruction,
  buildHeapFramePrepend,
  buildSetExecutionFeeInstruction,
  createSauceSvmClient,
  deriveProgramDataPda,
  derivePotPda,
  ENGINE_FAULTS,
} from "../../src/svm/index.js";
import {
  HARNESS_POT_SALT,
  buildExecuteTransactionForHarness,
  describeSvm,
  expectFail,
  sendInstructions,
  sendSigned,
  stageProgram,
  startEngine,
  toBigInt,
} from "./engine-harness.js";
import type { EngineHarness } from "./engine-harness.js";

import { compileSvm } from "./rs-compile.js";

const RPC_URL = "http://127.0.0.1:65535/";

/** Compile a scalar return using the current engine ABI, including its required boxing. */
const PROGRAM = compileSvm("function main(): Uint256 { return 42n; }").bytecode;

/**
 * Answers the two methods `simulate` makes, backing `simulateTransaction` with LiteSVM.
 *
 * litesvm takes the raw wire bytes, so the client's transaction is executed exactly as signed —
 * no re-encoding, and no opportunity for this stub to quietly fix a malformed instruction.
 */
const fetchStub = (harness: EngineHarness): { install: () => void; restore: () => void } => {
  const original = globalThis.fetch;
  const stub = async (_url: unknown, init: { body: string }): Promise<unknown> => {
    const { id, method, params } = JSON.parse(init.body) as {
      id: number;
      method: string;
      params: unknown[];
    };

    if (method === "getLatestBlockhash") {
      return Response.json({
        id,
        jsonrpc: "2.0",
        result: {
          context: { apiVersion: "2.0.0", slot: 100 },
          value: { blockhash: harness.svm.latestBlockhash(), lastValidBlockHeight: 1_000_000 },
        },
      });
    }

    if (method === "simulateTransaction") {
      const wire = getBase64Encoder().encode(params[0] as string);
      // Decoded from the wire bytes the client signed, not rebuilt — so what runs is what it sent.
      const result = harness.svm.sendTransaction(
        getTransactionDecoder().decode(new Uint8Array(wire)),
      ) as {
        err?: () => unknown;
        logs?: () => string[];
        returnData?: () => { data(): Uint8Array };
      };
      const failed = typeof result.err === "function" ? result.err.call(result) : undefined;
      // Only a landed transaction's metadata is read: building it from a failed one is what aborts
      // litesvm natively (`kitchen-bench.ts`).
      const returned =
        failed === undefined && typeof result.returnData === "function"
          ? result.returnData.call(result).data()
          : new Uint8Array();

      return Response.json({
        id,
        jsonrpc: "2.0",
        result: {
          context: { apiVersion: "2.0.0", slot: 100 },
          value: {
            accounts: null,
            err: failed ? String(failed) : null,
            logs: typeof result.logs === "function" ? result.logs.call(result) : [],
            returnData:
              returned.length === 0
                ? null
                : {
                    programId: harness.programId,
                    data: [Buffer.from(returned).toString("base64"), "base64"],
                  },
            unitsConsumed: 0,
          },
        },
      });
    }

    if (method === "getAccountInfo") {
      const account = harness.svm.getAccount(params[0] as Address);

      return Response.json({
        id,
        jsonrpc: "2.0",
        result: {
          context: { apiVersion: "2.0.0", slot: 100 },
          value: account.exists
            ? {
                data: [Buffer.from(account.data).toString("base64"), "base64"],
                executable: account.executable,
                lamports: Number(account.lamports),
                owner: account.programAddress,
                rentEpoch: 0,
                space: account.data.length,
              }
            : null,
        },
      });
    }

    throw new Error(`the client made an unexpected RPC call: ${method}`);
  };

  return {
    install: () => {
      globalThis.fetch = stub as unknown as typeof fetch;
    },
    restore: () => {
      globalThis.fetch = original;
    },
  };
};

describeSvm("SauceSvmClient against the gated engine", () => {
  let harness: EngineHarness;
  let stub: ReturnType<typeof fetchStub>;

  beforeAll(async () => {
    harness = await startEngine(1_700_000_000n);
    stub = fetchStub(harness);
    stub.install();
  });

  afterAll(() => stub.restore());

  it("builds a cook the gate accepts, rather than a direct execute it refuses", async () => {
    const client = await createSauceSvmClient({
      kitchen: harness.kitchen,
      maxExecutionFee: 0n,
      payer: harness.payer,
      potSalt: HARNESS_POT_SALT,
      programId: harness.programId,
      rpcUrl: RPC_URL,
    });

    const result = await client.simulate(PROGRAM, { accounts: [] }, {});

    // Verified to observe the defect, not just to pass: dropping the named `pot` account the 0.4.0
    // cook added fails this with Custom(3007), and a direct execute would fail it with the gate's
    // own Custom(67).
    expect(result.err ?? null).toBeNull();
  });

  it("via engine, builds the engine's direct paid cook, which runs the program with no Kitchen", async () => {
    const client = await createSauceSvmClient({
      kitchen: harness.kitchen,
      payer: harness.payer,
      programId: harness.programId,
      rpcUrl: RPC_URL,
      via: "engine",
    });

    const result = await client.simulate(PROGRAM, { accounts: [] }, {});

    expect(client.via).toBe("engine");
    expect(result.err ?? null).toBeNull();
    expect(toBigInt(result.returnData!)).toBe(42n);
  });

  it("quotes the Kitchen's fee, and a direct cook capped below it is refused", async () => {
    const client = await createSauceSvmClient({
      kitchen: harness.kitchen,
      payer: harness.payer,
      programId: harness.programId,
      rpcUrl: RPC_URL,
      via: "engine",
    });
    const { address: programData } = await deriveProgramDataPda(harness.kitchen);
    const price = (fee: bigint) =>
      sendInstructions(harness, [
        buildSetExecutionFeeInstruction({
          kitchen: harness.kitchen,
          authority: harness.payer.address,
          programData,
          feeConfig: harness.feeConfig,
          fee,
        }),
      ]);

    await price(4_000n);
    try {
      expect(await client.executionFee()).toBe(4_000n);
      const capped = await client.simulate(PROGRAM, { accounts: [] }, {});
      // Custom(84): the engine's ExecutionFeeExceedsMaximum, as the client signed a zero cap.
      expect(String(capped.err)).toContain(`code: ${ENGINE_FAULTS.ExecutionFeeExceedsMaximum}`);
      const paid = await client.simulate(
        PROGRAM,
        { accounts: [] },
        {},
        { maxExecutionFee: 4_000n },
      );
      expect(paid.err ?? null).toBeNull();
    } finally {
      await price(0n);
    }
  });

  it("via engine, a staged cook is pinned: a bare buffer address with no digest is refused", async () => {
    const client = await createSauceSvmClient({
      kitchen: harness.kitchen,
      payer: harness.payer,
      programId: harness.programId,
      rpcUrl: RPC_URL,
      via: "engine",
    });
    const staged = await stageProgram(harness, PROGRAM, 31n);

    await expect(client.simulateStaged(staged.codeBuffer, { accounts: [] }, {})).rejects.toThrow(
      /is pinned/,
    );
    const pinned = await client.simulateStaged(
      {
        address: staged.codeBuffer,
        seed: new Uint8Array(32),
        sha256: staged.sha256,
        signatures: [],
      },
      { accounts: [] },
      {},
    );
    expect(toBigInt(pinned.returnData!)).toBe(42n);
    const wrong = new Uint8Array(staged.sha256).fill(1);
    const refused = await client.simulateStaged(
      staged.codeBuffer,
      { accounts: [] },
      {},
      {
        expectedSha256: wrong,
      },
    );
    expect(String(refused.err)).toContain(`code: ${ENGINE_FAULTS.CodeHashMismatch}`);
  });

  it("runs a cook too wide for one transaction through the lookup table cookLookupTable names", async () => {
    // Forty accounts: 1,280 bytes of keys alone, past the 1,232 a transaction holds.
    const names = Array.from({ length: 40 }, (_, i) => `a${i}`);
    const wide = compileSvm(
      `function main(${names.map((name) => `${name}: Account`).join(", ")}): Uint256 {\n` +
        "  return 42;\n}\n",
    );
    // The compiler's manifest, as the client takes it.
    const manifest = wide.manifest! as unknown as AccountManifest;
    const keys = names.map((_, i) => getAddressDecoder().decode(new Uint8Array(32).fill(i + 7)));
    const resolution = Object.fromEntries(names.map((name, i) => [name, keys[i]!]));
    const client = await createSauceSvmClient({
      kitchen: harness.kitchen,
      maxExecutionFee: 0n,
      payer: harness.payer,
      potSalt: HARNESS_POT_SALT,
      programId: harness.programId,
      rpcUrl: RPC_URL,
    });
    // As it is, the cook does not fit one transaction: refused before the cluster is asked.
    await expect(client.simulate(wide.bytecode, manifest, resolution)).rejects.toThrow(
      /past Solana's 1232: execute and executeStaged take its accounts through a lookup table/,
    );

    // A table the payer holds already, over the program's accounts and the Kitchen cook's own that
    // neither sign nor are called — the Pot, the fee config, the System Program, the engine.
    const { address: pot } = await derivePotPda(
      harness.kitchen,
      harness.payer.address,
      HARNESS_POT_SALT,
    );
    const table = getAddressDecoder().decode(new Uint8Array(32).fill(250));
    const data = getAddressLookupTableEncoder().encode({
      deactivationSlot: 2n ** 64n - 1n,
      lastExtendedSlot: 100n,
      lastExtendedSlotStartIndex: 0,
      authority: some(harness.payer.address),
      addresses: [
        ...keys,
        pot,
        harness.feeConfig,
        address("11111111111111111111111111111111"),
        harness.programId,
      ],
    });
    harness.svm.setAccount({
      address: table,
      data: new Uint8Array(data),
      executable: false,
      lamports: lamports(harness.svm.minimumBalanceForRentExemption(BigInt(data.length))),
      programAddress: address("AddressLookupTab1e1111111111111111111111111"),
      space: BigInt(data.length),
    });

    // It covers every account the client measures a table must hold, so nothing is sent, and the
    // cook through it is one the Kitchen and the engine run.
    const ready = await client.cookLookupTable(wide.bytecode, manifest, resolution, {
      existing: table,
    });
    expect(ready?.lookupTableAddress).toBe(table);
    const result = await client.simulate(wide.bytecode, manifest, resolution, {
      lookupTables: ready!.lookupTables,
    });
    expect(result.err ?? null).toBeNull();
    expect(toBigInt(result.returnData!)).toBe(42n);
  });

  it("refuses the SAME program invoked through the legacy execute, bypassing the kitchen — no Pot gate, no run", async () => {
    // The engine `.so` ships in the PUBLIC package (eco-incorp/v12 is private, so a packaged binary
    // is the only way a consumer gets the engine). Its legacy `execute` runs a program solely when
    // the invocation arrived through a deployed kitchen cook, which signs a Pot; the engine's other
    // way in, the direct cook above, is paid — it charges the Kitchen's fee first. This is the
    // negative for the first — the SAME `PROGRAM` the cook above ran is handed straight to the
    // engine's own `execute` discriminator, skipping the kitchen entirely. Before the gate
    // this exact shape (a self-contained program, empty account list) was the normal successful path,
    // so a failure here isolates the gate, not a malformed instruction. If a future engine build
    // regressed the gate to run un-gated bytecode, this is the test that fails instead of a runnable
    // engine shipping quietly.
    const direct = await buildExecuteTransactionForHarness(harness, [
      ...buildComputeBudgetPrepend({ unitLimit: 1_400_000 }),
      buildHeapFramePrepend(),
      buildExecuteInstruction({ programId: harness.programId, bytecode: PROGRAM, accounts: [] }),
    ]);
    const refused = expectFail(sendSigned(harness, direct));
    // A program-level custom error (the gate's own, observed as Custom(67)) — matched loosely so an
    // engine revision that renumbers it still passes, but distinguished from a runtime InstructionError
    // that would mean the transaction never reached the gate.
    expect(refused.err).toMatch(/Custom/);
  });
});
