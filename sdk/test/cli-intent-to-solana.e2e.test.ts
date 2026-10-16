/**
 * Intents to Solana written as Sauce and published with `sauce intent publish`, both chains local:
 * Ethereum an anvil (eco-routes' 2.12.0 Portal and HyperProver at the registry's addresses,
 * `eco-routes-anvil.ts`), Solana a LiteSVM bank running the released engine and Kitchen at their
 * release ids and eco-routes' programs as mainnet runs them (the pinned dump,
 * `svm/eco-routes-svm.ts`), reached through a JSON-RPC shim (`svm/rpc-shim.ts`).
 *
 *  1. A file paying a wallet USDC on Solana (`Solana(() => { USDC.transfer(recipient, amount) })`,
 *     the manual's `docs/examples/ethereum-to-solana.sauce.ts`): published from an Ethereum wallet, filled on
 *     Solana (the route creating the recipient's token account), proven back through Hyperlane and
 *     claimed on Ethereum.
 *  2. The same intent made step by step (`sauce intent publish` with no file), its recipient and
 *     token given as Solana addresses.
 *  3. A file whose body is a program: the first intent's route creates the Pot the Portal's
 *     executor owns (read as missing when it is published), moves the delivered USDC into it and
 *     cooks there; a second, published once the Pot exists, only cooks.
 *
 * MOCKED, and only this: Hyperlane's off-chain half, as in `cli-intent-solana.e2e.test.ts`.
 *
 * GATED on SAUCE_V12_RUNTIME_CREATION_HEX and the Solana engine artifacts.
 */
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  address,
  createKeyPairSignerFromBytes,
  generateKeyPairSigner,
  getCompiledTransactionMessageDecoder,
  lamports,
  type Address as SvmAddress,
  type KeyPairSigner,
} from "@solana/kit";
import { bytesToHex, encodeFunctionData, parseAbi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  ADDRESS_LOOKUP_TABLE_PROGRAM_ADDRESS,
  getAddressLookupTableEncoder,
} from "@solana-program/address-lookup-table";

import { buildFill } from "../src/cli/lifecycle.js";
import { IntentStore } from "../src/cli/store.js";
import { v12SvmEngineProgramId } from "../src/deployments/index.js";
import {
  associatedTokenAccount,
  buildSetExecutionFeeInstruction,
  deriveProgramDataPda,
  SOLANA_HYPERLANE,
  svmHyperDispatcherPda,
  svmIntentPot,
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
  type LocalChain,
} from "./cli-anvil.js";
import {
  deployMailbox,
  plantHyperProver,
  plantPortal,
  PORTAL_FIXTURES,
} from "./eco-routes-anvil.js";
import { loadEcoRoutes, programId, setTime } from "./svm/eco-routes-svm.js";
import {
  ENGINE_SO,
  sendInstructions,
  setMint,
  setTokenAccount,
  startEngine,
  svmArtifactsPresent,
  tokenAmount,
  type EngineHarness,
} from "./svm/engine-harness.js";
import { solanaShim, type SolanaShim } from "./svm/rpc-shim.js";

const SOLANA_URL = "http://127.0.0.1:65533/";
const USDC_MINT = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const PORTAL = programId("portal");
const HYPER = programId("hyper_prover");
/** Anvil's fourth dev account: the solver's account on Ethereum, which the reward pays. */
const SOLVER_KEY = "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6";
const SOLVER = privateKeyToAccount(SOLVER_KEY);
const AMOUNT = 1_000_000n;
const REWARD = 1_050_000n;
const KITCHEN_FEE = 5_000n;
const HYPERLANE_FEE = 7_777n;
const MAILBOX = parseAbi(["function process(bytes, bytes)"]);

/** The manual's example (docs/examples/ethereum-to-solana.sauce.ts): pays a Solana wallet USDC. */
const TRANSFER = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../docs/examples/ethereum-to-solana.sauce.ts"),
  "utf8",
);

