// Approves the payment `approval.sauce.ts` is waiting for: resolves its promise by `key`, the word
// that program returned, so its body runs in this cook and pays. Nothing happens for a key already
// settled, or expired.
//
//   sauce run approve.sauce.ts --chain <chain> --wallet <name> --password-env <NAME> --args <key>
//
//   key: Uint256  the approval's key, `approval.sauce.ts`'s answer
//
// On Base, approving the payment `approval.sauce.ts` returned the key of:
//
//   sauce run approve.sauce.ts --chain base --wallet <name> --password-env <NAME> --args <key>
import { Async } from "@sauce/async";

function main(key: Uint256): void {
  Async.resolve(key, hex``);
}
