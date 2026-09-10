import { AccountRole, isSignerRole } from "@solana/kit";
import type { Address, TransactionSigner } from "@solana/kit";
import type { AccountManifest, AccountRole as SlotRole } from "sauce-compiler";

/**
 * Maps each declared slot of the compiler's AccountManifest to a concrete
 * address. `signer` REPLACES the manifest's requirement rather than only
 * raising it: omit it to keep the manifest's own value, `true` to make a
 * non-signer slot sign, and `false` to attach a slot the program treats as a
 * signer WITHOUT a transaction signature — which is what a PDA the program
 * signs for via `invoke_signed` needs. Pass the TransactionSigner itself to
 * also sign with it (required for any signer ref other than the reserved
 * fee-payer ref — the send layer has no other way to obtain that signature).
 *
 * The two sides describe different things: the manifest states what the PROGRAM
 * requires of the slot, this states what the TRANSACTION provides.
 */
export interface AccountResolution {
  [ref: string]: Address | { address: Address; signer?: boolean | TransactionSigner };
}

/**
 * Reserved ref: resolves to the fee payer with signer:true (use it when
 * bytecode reads MSG_SENDER). A resolution entry under this key is a conflict
 * and throws — rename the plan ref if it must resolve to another address.
 */
export const PAYER_REF = "payer";

export interface ResolveAccountsOptions {
  /**
   * Append the fee payer as a readonly signer at the END of the tail (plan
   * indices stay stable) when no resolved meta already signs. The engine's
   * NoSigner is LAZY — raised only when the program executes
   * MSG_SENDER/TX_ORIGIN — so a signerless list is valid for programs that
   * never read the sender (and lets simulations run sigVerify: false with no
   * signer at all). Set this for MSG_SENDER-reading programs whose plan
   * carries no signer meta; prefer the reserved 'payer' ref when the payer
   * should occupy a plan slot instead.
   */
  appendPayerSigner?: boolean;
}

export interface ResolvedAccountMeta {
  address: Address;
  role: AccountRole;
  /**
   * Present only when the resolution attached a TransactionSigner — kit's
   * signTransactionMessageWithSigners collects it from the instruction meta
   * (detection is `'signer' in meta`, so the key is omitted, not undefined).
   */
  signer?: TransactionSigner;
}

/** The four `AccountRole` values are exactly Solana's own, so each maps straight onto a kit role. */
function isWritableSlot(role: SlotRole): boolean {
  return role === "writable" || role === "writable_signer";
}

function isSignerSlot(role: SlotRole): boolean {
  return role === "readonly_signer" || role === "writable_signer";
}

/**
 * Resolves an AccountManifest into ordered account metas: metas[i] is
 * user-account index i of the execute instruction (inline: instruction account
 * i; staged: i + 1, after the buffer). The base role comes from the slot's
 * `requires`; the resolution entry's signer flag then replaces it (see
 * `AccountResolution`), and a TransactionSigner or the reserved PAYER_REF sets
 * it. An attached
 * TransactionSigner rides on the meta so the transaction builder signs with it.
 * Duplicate addresses across refs are fine — Solana dedupes at message compile.
 *
 * A `remaining` entry is a POSITION, not an account: it marks where the
 * caller's own variable-length tail begins, so resolution stops there and the
 * caller appends its tail itself. It must be the LAST entry, and one that is not
 * throws — stopping early would drop the slots after it from `metas` and shift
 * the index of every account the caller then appends.
 *
 * MSG_SENDER/TX_ORIGIN is the first in-list signer, resolved LAZILY by the
 * engine (NoSigner only when the program actually reads the sender) — so no
 * signer is auto-appended; a MSG_SENDER-reading program whose manifest
 * declares no signer slot passes `appendPayerSigner: true`.
 */
