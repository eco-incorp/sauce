// Wraps `lamports` of the owner's SOL into the Pot's WSOL account: the System Program's transfer,
// which the owner signs, then SPL Token's SyncNative, which counts the account's new lamports as
// WSOL. Each account is written where it is used — the System Program, the owner, the Pot's WSOL
// account, SPL Token — and compiling adds it to main with how it is derived, read-only unless
// `.writable()` or `.signer()` gives it that role (`sauce compile --json` lists them). The command
// derives every one, so it is given none. Returns the Pot's WSOL balance after.
//
//   sauce run wrap.sauce.ts --chain <chain> --keypair <keypair> --args <lamports>
//
//   lamports: Uint256   how much SOL, in lamports (9 decimals): 1000000 is 0.001 SOL. The Pot's
//                       WSOL account is created before the cook when it has none (the owner paying
//                       the rent, asked first, or --yes).
//
// On Solana, 0.001 SOL:
//
//   sauce run wrap.sauce.ts --chain solana --keypair <keypair> --args 1000000
function main(lamports: Uint256): Uint256 {
  const potWsol = WSOL.accountOf(pot).writable();
  // The System Program's transfer: instruction 2 (4 bytes), then the lamports (8 bytes).
  let transfer = hex`02000000`;
  svm.call(
    Solana.systemProgram,
    [Solana.owner.writable().signer(), potWsol],
    transfer.concat(lamports.toBytesLe(8)),
  );
  // SPL Token's SyncNative: instruction 17.
  svm.call(Solana.tokenProgram, [potWsol], hex`11`);
  return pot.WSOL;
}
