/**
 * @eco-incorp/sauce-sdk/svm — the SVM `settle` recipe, shipped as SOURCE.
 *
 * This is the SVM twin of the EVM `settle.sauce.ts` (`@eco-incorp/sauce-sdk/recipes`): enforce a
 * minimum-output floor on the FIRST escrow's balance, then sweep every listed escrow's whole balance
 * to one recipient. Same contract as the EVM program, same "compiled by the ordinary compiler"
 * delivery — a partner recompiles the exact source we ship and byte-compares. Only the VM mechanics
 * differ: a balance is read out of an SPL token account's own data (no `balanceOf` call), and moved
 * with an SPL `TransferChecked` CPI (no ERC20 `transfer`).
 *
 * ```ts
 * import { compile } from "sauce-next";
 * import { svmSettleSource } from "@eco-incorp/sauce-sdk/svm";
 *
 * const { bytecode, manifest } = compile({
 *   target: "svm",
 *   entry: "main.js",
 *   resolve: (path) => (path === "main.js" ? Buffer.from(svmSettleSource(3)) : undefined),
 *   defines: [["SETTLE_MIN_OUT", String(minOut)], ["SETTLE_SPL_COUNT", String(splCount)]],
 * });
 * // `bytecode` is a deterministic function of (escrowCount, minOut, splCount) — and ONLY those.
 * // Every account identity is an attach slot, so one blob still serves every mint/recipient.
 * ```
 *
 * The shape, and why each piece differs from EVM's single loop:
 *   - N IS A COMPILE-TIME PROPERTY. An SVM token account must be ATTACHED to the instruction and
 *     addressed by a LITERAL index, so the source can't loop a runtime-length list the way the EVM
 *     twin loops a heap array — the generator emits N unrolled sweeps. It returns the exact text
 *     that gets compiled, so a partner still byte-compares source they can read.
 *   - ONE RECIPIENT, N DESTINATIONS. The caller passes a single recipient WALLET; the SDK derives
 *     that wallet's ATA per mint and fills the `dest_i` slots — an SPL token account holds one mint,
 *     so N mints need N destination accounts even for one recipient. (A derivable address still has
 *     to be attached: Solana requires every touched account in the instruction's account list.)
 *   - `SETTLE_SPL_COUNT` (a compile-time define) groups escrows by token program: the first
 *     `splCount` sweep via `tokenProgram0`, the rest via `tokenProgram1` — classic SPL and
 *     Token-2022 in one settle. All-classic? attach the same program at both slots and Solana dedups
 *     it.
 *   - `TransferChecked` (ix 12), so it is correct for Token-2022 fee mints (PYUSD et al.), not only
 *     classic SPL. That is why each escrow also attaches its `mint_i` — TransferChecked reads
 *     decimals from it (the program reads them on-chain, so decimals are never an argument).
 *     Transfer-HOOK mints are out of scope; a resolver should reject one with a clear error.
 *
 * `svmSettleRefs(n)` gives the manifest order to resolve against. There is no
 * `decodeSvmSettleProgram` and there cannot be one: the account identities are never in the
 * bytecode on SVM (Solana requires them attached), so there is no prologue carrying them to parse
 * back. Verification is by RECOMPILE, in `@eco-incorp/sauce-sdk/svm/verify`:
 * `verifySvmSettleProgram` recompiles this source with the caller's expected
 * `(escrowCount, minOut, splCount)` and byte-compares — proving the logic is genuine AND pinning
 * those two scalars, since both are folded in. The resolved account identities come from the
 * executed instruction's account list, matched against these refs.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Offset of the SPL token account's u64 `amount` field (identical in classic SPL + Token-2022). */
const SPL_AMOUNT_OFFSET = 64;
/** Offset of the mint's `decimals` byte (identical in the first 82 bytes of both programs' mints). */
const MINT_DECIMALS_OFFSET = 44;

/**
 * Upper bound on generated escrows. Each escrow attaches THREE accounts — `escrow_i` (source),
 * `mint_i` (read for decimals by TransferChecked), `dest_i` (the recipient's ATA) — on top of the
 * two token-program slots and the shared `owner`. So N escrows is `3N + 3` accounts; a large N needs
 * an address lookup table to fit the transaction, which is why this is capped.
 */
export const SVM_MAX_ESCROWS = 16;

