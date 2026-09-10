/**
 * The kitchen's `#[error_code]` numbers, used to assert a failure is the KITCHEN's own guard.
 *
 * Without this a rejection test is nearly vacuous: `MAX_POT_LEN` is one
 * `MAX_PERMITTED_DATA_INCREASE`, so an oversized request is refused by the System Program whether or
 * not the kitchen checks it first, and a failed transaction leaves no account behind either way.
 *
 * The CODE, not the log text: Anchor surfaces `#[error_code]` as `InstructionErrorCustom` on
 * `err()`, which
 * is a wire contract the IDL declares — and reading it needs no `meta()`, whose use on a failed
 * transaction aborted this suite on CI. `engine-wire-drift.test.ts` pins these numbers to the IDL,
 * so a renumbered error fails there rather than silently weakening this.
 */
export const KITCHEN_ERROR = {
  CodeBufferHashMismatch: 6003,
  PotSpaceOutOfRange: 6007,
} as const;
