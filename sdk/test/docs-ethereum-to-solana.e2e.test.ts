/**
 * The manual's Ethereum-to-Solana intent, `docs/examples/ethereum-to-solana.ts`, run end to end as
 * the example builds it: its two transactions sent from the creator's wallet on an anvil standing in
 * for Ethereum (eco-routes' 2.12.0 Portal and HyperProver at the registry's addresses,
 * `eco-routes-anvil.ts`), the intent imported from the publish by `sauce intent import`, filled and
 * proven on Solana in LiteSVM running the programs mainnet runs (the pinned dump,
 * `svm/eco-routes-svm.ts`), the proof carried back, and the reward claimed on Ethereum. The
 * recipient is a wallet, and the USDC lands in the account the example derives for it.
 *
 * MOCKED, and only this: Hyperlane's off-chain half, as in `cli-intent-solana.e2e.test.ts`, which
 * this follows. The test reads the message Solana's Mailbox wrote and delivers it to Ethereum's
 * Mailbox itself (`MockMailbox.process`, no ISM). Ethereum's HyperProver is real.
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
  getCompiledTransactionMessageDecoder,
  lamports,
  type Address as SvmAddress,
  type KeyPairSigner,
} from "@solana/kit";
import type { LiteSVM } from "litesvm";
import { bytesToHex, encodeFunctionData, getAddress, parseAbi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { paySolanaWallet } from "../../docs/examples/ethereum-to-solana.js";
import {
  associatedTokenAccount,
  SOLANA_HYPERLANE,
  svmHyperDispatcherPda,
  TOKEN_PROGRAM_ID,
  universalOfSvmKey,
} from "../src/svm/index.js";
import {
  describeEvm,
  fixture,
  jsonOf,
  OWNER,
  registered,
  sauce,
  startChain,
  type LocalChain,
} from "./cli-anvil.js";
import {
  deployMailbox,
  plantHyperProver,
  plantPortal,
  PORTAL_FIXTURES,
} from "./eco-routes-anvil.js";
import { ecoRoutesSvm, programId } from "./svm/eco-routes-svm.js";
import { setMint, setTokenAccount, tokenAmount, type EngineHarness } from "./svm/engine-harness.js";
import { solanaShim, type SolanaShim } from "./svm/rpc-shim.js";

const SOLANA_URL = "http://127.0.0.1:65532/";
const USDC_MINT = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const HYPER = programId("hyper_prover");
/** Anvil's fourth dev account: the solver's account on Ethereum, which the reward pays. */
const SOLVER_KEY = "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6";
const SOLVER = privateKeyToAccount(SOLVER_KEY);
/** What the example's own run uses: 1 USDC delivered, 1.05 USDC of reward. */
const AMOUNT = 1_000_000n;
const REWARD = 1_050_000n;
const MAILBOX = parseAbi(["function process(bytes, bytes)"]);