/** The generated program's doc header — one copy, emitted verbatim for every escrow count. */
const SVM_HEADER = `// settle.sauce.ts — a STANDALONE, reusable SVM Sauce program: enforce a minimum-output
// floor on the FIRST escrow SPL token account's CURRENT balance, then sweep every listed escrow's
// whole balance to ONE recipient.
//
// This is the SVM twin of the EVM \`settle.sauce.ts\` (@eco-incorp/sauce-sdk/recipes), statement for
// statement: read the floor token's balance, revert if it is below \`minOut\`, then sweep each token
// in turn, skipping empty ones, and return the floor balance. Only the VM mechanics differ — there
// is no Pot and no \`balanceOf\` call: a balance lives IN the escrow account's own data, and moving it
// is an SPL Token \`TransferChecked\` CPI rather than an ERC20 call.
//
// GENERATED, NOT HAND-WRITTEN — by \`svmSettleSource(escrowCount)\` (sdk/src/svm/recipes/index.ts).
// On EVM the token list is DATA, so one static program loops over it at runtime; on SVM a token
// account must be ATTACHED to the instruction and addressed by a LITERAL account index, so the
// escrow count is a compile-time property and the sweeps are unrolled. The generator returns the
// EXACT text that gets compiled, so a partner still reads precisely what they byte-compare.
//
// It is deliberately NOT tied to any recipe, protocol, or product. Nothing below knows what produced
// the escrows' balances — a swap, a bridge, an airdrop, or nothing at all. Keep it that way: no
// caller-specific names, in the code OR in the revert string (identical to the EVM twin's).
//
// THE SHAPE: \`main(<accounts…>)\` with \`SETTLE_MIN_OUT\` / \`SETTLE_SPL_COUNT\` supplied as compile-time
// \`defines\`. Every ACCOUNT is a \`main\` parameter, declared in the order a caller attaches them —
// that declaration is the account manifest.
//   - \`SETTLE_MIN_OUT\` is the direct mirror of the EVM twin's \`minOut\` — and applies
//     to \`escrow0\` ONLY, exactly as the EVM floor applies to \`tokens[0]\`. Every other escrow is swept
//     unconditionally (a dust sweep).
//   - \`splCount\` groups escrows by token program: escrow i sweeps via \`tokenProgram0\` when
//     \`i < splCount\`, else \`tokenProgram1\`. Classic SPL and Token-2022 in one settle; order escrows
//     classic-first. When every mint shares one program, pass \`tokenProgram1 == tokenProgram0\`.
//   - Every identity — which escrows, which recipient ATAs, which owner authorizes, which token
//     programs — binds at EXECUTION time via the manifest's slots, so one blob serves every
//     mint/recipient. The bytecode varies ONLY with (escrowCount, minOut, splCount).
//
// ONE RECIPIENT, N DESTINATIONS: the \`dest_i\` refs are the ONE recipient wallet's associated token
// account per mint. An SPL token account holds a single mint, so N mints need N destination accounts
// even for a single recipient; the SDK derives them from the recipient wallet + each mint. This is
// the SPL-shaped equivalent of the EVM twin's single \`recipient\` address.
//
// TransferChecked (ix 12), NOT the legacy Transfer (ix 3): legacy Transfer reverts on a Token-2022
// mint with a transfer fee (e.g. PYUSD), so it cannot honour "works for SPL or Token-2022".
// TransferChecked is uniform across both programs and reads the mint's decimals to self-check — the
// reason each escrow attaches its \`mint_i\`, and the reason decimals are read on-chain rather than
// passed as an argument. Transfer-HOOK mints (rare; compliance/allowlist tokens) are out of scope:
// they need per-mint hook accounts a generic program cannot enumerate, and a transfer targeting one
// reverts atomically. A resolver should reject a hook-configured mint up front with a clear error.
//
// EACH \`tokenProgram_p\` IS ONE BINDING: it is an \`Account\` parameter, and \`svm.call\` takes that
// same account as its CPI target — so there is nothing for a caller to keep in sync. Nothing here
// pins WHICH program arrives at that slot, though: whoever attaches the accounts chooses, so a
// caller that cares must compare the attached account itself.
//
// KNOWN PROPERTY, DOCUMENTED AND ACCEPTED — NOT DEFENDED AGAINST: the floor and the sweeps read
// CURRENT balances, not a delta against a baseline, so a donated balance counts toward \`minOut\` and
// rides along. Same accepted property as the EVM twin — but materially EASIER to trigger here, since
// an associated token account is a public address anyone can permissionlessly transfer into. Do not
// add baseline/delta machinery; the chosen model is the escrows ending clean.
//
// u64-ONLY ARITHMETIC: \`le8\` is a 64-bit byteswap, sound because both the SPL \`amount\` field and the
// \`minOut\` argument are u64-shaped.
//
// PARTNER VERIFY: recompile \`svmSettleSource(n)\` yourself with the options in
// sdk/src/svm/recipes/index.ts and byte-compare against what you were handed. There is no golden hash.`;

