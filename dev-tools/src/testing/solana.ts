/**
 * A Solana test chain: LiteSVM in this process with the released engine and Kitchen, ten test
 * accounts each with a Pot, and the calls a test makes — fund an account, run or simulate a program
 * as an account's cook, read balances, snapshot and revert, move the clock.
 *
 * The test accounts' keys come from fixed seeds, so they are the same on every run: a recording made
 * with them replays with them.
 */
import { createHash } from "node:crypto";
import {
  address,
  createKeyPairSignerFromPrivateKeyBytes,
  getAddressDecoder,
  getAddressEncoder,
  isAddress,
  type Address,
  type KeyPairSigner,
} from "@solana/kit";
import { bytesToHex, parseUnits, type Hex } from "viem";

import {
  compileProgram,
  CookReverted,
  type CompiledProgram,
  type ProgramInput,
  type Value,
} from "./program.js";
import {
  Bank,
  clusterSource,
  stateSource,
  type BankAccount,
  type ClusterHeader,
  type Sent,
} from "./solana-bank.js";
import { cook, failureOf, sendStep, type CookChain, type Cooked } from "./solana-cook.js";
import {
  buildAtaPrepend,
  buildCreatePotInstruction,
  decodeExecutionFeeConfig,
  deriveExecutionFeeConfigPda,
  derivePotPda,
  EXECUTION_FEE_CONFIG_DISCRIMINATOR,
  MAX_POT_LEN,
  svmTokenAccount,
  svmTokenRows,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  v12SvmEngineProgramId,
  v12SvmKitchenProgramId,
  type CanonicalChain,
  type EntryValue,
} from "./sdk.js";
import type { ForkMode } from "./state.js";

const SYSTEM_PROGRAM = "11111111111111111111111111111111" as Address;
/** The salt `sauce pot` and `sauce run` use when given none. */
const POT_SALT = new Uint8Array(32);
/** What each test account holds when the chain starts: 1,000 SOL. */
const START_LAMPORTS = 1_000n * 10n ** 9n;
const TEST_ACCOUNTS = 10;

/** A key's secret, from a fixed seed: the same on every run. */
const seedOf = (name: string): Uint8Array =>
  new Uint8Array(createHash("sha256").update(`@eco-incorp/sauce/testing ${name}`).digest());

export interface SolanaTestAccount {
  readonly index: number;
  /** Its public key, base58: a wallet that signs and pays for its cooks. */
  readonly address: Address;
  /** Its keypair as `solana-keygen` writes one: the 32-byte secret, then the public key. */
  readonly secretKey: Uint8Array;
  /** Its Pot under the default salt. Created on the account's first cook, or by `deployPot`. */
  readonly pot: Address;
}

/** An account as the chain holds it. */
export interface SolanaAccount {
  readonly lamports: bigint;
  /** The program that owns it. */
  readonly owner: Address;
  readonly data: Uint8Array;
  readonly executable: boolean;
}

export interface SolanaCookOptions {
  /** The account whose Pot cooks: an index into the test accounts, or one of them. Default 0. */
  readonly from?: number | SolanaTestAccount;
  /** `main`'s arguments, in order: integers as bigint or number, a key as base58. */
  readonly args?: readonly EntryValue[];
  /**
   * The program's `Account` parameters, by name, as `sauce run --account` takes them: `pot`,
   * `owner`, `pot:USDC` (the Pot's USDC account), `@to:USDC` (that of `main`'s argument `to`),
   * `mint:USDC`, `program:USDC`, a base58 address. The accounts the SDK added for the token methods
   * and the venues are derived: name only the rest.
   */
  readonly accounts?: Readonly<Record<string, string>>;
}

/** How much one holder's balance of one token changed. */
export interface SolanaChange {
  /** The wallet, Pot or account whose balance it is: a token account's owner, for a token. */
  readonly holder: Address;
  /** `SOL`, the token's registry symbol, or its mint. */
  readonly token: string;
  /** The token's mint; absent for SOL. */
  readonly mint?: Address;
  /** After less before, in base units (lamports for SOL). */
  readonly amount: bigint;
}