describeEvm(
  "docs/examples/ethereum-to-solana: published on Ethereum, paid on Solana, claimed",
  () => {
    let ethereum: LocalChain;
    let svm: LiteSVM;
    let shim: SolanaShim;
    let work: string;
    let config: string;
    let keypair: string;
    let solver: KeyPairSigner;
    let usdc: Address;
    let mailbox: Address;
    const bank = (): EngineHarness => ({ svm }) as unknown as EngineHarness;
    const now = async (): Promise<bigint> => (await ethereum.publicClient.getBlock()).timestamp;

    /** Hyperlane's delivery, mocked: every message Solana's Mailbox wrote in the shim's last
     *  transaction, processed by Ethereum's Mailbox. */
    async function relayLast(): Promise<number> {
      const last = shim.sent.at(-1)!;
      const keys = getCompiledTransactionMessageDecoder().decode(last.messageBytes).staticAccounts;
      let delivered = 0;
      for (const key of keys) {
        const found = svm.getAccount(key);
        if (!found.exists || found.programAddress !== SOLANA_HYPERLANE.mailbox) continue;
        if (new TextDecoder().decode(found.data.subarray(1, 9)) !== "DISPATCH") continue;
        const message = bytesToHex(found.data.subarray(1 + 8 + 4 + 8 + 32));
        await ethereum.send(
          ethereum.deployer,
          mailbox,
          encodeFunctionData({ abi: MAILBOX, functionName: "process", args: ["0x", message] }),
        );
        delivered++;
      }

      return delivered;
    }

    beforeAll(async () => {
      work = mkdtempSync(join(tmpdir(), "sauce-docs-ethereum-to-solana-"));
      ethereum = await startChain("ethereum");
      usdc = await ethereum.plant(fixture("MockERC20"), registered(ethereum.chain, "USDC"));
      await plantPortal(ethereum, PORTAL_FIXTURES.v2_12);
      mailbox = await deployMailbox(ethereum, 7_777n);
      // Ethereum's HyperProver trusts Solana's HyperProver dispatcher, the message's sender.
      await plantHyperProver(ethereum, mailbox, [
        universalOfSvmKey(await svmHyperDispatcherPda(HYPER)),
      ]);
      await ethereum.mint(usdc, OWNER.address, 10n * REWARD);

      svm = ecoRoutesSvm(await now());
      const { privateKey, publicKey } = generateKeyPairSync("ed25519");
      const bytes = new Uint8Array([
        ...privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32),
        ...publicKey.export({ format: "der", type: "spki" }).subarray(-32),
      ]);
      keypair = join(work, "solver.json");
      writeFileSync(keypair, JSON.stringify([...bytes]));
      solver = await createKeyPairSignerFromBytes(bytes);
      svm.airdrop(solver.address, lamports(10_000_000_000n));
      setMint(bank(), USDC_MINT, 6);
      setTokenAccount(
        bank(),
        await associatedTokenAccount(solver.address, USDC_MINT, TOKEN_PROGRAM_ID),
        USDC_MINT,
        solver.address,
        10n * AMOUNT,
      );
      shim = solanaShim(svm, SOLANA_URL);
      shim.install();
      config = join(work, "sauce.config.json");
      writeFileSync(
        config,
        JSON.stringify({ rpcUrls: { "1": ethereum.rpcUrl, "1399811149": SOLANA_URL } }),
      );
    }, 180_000);

    afterAll(async () => {
      shim?.restore();
      rmSync(work, { recursive: true, force: true });
      await ethereum?.stop();
    });

    it("pays the Solana wallet's USDC account, and the solver claims the reward on Ethereum", async () => {
      const store = mkdtempSync(join(work, "store-"));
      const run = (...argv: string[]) =>
        sauce("intent", ...argv, "--config", config, "--store", store);
      // A wallet that has held USDC before: its associated account exists, holding nothing.
      const recipient: SvmAddress = (await generateKeyPairSigner()).address;
      const account = await associatedTokenAccount(recipient, USDC_MINT, TOKEN_PROGRAM_ID);
      setTokenAccount(bank(), account, USDC_MINT, recipient, 0n);

      const start = await now();
      const built = await paySolanaWallet({
        creator: OWNER.address,
        recipient,
        amount: AMOUNT,
        reward: REWARD,
        deliverBy: start + 3_600n,
        refundableFrom: start + 86_400n,
        salt: `0x${"07".repeat(32)}`,
      });
      // The creator's wallet sends what the example prints, in order: the approval, the publish.
      expect(built.transactions).toHaveLength(2);
      let published: Hex | undefined;
      for (const { to, data, value } of built.transactions) {
        published = await ethereum.send(ethereum.owner, getAddress(to), data, value);
      }
      // The reward left the creator's wallet for the intent's escrow.
      expect(await ethereum.balanceOf(usdc, OWNER.address)).toBe(9n * REWARD);

      const imported = jsonOf(await run("import", published!, "--chain", "ethereum", "--json"));
      const hash = (imported.intents as Array<{ record: { intentHash: Hex } }>)[0]!.record
        .intentHash;
      expect(hash).toBe(built.intentHash);
      expect(jsonOf(await run("show", hash, "--json")).status).toMatchObject({
        state: "funded",
        destination: { chain: "solana" },
        prover: { kind: "Hyperlane", supported: true, destinationProver: HYPER },
      });

      const filled = await run(
        ...["fill", hash, "--claimant", SOLVER.address, "--send", "--keypair", keypair],
        ...["--auto-approve", "--json"],
      );
      expect(filled.code).toBe(0);
      expect(tokenAmount(bank(), account)).toBe(AMOUNT);

      expect(await relayLast()).toBe(1);
      expect((jsonOf(await run("show", hash, "--json")).status as { state: string }).state).toBe(
        "proven",
      );
      const before = await ethereum.balanceOf(usdc, SOLVER.address);
      const claimed = await run("claim", hash, "--private-key", SOLVER_KEY, "--json");
      expect(claimed.code).toBe(0);
      expect(await ethereum.balanceOf(usdc, SOLVER.address)).toBe(before + REWARD);
    }, 240_000);
  },
);