/** Absolute path to the checked-in N=1 instance of `svmSettleSource()`, inside THIS installed
 *  package — readable on its own, and pinned equal to the generator's output by
 *  `sdk/test/svm-settle.compile.test.ts` so the two can never drift. */
export const SVM_SETTLE_SOURCE_PATH: string = join(__dirname, "settle.sauce.ts");

function assertEscrowCount(fn: string, escrowCount: number): void {
  if (!Number.isInteger(escrowCount) || escrowCount < 1 || escrowCount > SVM_MAX_ESCROWS) {
    throw new Error(`${fn}: escrowCount must be an integer 1..${SVM_MAX_ESCROWS}, got ${escrowCount}`);
  }
}

/**
 * The SVM `settle` program text for `escrowCount` escrows — the SVM twin of
 * the EVM `settle.sauce.ts`, statement for statement, differing only where the VM forces it (see this
 * module's header). Generated rather than static because the escrow count is a compile-time property
 * on SVM; the returned text is exactly what gets compiled.
 */
export function svmSettleSource(escrowCount: number = 1): string {
  assertEscrowCount("svmSettleSource", escrowCount);

  const sweep = (i: number): string => `
  // escrow ${i}: read balance then decimals, then TransferChecked the whole balance to this
  // recipient's ATA, via this escrow's token program (tokenProgram0 for the first
  // \`SETTLE_SPL_COUNT\` escrows, tokenProgram1 for the rest).
  const bal${i} = svm.sload(escrow${i}, ${SPL_AMOUNT_OFFSET}, 8).toLe();
  const dec${i} = svm.sload(mint${i}, ${MINT_DECIMALS_OFFSET}, 1).toLe();
  if (bal${i} > 0) {
    const tp${i} = ${i} < SETTLE_SPL_COUNT ? tokenProgram0 : tokenProgram1;
    const tag${i} = hex\`0c\`;                                   // TransferChecked
    const data${i} = tag${i}.concat(bal${i}.toBytesLe(8)).concat(dec${i}.toBytesLe(1));
    svm.call(tp${i}, [escrow${i}, mint${i}, dest${i}, owner], data${i});
  }`;

  // Accounts are main() PARAMS, declared in exactly `svmSettleRefs` order — that declaration IS
  // the manifest the caller attaches against.
  const params = ["tokenProgram0: Account", "tokenProgram1: Account"];
  for (let i = 0; i < escrowCount; i++) {
    params.push(`escrow${i}: Account<Writable>`, `mint${i}: Account`, `dest${i}: Account<Writable>`);
    if (i === 0) params.push("owner: Account<Signer>");
  }

  return `${SVM_HEADER}
// Per-execution values arrive as \`defines\`, which replace these declarations and constant-fold, so
// a given (minOut, splCount) pair yields fixed bytecode. The defaults keep this file compilable and
// readable on its own.
const SETTLE_MIN_OUT = 0n;
const SETTLE_SPL_COUNT = 0n;

function main(${params.join(", ")}): Uint256 {
  const floorBal = svm.sload(escrow0, ${SPL_AMOUNT_OFFSET}, 8).toLe();
  if (SETTLE_MIN_OUT > 0) {
    if (floorBal < SETTLE_MIN_OUT) {
      throw "settle: balance below minOut";
    }
  }
${Array.from({ length: escrowCount }, (_, i) => sweep(i)).join("\n")}

  return floorBal;
}
`;
}

/**
 * The account refs a generated program declares, in manifest order, for `escrowCount` escrows:
 * `tokenProgram0`, `tokenProgram1`, then per escrow `escrow_i` (source, writable), `mint_i`
 * (read for decimals), `dest_i` (recipient ATA, writable) — with the shared `owner` (signer) landing
 * right after escrow 0's group, which is simply the order `main` declares its params in. A caller's
 * `AccountResolution` must cover
 * exactly these; `sdk/test/svm-settle.compile.test.ts` pins this against a real compile for several
 * escrow counts so it can never drift from what the compiler actually emits.
 */
export function svmSettleRefs(escrowCount: number = 1): string[] {
  assertEscrowCount("svmSettleRefs", escrowCount);

  const refs = ["tokenProgram0", "tokenProgram1"];
  for (let i = 0; i < escrowCount; i++) {
    refs.push(`escrow${i}`, `mint${i}`, `dest${i}`);
    if (i === 0) refs.push("owner");
  }
  return refs;
}
