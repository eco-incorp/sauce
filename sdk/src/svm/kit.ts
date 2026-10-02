/**
 * The `@solana/kit` primitives this subpath's own functions take, re-exported as kit has them, so a
 * project that calls them needs no direct dependency on kit: an address and a blockhash from a
 * string, a key pair signer, an account's role, a program-derived address, and the wire
 * transaction's size limit. A package manager that installs a package's dependencies beside it
 * rather than at the project's root (pnpm) does not let the project import them itself.
 */
export {
  AccountRole,
  TRANSACTION_SIZE_LIMIT,
  address,
  blockhash,
  generateKeyPairSigner,
  getAddressEncoder,
  getProgramDerivedAddress,
} from "@solana/kit";
