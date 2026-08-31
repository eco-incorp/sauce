/**
 * LiteSVM twin of utils.ts — runs `target: 'svm'` bytecode on the real SVM
 * engine inside an in-process LiteSVM bank (no validator, no RPC).
 *
 * Self-contained on purpose: the compiler package must not depend on sdk/, so
 * the engine interface (discriminator, account laws, the ComputeBudget
 * prepends) is mirrored here from the engine crate (sauce repo,
 * svm/programs/engine) and the execute instruction is assembled by hand.
 *
 * Interpreter memory is the transaction's 256 KiB BPF heap frame — no memory
 * accounts exist, so every execute transaction carries a
 * RequestHeapFrame(262144) instruction (add-once beside any other
 * ComputeBudget instruction; without it the engine aborts before any opcode).
 *
 * Two laws bind the execute account list:
 * - the AccountPlan's meta order IS the engine's user-account index space:
 *   plan meta i must be instruction account i, exactly (no fixed prefix);
 * - MSG_SENDER = the first is_signer in the instruction account list, resolved
 *   LAZILY (NoSigner only when the program reads the sender): when the plan
 *   interns the reserved 'payer' ref it is mapped in place, otherwise the
 *   harness appends the payer AFTER the plan-mapped metas (and any extra
 *   provided accounts) so plan indices — and raw positional indices — stay
 *   faithful while MSG_SENDER-reading programs keep working.
 *
 * The engine binary is vendored at ../artifacts/svm/engine.so (committed,
 * force-added — built from the exact commit the `sauce` git dep is pinned
 * to) so these suites run offline, same as the EVM ones. SAUCE_ENGINE_SO
 * overrides the default, e.g. to test against a freshly built engine before
 * repinning. Refresh the vendored binary whenever the pin moves: rebuild with
 * `cargo build-sbf` in the pinned commit's svm/ checkout, copy over
 * artifacts/svm/engine.so, and force-commit.
 */
import { existsSync } from 'fs';
import { resolve } from 'path';
import {
  AccountRole,
  appendTransactionMessageInstructions,
  createTransactionMessage,
  generateKeyPairSigner,
  getAddressCodec,
  lamports,
  pipe,
  setTransactionMessageFeePayerSigner,
  signTransactionMessageWithSigners,
} from '@solana/kit';
import type { AccountMeta, AccountSignerMeta, Address, Instruction, KeyPairSigner } from '@solana/kit';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';
import { compile } from '../src/index.js';
import type { CompileOptions } from '../src/index.js';

// Mirrored from the engine crate: sha256("global:execute")[..8] and the
// heap-frame size every execute transaction must request.
const EXECUTE_DISCRIMINATOR = new Uint8Array([0x82, 0xdd, 0xf2, 0x9a, 0x0d, 0xc1, 0xbd, 0x1d]);
const HEAP_FRAME_BYTES = 262_144;

export const SYSTEM_PROGRAM = '11111111111111111111111111111111' as Address;
const COMPUTE_BUDGET_PROGRAM = 'ComputeBudget111111111111111111111111111111' as Address;

/** ComputeBudgetInstruction::RequestHeapFrame — u8 discriminant 1 + u32 LE bytes. */
const requestHeapFrame = (bytes: number): Instruction => {
  const data = new Uint8Array(5);
  data[0] = 1;
  new DataView(data.buffer).setUint32(1, bytes, true);

  return { programAddress: COMPUTE_BUDGET_PROGRAM, accounts: [], data };
};

// cwd is compiler/ under jest (the pnpm script runs there); the vendored
// binary lives at the repo-root artifacts/svm/, one level up from compiler/.
export const ENGINE_SO = process.env.SAUCE_ENGINE_SO ?? resolve(process.cwd(), '../artifacts/svm/engine.so');

export const canRunSvm = (): boolean => existsSync(ENGINE_SO);

export interface SvmHarness {
  svm: LiteSVM;
  programId: Address;
  payer: KeyPairSigner;
}

