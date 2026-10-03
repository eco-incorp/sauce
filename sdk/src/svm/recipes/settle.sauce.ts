// settle.sauce.ts — a STANDALONE, reusable SVM Sauce program: enforce a minimum-output
// floor on the FIRST escrow SPL token account's CURRENT balance, then sweep every listed escrow's
// whole balance to ONE recipient.
//
// This is the SVM twin of the EVM `settle.sauce.ts` (@eco-incorp/sauce/recipes), statement for
// statement: read the floor token's balance, revert if it is below `minOut`, then sweep each token
// in turn, skipping empty ones, and return the floor balance. Only the VM mechanics differ — there
// is no Pot and no `balanceOf` call: a balance lives IN the escrow account's own data, and moving it
// is an SPL Token `TransferChecked` CPI rather than an ERC20 call.
//
// GENERATED, NOT HAND-WRITTEN — by `svmSettleSource(escrowCount)` (sdk/src/svm/recipes/index.ts).
// On EVM the token list is DATA, so one static program loops over it at runtime; on SVM a token
// account must be ATTACHED to the instruction and addressed by a LITERAL account index, so the
// escrow count is a compile-time property and the sweeps are unrolled. The generator returns the
// EXACT text that gets compiled, so a partner still reads precisely what they byte-compare.
//
// It is deliberately NOT tied to any recipe, protocol, or product. Nothing below knows what produced
// the escrows' balances — a swap, a bridge, an airdrop, or nothing at all. Keep it that way: no
// caller-specific names, in the code OR in the revert string (identical to the EVM twin's).
//
// THE SHAPE: `main(<accounts…>)` with `SETTLE_MIN_OUT` / `SETTLE_SPL_COUNT` supplied as compile-time
// `defines`. Every ACCOUNT is a `main` parameter, declared in the order a caller attaches them —
// that declaration is the account manifest.
//   - `SETTLE_MIN_OUT` is the direct mirror of the EVM twin's `minOut` — and applies
//     to `escrow0` ONLY, exactly as the EVM floor applies to `tokens[0]`. Every other escrow is swept
//     unconditionally (a dust sweep).
//   - `splCount` groups escrows by token program: escrow i sweeps via `tokenProgram0` when
//     `i < splCount`, else `tokenProgram1`. Classic SPL and Token-2022 in one settle; order escrows
//     classic-first. When every mint shares one program, pass `tokenProgram1 == tokenProgram0`.
//   - Every identity — which escrows, which recipient ATAs, which owner authorizes, which token
//     programs — binds at EXECUTION time via the manifest's slots, so one blob serves every
//     mint/recipient. The bytecode varies ONLY with (escrowCount, minOut, splCount).
//
// ONE RECIPIENT, N DESTINATIONS: the `dest_i` refs are the ONE recipient wallet's associated token
// account per mint. An SPL token account holds a single mint, so N mints need N destination accounts
// even for a single recipient; the SDK derives them from the recipient wallet + each mint. This is
// the SPL-shaped equivalent of the EVM twin's single `recipient` address.
//
// TransferChecked (ix 12), NOT the legacy Transfer (ix 3): legacy Transfer reverts on a Token-2022
// mint with a transfer fee (e.g. PYUSD), so it cannot honour "works for SPL or Token-2022".
// TransferChecked is uniform across both programs and reads the mint's decimals to self-check — the
// reason each escrow attaches its `mint_i`, and the reason decimals are read on-chain rather than
// passed as an argument. Transfer-HOOK mints (rare; compliance/allowlist tokens) are out of scope:
// they need per-mint hook accounts a generic program cannot enumerate, and a transfer targeting one
// reverts atomically. A resolver should reject a hook-configured mint up front with a clear error.
//
// EACH `tokenProgram_p` IS ONE BINDING: it is an `Account` parameter, and `svm.call` takes that
// same account as its CPI target — so there is nothing for a caller to keep in sync. Nothing here
// pins WHICH program arrives at that slot, though: whoever attaches the accounts chooses, so a
// caller that cares must compare the attached account itself.
//
// KNOWN PROPERTY, DOCUMENTED AND ACCEPTED — NOT DEFENDED AGAINST: the floor and the sweeps read
// CURRENT balances, not a delta against a baseline, so a donated balance counts toward `minOut` and
// rides along. Same accepted property as the EVM twin — but materially EASIER to trigger here, since
// an associated token account is a public address anyone can permissionlessly transfer into. Do not
// add baseline/delta machinery; the chosen model is the escrows ending clean.
//
// u64-ONLY ARITHMETIC: `le8` is a 64-bit byteswap, sound because both the SPL `amount` field and the
// `minOut` argument are u64-shaped.
//
// PARTNER VERIFY: recompile `svmSettleSource(n)` yourself with the options in
// sdk/src/svm/recipes/index.ts and byte-compare against what you were handed. There is no golden hash.
// Per-execution values arrive as `defines`, which replace these declarations and constant-fold, so
// a given (minOut, splCount) pair yields fixed bytecode. The defaults keep this file compilable and
// readable on its own.
const SETTLE_MIN_OUT = 0n;
const SETTLE_SPL_COUNT = 0n;

function main(
  tokenProgram0: Account,
  tokenProgram1: Account,
  escrow0: Account<Writable>,
  mint0: Account,
  dest0: Account<Writable>,
  owner: Account<Signer>,
): Uint256 {
  const floorBal = svm.sload(escrow0, 64, 8).toLe();
  if (SETTLE_MIN_OUT > 0) {
    if (floorBal < SETTLE_MIN_OUT) {
      throw "settle: balance below minOut";
    }
  }

  // escrow 0: read balance then decimals, then TransferChecked the whole balance to this
  // recipient's ATA, via this escrow's token program (tokenProgram0 for the first
  // `SETTLE_SPL_COUNT` escrows, tokenProgram1 for the rest).
  const bal0 = svm.sload(escrow0, 64, 8).toLe();
  const dec0 = svm.sload(mint0, 44, 1).toLe();
  if (bal0 > 0) {
    const tp0 = 0 < SETTLE_SPL_COUNT ? tokenProgram0 : tokenProgram1;
    const tag0 = hex`0c`; // TransferChecked
    const data0 = tag0.concat(bal0.toBytesLe(8)).concat(dec0.toBytesLe(1));
    svm.call(tp0, [escrow0, mint0, dest0, owner], data0);
  }

  return floorBal;
}