export interface SolanaCookResult {
  /** The cook's transaction; absent from a simulation. */
  readonly signature?: string;
  readonly computeUnits: bigint;
  /** What the program returned, raw. */
  readonly returnData: Hex;
  /** What `main` returned, read as it declares it; undefined when it declares nothing. */
  readonly returned: Value | undefined;
  /** The transaction's program logs. */
  readonly logs: readonly string[];
  /** Every balance the cook changed: SOL, and each token by the owner of its token account. */
  readonly changes: readonly SolanaChange[];
  /** The program did not fit one transaction, so it was staged into a code buffer first. */
  readonly staged: boolean;
  /** The staged cook's accounts went through a lookup table. */
  readonly lookupTable: boolean;
  /** How much `holder`'s balance of `token` (`SOL`, a symbol, or a mint) changed. */
  delta(holder: Address, token: string): bigint;
}

/** A token as a test names it, resolved on the chain. */
interface SolanaToken {
  readonly mint: Address;
  readonly program: Address;
  readonly decimals: number;
  readonly label: string;
}

/** A token account's mint, owner and amount, or `undefined` for any other account. */
function tokenAccountOf(
  account: BankAccount | null,
): { mint: Address; owner: Address; amount: bigint } | undefined {
  if (account === null) return undefined;
  if (account.owner !== TOKEN_PROGRAM_ID && account.owner !== TOKEN_2022_PROGRAM_ID)
    return undefined;
  const { data } = account;
  // The base layout's 165 bytes; an extended Token-2022 account marks its kind at byte 165.
  if (data.length < 165 || (data.length > 165 && data[165] !== 2)) return undefined;

  return {
    mint: getAddressDecoder().decode(data.subarray(0, 32)),
    owner: getAddressDecoder().decode(data.subarray(32, 64)),
    amount: new DataView(data.buffer, data.byteOffset).getBigUint64(64, true),
  };
}

export class SolanaTestChain {
  private readonly cookChain: CookChain;
  private recordTo: { readonly path: string; readonly rpcUrl: string } | undefined;

  private constructor(
    /** The chain the bank runs as. */
    readonly chain: CanonicalChain,
    /** How it was started: "replay", "record", "live" (forks) or "local" (an empty chain). */
    readonly mode: "replay" | "record" | "live" | "local",
    private readonly bank: Bank,
    readonly engine: Address,
    readonly kitchen: Address,
    private readonly feeConfig: Address,
    private readonly signers: readonly KeyPairSigner[],
    private readonly accounts: readonly SolanaTestAccount[],
    /** Pays for the token accounts `fund` creates, so no test account's balance moves. */
    private readonly funder: KeyPairSigner,
    recordTo: { readonly path: string; readonly rpcUrl: string } | undefined,
  ) {
    this.recordTo = recordTo;
    this.cookChain = { bank, chain, engine, kitchen, feeConfig };
  }

  /**
   * The chain in `bank`, ready to cook: the test accounts and the funder holding SOL, the Kitchen's
   * fee config the chain's own (none on the chain, or `zeroFee`: one charging nothing), and account
   * 0's Pot created.
   */
  static async start(
    chain: CanonicalChain,
    bank: Bank,
    options: {
      readonly zeroFee?: boolean;
      readonly recordTo?: { readonly path: string; readonly rpcUrl: string };
    },
  ): Promise<SolanaTestChain> {
    const engine = address(v12SvmEngineProgramId());
    const kitchen = address(v12SvmKitchenProgramId());
    const { address: feeConfig } = await deriveExecutionFeeConfigPda(kitchen);
    const seeds = Array.from({ length: TEST_ACCOUNTS }, (_, index) =>
      seedOf(`solana account ${index}`),
    );
    const signers = await Promise.all(
      seeds.map((seed) => createKeyPairSignerFromPrivateKeyBytes(seed)),
    );
    const funder = await createKeyPairSignerFromPrivateKeyBytes(seedOf("solana funder"));
    const accounts = await Promise.all(
      signers.map(async (signer, index) => ({
        index,
        address: signer.address,
        secretKey: new Uint8Array([
          ...seeds[index]!,
          ...getAddressEncoder().encode(signer.address),
        ]),
        pot: (await derivePotPda(kitchen, signer.address, POT_SALT)).address,
      })),
    );
    const wallets = [...signers, funder].map((signer) => signer.address);
    await bank.ensure([...wallets, feeConfig]);
    for (const wallet of wallets) {
      bank.set(wallet, {
        lamports: START_LAMPORTS,
        owner: SYSTEM_PROGRAM,
        data: new Uint8Array(),
        executable: false,
      });
    }
    const held = bank.account(feeConfig);
    if (held === null || options.zeroFee === true) {
      const data = new Uint8Array(16);
      data.set(EXECUTION_FEE_CONFIG_DISCRIMINATOR, 0);
      bank.set(feeConfig, {
        lamports: held?.lamports ?? bank.rentExempt(16),
        owner: kitchen,
        data,
        executable: false,
      });
    }
    const testChain = new SolanaTestChain(
      chain,
      bank.mode,
      bank,
      engine,
      kitchen,
      feeConfig,
      signers,
      accounts,
      funder,
      options.recordTo,
    );
    await testChain.deployPot(0);

    return testChain;
  }