/**
 * A user account for one svmCook run. `ref` names the account: plan refs
 * resolve against it by name; refs the plan never interned (e.g. a CPI target
 * program) are appended after the plan-mapped metas. The account is created in
 * LiteSVM (setAccount) only when `data` or `lamports` is given — address-only
 * entries just place a meta. `signer: true` generates a keypair so the
 * harness can co-sign (a fixed `address` cannot sign).
 */
export interface SvmTestAccount {
  ref: string;
  data?: Uint8Array;
  writable?: boolean;
  signer?: boolean;
  owner?: Address;
  lamports?: bigint;
  address?: Address;
}

export type SvmCookResult =
  | { ok: true; returnData: Uint8Array; logs: string[] }
  | { ok: false; revertData?: Uint8Array; err: string; logs: string[] };

export const startSvm = async (): Promise<SvmHarness> => {
  const svm = new LiteSVM();
  const programId = (await generateKeyPairSigner()).address;
  svm.addProgramFromFile(programId, ENGINE_SO);

  const payer = await generateKeyPairSigner();
  svm.airdrop(payer.address, lamports(1_000_000_000_000n));

  // No memory setup: interpreter memory is the per-transaction heap frame,
  // requested by the RequestHeapFrame instruction svmCook prepends.
  return { svm, programId, payer };
};

interface ResolvedTestAccount {
  spec: SvmTestAccount;
  address: Address;
  signer?: KeyPairSigner;
}

/** A random (almost surely off-curve) address for fixture accounts. */
export const randomSvmAddress = (): Address => getAddressCodec().decode(crypto.getRandomValues(new Uint8Array(32)));

const materializeAccount = async (harness: SvmHarness, spec: SvmTestAccount): Promise<ResolvedTestAccount> => {
  let address = spec.address;
  let signer: KeyPairSigner | undefined;

  if (address === undefined) {
    if (spec.signer) {
      signer = await generateKeyPairSigner();
      address = signer.address;
    } else {
      address = randomSvmAddress();
    }
  } else if (spec.signer) {
    throw new Error(`signer test account '${spec.ref}' cannot use a fixed address (the harness has no keypair for it)`);
  }

  if (spec.data !== undefined || spec.lamports !== undefined) {
    const data = spec.data ?? new Uint8Array(0);

    harness.svm.setAccount({
      address,
      data,
      executable: false,
      lamports: lamports(spec.lamports ?? harness.svm.minimumBalanceForRentExemption(BigInt(data.length))),
      // Default owner is the engine. Note SSTORE has NO effectively-writable
      // target class on SVM: every engine-owned target is ProtectedAccount
      // (finalized buffers stay unscribblable) and the runtime independently
      // rejects engine data-writes to foreign-owned accounts — the SSTORE
      // fail-path tests below pin both walls.
      programAddress: spec.owner ?? harness.programId,
      space: BigInt(data.length),
    });
  }

  return { spec, address, signer };
};

const roleFor = (writable: boolean, signer: boolean): AccountRole =>
  writable
    ? signer
      ? AccountRole.WRITABLE_SIGNER
      : AccountRole.WRITABLE
    : signer
      ? AccountRole.READONLY_SIGNER
      : AccountRole.READONLY;

const accountMeta = (
  acct: ResolvedTestAccount,
  writable: boolean,
  signer: boolean,
): AccountMeta | AccountSignerMeta => {
  const role = roleFor(writable, signer);

  return signer && acct.signer ? { address: acct.address, role, signer: acct.signer } : { address: acct.address, role };
};

