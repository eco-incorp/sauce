// A Solana program's executable bytes, read from a cluster the way `solana program dump` writes
// them: what `scripts/dump-svm-venues.mjs` pinned in `test/fixtures/svm-venue-programs/` and what
// `solana program dump` pinned in `test/fixtures/svm-exact-in-programs/`.
//
//   upgradeable loader   the ProgramData account's data after its 45-byte header (a u32 tag, the
//                        deploy slot, an `Option<Pubkey>`), the whole allocation: its size is the
//                        pinned `size`, the zeros past the ELF included
//   loader v2 and v1     the program account's data, which is the ELF
//   loader v4            the program account's data after its 48-byte header (slot, authority,
//                        status)
//
// Reads are `getAccountInfo` and nothing else: no key, no transaction, no `getProgramAccounts`.
// The endpoints are handed in (the SDK's own public list, `src/cli/public-rpcs.ts`, which the
// fetch script loads) so this module holds no URL.
import { createHash } from "node:crypto";

import { getAddressDecoder } from "@solana/kit";

const UPGRADEABLE = "BPFLoaderUpgradeab1e11111111111111111111111";
const LOADER_V2 = "BPFLoader2111111111111111111111111111111111";
const LOADER_V1 = "BPFLoader1111111111111111111111111111111111";
const LOADER_V4 = "LoaderV411111111111111111111111111111111111";

/** `UpgradeableLoaderState::ProgramData`: a u32 tag, the deploy slot, an `Option<Pubkey>`. */
const PROGRAM_DATA_HEADER = 4 + 8 + 1 + 32;
/** Loader v4's `LoaderV4State`: the slot, the authority (or next version) and the status. */
const V4_HEADER = 8 + 32 + 8;

export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** A JSON-RPC error worth another attempt: the node lagging, unhealthy or shedding load. */
const RETRYABLE_RPC_CODES = new Set([-32004, -32005, -32009, -32014, -32016]);

/**
 * A reader over `endpoints` (URLs, tried in order, the next on a failure). A network error, a
 * timeout, HTTP 429/5xx (honouring `Retry-After`) and a node that is behind or unhealthy are
 * retried with a growing delay, `attempts` times in all; any other error is final. Nothing in a
 * failure carries the URL's query string, so a keyed endpoint is never printed.
 */
export function createReader({ endpoints, attempts = 8, timeoutMs = 120_000, log = () => {} }) {
  if (endpoints.length === 0) throw new Error("solana-program-elf: no endpoint");
  const label = (url) => {
    const { origin } = new URL(url);
    return origin;
  };
  let sticky = 0;

  async function call(method, params) {
    let last = "no attempt";
    for (let attempt = 0; attempt < attempts; attempt++) {
      const at = (sticky + attempt) % endpoints.length;
      const url = endpoints[at];
      let wait = Math.min(30_000, 1_000 * 2 ** attempt);
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (response.status === 429 || response.status >= 500) {
          const after = Number(response.headers.get("retry-after"));
          if (Number.isFinite(after) && after > 0) wait = Math.max(wait, after * 1_000);
          last = `${label(url)} answered HTTP ${response.status}`;
        } else if (!response.ok) {
          throw new Error(`${label(url)} answered HTTP ${response.status}`);
        } else {
          const body = await response.json();
          if (body.error === undefined) {
            sticky = at;
            return body.result;
          }
          if (!RETRYABLE_RPC_CODES.has(body.error.code))
            throw new Error(`${method}: ${label(url)} answered ${JSON.stringify(body.error)}`);
          last = `${label(url)} answered ${body.error.code} ${body.error.message}`;
        }
      } catch (error) {
        if (error?.name !== "TimeoutError" && error?.name !== "TypeError" && !error?.cause)
          throw error;
        last = `${label(url)}: ${error?.name === "TimeoutError" ? "timed out" : (error?.cause?.code ?? error?.message)}`;
      }
      log(`${method} attempt ${attempt + 1}/${attempts} failed (${last}); retrying in ${wait} ms`);
      await sleep(wait);
    }
    throw new Error(`${method} failed after ${attempts} attempts: ${last}`);
  }

  /** `{ context: { slot }, value }`, `value` null for an account that does not exist. */
  const account = (address) =>
    call("getAccountInfo", [address, { encoding: "base64", commitment: "finalized" }]).then(
      (result) => ({
        slot: result.context.slot,
        account:
          result.value === null
            ? null
            : {
                owner: result.value.owner,
                data: Buffer.from(result.value.data[0], "base64"),
              },
      }),
    );

  return { call, account };
}

/**
 * The program `programId`'s executable bytes as a cluster holds them now: `{ status: "ok", loader,
 * elf, slot, programData?, lastDeploySlot? }`, or `{ status: "missing" | "closed" | "unsupported",
 * reason }` for a program with nothing to dump. `slot` is the slot the last read answered at.
 */
export async function readProgramElf(reader, programId) {
  const head = await reader.account(programId);
  if (head.account === null)
    return { status: "missing", reason: "the program account does not exist" };
  const { owner, data } = head.account;

  if (owner === UPGRADEABLE) {
    if (data.length !== 36 || data.readUInt32LE(0) !== 2)
      return {
        status: "unsupported",
        reason: "an upgradeable-loader account that is not a Program",
      };
    const programData = getAddressDecoder().decode(data.subarray(4, 36));
    const body = await reader.account(programData);
    if (body.account === null)
      return {
        status: "closed",
        reason: `its ProgramData account ${programData} does not exist`,
        programData,
      };
    const state = body.account.data;
    if (body.account.owner !== UPGRADEABLE || state.readUInt32LE(0) !== 3)
      return { status: "unsupported", reason: `${programData} is not a ProgramData account` };
    return done(state.subarray(PROGRAM_DATA_HEADER), "upgradeable", body.slot, {
      programData,
      lastDeploySlot: state.readBigUInt64LE(4).toString(),
    });
  }
  if (owner === LOADER_V2) return done(data, "loader-v2", head.slot, {});
  if (owner === LOADER_V1) return done(data, "loader-v1", head.slot, {});
  if (owner === LOADER_V4) {
    const status = data.readBigUInt64LE(40);
    if (status === 0n) return { status: "closed", reason: "its loader-v4 status is retracted" };
    return done(data.subarray(V4_HEADER), "loader-v4", head.slot, {});
  }
  return { status: "unsupported", reason: `owned by ${owner}, which is no program loader` };
}

function done(elf, loader, slot, extra) {
  if (elf.subarray(0, 4).toString("hex") !== "7f454c46")
    return { status: "unsupported", reason: "its program data is not an ELF" };
  return { status: "ok", loader, elf, slot, ...extra };
}
