// What `scripts/capture-registry-abi.mjs` may record about a deployment's code, and what
// `scripts/gen-registry-abis.mjs` may read back from it.
//
// A read of code that fails is UNKNOWN, never absent. The generator takes an event or error no
// captured code carries for one no deployment carries (and leaves it out of the registry, a shipped
// one included), so a code read that failed and was recorded as "no code" would remove entries from
// the registry on the next recapture. Every read here either returns the code the chain served or
// throws, naming the chain and address, and the capture stops before it writes anything.
//
// The functions take the reader (`getCode`) and the chain's kind as arguments, so a test drives them
// with a reader that throws.

/** zkSync Era runs EraVM bytecode: no PUSH4 dispatcher to parse, so selectors are found by scan. */
export const ERAVM = new Set([324]);

export const ZERO = "0x0000000000000000000000000000000000000000";
export const isAddress = (a) => a !== null && a !== ZERO && /^0x[0-9a-f]{40}$/.test(a);

/**
 * Whether a JSON-RPC error is the call's own revert, as nodes report one (code 3, or -32000/-32015
 * with an execution message), rather than a node refusing or failing the request. A node that gives
 * up on a call (`execution aborted (timeout = 5s)`, a cancelled or timed-out request) has not said
 * the contract lacks what it was asked, so that is no revert: the request is retried and, past its
 * retries, fails the capture.
 */
export function isRevert(error) {
  if (error?.code === 3) return true;
  const message = String(error?.message ?? "").toLowerCase();
  if (/abort|timeout|timed out|cancel/.test(message)) return false;
  return /revert|execution|invalid opcode|out of gas|stack underflow|bad instruction/.test(message);
}

/**
 * The code at `address`, which `getCode` reads: what the chain served (`0x` for an address with
 * none), or a thrown error naming `what` the code was wanted for. A reader that answers anything but
 * a string has not answered.
 */
export async function readCode(getCode, chainId, address, what) {
  let code;
  try {
    code = await getCode(chainId, address);
  } catch (err) {
    throw new Error(
      `chain ${chainId} ${address}: the code of ${what} could not be read (${err.message}), so what ` +
        "it carries is unknown: recapture",
      { cause: err },
    );
  }
  if (typeof code !== "string") {
    throw new Error(
      `chain ${chainId} ${address}: the code of ${what} was not answered, so what it carries is ` +
        "unknown: recapture",
    );
  }
  return code;
}

/**
 * The addresses a thin proxy hard-codes: PUSH20 constants, and PUSH32 words holding an address (how
 * Solidity inlines an `immutable address`).
 */
export function embeddedAddresses(code) {
  const hex = code.slice(2);
  const out = new Set();
  for (let i = 0; i < hex.length; i += 2) {
    const op = parseInt(hex.slice(i, i + 2), 16);
    let imm = null;
    if (op === 0x73) imm = `0x${hex.slice(i + 2, i + 42)}`;
    if (op === 0x7f && /^0{24}/.test(hex.slice(i + 2, i + 26)))
      imm = `0x${hex.slice(i + 26, i + 66)}`;
    if (imm !== null) {
      imm = imm.toLowerCase();
      if (isAddress(imm) && !/^0x0{8}/.test(imm) && !/^0xf{8}/.test(imm)) out.add(imm);
    }
    if (op >= 0x60 && op <= 0x7f) i += 2 * (op - 0x5f);
  }
  return [...out];
}

/**
 * The Solidity libraries `codes` link, by address: each embedded address whose code is a deployed
 * library's, which opens with the call guard solc writes into every library (PUSH20 its own
 * address, ADDRESS, EQ). A library runs in its caller's context through DELEGATECALL, so what it
 * emits or reverts with is its caller's (Aave's Pool emits `Supply` from SupplyLogic). A library
 * links others in turn. None on EraVM, whose code is not EVM bytecode. An embedded address whose
 * code cannot be read fails the capture: it may be a library.
 */
export async function linkedLibraries(chainId, codes, getCode) {
  const found = new Map();
  if (ERAVM.has(chainId)) return found;
  const tried = new Set();
  for (let frontier = codes.filter(Boolean); frontier.length > 0;) {
    const next = [];
    for (const code of frontier) {
      for (const address of embeddedAddresses(code)) {
        if (tried.has(address)) continue;
        tried.add(address);
        const library = await readCode(getCode, chainId, address, "an address a contract embeds");
        if (!library.toLowerCase().startsWith(`0x73${address.slice(2)}3014`)) continue;
        found.set(address, library);
        next.push(library);
      }
    }
    frontier = next;
  }
  return found;
}

/** The code of each of `facets`, by address: a facet a router named runs as the instance's. */
export async function facetCodes(chainId, facets, getCode) {
  const codes = {};
  for (const facet of facets) {
    codes[facet] = await readCode(getCode, chainId, facet, "a facet a router named");
  }
  return codes;
}

/**
 * The captured rows of `protocol`'s `abi` export, every one a deployment whose code was read. A row
 * that recorded an error (a layer that could not be read, an address with no code) stands for a
 * deployment whose events and errors the generator would read as absent, so it refuses the export
 * instead.
 */
export function readableRows(instances, protocol, abi) {
  const rows = instances.filter((row) => row.protocol === protocol && row.abi === abi);
  const failed = rows.filter((row) => row.error !== undefined);
  if (failed.length > 0) {
    throw new Error(
      `${protocol}.${abi}: ${failed.length} captured deployment(s) recorded an error, so what ` +
        `their code carries is unknown (${failed.map((r) => `${r.chainId}:${r.address}: ${r.error}`).join("; ")}) — ` +
        `recapture ${protocol}`,
    );
  }
  return rows;
}