export const svmCook = async (
  harness: SvmHarness,
  source: string,
  options: CompileOptions & { accounts?: SvmTestAccount[] } = {},
): Promise<SvmCookResult> => {
  const { accounts: testAccounts = [], ...compileOptions } = options;

  if (compileOptions.target !== undefined && compileOptions.target !== 'svm') {
    throw new Error(`svmCook compiles with target 'svm', got override '${compileOptions.target}'`);
  }

  const { bytecode, accountPlan } = compile(source, { ...compileOptions, target: 'svm' });

  if (!accountPlan) throw new Error('svm compile produced no account plan');

  const resolved: ResolvedTestAccount[] = [];
  const byRef = new Map<string, ResolvedTestAccount>();

  for (const spec of testAccounts) {
    // Reserved: svmCook places the payer itself (plan slot or final append). A
    // provided 'payer' fixture would be a second, random-address account — and
    // with signer:true it could precede the real payer and hijack MSG_SENDER.
    if (spec.ref === 'payer') throw new Error(`test account ref 'payer' is reserved for the harness payer`);

    if (byRef.has(spec.ref)) throw new Error(`duplicate test account ref '${spec.ref}'`);

    const acct = await materializeAccount(harness, spec);

    resolved.push(acct);
    byRef.set(spec.ref, acct);
  }

  // Plan-mapped metas first (plan index i = user index i = instruction account
  // i). In raw-index mode the plan is empty and the provided accounts map
  // positionally to user indices 0..n-1. Unplanned extras follow, the payer
  // last (unless the plan interned the reserved 'payer' ref).
  const metas: (AccountMeta | AccountSignerMeta)[] = [];
  const placed = new Set<string>();
  let payerPlaced = false;

  for (const meta of accountPlan.metas) {
    if (meta.ref === 'payer') {
      metas.push({ address: harness.payer.address, role: roleFor(meta.writable, true) });
      payerPlaced = true;
      continue;
    }

    const acct = byRef.get(meta.ref);

    if (!acct) throw new Error(`unresolved account ref '${meta.ref}' (provide it in options.accounts)`);

    placed.add(meta.ref);
    metas.push(
      accountMeta(acct, meta.writable || (acct.spec.writable ?? false), meta.signer || (acct.spec.signer ?? false)),
    );
  }

  for (const acct of resolved) {
    if (!placed.has(acct.spec.ref))
      metas.push(accountMeta(acct, acct.spec.writable ?? false, acct.spec.signer ?? false));
  }

  if (!payerPlaced) metas.push({ address: harness.payer.address, role: AccountRole.WRITABLE_SIGNER });

  const data = new Uint8Array(EXECUTE_DISCRIMINATOR.length + bytecode[0].length);
  data.set(EXECUTE_DISCRIMINATOR, 0);
  data.set(bytecode[0], EXECUTE_DISCRIMINATOR.length);

  const instruction: Instruction = {
    programAddress: harness.programId,
    accounts: metas,
    data,
  };

  // A fresh blockhash per send keeps signatures unique — LiteSVM's transaction
  // history rejects a byte-identical resend (e.g. the same source cooked twice).
  harness.svm.expireBlockhash();

  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(harness.payer, m),
    (m) => appendTransactionMessageInstructions([requestHeapFrame(HEAP_FRAME_BYTES), instruction], m),
    (m) => harness.svm.setTransactionMessageLifetimeUsingLatestBlockhash(m),
  );
  const transaction = await signTransactionMessageWithSigners(message);
  const result = harness.svm.sendTransaction(transaction);

  if (result instanceof FailedTransactionMetadata) {
    // Nearly all engine errors collapse to InvalidInstructionData at the tx
    // level, so the logs are the only channel a fail-path test can inspect.
    const revertData = result.meta().returnData().data();
    const logs = result.meta().logs();

    return revertData.length > 0
      ? { ok: false, revertData, err: String(result.err()), logs }
      : { ok: false, err: String(result.err()), logs };
  }

  return { ok: true, returnData: result.returnData().data(), logs: result.logs() };
};

/** Decodes a successful scalar result (32-byte big-endian word; empty → 0). */
export const svmUint = (result: SvmCookResult): bigint => {
  if (!result.ok) throw new Error(`svm execution failed: ${result.err}`);

  return result.returnData.length === 0 ? 0n : BigInt('0x' + Buffer.from(result.returnData).toString('hex'));
};

/** Hex of a successful result's raw return bytes (dynamic Bytes results). */
export const svmHex = (result: SvmCookResult): string => {
  if (!result.ok) throw new Error(`svm execution failed: ${result.err}`);

  return '0x' + Buffer.from(result.returnData).toString('hex');
};
