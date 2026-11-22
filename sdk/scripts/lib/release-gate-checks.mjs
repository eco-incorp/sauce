// What the release gate (`sdk/scripts/release-gate.mjs`) holds a cook's outcome to, as pure functions
// of what the command and the chain reported, so each check is tested against the outcomes it must
// refuse. Each returns the problem, a sentence for the gate's FAIL line, or `undefined` when the
// outcome is the one expected.
//
// A cook that ran and succeeded is not yet the cook the gate is for: a simulation can succeed and
// move nothing, or move another token, or pay another account, and a mined cook can go to another
// contract. Each check therefore reads what the cook DID.

const sameAddress = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

/**
 * The net change of `holder`'s `mint`, in base units, over the entries of a simulation's
 * `tokenChanges` that name BOTH: another mint's entry, or another holder's, never stands in for it.
 * Each entry's `owner` is the token account's owner and its `delta` a decimal string, negative
 * where the account is debited. `{ delta: undefined }` where no entry matches, and `{ problem }`
 * where one that does has no delta to read.
 */
function netChange(changes, holder, mint) {
  let delta;
  for (const entry of changes) {
    if (entry === null || typeof entry !== "object") continue;
    if (entry.owner !== holder || entry.mint !== mint) continue;
    if (typeof entry.delta !== "string" || !/^-?\d+$/.test(entry.delta)) {
      return {
        problem: `the simulation's change of ${entry.account ?? "an account"} has no readable delta (${String(entry.delta)})`,
      };
    }
    delta = (delta ?? 0n) + BigInt(entry.delta);
  }

  return { delta };
}

/**
 * A simulated Solana payment: `simulated` is `sauce simulate --json`'s object, read by its
 * top-level `ok`, `logs`, `pot` and `tokenChanges`. It must have run on the package's engine and
 * shown, in its own effects, `expected.amount` of the mint leaving the Pot and reaching the
 * recipient.
 */
export function solanaCookProblem(simulated, expected) {
  const { engine, earlier, recipient, mint, amount, symbol } = expected;
  if (simulated.ok !== true) return `the cook does not simulate: ${simulated.reason}`;
  const logs = Array.isArray(simulated.logs) ? simulated.logs : [];
  if (!logs.some((line) => String(line).startsWith(`Program ${engine} invoke`))) {
    return `the simulated cook never invokes the package's engine ${engine}`;
  }
  const other = earlier.find((id) =>
    logs.some((line) => String(line).startsWith(`Program ${id} invoke`)),
  );
  if (other !== undefined) return `the simulated cook invokes the earlier engine ${other}`;

  const pot = simulated.pot;
  if (typeof pot !== "string" || pot === "") {
    return "the simulation names no Pot, so the payment it makes cannot be read";
  }
  const changes = Array.isArray(simulated.tokenChanges) ? simulated.tokenChanges : [];
  const received = netChange(changes, recipient, mint);
  if (received.problem !== undefined) return received.problem;
  if (received.delta === undefined) {
    return `the simulation shows no ${symbol} change for the recipient ${recipient}: the payment is not in its effects`;
  }
  if (received.delta !== amount) {
    return `the recipient ${recipient} receives ${received.delta} ${symbol}, not ${amount}`;
  }
  const paid = netChange(changes, pot, mint);
  if (paid.problem !== undefined) return paid.problem;
  if (paid.delta === undefined) {
    return `the simulation shows no ${symbol} change for the Pot ${pot}: nothing is paid from it`;
  }
  if (paid.delta !== -amount) {
    return `the Pot ${pot}'s ${symbol} changes by ${paid.delta}, not ${-amount}`;
  }

  return undefined;
}

/**
 * A mined EVM cook: `observed` is what the chain shows of it (the transaction's target, the engine
 * its calldata names, and the output of its top call from `debug_traceTransaction`), `expected`
 * what step 3 deployed and the package names. A program's return comes back with no ABI framing:
 * `return 7` is the one 32-byte word 7.
 */
export function evmCookProblem(observed, expected) {
  if (!sameAddress(observed.engine, expected.engine)) {
    return `the cook names engine ${observed.engine}, not the package's ${expected.engine}`;
  }
  if (
    observed.to === null ||
    observed.to === undefined ||
    !sameAddress(observed.to, expected.pot)
  ) {
    return `the cook went to ${observed.to ?? "no account (it created a contract)"}, not to the Pot ${expected.pot} that step 3 deployed`;
  }
  const { output } = observed;
  if (typeof output !== "string") {
    return "the cook's trace has no output, so what it returned cannot be read";
  }
  if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(output)) {
    return `the cook's traced output ${output.slice(0, 74)} is not hex`;
  }
  const bytes = (output.length - 2) / 2;
  if (bytes !== 32) {
    return `the cook returned ${bytes} bytes, not the one word of ${expected.value}`;
  }
  const returned = BigInt(output);
  if (returned !== expected.value) {
    return `the cook returned ${returned}, not ${expected.value}`;
  }

  return undefined;
}
