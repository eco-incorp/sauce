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
import { getBase64Encoder, getTransactionDecoder } from "@solana/kit";
import {
  buildComputeBudgetPrepend,
  buildExecuteInstruction,
  buildHeapFramePrepend,
  createSauceSvmClient,
} from "../../src/svm/index.js";
import {
  HARNESS_POT_SALT,
  buildExecuteTransactionForHarness,
  describeSvm,
  expectFail,
  sendSigned,
  startEngine,
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

      return Response.json({
        id,
        jsonrpc: "2.0",
        result: {
          context: { apiVersion: "2.0.0", slot: 100 },
          value: {
            accounts: null,
            err: failed ? String(failed) : null,
            logs: typeof result.logs === "function" ? result.logs.call(result) : [],
            returnData: null,
            unitsConsumed: 0,
          },
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

  it("refuses the SAME program invoked directly, bypassing the kitchen — the inertness that makes shipping the engine safe", async () => {
    // The engine `.so` ships in the PUBLIC package (eco-incorp/v12 is private, so a packaged binary
    // is the only way a consumer gets the engine). That is only safe because a leaked engine is
    // INERT: it runs a program solely when the invocation arrived through a deployed kitchen cook.
    // This is the negative that proves it — the SAME `PROGRAM` the cook above ran is handed straight
    // to the engine's own `execute` discriminator, skipping the kitchen entirely. Before the gate
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