  /** Test account `index` (0–9), with its keypair and its Pot's address. */
  account(index = 0): SolanaTestAccount {
    const account = this.accounts[index];
    if (account === undefined)
      throw new RangeError(`there are 10 test accounts, 0 to 9: not ${index}`);

    return account;
  }

  private accountOf(from: number | SolanaTestAccount | undefined): SolanaTestAccount {
    return typeof from === "object" ? from : this.account(from ?? 0);
  }

  /** The Kitchen's execution fee, in lamports, which every cook's owner pays. */
  async executionFee(): Promise<bigint> {
    await this.bank.ensure([this.feeConfig]);
    const config = this.bank.account(this.feeConfig);
    if (config === null) throw new Error(`the Kitchen's fee config ${this.feeConfig} is not here`);

    return decodeExecutionFeeConfig(config.data);
  }

  /** Creates `account`'s Pot through the Kitchen if it is not created yet. */
  async deployPot(account: number | SolanaTestAccount = 0): Promise<Address> {
    const owner = this.accountOf(account);
    await this.bank.ensure([owner.pot]);
    if (this.bank.account(owner.pot) !== null) return owner.pot;
    await sendStep(
      this.cookChain,
      this.signers[owner.index]!,
      [
        buildCreatePotInstruction({
          kitchen: this.kitchen,
          owner: owner.address,
          engineProgram: this.engine,
          pot: owner.pot,
          salt: POT_SALT,
          space: MAX_POT_LEN,
        }),
      ],
      `creating the Pot of ${owner.address}`,
    );

    return owner.pot;
  }

  /** The account at `key`, or `null` where the chain holds none. */
  async getAccount(key: Address): Promise<SolanaAccount | null> {
    await this.bank.ensure([key]);
    const account = this.bank.account(key);

    return account === null ? null : { ...account };
  }

  /** Sets the account at `key` (`null` removes it). A snapshot puts it back like any other. */
  async setAccount(key: Address, account: SolanaAccount | null): Promise<void> {
    await this.bank.ensure([key]);
    this.bank.set(
      key,
      account === null ? null : { ...account, data: new Uint8Array(account.data) },
    );
  }

  /** `name` as a token: a registry symbol on the chain, or a mint's address, read from the chain. */
  private async tokenOf(name: string): Promise<SolanaToken> {
    const row = svmTokenRows(this.chain).find(
      (entry) => entry.symbol.toLowerCase() === name.toLowerCase(),
    );
    if (row === undefined && !isAddress(name)) {
      throw new Error(
        `${name} is not a token the registry has on ${this.chain.slug}: give its mint`,
      );
    }
    const mint = address(row?.mint ?? name);
    await this.bank.ensure([mint]);
    const account = this.bank.account(mint);
    const what = row === undefined ? `the mint ${mint}` : `${row.symbol}'s mint, ${mint},`;
    if (account === null) {
      throw new Error(
        `${what} is not on this chain` +
          (this.mode === "local"
            ? ": an empty local chain has no tokens but wrapped SOL, so fork one"
            : this.bank.unrecorded.has(mint)
              ? ": the recording does not hold it, so record again"
              : ""),
      );
    }
    if (account.owner !== TOKEN_PROGRAM_ID && account.owner !== TOKEN_2022_PROGRAM_ID) {
      throw new Error(`${what} is not a mint: it is an account of ${account.owner}`);
    }

    return {
      mint,
      program: account.owner,
      decimals: account.data[44]!,
      label: row?.symbol ?? mint,
    };
  }

