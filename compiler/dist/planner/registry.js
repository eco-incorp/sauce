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
/** Reserved ref: the SDK's resolveAccounts binds it to the fee payer (signer). */
export const PAYER_REF = 'payer';
export class AccountRegistry {
    /** Insertion order == index order (first use assigns the next free index). */
    entries = new Map();
    mode;
    /** Intern a symbolic ref; assigns first-use index, ORs flags on re-intern. */
    intern(ref, flags = {}) {
        this.setMode('refs');
        return this.place(ref, flags);
    }
    place(ref, flags) {
        let entry = this.entries.get(ref);
        if (!entry) {
            const index = this.entries.size;
            if (index > 0xff)
                throw new Error(`too many accounts: ref '${ref}' would need index ${index} (max 255)`);
            entry = { index, writable: false, signer: false };
            this.entries.set(ref, entry);
        }
        entry.writable = entry.writable || (flags.writable ?? false);
        entry.signer = entry.signer || (flags.signer ?? false);
        return entry.index;
    }
    /** Record that a raw numeric index was used (locks the registry to raw mode). */
    useRawIndex() {
        this.setMode('raw');
    }
    setMode(mode) {
        if (this.mode && this.mode !== mode) {
            throw new Error('cannot mix raw account indices and symbolic account refs');
        }
        this.mode = mode;
    }
    buildPlan() {
        const metas = [...this.entries.entries()].map(([ref, e]) => ({ ref, writable: e.writable, signer: e.signer }));
        return this.mode === 'raw' ? { metas, usesRawIndices: true } : { metas };
    }
}