export function resolveAccounts(
  manifest: AccountManifest,
  resolution: AccountResolution,
  payer: Address,
  { appendPayerSigner = false }: ResolveAccountsOptions = {},
): ResolvedAccountMeta[] {
  const unresolved: string[] = [];
  const metas: ResolvedAccountMeta[] = [];
  let hasRemaining = false;

  for (const [index, entry] of manifest.accounts.entries()) {
    // A `remaining` marker carries no role: everything after it is the caller's own tail, which only
    // the caller can enumerate. It has to be LAST for that to hold — a slot after it would be
    // dropped from `metas`, shifting the index of every account the caller then appends.
    if (entry.kind !== "slot") {
      const after = manifest.accounts.slice(index + 1);

      if (after.length > 0) {
        const names = after.map((later) => (later.kind === "slot" ? later.name : later.kind));
        throw new Error(
          `account manifest: a '${entry.kind}' entry must be last, but index ${index} of ${manifest.accounts.length} is followed by '${names.join("', '")}'`,
        );
      }

      hasRemaining = true;
      break;
    }

    const meta = { ref: entry.name, writable: isWritableSlot(entry.requires) };
    let address: Address | undefined;
    let signer = isSignerSlot(entry.requires);
    let transactionSigner: TransactionSigner | undefined;

    if (meta.ref === PAYER_REF) {
      if (resolution[PAYER_REF] !== undefined) {
        throw new Error(
          `account ref 'payer' is reserved for the fee payer (rename the ref or remove it from the resolution map)`,
        );
      }

      address = payer;
      signer = true;
    } else {
      const entry = resolution[meta.ref];

      if (entry !== undefined) {
        if (typeof entry === "string") {
          address = entry;
        } else {
          address = entry.address;

          if (typeof entry.signer === "object") {
            if (entry.signer.address !== entry.address) {
              throw new Error(
                `account ref '${meta.ref}' address ${entry.address} does not match its TransactionSigner address ${entry.signer.address}`,
              );
            }

            transactionSigner = entry.signer;
            signer = true;
          } else {
            // The override REPLACES the manifest's requirement rather than only raising it:
            // `undefined` keeps the manifest default, `true` raises, and `false` LOWERS. Lowering is
            // the case that matters — a Pot is a PDA the kitchen signs for via `invoke_signed`, so
            // its slot is `writable_signer` to the program while the TRANSACTION must attach it
            // unsigned. `signer || …` could only ever raise, which made that unattachable.
            //
            // The two sides describe different things: the manifest states what the PROGRAM
            // requires of the slot, the resolution states what the TRANSACTION provides. Only the
            // caller knows a CPI supplies the signature.
            signer = entry.signer ?? signer;
          }
        }
      }
    }

    if (address === undefined) {
      unresolved.push(meta.ref);
      continue;
    }

    const role = meta.writable
      ? signer
        ? AccountRole.WRITABLE_SIGNER
        : AccountRole.WRITABLE
      : signer
        ? AccountRole.READONLY_SIGNER
        : AccountRole.READONLY;

    metas.push(
      transactionSigner ? { address, role, signer: transactionSigner } : { address, role },
    );
  }

  if (unresolved.length > 0) {
    throw new Error(
      `unresolved account refs: ${unresolved.join(", ")} (provide addresses in the resolution map)`,
    );
  }

  if (appendPayerSigner && !metas.some((meta) => isSignerRole(meta.role))) {
    // Appending lands at `metas.length` — which, after a `remaining` marker, is exactly where the
    // caller's own tail begins. Every account they then append would sit one slot later than the
    // program expects, and the program would read the payer where it expected the first tail
    // account. The caller owns that region, so the signer has to come from them.
    //
    // Reachable only since the resolution's `signer` flag started LOWERING as well as raising: a
    // manifest signer slot used to guarantee a signing meta here, so this branch could not be
    // entered by a manifest that declared one.
    if (hasRemaining) {
      throw new Error(
        "appendPayerSigner: this manifest ends with a 'remaining' marker, so appending the payer " +
          "would take the first index of the caller's own tail and shift every account after it. " +
          "Include a signer in the tail, or resolve a manifest slot as a signer, instead.",
      );
    }

    metas.push({ address: payer, role: AccountRole.READONLY_SIGNER });
  }

  return metas;
}