  /**
   * `holder`'s balance of `token`, in base units: `SOL` its lamports, a token (a registry symbol, or
   * a mint) its associated token account's amount, 0 where it has none.
   */
  async balanceOf(holder: Address, token: string): Promise<bigint> {
    if (token.toUpperCase() === "SOL") {
      await this.bank.ensure([holder]);
      return this.bank.account(holder)?.lamports ?? 0n;
    }
    const resolved = await this.tokenOf(token);
    const account = await svmTokenAccount(
      { mint: resolved.mint, tokenProgram: resolved.program },
      holder,
    );
    await this.bank.ensure([account]);

    return tokenAccountOf(this.bank.account(account))?.amount ?? 0n;
  }

  /**
   * Gives `holder` more of each token: `{ USDC: "100", SOL: "1" }` adds whole tokens, a bigint adds
   * base units (`{ USDC: 100_000_000n }`). A token's amount is written into `holder`'s associated
   * token account, which is created first where it is missing (its rent paid by the kit, not by a
   * test account); the mint's supply is left as it was. SOL is added to the account itself.
   */
  async fund(holder: Address, amounts: Readonly<Record<string, string | bigint>>): Promise<void> {
    for (const [name, amount] of Object.entries(amounts)) {
      if (name.toUpperCase() === "SOL") {
        const units = typeof amount === "bigint" ? amount : parseUnits(amount, 9);
        await this.bank.ensure([holder]);
        const held = this.bank.account(holder);
        this.bank.set(
          holder,
          held === null
            ? { lamports: units, owner: SYSTEM_PROGRAM, data: new Uint8Array(), executable: false }
            : { ...held, lamports: held.lamports + units },
        );
        continue;
      }
      const token = await this.tokenOf(name);
      const units = typeof amount === "bigint" ? amount : parseUnits(amount, token.decimals);
      const key = await svmTokenAccount({ mint: token.mint, tokenProgram: token.program }, holder);
      await this.bank.ensure([holder, key]);
      if (this.bank.account(key) === null) {
        const { instruction } = await buildAtaPrepend({
          payer: this.funder,
          owner: holder,
          mint: token.mint,
          tokenProgram: token.program,
        });
        await sendStep(
          this.cookChain,
          this.funder,
          [instruction],
          `creating the ${token.label} account of ${holder}`,
        );
      }
      const held = this.bank.account(key)!;
      const before = tokenAccountOf(held)?.amount;
      if (before === undefined) throw new Error(`${key} is not a token account`);
      const target = before + units;
      if (target >= 2n ** 64n) {
        throw new Error(`funding ${holder} with ${units} ${token.label} passes a token's 2^64 - 1`);
      }
      const data = new Uint8Array(held.data);
      new DataView(data.buffer).setBigUint64(64, target, true);
      // A native account's (wrapped SOL's) amount is its lamports above its rent: both move. It
      // says so in `is_native`, an option whose tag is at byte 109.
      const native = held.data[109] === 1;
      this.bank.set(key, {
        ...held,
        data,
        lamports: native ? held.lamports + units : held.lamports,
      });
      if ((await this.balanceOf(holder, name)) !== target) {
        throw new Error(`funding ${holder} with ${name} did not change its balance as written`);
      }
    }
  }

  /** `program` compiled for Solana, its imports read as they are now. */
  compile(program: ProgramInput): CompiledProgram {
    return compileProgram(program, this.chain);
  }

  /** `SOL`, a registry symbol or a mint, as a change names it. */
  private tokenName(mint: Address): string {
    return svmTokenRows(this.chain).find((row) => row.mint === mint)?.symbol ?? mint;
  }

