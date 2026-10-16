/**
 * An intent from Base to Solana, filled through the intent tools: LiteSVM running the programs
 * mainnet runs (the pinned dump, `sdk/test/svm/eco-routes-svm.ts`: the Portal, the HyperProver,
 * Hyperlane's Mailbox and IGP), reached through a JSON-RPC shim over the bank
 * (`sdk/test/svm/rpc-shim.ts`), which checks every signature it is sent. The server builds the
 * fill as a base64 transaction for the solver's Solana key, with every signature but the fee
 * payer's; the test signs it with that key, here, and lands it.
 *
 * Solana's side only: the record is built from the intent as Base would publish it, and nothing
 * reads Base (`sdk/test/cli-intent-solana.e2e.test.ts` runs the whole life with the CLI).
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import {
  address,
  generateKeyPairSigner,
  getAddressCodec,
  getBase64Encoder,
  getTransactionDecoder,
  lamports,
  partiallySignTransaction,
  type KeyPairSigner,
} from "@solana/kit";
import { pad, type Hex } from "viem";

import { intentRecord } from "../../sdk/dist/cli/lifecycle.js";
import { ecoRoutesContract, ecoRoutesPortal } from "../../sdk/dist/protocols/eco-routes/lookup.js";
import { toUniversalAddress } from "../../sdk/dist/routes/normalize.js";
import type { Intent } from "../../sdk/dist/routes/types.js";
import {
  associatedTokenAccount,
  svmTokenTransferCall,
  TOKEN_PROGRAM_ID,
  universalOfSvmKey,
} from "../../sdk/dist/svm/index.js";
import { ecoRoutesSvm, programId } from "../../sdk/test/svm/eco-routes-svm.js";
import { solanaShim, type SolanaShim } from "../../sdk/test/svm/rpc-shim.js";
import { connect, failed, ok, type Connected } from "./harness.js";

/** SPL accounts placed in the bank directly, as the SDK's own Solana suites place them: a mint
 *  (82 bytes, decimals and initialized), and a token account (165 bytes: mint, owner, amount). */
type Bank = ReturnType<typeof ecoRoutesSvm>;
const TOKEN_PROGRAM = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
function place(svm: Bank, at: Parameters<Bank["setAccount"]>[0]["address"], data: Uint8Array) {
  svm.setAccount({
    address: at,
    data,
    executable: false,
    lamports: lamports(svm.minimumBalanceForRentExemption(BigInt(data.length))),
    programAddress: TOKEN_PROGRAM,
    space: BigInt(data.length),
  });
}
function setMint(svm: Bank, mint: Parameters<Bank["setAccount"]>[0]["address"], decimals: number) {
  const data = new Uint8Array(82);
  data[44] = decimals;
  data[45] = 1;
  place(svm, mint, data);
}
function setTokenAccount(
  svm: Bank,
  at: Parameters<Bank["setAccount"]>[0]["address"],
  mint: Parameters<Bank["setAccount"]>[0]["address"],
  owner: Parameters<Bank["setAccount"]>[0]["address"],
  amount: bigint,
) {
  const codec = getAddressCodec();
  const data = new Uint8Array(165);
  data.set(new Uint8Array(codec.encode(mint)), 0);
  data.set(new Uint8Array(codec.encode(owner)), 32);
  new DataView(data.buffer).setBigUint64(64, amount, true);
  data[108] = 1;
  place(svm, at, data);
}
const tokenAmount = (svm: Bank, at: Parameters<Bank["setAccount"]>[0]["address"]): bigint => {
  const account = svm.getAccount(at);
  assert.ok(account.exists, `token account ${at}`);

  return new DataView(account.data.buffer, account.data.byteOffset).getBigUint64(64, true);
};

const SOLANA_URL = "http://127.0.0.1:65533/";
const NOW = 1_790_000_000n;
const USDC = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const PORTAL = programId("portal");
/** The solver's account on Base, which the reward pays: a Solana key is no claimant there. */
const CLAIMANT: Hex = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";
const AMOUNT = 1_000_000n;

