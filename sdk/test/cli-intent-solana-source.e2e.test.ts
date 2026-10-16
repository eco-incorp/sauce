/**
 * An intent from Solana to Base through the `sauce` command, both chains local and settled to the
 * end: published and funded on Solana in LiteSVM running the programs mainnet runs (the pinned dump,
 * `svm/eco-routes-svm.ts`: the Portal, the HyperProver, Hyperlane's Mailbox), filled and proven on
 * an anvil standing in for Base (eco-routes' 2.12.0 Portal and HyperProver at the registry's
 * addresses, `eco-routes-anvil.ts`), the proof carried to Solana and the reward claimed there. And a
 * second intent cancelled on Base after its deadline, the cancellation proven to Solana, and the
 * reward refunded there before its deadline.
 *
 * The CLI reaches Solana through a JSON-RPC shim over the bank (`svm/rpc-shim.ts`), which checks
 * every signature it is sent, and Base over HTTP.
 *
 * MOCKED, and only this: Hyperlane's off-chain half. Base's Mailbox is `MockMailbox`, whose
 * `dispatch` formats and logs the message as Hyperlane's does; the test reads that message from its
 * `Dispatch` log, as a relayer does, and delivers it to Solana's REAL Mailbox with the inbox's ISM
 * swapped for a pass-through (`svm/hyperlane-inbox.ts`): the validators' signatures are mocked.
 * Solana's HyperProver is real: its `handle` checks the sender against mainnet's whitelist (Base's
 * HyperProver) and records the proof Solana's Portal pays on.
 *
 * GATED on SAUCE_V12_RUNTIME_CREATION_HEX like every EVM execution suite (CLAUDE.md).
 */
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  address,
  createKeyPairSignerFromBytes,
  generateKeyPairSigner,
  lamports,
  type Address as SvmAddress,
  type KeyPairSigner,
} from "@solana/kit";
import type { LiteSVM } from "litesvm";
import { decodeEventLog, getAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { ecoRoutesPortal } from "../src/protocols/eco-routes/lookup.js";
import {
  associatedTokenAccount,
  svmHyperPdaPayerPda,
  svmVaultPda,
  svmWithdrawnMarkerPda,
  TOKEN_PROGRAM_ID,
  universalOfSvmKey,
} from "../src/svm/index.js";
import {
  describeEvm,
  fixture,
  jsonOf,
  OWNER_KEY,
  registered,
  sauce,
  startChain,
  type LocalChain,
} from "./cli-anvil.js";
import {
  deployMailbox,
  MAILBOX,
  plantHyperProver,
  plantPortal,
  PORTAL_FIXTURES,
} from "./eco-routes-anvil.js";
import { ecoRoutesSvm, programId, setTime } from "./svm/eco-routes-svm.js";
import { setMint, setTokenAccount, tokenAmount, type EngineHarness } from "./svm/engine-harness.js";
import { deliverToSolana, passThroughIsm } from "./svm/hyperlane-inbox.js";
import { solanaShim, type SolanaShim } from "./svm/rpc-shim.js";

const SOLANA_URL = "http://127.0.0.1:65533/";
const USDC_MINT = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const PORTAL = programId("portal");
const HYPER = programId("hyper_prover");
/** Anvil's fourth dev account: the solver on Base, which delivers the route's USDC. */
const SOLVER_KEY = "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6";
const SOLVER = privateKeyToAccount(SOLVER_KEY);
const RECIPIENT = getAddress("0x00000000000000000000000000000000000000bb");
const AMOUNT = 1_000_000n;
const REWARD = 1_050_000n;
const HYPERLANE_FEE = 7_777n;

/** The intent file: USDC delivered on Base, a USDC reward escrowed on Solana. */
const FILE = `// sauce intent publish pay.sauce.ts --chain solana --keypair <keypair> \\
//   --intent-deadline <unix seconds> --intent-creator <key> --args <recipient>
function main(recipient: Address) {
  Base(() => {
    USDC.transfer(recipient, ${AMOUNT});
  }).reward({ tokens: [{ token: USDC, amount: ${REWARD} }] });
}
`;

/** A fresh ed25519 keypair, as the 64-byte file `solana-keygen` writes, and its signer. */
async function keypairFile(path: string): Promise<KeyPairSigner> {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const bytes = new Uint8Array([
    ...privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32),
    ...publicKey.export({ format: "der", type: "spki" }).subarray(-32),
  ]);
  writeFileSync(path, JSON.stringify([...bytes]));

  return createKeyPairSignerFromBytes(bytes);
}