  /** What each balance the cook wrote changed: SOL by account, tokens by their accounts' owners. */
  private changesOf(writable: Sent["writable"]): SolanaChange[] {
    const sums = new Map<string, SolanaChange>();
    const add = (holder: Address, mint: Address | undefined, amount: bigint) => {
      const id = `${holder}/${mint ?? "SOL"}`;
      const now = sums.get(id);
      sums.set(id, {
        holder,
        token: mint === undefined ? "SOL" : this.tokenName(mint),
        ...(mint === undefined ? {} : { mint }),
        amount: (now?.amount ?? 0n) + amount,
      });
    };
    for (const [key, { before, after }] of writable) {
      add(key, undefined, (after?.lamports ?? 0n) - (before?.lamports ?? 0n));
      const was = tokenAccountOf(before);
      const is = tokenAccountOf(after);
      if (was !== undefined) add(was.owner, was.mint, -was.amount);
      if (is !== undefined) add(is.owner, is.mint, is.amount);
    }

    return [...sums.values()].filter((change) => change.amount !== 0n);
  }

  /** A mint, or `SOL`, as `delta` names a token. */
  private mintOf(token: string): Address | "SOL" {
    if (token.toUpperCase() === "SOL") return "SOL";
    const row = svmTokenRows(this.chain).find(
      (entry) => entry.symbol.toLowerCase() === token.toLowerCase(),
    );
    if (row !== undefined) return address(row.mint);
    if (isAddress(token)) return token;
    throw new Error(
      `${token} is not a token the registry has on ${this.chain.slug}: give its mint`,
    );
  }

  /** The cook's result, or the `CookReverted` it throws. */
  private result(program: CompiledProgram, cooked: Cooked, kept: boolean): SolanaCookResult {
    const { sent } = cooked;
    if (!sent.ok) {
      const { reason, data } = failureOf(sent, this.cookChain, cooked.labels);
      const unrecorded = sent.accounts.filter((key) => this.bank.unrecorded.has(key));
      throw new CookReverted(reason, data, {
        logs: sent.logs,
        ...(unrecorded.length === 0
          ? {}
          : {
              note:
                `the recording holds no account at ${unrecorded.join(", ")}, read as missing: ` +
                "record again if the test reads more than it did",
            }),
      });
    }
    const returnData = bytesToHex(sent.returnData);
    const changes = this.changesOf(sent.writable);

    return {
      ...(kept ? { signature: sent.signature } : {}),
      computeUnits: sent.units,
      returnData,
      returned: program.decode(returnData),
      logs: sent.logs,
      changes,
      staged: cooked.staged,
      lookupTable: cooked.lookupTable,
      delta: (holder, token) => {
        const mint = this.mintOf(token);
        return (
          changes.find(
            (change) =>
              change.holder === holder &&
              (mint === "SOL" ? change.mint === undefined : change.mint === mint),
          )?.amount ?? 0n
        );
      },
    };
  }

  private async cook(
    program: ProgramInput,
    options: SolanaCookOptions,
    keep: boolean,
  ): Promise<SolanaCookResult> {
    const compiled = this.compile(program);
    const owner = this.accountOf(options.from);
    // Kept even by a simulation, as on an EVM chain: the Pot is the account's from then on.
    await this.deployPot(owner);
    const fee = await this.executionFee();
    if (!keep) this.bank.snapshot();
    try {
      const cooked = await cook(this.cookChain, {
        owner: this.signers[owner.index]!,
        pot: owner.pot,
        salt: POT_SALT,
        program: compiled,
        args: options.args ?? [],
        accounts: options.accounts ?? {},
        fee,
      });

      return this.result(compiled, cooked, keep);
    } finally {
      if (!keep) this.bank.revert();
    }
  }

  /**
   * Sends `program` as a cook from `options.from`'s Pot, as `sauce run` sends it: the token
   * accounts it names created first where missing, a program too large for one transaction staged
   * first. Throws {@link CookReverted} when it fails.
   */
  run(program: ProgramInput, options: SolanaCookOptions = {}): Promise<SolanaCookResult> {
    return this.cook(program, options, true);
  }

  /**
   * The same cook, and everything before it, run and then undone: what it would do, changing
   * nothing but the Pot, which it creates if it is not created yet.
   */
  simulate(program: ProgramInput, options: SolanaCookOptions = {}): Promise<SolanaCookResult> {
    return this.cook(program, options, false);
  }

  /** Remembers the chain's state; `revert()` returns to it. Snapshots nest. */
  async snapshot(): Promise<void> {
    this.bank.snapshot();
  }

