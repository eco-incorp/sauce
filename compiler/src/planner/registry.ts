/**
 * Account registry for the 'svm' compile target.
 *
 * SVM CALL/SLOAD/SSTORE operate on ACCOUNT INDICES into the execute instruction's
 * user-account slice (the accounts after the 3 engine PDAs). SauceScript names
 * accounts with symbolic string refs; the registry interns each ref to a stable
 * u8 index in FIRST-USE order and records the strongest flags seen (a ref used
 * readonly then writable ends up writable). The resulting AccountPlan tells the
 * sender which account to place at which index, and with which meta flags.
 *
 * One registry per compile, shared across every function's child context (it
 * lives on the SharedModule), so helper functions see the same numbering.
 *
 * Escape hatch: raw numeric indices bypass the registry entirely (the caller
 * owns the account ordering). Raw and symbolic modes cannot be mixed within one
 * compile — the plan would silently disagree with the hand-picked indices.
 */

export interface AccountMeta {
  ref: string;
  pubkey?: string;
  writable: boolean;
  signer: boolean;
}

/** Reserved ref: the SDK's resolveAccounts binds it to the fee payer (signer). */
export const PAYER_REF = 'payer';

/** Ordered account plan: metas[i] is user-account index i (after the 3 engine PDAs). */
export interface AccountPlan {
  metas: AccountMeta[];
  /**
   * Set when the program used raw numeric account indices (escape hatch): the
   * caller owns the account ordering, so metas stays empty. Lets a nested
   * compile (eval) propagate raw mode to the enclosing registry — mixing raw
   * and symbolic modes across the eval boundary must still fail loud.
   */
  usesRawIndices?: true;
}

interface RegistryEntry {
  index: number;
  writable: boolean;
  signer: boolean;
}

export class AccountRegistry {
  /** Insertion order == index order (first use assigns the next free index). */
  private readonly entries = new Map<string, RegistryEntry>();
  private mode?: 'refs' | 'raw';

  /** Intern a symbolic ref; assigns first-use index, ORs flags on re-intern. */
  intern(ref: string, flags: { writable?: boolean; signer?: boolean } = {}): number {
    this.setMode('refs');

    return this.place(ref, flags);
  }

  private place(ref: string, flags: { writable?: boolean; signer?: boolean }): number {
    let entry = this.entries.get(ref);

    if (!entry) {
      const index = this.entries.size;

      if (index > 0xff) throw new Error(`too many accounts: ref '${ref}' would need index ${index} (max 255)`);

      entry = { index, writable: false, signer: false };
      this.entries.set(ref, entry);
    }

    entry.writable = entry.writable || (flags.writable ?? false);
    entry.signer = entry.signer || (flags.signer ?? false);

    return entry.index;
  }

  /** Record that a raw numeric index was used (locks the registry to raw mode). */
  useRawIndex(): void {
    this.setMode('raw');
  }

  private setMode(mode: 'refs' | 'raw'): void {
    if (this.mode && this.mode !== mode) {
      throw new Error('cannot mix raw account indices and symbolic account refs');
    }

    this.mode = mode;
  }

  buildPlan(): AccountPlan {
    const metas = [...this.entries.entries()].map(([ref, e]) => ({ ref, writable: e.writable, signer: e.signer }));

    return this.mode === 'raw' ? { metas, usesRawIndices: true } : { metas };
  }
}
