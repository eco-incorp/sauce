/**
 * An intent from Solana to Base, through the tools: published from a Solana wallet and claimed on
 * Solana. LiteSVM runs the programs mainnet runs (the pinned dump, `sdk/test/svm/eco-routes-svm.ts`:
 * the Portal and the HyperProver), reached through a JSON-RPC shim over the bank
 * (`sdk/test/svm/rpc-shim.ts`), which checks every signature it is sent. The server builds each
 * transaction as base64 for the key `from` names, every signature in but the fee payer's; the test
 * signs it with that key, here, and lands it.
 *
 * Solana's side only: Base is not read, and the proof the HyperProver records when Hyperlane
 * delivers the fill's is placed in the bank as that delivery writes it
 * (`sdk/test/cli-intent-solana-source.e2e.test.ts` runs the whole life, the fill and the delivery
 * included, with the CLI).
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
  type Address,
  type KeyPairSigner,
} from "@solana/kit";

import {
  associatedTokenAccount,
  PORTAL_SOURCE_DISCRIMINATORS,
  svmProofPda,
  svmVaultPda,
  TOKEN_PROGRAM_ID,
} from "../../sdk/dist/svm/index.js";
import { ecoRoutesSvm, programId } from "../../sdk/test/svm/eco-routes-svm.js";
import { solanaShim, type SolanaShim } from "../../sdk/test/svm/rpc-shim.js";
import { connect, failed, ok, type Connected } from "./harness.js";

type Bank = ReturnType<typeof ecoRoutesSvm>;
const TOKEN_PROGRAM = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const codec = getAddressCodec();
function place(svm: Bank, at: Address, data: Uint8Array, owner: Address = TOKEN_PROGRAM) {
  svm.setAccount({
    address: at,
    data,
    executable: false,
    lamports: lamports(svm.minimumBalanceForRentExemption(BigInt(data.length))),
    programAddress: owner,
    space: BigInt(data.length),
  });
}
function setMint(svm: Bank, mint: Address, decimals: number) {
  const data = new Uint8Array(82);
  data[44] = decimals;
  data[45] = 1;
  place(svm, mint, data);
}
function setTokenAccount(svm: Bank, at: Address, mint: Address, owner: Address, amount: bigint) {
  const data = new Uint8Array(165);
  data.set(new Uint8Array(codec.encode(mint)), 0);
  data.set(new Uint8Array(codec.encode(owner)), 32);
  new DataView(data.buffer).setBigUint64(64, amount, true);
  data[108] = 1;
  place(svm, at, data);
}
const tokenAmount = (svm: Bank, at: Address): bigint => {
  const account = svm.getAccount(at);

  return account.exists
    ? new DataView(account.data.buffer, account.data.byteOffset).getBigUint64(64, true)
    : 0n;
};

const SOLANA_URL = "http://127.0.0.1:65531/";
/** The bank's clock: now, since a deadline that has passed is refused by the wall clock. */
const NOW = BigInt(Math.floor(Date.now() / 1000));
const USDC = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const HYPER = programId("hyper_prover");
const REWARD = 1_050_000n;
const SOURCE = `function main(recipient: Address) {
  Base(() => {
    USDC.transfer(recipient, 1000000);
  }).reward({ tokens: [{ token: USDC, amount: ${REWARD} }] });
}
`;

/** Signs `transaction` (base64, every signature in but the fee payer's) with `signer` and lands it. */
async function land(svm: Bank, signer: KeyPairSigner, transaction: string): Promise<void> {
  const unsigned = getTransactionDecoder().decode(getBase64Encoder().encode(transaction));
  const signed = await partiallySignTransaction([signer.keyPair], unsigned);
  const result = svm.sendTransaction(signed as never) as {
    constructor: { name: string };
    err?: () => unknown;
    meta?: () => { logs: () => string[] };
  };
  assert.notEqual(
    result.constructor.name,
    "FailedTransactionMetadata",
    `the transaction landed: ${String(result.err?.())}\n${result.meta?.().logs().join("\n")}`,
  );
}

