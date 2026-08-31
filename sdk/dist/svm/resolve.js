import { AccountRole, isSignerRole } from '@solana/kit';
/**
 * Reserved ref: resolves to the fee payer with signer:true (use it when
 * bytecode reads MSG_SENDER). A resolution entry under this key is a conflict
 * and throws — rename the plan ref if it must resolve to another address.
 */
export const PAYER_REF = 'payer';
/** The four `AccountRole` values are exactly Solana's own, so each maps straight onto a kit role. */
function isWritableSlot(role) {
    return role === 'writable' || role === 'writable_signer';
}
function isSignerSlot(role) {
    return role === 'readonly_signer' || role === 'writable_signer';
}
/**
 * Resolves an AccountManifest into ordered account metas: metas[i] is
 * user-account index i of the execute instruction (inline: instruction account
 * i; staged: i + 1, after the buffer). The base role comes from the slot's
 * `requires`; signer is upgraded by that role, the resolution entry's signer
 * flag or TransactionSigner, or the reserved PAYER_REF. An attached
 * TransactionSigner rides on the meta so the transaction builder signs with it.
 * Duplicate addresses across refs are fine — Solana dedupes at message compile.
 *
 * A `remaining` entry is a POSITION, not an account: it marks where the
 * caller's own variable-length tail begins, so resolution stops there and the
 * caller appends its tail itself.
 *
 * MSG_SENDER/TX_ORIGIN is the first in-list signer, resolved LAZILY by the
 * engine (NoSigner only when the program actually reads the sender) — so no
 * signer is auto-appended; a MSG_SENDER-reading program whose manifest
 * declares no signer slot passes `appendPayerSigner: true`.
 */
export function resolveAccounts(manifest, resolution, payer, { appendPayerSigner = false } = {}) {
    const unresolved = [];
    const metas = [];
    for (const entry of manifest.accounts) {
        // A `remaining` marker is always last and carries no role: everything after it is the
        // caller's own tail, which only the caller can enumerate.
        if (entry.kind !== 'slot')
            break;
        const meta = { ref: entry.name, writable: isWritableSlot(entry.requires) };
        let address;
        let signer = isSignerSlot(entry.requires);
        let transactionSigner;
        if (meta.ref === PAYER_REF) {
            if (resolution[PAYER_REF] !== undefined) {
                throw new Error(`account ref 'payer' is reserved for the fee payer (rename the ref or remove it from the resolution map)`);
            }
            address = payer;
            signer = true;
        }
        else {
            const entry = resolution[meta.ref];
            if (entry !== undefined) {
                if (typeof entry === 'string') {
                    address = entry;
                }
                else {
                    address = entry.address;
                    if (typeof entry.signer === 'object') {
                        if (entry.signer.address !== entry.address) {
                            throw new Error(`account ref '${meta.ref}' address ${entry.address} does not match its TransactionSigner address ${entry.signer.address}`);
                        }
                        transactionSigner = entry.signer;
                        signer = true;
                    }
                    else {
                        signer = signer || (entry.signer ?? false);
                    }
                }
            }
        }
        if (address === undefined) {
            unresolved.push(meta.ref);
            continue;
        }
        const role = meta.writable
            ? (signer ? AccountRole.WRITABLE_SIGNER : AccountRole.WRITABLE)
            : (signer ? AccountRole.READONLY_SIGNER : AccountRole.READONLY);
        metas.push(transactionSigner ? { address, role, signer: transactionSigner } : { address, role });
    }
    if (unresolved.length > 0) {
        throw new Error(`unresolved account refs: ${unresolved.join(', ')} (provide addresses in the resolution map)`);
    }
    if (appendPayerSigner && !metas.some(meta => isSignerRole(meta.role))) {
        metas.push({ address: payer, role: AccountRole.READONLY_SIGNER });
    }
    return metas;
}
//# sourceMappingURL=resolve.js.map