/**
 * A program, not a list of transfers (the `const` makes it one): what was delivered, moved into the
 * Pot, paid on from there. Small, as a program an intent runs on Solana has to be: the fill carries
 * its bytecode, and Solana's transaction is 1,232 bytes, its accounts through a lookup table.
 */
const PROGRAM = `function main(recipient: Address, amount: Uint256, reward: Uint256) {
  Solana(() => {
    const delivered = amount;
    USDC.transfer(recipient, delivered);
  }, { tokens: [{ token: USDC, amount }] }).reward({ tokens: [{ token: USDC, amount: reward }] });
}
`;

/** The same, checking the Pot holds it first: too large for any fill. */
const CHECKED = `function main(recipient: Address, amount: Uint256, reward: Uint256) {
  Solana(() => {
    require(self.USDC >= amount, "short");
    USDC.transfer(recipient, amount);
  }, { tokens: [{ token: USDC, amount }] }).reward({ tokens: [{ token: USDC, amount: reward }] });
}
`;

const describeBoth = svmArtifactsPresent ? describeEvm : describe.skip;

describeBoth("sauce intent publish: Sauce intents to Solana, from an Ethereum wallet", () => {
  let ethereum: LocalChain;
  let harness: EngineHarness;
  let shim: SolanaShim;
  let work: string;
  let config: string;
  let keypair: string;
  let solver: KeyPairSigner;
  let usdc: Address;
  let mailbox: Address;
  const now = async (): Promise<bigint> => (await ethereum.publicClient.getBlock()).timestamp;
  const intent = (store: string, ...argv: string[]) =>
    sauce("intent", ...argv, "--config", config, "--store", store);

  /** Hyperlane's delivery, mocked: every message Solana's Mailbox wrote in the shim's last
   *  transaction, processed by Ethereum's Mailbox. */
  async function relayLast(): Promise<number> {
    const last = shim.sent.at(-1)!;
    const keys = getCompiledTransactionMessageDecoder().decode(last.messageBytes).staticAccounts;
    let delivered = 0;
    for (const key of keys) {
      const found = harness.svm.getAccount(key);
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

  /** The intent `published` stored, filled from the solver's keypair, proven, and claimed. */
  async function fillProveClaim(store: string, hash: Hex): Promise<void> {
    const filled = await intent(
      store,
      ...["fill", hash, "--claimant", SOLVER.address, "--send", "--keypair", keypair],
      ...["--auto-approve", "--json"],
    );
    expect(filled.code).toBe(0);
    expect(await relayLast()).toBe(1);
    const before = await ethereum.balanceOf(usdc, SOLVER.address);
    const claimed = await intent(store, "claim", hash, "--private-key", SOLVER_KEY, "--json");
    expect(claimed.code).toBe(0);
    expect(await ethereum.balanceOf(usdc, SOLVER.address)).toBe(before + REWARD);
  }

  /** `text` published from the owner's Ethereum wallet with `args`; the hash of its one intent. */
  /** What the last `publish` said beside its result. */
  let said = "";

  async function publish(store: string, text: string, ...args: string[]): Promise<Hex> {
    const file = join(work, `intent-${Math.random().toString(16).slice(2)}.sauce.ts`);
    writeFileSync(file, text);
    const start = await now();
    const published = await intent(
      store,
      ...["publish", file, "--chain", "ethereum", "--private-key", OWNER_KEY, "--yes", "--json"],
      ...["--intent-deadline", String(start + 3600n), "--intent-creator", OWNER.address],
      ...["--intent-reward-deadline", String(start + 7200n), "--intent-execution-fee", "auto"],
      ...["--args", ...args],
    );
    if (published.code !== 0) throw new Error(published.stderr);
    said = published.stderr;
    const [only] = jsonOf(published).intents as Array<{ intentHash: Hex }>;

    return only!.intentHash;
  }

  beforeAll(async () => {
    work = mkdtempSync(join(tmpdir(), "sauce-intent-to-solana-e2e-"));
    ethereum = await startChain("ethereum");
    usdc = await ethereum.plant(fixture("MockERC20"), registered(ethereum.chain, "USDC"));
    await plantPortal(ethereum, PORTAL_FIXTURES.v2_12);
    mailbox = await deployMailbox(ethereum, HYPERLANE_FEE);
    await plantHyperProver(ethereum, mailbox, [
      universalOfSvmKey(await svmHyperDispatcherPda(HYPER)),
    ]);
    await ethereum.mint(usdc, OWNER.address, 10n * REWARD);

    harness = await startEngine(await now(), ENGINE_SO as string, address(v12SvmEngineProgramId()));
    loadEcoRoutes(harness.svm);
    setTime(harness.svm, await now());
    // Priced, as mainnet's Kitchen is: the executor pays the fee from what the route delivers.
    const { address: programData } = await deriveProgramDataPda(harness.kitchen);
    const priced = await sendInstructions(harness, [
      buildSetExecutionFeeInstruction({
        kitchen: harness.kitchen,
        authority: harness.payer.address,
        programData,
        feeConfig: harness.feeConfig,
        fee: KITCHEN_FEE,
      }),
    ]);
    if (!priced.ok) throw new Error(`pricing the Kitchen failed: ${priced.err}`);
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const bytes = new Uint8Array([
      ...privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32),
      ...publicKey.export({ format: "der", type: "spki" }).subarray(-32),
    ]);
    keypair = join(work, "solver.json");
    writeFileSync(keypair, JSON.stringify([...bytes]));
    solver = await createKeyPairSignerFromBytes(bytes);
    harness.svm.airdrop(solver.address, lamports(10_000_000_000n));
    setMint(harness, USDC_MINT, 6);
    setTokenAccount(
      harness,
      await associatedTokenAccount(solver.address, USDC_MINT, TOKEN_PROGRAM_ID),
      USDC_MINT,
      solver.address,
      100n * AMOUNT,
    );
    shim = solanaShim(harness.svm, SOLANA_URL);
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

  /** A wallet with no token account for USDC yet: the route creates it. */
  const wallet = async (): Promise<{ key: SvmAddress; account: SvmAddress }> => {
    const key = (await generateKeyPairSigner()).address;

    return { key, account: await associatedTokenAccount(key, USDC_MINT, TOKEN_PROGRAM_ID) };
  };

  it("publishes a file paying a Solana wallet, fills it there, proves it and claims", async () => {
    const store = mkdtempSync(join(work, "store-"));
    const recipient = await wallet();
    const hash = await publish(store, TRANSFER, recipient.key, String(AMOUNT), String(REWARD));
    const shown = jsonOf(await intent(store, "show", hash, "--json")).status;
    expect(shown).toMatchObject({ state: "funded", destination: { chain: "solana" } });
    expect(harness.svm.getAccount(recipient.account).exists).toBe(false);
    await fillProveClaim(store, hash);
    expect(tokenAmount(harness, recipient.account)).toBe(AMOUNT);
  }, 240_000);

  it("makes the same intent step by step, its recipient and token Solana's", async () => {
    const store = mkdtempSync(join(work, "store-"));
    const recipient = await wallet();
    const out = join(work, "made.sauce.ts");
    const published = await intent(
      store,
      ...["publish", "--source", "ethereum", "--destination", "solana", "--token", USDC_MINT],
      ...["--amount", "1", "--recipient", recipient.key, "--reward-token", "USDC"],
      ...["--reward", "1.05", "--fill-deadline", "+1h", "--reward-deadline", "+2h"],
      ...["--prover", "HyperProver", "--out", out, "--private-key", OWNER_KEY, "--yes", "--json"],
    );
    expect(published.stderr).toContain(`The recipient is the wallet ${recipient.key}`);
    expect(published.code).toBe(0);
    const [only] = jsonOf(published).intents as Array<{ intentHash: Hex }>;
    await fillProveClaim(store, only!.intentHash);
    expect(tokenAmount(harness, recipient.account)).toBe(AMOUNT);
  }, 240_000);

  it("creates the executor's Pot from the first program's route, then cooks on it", async () => {
    writeFileSync(join(work, "checked.sauce.ts"), CHECKED);
    const pot = await svmIntentPot({ portal: PORTAL, kitchen: harness.kitchen });
    expect(harness.svm.getAccount(pot).exists).toBe(false);
    const feeBefore = harness.svm.getBalance(harness.feeConfig) ?? 0n;
    for (const round of [1, 2]) {
      const store = mkdtempSync(join(work, "store-"));
      const recipient = await wallet();
      const hash = await publish(store, PROGRAM, recipient.key, String(AMOUNT), String(REWARD));
      // The first route creates the Pot, and says another published before it is filled races it;
      // the second, read once the Pot exists, does not. Both fills need a lookup table.
      expect(said.includes("does not exist yet: this intent's route creates it")).toBe(round === 1);
      expect(said).toContain("only through an address lookup table");
      // Too large for one transaction as it is: a simulation says the table comes first.
      const planned = await intent(
        store,
        ...["fill", hash, "--solver", solver.address, "--claimant", SOLVER.address, "--json"],
      );
      expect(planned.code).toBe(0);
      expect(jsonOf(planned).intents).toMatchObject([{ ok: true, sent: false, simulated: false }]);
      await fillProveClaim(store, hash);
      expect(harness.svm.getAccount(pot).exists).toBe(true);
      expect(tokenAmount(harness, recipient.account)).toBe(AMOUNT);
      expect((harness.svm.getBalance(harness.feeConfig) ?? 0n) - feeBefore).toBe(
        BigInt(round) * KITCHEN_FEE,
      );
    }
    // A program whose fill would not fit even through a table is refused before anything is sent.
    const refused = await intent(
      mkdtempSync(join(work, "store-")),
      ...["publish", join(work, "checked.sauce.ts"), "--chain", "ethereum"],
      ...["--private-key", OWNER_KEY],
      ...["--yes", "--intent-deadline", String((await now()) + 3600n)],
      ...["--intent-creator", OWNER.address, "--intent-execution-fee", "auto"],
      ...["--args", (await wallet()).key, String(AMOUNT), "1"],
    );
    expect(refused.code).toBe(1);
    expect(refused.stderr).toMatch(/even through a lookup table, past Solana's 1232/);
    // A lookup table given to a fill must still be active: one deactivated is refused, before
    // anything is sent through it.
    const store = mkdtempSync(join(work, "store-"));
    const hash = await publish(store, PROGRAM, (await wallet()).key, String(AMOUNT), "1");
    const deactivated = (await generateKeyPairSigner()).address;
    const table = new Uint8Array(
      getAddressLookupTableEncoder().encode({
        deactivationSlot: 5n,
        lastExtendedSlot: 1n,
        lastExtendedSlotStartIndex: 0,
        authority: solver.address,
        addresses: [PORTAL],
      }),
    );
    harness.svm.setAccount({
      address: deactivated,
      data: table,
      executable: false,
      lamports: lamports(harness.svm.minimumBalanceForRentExemption(BigInt(table.length))),
      programAddress: ADDRESS_LOOKUP_TABLE_PROGRAM_ADDRESS,
      space: BigInt(table.length),
    });
    await expect(
      buildFill(
        new IntentStore(store).load(hash).record,
        { "1": ethereum.rpcUrl, "1399811149": SOLANA_URL },
        { from: solver.address, claimant: SOLVER.address, lookupTable: deactivated },
      ),
    ).rejects.toThrow(`the lookup table ${deactivated} was deactivated in slot 5`);
    // What the routes delivered went where the program sent it: none stays in the Pot.
    expect(
      tokenAmount(harness, await associatedTokenAccount(pot, USDC_MINT, TOKEN_PROGRAM_ID)),
    ).toBe(0n);
  }, 480_000);
});