  /** Returns the chain to the last `snapshot()`, which is used up. */
  async revert(): Promise<void> {
    this.bank.revert();
  }

  /** Moves the clock `seconds` forward, and the slot with it (two and a half a second). */
  async increaseTime(seconds: number | bigint): Promise<void> {
    const clock = this.bank.clock();
    const elapsed = BigInt(seconds);
    this.bank.moveClock(clock.slot + (elapsed * 5n) / 2n, clock.unixTimestamp + elapsed);
  }

  /** Moves the slot `slots` forward, and the clock with it (400 ms a slot). */
  async warp(slots: number | bigint): Promise<void> {
    const clock = this.bank.clock();
    const moved = BigInt(slots);
    this.bank.moveClock(clock.slot + moved, clock.unixTimestamp + (moved * 2n) / 5n);
  }

  /** The clock's time, in seconds. */
  async now(): Promise<bigint> {
    return this.bank.clock().unixTimestamp;
  }

  /** The slot the chain is at. */
  async slot(): Promise<bigint> {
    return this.bank.clock().slot;
  }

  /** Stops the chain. A recording chain writes its state file here: await it. */
  async stop(): Promise<void> {
    const recordTo = this.recordTo;
    this.recordTo = undefined;
    if (recordTo !== undefined) {
      this.bank.writeRecording(recordTo.path, this.chain.slug, recordTo.rpcUrl);
    }
  }
}

export interface SolanaForkOptions {
  /**
   * A recorded state file (`.json.gz`), which replay boots from with no RPC. Commit it beside your
   * tests. With no file there yet, the fork records one (and needs `rpcUrl`).
   */
  readonly state?: string;
  /** The cluster's RPC, to record or to fork live. A Solana node serves accounts as they are now. */
  readonly rpcUrl?: string;
  /**
   * "auto" (default): replay `state` when it exists, record it when it does not, fork live when no
   * state file is named. "replay" refuses to start without the file; "record" records it again;
   * "live" forks without recording.
   */
  readonly mode?: "auto" | ForkMode;
  /** Charge no execution fee, so a cook's owner pays only the transaction's. Default: the chain's. */
  readonly zeroFee?: boolean;
}

/** Forks `chain` (Solana) in `mode`, as `fork` chose it. */
export async function forkSolana(
  chain: CanonicalChain,
  mode: ForkMode,
  options: SolanaForkOptions,
): Promise<SolanaTestChain> {
  const engine = address(v12SvmEngineProgramId());
  const kitchen = address(v12SvmKitchenProgramId());
  if (mode === "replay") {
    const source = stateSource(options.state!);
    if (source.chain !== chain.slug) {
      throw new Error(`${options.state} is a recording of ${source.chain}, not ${chain.slug}`);
    }
    const bank = await Bank.open({
      mode,
      source,
      header: source.header,
      engine,
      kitchen,
      unrecorded: source.unrecorded,
    });

    return SolanaTestChain.start(chain, bank, { zeroFee: options.zeroFee ?? false });
  }
  const source = clusterSource(options.rpcUrl!);
  const bank = await Bank.open({ mode, source, header: await source.header(), engine, kitchen });

  return SolanaTestChain.start(chain, bank, {
    zeroFee: options.zeroFee ?? false,
    ...(mode === "record" ? { recordTo: { path: options.state!, rpcUrl: options.rpcUrl! } } : {}),
  });
}

/** An empty Solana chain at slot 1,000 and the time now: the release's programs, no fee. */
export async function localSolana(chain: CanonicalChain): Promise<SolanaTestChain> {
  const unixTimestamp = BigInt(Math.floor(Date.now() / 1000));
  const header: ClusterHeader = {
    clock: {
      slot: 0n,
      epochStartTimestamp: unixTimestamp,
      epoch: 0n,
      leaderScheduleEpoch: 0n,
      unixTimestamp,
    },
  };
  const bank = await Bank.open({
    mode: "local",
    header,
    engine: address(v12SvmEngineProgramId()),
    kitchen: address(v12SvmKitchenProgramId()),
  });
  bank.moveClock(1_000n, unixTimestamp);

  return SolanaTestChain.start(chain, bank, { zeroFee: true });
}
