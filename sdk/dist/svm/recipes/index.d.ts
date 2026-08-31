/**
 * Upper bound on generated escrows. Each escrow attaches THREE accounts — `escrow_i` (source),
 * `mint_i` (read for decimals by TransferChecked), `dest_i` (the recipient's ATA) — on top of the
 * two token-program slots and the shared `owner`. So N escrows is `3N + 3` accounts; a large N needs
 * an address lookup table to fit the transaction, which is why this is capped.
 */
export declare const SVM_MAX_ESCROWS = 16;
/** Absolute path to the checked-in N=1 instance of `svmSettleSource()`, inside THIS installed
 *  package — readable on its own, and pinned equal to the generator's output by
 *  `sdk/test/svm-settle.compile.test.ts` so the two can never drift. */
export declare const SVM_SETTLE_SOURCE_PATH: string;
/**
 * The SVM `settle` program text for `escrowCount` escrows — the SVM twin of
 * the EVM `settle.sauce.ts`, statement for statement, differing only where the VM forces it (see this
 * module's header). Generated rather than static because the escrow count is a compile-time property
 * on SVM; the returned text is exactly what gets compiled.
 */
export declare function svmSettleSource(escrowCount?: number): string;
/**
 * The account refs a generated program declares, in manifest order, for `escrowCount` escrows:
 * `tokenProgram0`, `tokenProgram1`, then per escrow `escrow_i` (source, writable), `mint_i`
 * (read for decimals), `dest_i` (recipient ATA, writable) — with the shared `owner` (signer) landing
 * right after escrow 0's group, which is simply the order `main` declares its params in. A caller's
 * `AccountResolution` must cover
 * exactly these; `sdk/test/svm-settle.compile.test.ts` pins this against a real compile for several
 * escrow counts so it can never drift from what the compiler actually emits.
 */
export declare function svmSettleRefs(escrowCount?: number): string[];
//# sourceMappingURL=index.d.ts.map