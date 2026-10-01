/**
 * An intent from Arbitrum to Solana through the `sauce` command, both chains local: published on an
 * anvil standing in for Arbitrum (eco-routes' 2.12.0 Portal and HyperProver at the registry's
 * addresses, `eco-routes-anvil.ts`), imported from that transaction, then filled and proven on
 * Solana in LiteSVM running the programs mainnet runs (the pinned dump, `svm/eco-routes-svm.ts`:
 * the Portal, the HyperProver, proof_helper, Hyperlane's Mailbox and IGP, with the outbox and IGP
 * accounts as mainnet held them), the proof carried back and the reward claimed on Arbitrum. And a
 * second intent cancelled on Solana after its deadline, the cancellation proven once final, and
 * refunded on Arbitrum before the reward's deadline.
 *
 * The CLI reaches Solana through a JSON-RPC shim over the bank (`svm/rpc-shim.ts`), which checks
 * every signature it is sent, and Arbitrum over HTTP.
 *
 * MOCKED, and only this: Hyperlane's off-chain half. The test reads the message Solana's Mailbox
 * wrote (the dispatched-message account, as a relayer reads it) and delivers it to Arbitrum's
 * Mailbox itself (`MockMailbox.process`, no ISM). Arbitrum's HyperProver is real: its `handle`
 * checks the sender is whitelisted — Solana's HyperProver dispatcher, as mainnet's whitelist it —
 * and records the proof the Portal pays on.
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

import { ecoRoutesContract, ecoRoutesPortal } from "../src/protocols/eco-routes/lookup.js";
import { hashIntent } from "../src/routes/encode.js";
import { toUniversalAddress } from "../src/routes/normalize.js";
import { publishAndFundTx } from "../src/routes/portal.js";
import type { Intent } from "../src/routes/types.js";
import {
  associatedTokenAccount,
  SOLANA_HYPERLANE,
  svmHyperDispatcherPda,
  svmTokenTransferCall,
  TOKEN_PROGRAM_ID,
  universalOfSvmKey,
} from "../src/svm/index.js";
import {
  describeEvm,
  fixture,
  jsonOf,
  OWNER,
  OWNER_KEY,
  registered,
  sauce,
  startChain,
  WORKER,
  type LocalChain,
} from "./cli-anvil.js";
import {
  deployMailbox,
  plantHyperProver,
  plantPortal,
  PORTAL_FIXTURES,
} from "./eco-routes-anvil.js";
import { ecoRoutesSvm, programId, setTime } from "./svm/eco-routes-svm.js";
import { setMint, setTokenAccount, tokenAmount, type EngineHarness } from "./svm/engine-harness.js";
import { solanaShim, type SolanaShim } from "./svm/rpc-shim.js";

const SOLANA_URL = "http://127.0.0.1:65534/";
const USDC_MINT = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const PORTAL = programId("portal");
const HYPER = programId("hyper_prover");
/** Anvil's fourth dev account: the solver's account on Arbitrum, which the reward pays. */
const SOLVER_KEY = "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6";
const SOLVER = privateKeyToAccount(SOLVER_KEY);
const AMOUNT = 1_000_000n;
const REWARD = 1_050_000n;
const HYPERLANE_FEE = 7_777n;
const APPROVE = parseAbi(["function approve(address, uint256)"]);
const MAILBOX = parseAbi(["function process(bytes, bytes)"]);