describeEvm("sauce intent: Solana to Base, claimed on Solana; cancelled and refunded", () => {
  let base: LocalChain;
  let svm: LiteSVM;
  let shim: SolanaShim;
  let work: string;
  let config: string;
  let file: string;
  let creatorFile: string;
  let claimantFile: string;
  let creator: KeyPairSigner;
  let claimant: KeyPairSigner;
  let relayer: KeyPairSigner;
  let usdc: Address;
  let mailbox: Address;
  const relayed = new Set<Hex>();
  /** The harness helpers take an engine harness; they need only its bank. */
  const bank = (): EngineHarness => ({ svm }) as unknown as EngineHarness;
  const now = async (): Promise<bigint> => (await base.publicClient.getBlock()).timestamp;
  const run = (store: string, ...argv: string[]) =>
    sauce("intent", ...argv, "--config", config, "--store", store);
  const ata = (owner: SvmAddress) => associatedTokenAccount(owner, USDC_MINT, TOKEN_PROGRAM_ID);

  /** Publishes the file's intent from the creator's Solana wallet, its reward deadline `reward`. */
  async function published(store: string, deadline: bigint, reward: bigint): Promise<Hex> {
    const out = await run(
      store,
      ...["publish", file, "--chain", "solana", "--keypair", creatorFile],
      ...["--intent-deadline", deadline.toString(), "--intent-reward-deadline", reward.toString()],
      ...["--intent-creator", creator.address, "--json", "--args", RECIPIENT],
    );
    expect({ code: out.code, stderr: out.stderr }).toMatchObject({ code: 0 });
    expect(out.stderr).toContain("stored intent");
    const json = JSON.parse(out.stdout) as { intents: Array<{ intentHash: Hex; vault: string }> };

    return json.intents[0]!.intentHash;
  }

  /** Hyperlane's delivery from Base to Solana: every message Base's Mailbox dispatched that has not
   *  been delivered yet, read from its `Dispatch` logs and processed by Solana's Mailbox. Kept by
   *  message, not by block: viem caches the block number, so a block bound could read one twice,
   *  which the Mailbox refuses (MessageAlreadyProcessed). */
  async function relay(): Promise<number> {
    const logs = await base.publicClient.getLogs({ address: mailbox, fromBlock: 0n });
    let delivered = 0;
    for (const log of logs) {
      const decoded = decodeEventLog({ abi: MAILBOX, data: log.data, topics: log.topics });
      if (decoded.eventName !== "Dispatch" || relayed.has(decoded.args.message)) continue;
      await deliverToSolana(svm, relayer, decoded.args.message);
      relayed.add(decoded.args.message);
      delivered++;
    }

    return delivered;
  }

  beforeAll(async () => {
    work = mkdtempSync(join(tmpdir(), "sauce-intent-solana-source-e2e-"));
    base = await startChain("base");
    usdc = await base.plant(fixture("MockERC20"), registered(base.chain, "USDC"));
    await plantPortal(base, PORTAL_FIXTURES.v2_12);
    mailbox = await deployMailbox(base, HYPERLANE_FEE);
    await plantHyperProver(base, mailbox);
    await base.mint(usdc, SOLVER.address, 10n * AMOUNT);

    svm = ecoRoutesSvm(await now());
    await passThroughIsm(svm);
    // The HyperProver's rent payer, which pays for each proof account it records.
    svm.airdrop(await svmHyperPdaPayerPda(HYPER), lamports(1_000_000_000n));
    creatorFile = join(work, "creator.json");
    claimantFile = join(work, "claimant.json");
    creator = await keypairFile(creatorFile);
    claimant = await keypairFile(claimantFile);
    relayer = await generateKeyPairSigner();
    for (const key of [creator.address, claimant.address, relayer.address]) {
      svm.airdrop(key, lamports(10_000_000_000n));
    }
    setMint(bank(), USDC_MINT, 6);
    setTokenAccount(bank(), await ata(creator.address), USDC_MINT, creator.address, 10n * REWARD);
    shim = solanaShim(svm, SOLANA_URL);
    shim.install();
    config = join(work, "sauce.config.json");
    writeFileSync(
      config,
      JSON.stringify({ rpcUrls: { "8453": base.rpcUrl, "1399811149": SOLANA_URL } }),
    );
    file = join(work, "pay.sauce.ts");
    writeFileSync(file, FILE);
  }, 180_000);

  afterAll(async () => {
    shim?.restore();
    rmSync(work, { recursive: true, force: true });
    await base?.stop();
  });

  it("publishes it on Solana, fills and proves it on Base, and claims the reward on Solana", async () => {
    const store = mkdtempSync(join(work, "store-"));
    const start = await now();
    const before = tokenAmount(bank(), await ata(creator.address));
    const hash = await published(store, start + 3600n, start + 7200n);

    // Escrowed on Solana, in the vault Solana's Portal derives.
    const vault = await svmVaultPda(PORTAL, hash);
    expect(tokenAmount(bank(), await ata(creator.address))).toBe(before - REWARD);
    expect(tokenAmount(bank(), await ata(vault))).toBe(REWARD);
    const shown = jsonOf(await run(store, "show", hash, "--json"));
    expect(shown.status).toMatchObject({
      state: "funded",
      source: { chain: "solana", portal: PORTAL, vault, funded: true, proof: null },
      destination: { chain: "base", claimant: null },
      prover: { kind: "Hyperlane", supported: true, sourceProver: HYPER },
      can: { fill: { ok: true }, claim: { ok: false } },
    });
    // In the order they landed: the reward escrowed, then the intent announced.
    expect((shown.events as Array<{ event: string; chain: string }>).map((e) => e.event)).toEqual([
      "funded",
      "published",
    ]);

    // A Solana key is the claimant: the fill on Base must name it.
    const unnamed = await run(store, "fill", hash, "--solver", SOLVER.address);
    expect(unnamed.code).toBe(2);
    expect(unnamed.stderr).toContain("needs the claimant");
    // An EVM address, padded, would be a Solana key no one holds: the reward lost.
    const evm = await run(
      store,
      "fill",
      hash,
      "--solver",
      SOLVER.address,
      "--claimant",
      SOLVER.address,
    );
    expect(evm.code).toBe(2);
    expect(evm.stderr).toContain("an EVM address is not one");

    const filled = await run(
      store,
      ...["fill", hash, "--claimant", claimant.address, "--send", "--private-key", SOLVER_KEY],
      ...["--auto-approve", "--json"],
    );
    expect({ code: filled.code, stderr: filled.stderr, stdout: filled.stdout }).toMatchObject({
      code: 0,
    });
    expect(await base.balanceOf(usdc, RECIPIENT)).toBe(AMOUNT);

    // Not claimable before the proof arrives on Solana.
    const early = await run(store, "claim", hash, "--keypair", claimantFile);
    expect(early.code).toBe(1);
    expect(early.stdout).toContain("has no proof of it yet");
    expect(await relay()).toBe(1);
    expect(jsonOf(await run(store, "show", hash, "--json")).status).toMatchObject({
      state: "proven",
      source: { proof: { claimant: claimant.address, destination: "8453" } },
    });

    const claimed = await run(store, "claim", hash, "--keypair", claimantFile, "--json");
    expect({ code: claimed.code, stderr: claimed.stderr, stdout: claimed.stdout }).toMatchObject({
      code: 0,
    });
    expect(tokenAmount(bank(), await ata(claimant.address))).toBe(REWARD);
    expect(tokenAmount(bank(), await ata(vault))).toBe(0n);
    expect(svm.getAccount(await svmWithdrawnMarkerPda(PORTAL, hash)).exists).toBe(true);

    // Settled, read back from both chains.
    const settled = jsonOf(await run(store, "show", hash, "--json"));
    expect(settled.status).toMatchObject({
      state: "claimed",
      source: { chain: "solana", rewardStatus: "Withdrawn", vaultHolds: [{ holds: "0" }] },
      destination: { chain: "base", claimant: universalOfSvmKey(claimant.address) },
      can: {
        fill: { ok: false },
        claim: { ok: false, why: "the reward was claimed" },
        refund: { ok: false, why: "claimed: the vault holds nothing to refund" },
      },
    });
    const again = await run(store, "claim", hash, "--keypair", claimantFile);
    expect(again.code).toBe(1);
    expect(again.stdout).toContain("claimed already");
    expect(
      (settled.events as Array<{ event: string; chain: string }>).map(
        (each) => `${each.event} ${each.chain}`,
      ),
    ).toEqual([
      "funded solana",
      "published solana",
      "filled base",
      "proving base",
      "claimed solana",
    ]);
  }, 240_000);

  it("is stored again from its publishing transaction", async () => {
    const store = mkdtempSync(join(work, "store-"));
    const start = await now();
    const hash = await published(store, start + 3600n, start + 7200n);
    const signature = (
      jsonOf(await run(store, "show", hash, "--json")).events as Array<{ tx: string }>
    )[1]!.tx;
    const other = mkdtempSync(join(work, "store-"));
    const imported = jsonOf(await run(other, "import", signature, "--chain", "solana", "--json"));
    expect(imported.intents).toMatchObject([
      {
        record: {
          intentHash: hash,
          source: { chain: "solana", portal: universalOfSvmKey(PORTAL) },
          destination: { chain: "base", portal: ecoRoutesPortal("base") },
        },
        funded: true,
      },
    ]);
  }, 240_000);

  it("cancels it on Base after its deadline, proves the cancellation to Solana, and refunds", async () => {
    const store = mkdtempSync(join(work, "store-"));
    const start = await now();
    const before = tokenAmount(bank(), await ata(creator.address));
    const hash = await published(store, start + 60n, start + 100_000n);
    const early = await run(store, "cancel", hash, "--private-key", OWNER_KEY);
    expect(early.code).toBe(1);
    expect(early.stdout).toContain("not before the route's deadline");
    await base.testClient.increaseTime({ seconds: 120 });
    await base.testClient.mine({ blocks: 1 });
    setTime(svm, start + 120n);
    // Not refundable before the reward's deadline, with no proof of the cancellation.
    const unproven = await run(store, "refund", hash, "--keypair", creatorFile);
    expect(unproven.code).toBe(1);
    expect(unproven.stdout).toContain("not before the reward's deadline");

    const cancelled = await run(
      store,
      ...["cancel", hash, "--and-prove", "--private-key", OWNER_KEY, "--auto-approve"],
    );
    expect({
      code: cancelled.code,
      stderr: cancelled.stderr,
      stdout: cancelled.stdout,
    }).toMatchObject({ code: 0 });
    expect(await relay()).toBe(1);
    const status = jsonOf(await run(store, "show", hash, "--json")).status;
    expect(status).toMatchObject({
      state: "cancelProven",
      destination: { cancelled: true },
      can: { claim: { ok: false }, refund: { ok: true } },
    });
    const claim = await run(store, "claim", hash, "--keypair", claimantFile);
    expect(claim.code).toBe(1);
    expect(claim.stdout).toContain("pays no claimant");

    const refunded = await run(store, "refund", hash, "--keypair", creatorFile, "--json");
    expect({ code: refunded.code, stderr: refunded.stderr, stdout: refunded.stdout }).toMatchObject(
      { code: 0 },
    );
    expect(tokenAmount(bank(), await ata(creator.address))).toBe(before);
    const settled = jsonOf(await run(store, "show", hash, "--json"));
    expect(settled.status).toMatchObject({
      state: "refunded",
      source: { rewardStatus: "Refunded", vaultHolds: [{ holds: "0" }] },
      destination: { cancelled: true },
      can: { fill: { ok: false }, claim: { ok: false }, refund: { ok: false } },
    });
    expect(
      (settled.events as Array<{ event: string; chain: string }>).map(
        (each) => `${each.event} ${each.chain}`,
      ),
    ).toEqual([
      "funded solana",
      "published solana",
      "cancelled base",
      "proving base",
      "refunded solana",
    ]);
  }, 240_000);
});