describe("the intent tools on a Solana destination", () => {
  let svm: ReturnType<typeof ecoRoutesSvm>;
  let shim: SolanaShim;
  let mcp: Connected;
  let solver: KeyPairSigner;
  let recipient: Awaited<ReturnType<typeof generateKeyPairSigner>>["address"];
  const rpcUrls = { solana: SOLANA_URL };

  /** An Base -> Solana intent: AMOUNT USDC to `recipient`, as eco-routes' deposit address. */
  const record = async (salt: string, deadline: bigint) => {
    const intent: Intent = {
      sourceChainId: 8453n,
      destination: 1399811149n,
      route: {
        salt: `0x${salt.repeat(32)}`,
        deadline,
        portal: universalOfSvmKey(PORTAL),
        nativeAmount: 0n,
        tokens: [{ token: universalOfSvmKey(USDC), amount: AMOUNT }],
        calls: [
          await svmTokenTransferCall({
            portal: PORTAL,
            mint: USDC,
            amount: AMOUNT,
            decimals: 6,
            recipient,
          }),
        ],
      },
      reward: {
        deadline: deadline + 3600n,
        creator: toUniversalAddress("0x70997970C51812dc3A010C7d01b50e0d17dc79C8"),
        prover: toUniversalAddress(ecoRoutesContract("base", "HyperProver")!),
        nativeAmount: 0n,
        tokens: [
          {
            token: toUniversalAddress("0xaf88d065e77c8cC2239327C5EDb3A432268e5831"),
            amount: 1_050_000n,
          },
        ],
      },
    };

    return intentRecord(intent, { sourcePortal: ecoRoutesPortal("base") });
  };

  before(async () => {
    svm = ecoRoutesSvm(NOW);
    solver = await generateKeyPairSigner();
    svm.airdrop(solver.address, lamports(10_000_000_000n));
    setMint(svm, USDC, 6);
    setTokenAccount(
      svm,
      await associatedTokenAccount(solver.address, USDC, TOKEN_PROGRAM_ID),
      USDC,
      solver.address,
      10n * AMOUNT,
    );
    // The recipient's token account, which the route pays: it must exist when the route runs.
    recipient = (await generateKeyPairSigner()).address;
    setTokenAccount(svm, recipient, USDC, (await generateKeyPairSigner()).address, 0n);
    shim = solanaShim(svm, SOLANA_URL);
    shim.install();
    mcp = await connect();
  });

  after(async () => {
    await mcp?.close();
    shim?.restore();
  });

  it("publishes intents to Solana, built against the accounts and the Pot Solana has", async () => {
    // A server whose endpoint reaches Solana: sauce_intent_publish reads which token accounts
    // exist before it builds the route, as the command does.
    const reading = await connect({
      chainIds: [1399811149],
      endpoint: (chain) => (chain.kind === "svm" ? SOLANA_URL : undefined),
    });
    const publish = async (wallet: string) => {
      const out = ok(
        await reading.call("sauce_intent_publish", {
          source: [
            "function main(recipient: Address, amount: Uint256) {",
            "  Solana(() => {",
            "    USDC.transfer(recipient, amount);",
            "  }).reward({ tokens: [{ token: USDC, amount: 1050000 }] });",
            "}",
          ].join("\n"),
          chain: "ethereum",
          args: [wallet, AMOUNT.toString()],
          intentDeadline: 2_000_000_000,
          intentCreator: CLAIMANT,
        }),
      ) as { intents: Array<{ record: { route: { calls: unknown[]; nativeAmount: string } } }> };

      return out.intents[0]!.record.route;
    };
    try {
      // The solver's wallet holds a USDC account already: the route only pays it.
      const paid = await publish(solver.address);
      assert.equal(paid.calls.length, 1);
      assert.equal(paid.nativeAmount, "0");
      // A new wallet has none: the route creates it first, and delivers its rent.
      const created = await publish((await generateKeyPairSigner()).address);
      assert.equal(created.calls.length, 2);
      assert.equal(created.nativeAmount, "2039280");
      // A program, cooked on the Pot the Portal's executor owns, which this cluster lacks: its
      // route creates the Pot, and the notes say what races it and that its fill needs a table.
      const program = ok(
        await reading.call("sauce_intent_publish", {
          source: [
            "function main(recipient: Address, amount: Uint256) {",
            "  Solana(() => {",
            "    const sent = amount;",
            "    USDC.transfer(recipient, sent);",
            "  }, { tokens: [{ token: USDC, amount }] }).reward({ tokens: [{ token: USDC, amount: 1050000 }] });",
            "}",
          ].join("\n"),
          chain: "ethereum",
          args: [(await generateKeyPairSigner()).address, AMOUNT.toString()],
          intentDeadline: 2_000_000_000,
          intentCreator: CLAIMANT,
          intentExecutionFee: "5000",
        }),
      ) as { notes: string[] };
      assert.ok(
        program.notes.some((note) =>
          /does not exist yet: this intent's route creates it/.test(note),
        ),
      );
      assert.ok(program.notes.some((note) => /only through an address lookup table/.test(note)));
    } finally {
      await reading.close();
    }
  });

  it("builds the solver's fill as a base64 transaction, which it signs and lands", async () => {
    const intent = await record("01", NOW + 3600n);
    const before = (await mcp.call("sauce_intent_status", { intent, rpcUrls })) as never;
    const read = ok(before) as {
      destination: { chain: string; portal: string; claimant: string | null; canCancel: boolean };
    };
    assert.deepEqual(
      [read.destination.chain, read.destination.portal, read.destination.claimant],
      ["solana", PORTAL, null],
    );

    // A Solana key fills; an EVM address does not, and the reward needs an EVM claimant.
    assert.match(
      failed(await mcp.call("sauce_intent_fill", { intent, from: CLAIMANT, rpcUrls })),
      /from/,
    );
    assert.match(
      failed(await mcp.call("sauce_intent_fill", { intent, from: solver.address, rpcUrls })),
      /claimant/,
    );
    assert.match(
      failed(
        await mcp.call("sauce_intent_fill", {
          intent,
          from: solver.address,
          dryRun: true,
          rpcUrls,
        }),
      ),
      /goes to Solana: build its fill instead/,
    );

    const out = ok(
      await mcp.call("sauce_intent_fill", {
        intent,
        from: solver.address,
        claimant: CLAIMANT,
        prove: false,
        rpcUrls,
      }),
    ) as {
      from: string;
      intents: Array<{
        transactions: Array<{
          chainId: number;
          feePayer: string;
          transaction: string;
          what: string;
        }>;
      }>;
      notes: string[];
    };
    assert.equal(out.from, solver.address);
    const [fulfill] = out.intents[0]!.transactions;
    assert.equal(fulfill!.chainId, 1399811149);
    assert.equal(fulfill!.feePayer, solver.address);
    assert.ok(out.notes.some((note) => /sign it with .* \(the fee payer, last\)/.test(note)));

    // Signed here by the fee payer, the one signature it lacks, and landed.
    const unsigned = getTransactionDecoder().decode(
      getBase64Encoder().encode(fulfill!.transaction),
    );
    const signed = await partiallySignTransaction([solver.keyPair], unsigned);
    const result = svm.sendTransaction(signed as never) as { constructor: { name: string } };
    assert.notEqual(result.constructor.name, "FailedTransactionMetadata", "the fill landed");
    assert.equal(tokenAmount(svm, recipient), AMOUNT);

    const filled = ok(await mcp.call("sauce_intent_status", { intent, rpcUrls })) as {
      state: string;
      destination: { claimant: string };
    };
    assert.equal(filled.destination.claimant, pad(CLAIMANT).toLowerCase());
    assert.equal(filled.state, "filled");
  });

  it("takes the Solana fee payer for a cancellation, which also reads the source", async () => {
    const intent = await record("02", NOW + 60n);
    assert.match(
      failed(await mcp.call("sauce_intent_cancel", { intent, from: solver.address, rpcUrls })),
      /needs base's endpoint \(chain id 8453\): pass rpcUrls/,
    );
  });
});