describeEvm(
  "sauce intent: Arbitrum to Solana, filled and proven on Solana, claimed; cancelled",
  () => {
    let arbitrum: LocalChain;
    let svm: LiteSVM;
    let shim: SolanaShim;
    let work: string;
    let config: string;
    let keypair: string;
    let solver: KeyPairSigner;
    let recipient: SvmAddress;
    let usdc: Address;
    let mailbox: Address;
    const portal = () => getAddress(ecoRoutesPortal("arbitrum"));
    /** The harness helpers take an engine harness; they need only its bank. */
    const bank = (): EngineHarness => ({ svm }) as unknown as EngineHarness;
    const now = async (): Promise<bigint> => (await arbitrum.publicClient.getBlock()).timestamp;
    const run = (store: string, ...argv: string[]) =>
      sauce("intent", ...argv, "--config", config, "--store", store);

    /** Publishes an Arbitrum -> Solana intent from the creator, as eco-routes' Solana deposit
     *  address does (`AMOUNT` USDC to `recipient`), and imports it from that transaction. */
    async function published(store: string, salt: string, deadline: bigint, reward: bigint) {
      const intent: Intent = {
        sourceChainId: 42161n,
        destination: 1399811149n,
        route: {
          salt: `0x${salt.repeat(32)}`,
          deadline,
          portal: universalOfSvmKey(PORTAL),
          nativeAmount: 0n,
          tokens: [{ token: universalOfSvmKey(USDC_MINT), amount: AMOUNT }],
          calls: [
            await svmTokenTransferCall({
              portal: PORTAL,
              mint: USDC_MINT,
              amount: AMOUNT,
              decimals: 6,
              recipient,
            }),
          ],
        },
        reward: {
          deadline: reward,
          creator: toUniversalAddress(OWNER.address),
          prover: toUniversalAddress(ecoRoutesContract("arbitrum", "HyperProver")),
          nativeAmount: 0n,
          tokens: [{ token: toUniversalAddress(usdc), amount: REWARD }],
        },
      };
      await arbitrum.send(
        arbitrum.owner,
        usdc,
        encodeFunctionData({ abi: APPROVE, functionName: "approve", args: [portal(), REWARD] }),
      );
      const tx = publishAndFundTx(intent, false, { portal: portal() });
      const hash = await arbitrum.send(arbitrum.owner, getAddress(tx.to), tx.data, tx.value);
      const imported = jsonOf(await run(store, "import", hash, "--chain", "arbitrum", "--json"));
      expect(
        (imported.intents as Array<{ record: { intentHash: Hex } }>)[0]!.record.intentHash,
      ).toBe(hashIntent(intent).intentHash);

      return hashIntent(intent).intentHash;
    }

    /** Hyperlane's delivery, mocked: every message Solana's Mailbox wrote in the shim's last
     *  transaction, read from its dispatched-message account, processed by Arbitrum's Mailbox. */
    async function relayLast(): Promise<number> {
      const last = shim.sent.at(-1)!;
      const keys = getCompiledTransactionMessageDecoder().decode(last.messageBytes).staticAccounts;
      let delivered = 0;
      for (const key of keys) {
        const found = svm.getAccount(key);
        if (!found.exists || found.programAddress !== SOLANA_HYPERLANE.mailbox) continue;
        if (new TextDecoder().decode(found.data.subarray(1, 9)) !== "DISPATCH") continue;
        const message = bytesToHex(found.data.subarray(1 + 8 + 4 + 8 + 32));
        await arbitrum.send(
          arbitrum.deployer,
          mailbox,
          encodeFunctionData({ abi: MAILBOX, functionName: "process", args: ["0x", message] }),
        );
        delivered++;
      }

      return delivered;
    }

    beforeAll(async () => {
      work = mkdtempSync(join(tmpdir(), "sauce-intent-solana-e2e-"));
      arbitrum = await startChain("arbitrum", 9500 + WORKER);
      usdc = await arbitrum.plant(fixture("MockERC20"), registered(arbitrum.chain, "USDC"));
      await plantPortal(arbitrum, PORTAL_FIXTURES.v2_12);
      mailbox = await deployMailbox(arbitrum, HYPERLANE_FEE);
      // Arbitrum's HyperProver trusts Solana's HyperProver dispatcher, the message's sender.
      await plantHyperProver(arbitrum, mailbox, [
        universalOfSvmKey(await svmHyperDispatcherPda(HYPER)),
      ]);
      await arbitrum.mint(usdc, OWNER.address, 10n * REWARD);

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
      // The recipient's token account, which the route pays: it must exist when the route runs.
      recipient = (await generateKeyPairSigner()).address;
      setTokenAccount(bank(), recipient, USDC_MINT, (await generateKeyPairSigner()).address, 0n);
      shim = solanaShim(svm, SOLANA_URL);
      shim.install();
      config = join(work, "sauce.config.json");
      writeFileSync(
        config,
        JSON.stringify({ rpcUrls: { "42161": arbitrum.rpcUrl, "1399811149": SOLANA_URL } }),
      );
    }, 180_000);

    afterAll(async () => {
      shim?.restore();
      rmSync(work, { recursive: true, force: true });
      await arbitrum?.stop();
    });

    it("fills it on Solana, proves it to Arbitrum through Hyperlane, and claims the reward", async () => {
      const store = mkdtempSync(join(work, "store-"));
      const start = await now();
      const hash = await published(store, "01", start + 3600n, start + 7200n);
      const status = jsonOf(await run(store, "show", hash, "--json")).status;
      expect(status).toMatchObject({
        state: "funded",
        destination: { chain: "solana", portal: PORTAL, claimant: null, canCancel: true },
        prover: { kind: "Hyperlane", supported: true, destinationProver: HYPER },
      });

      // Rehearsed from the solver's own accounts, for its Arbitrum address.
      const rehearsal = jsonOf(
        await run(
          store,
          "fill",
          hash,
          "--solver",
          solver.address,
          "--claimant",
          SOLVER.address,
          "--json",
        ),
      );
      expect(rehearsal).toMatchObject({
        intents: [{ ok: true, sent: false, solver: solver.address }],
      });
      expect(tokenAmount(bank(), recipient)).toBe(0n);
      // A Solana key is no claimant on Arbitrum: it must be named.
      const unnamed = await run(store, "fill", hash, "--solver", solver.address);
      expect(unnamed.code).toBe(2);
      expect(unnamed.stderr).toContain(
        "needs the claimant, an address on the intent's source chain",
      );

      const filled = await run(
        store,
        ...["fill", hash, "--claimant", SOLVER.address, "--send", "--keypair", keypair],
        ...["--auto-approve", "--json"],
      );
      expect(filled.code).toBe(0);
      const [sent] = (JSON.parse(filled.stdout) as { intents: Array<Record<string, unknown>> })
        .intents;
      expect(sent).toMatchObject({ ok: true, sent: true, solver: solver.address });
      expect((sent!.proof as { message: string }).message).toMatch(/^0x[0-9a-f]{64}$/);
      expect(tokenAmount(bank(), recipient)).toBe(AMOUNT);

      // Not claimable before the proof arrives.
      const early = await run(store, "claim", hash, "--private-key", SOLVER_KEY);
      expect(early.code).toBe(1);
      expect(await relayLast()).toBe(1);
      const shown = jsonOf(await run(store, "show", hash, "--json"));
      expect((shown.status as { state: string }).state).toBe("proven");
      const before = await arbitrum.balanceOf(usdc, SOLVER.address);
      const claimed = await run(store, "claim", hash, "--private-key", SOLVER_KEY, "--json");
      expect(claimed.code).toBe(0);
      expect(await arbitrum.balanceOf(usdc, SOLVER.address)).toBe(before + REWARD);
    }, 240_000);

    it("cancels it on Solana after its deadline, proves the cancellation once final, and refunds", async () => {
      const store = mkdtempSync(join(work, "store-"));
      const start = await now();
      const hash = await published(store, "02", start + 60n, start + 100_000n);
      const early = await run(store, "cancel", hash, "--keypair", keypair);
      expect(early.code).toBe(1);
      expect(early.stdout).toContain("not before the route's deadline");
      setTime(svm, start + 120n);
      const cancelled = await run(store, "cancel", hash, "--keypair", keypair, "--auto-approve");
      expect(cancelled.code).toBe(0);
      expect(cancelled.stdout).toContain("no solver can fill it now");
      const status = jsonOf(await run(store, "show", hash, "--json")).status;
      expect(status).toMatchObject({ state: "cancelled", destination: { cancelled: true } });
      // The shim finalizes every slot it has seen, so the cancellation is final at once.
      const proved = await run(
        store,
        "prove",
        hash,
        "--keypair",
        keypair,
        "--auto-approve",
        "--json",
      );
      expect(proved.code).toBe(0);
      // What the proof spends beyond its fee: the IGP's gas for the message, as mainnet's IGP
      // quotes it, and the message accounts' rent.
      const [proof] = (JSON.parse(proved.stdout) as { transactions: Array<{ value: string }> })
        .transactions;
      expect(BigInt(proof!.value)).toBeGreaterThan(0n);
      expect(await relayLast()).toBe(1);
      const claim = await run(store, "claim", hash, "--private-key", SOLVER_KEY);
      expect(claim.code).toBe(1);
      expect(claim.stdout).toContain("pays no claimant");
      const before = await arbitrum.balanceOf(usdc, OWNER.address);
      const refunded = await run(store, "refund", hash, "--private-key", OWNER_KEY);
      expect(refunded.code).toBe(0);
      expect(await arbitrum.balanceOf(usdc, OWNER.address)).toBe(before + REWARD);
    }, 240_000);
  },
);