describe("the intent tools on a Solana source", () => {
  let svm: Bank;
  let shim: SolanaShim;
  let mcp: Connected;
  let creator: KeyPairSigner;
  let claimant: KeyPairSigner;
  const rpcUrls = { solana: SOLANA_URL };

  before(async () => {
    svm = ecoRoutesSvm(NOW);
    creator = await generateKeyPairSigner();
    claimant = await generateKeyPairSigner();
    for (const key of [creator.address, claimant.address]) {
      svm.airdrop(key, lamports(10_000_000_000n));
    }
    setMint(svm, USDC, 6);
    setTokenAccount(
      svm,
      await associatedTokenAccount(creator.address, USDC, TOKEN_PROGRAM_ID),
      USDC,
      creator.address,
      10n * REWARD,
    );
    shim = solanaShim(svm, SOLANA_URL);
    shim.install();
    mcp = await connect();
  });

  after(async () => {
    await mcp?.close();
    shim?.restore();
  });

  it("publishes from a Solana wallet, and claims on Solana once the proof is recorded", async () => {
    const program = {
      source: SOURCE,
      chain: "solana",
      args: ["0x00000000000000000000000000000000000000aa"],
      intentDeadline: (NOW + 3600n).toString(),
      intentCreator: creator.address,
      rpcUrl: SOLANA_URL,
    };
    assert.match(failed(await mcp.call("sauce_intent_publish", program)), /give from/);
    const published = ok(
      await mcp.call("sauce_intent_publish", { ...program, from: creator.address }),
    ) as {
      intents: Array<{
        intentHash: `0x${string}`;
        vault: string;
        record: Record<string, unknown>;
        transactions: Array<{ chainId: number; feePayer: string; transaction: string }>;
      }>;
    };
    const [intent] = published.intents;
    const vault = await svmVaultPda(programId("portal"), intent!.intentHash);
    assert.equal(intent!.vault, vault);
    // Two transactions, in order: the funding, then the announcement.
    assert.deepEqual(
      intent!.transactions.map((tx) => [tx.chainId, tx.feePayer]),
      [
        [1399811149, creator.address],
        [1399811149, creator.address],
      ],
    );
    for (const tx of intent!.transactions) await land(svm, creator, tx.transaction);
    assert.equal(
      tokenAmount(svm, await associatedTokenAccount(vault, USDC, TOKEN_PROGRAM_ID)),
      REWARD,
    );

    const funded = ok(
      await mcp.call("sauce_intent_status", { intent: intent!.record, rpcUrls }),
    ) as { state: string; source: { chain: string; funded: boolean } };
    assert.deepEqual([funded.state, funded.source.chain, funded.source.funded], [
      "funded",
      "solana",
      true,
    ]);

    // The proof Solana's HyperProver records when Hyperlane delivers the fill's, as it writes it:
    // the account's discriminator, the chain it was filled on, the claimant.
    const proof = new Uint8Array(48);
    proof.set(PORTAL_SOURCE_DISCRIMINATORS.proofAccount);
    new DataView(proof.buffer).setBigUint64(8, 8453n, true);
    proof.set(new Uint8Array(codec.encode(claimant.address)), 16);
    place(svm, await svmProofPda(HYPER, intent!.intentHash), proof, HYPER);

    assert.match(
      failed(await mcp.call("sauce_intent_claim", { intent: intent!.record, rpcUrls })),
      /needs the account that pays its fee/,
    );
    const claim = ok(
      await mcp.call("sauce_intent_claim", {
        intent: intent!.record,
        from: claimant.address,
        rpcUrls,
      }),
    ) as { from: string; transactions: Array<{ feePayer: string; transaction: string }> };
    assert.equal(claim.from, claimant.address);
    await land(svm, claimant, claim.transactions[0]!.transaction);
    assert.equal(
      tokenAmount(svm, await associatedTokenAccount(claimant.address, USDC, TOKEN_PROGRAM_ID)),
      REWARD,
    );
    const claimed = ok(
      await mcp.call("sauce_intent_status", { intent: intent!.record, rpcUrls }),
    ) as { state: string };
    assert.equal(claimed.state, "claimed");
  });
});
