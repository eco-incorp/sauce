// ONE PLACE PER RELEASE. The Sauce release's addresses are the same on every chain, so each audience
// writes them in exactly one file, generated from the SDK by `gen-skills-references.mjs`:
// `docs/reference/deployments.md` for the manual and `sauce-chains/references/deployments.json` for
// the skills (which the MCP server serves like any skill file). Every other page, skill file,
// example and runner, comments included, points at that file or reads the SDK's `/deployments`
// helpers, so a release changes `releases.json` and those two files, and nothing else under `docs/`
// or `skills/`. `docs:check` and `skills:check` apply this rule.
//
// The addresses are the SDK's own, so there is no second list: the release's EVM contracts, its Pot
// init-code hash and the shared intent Pot each chain derives, its Solana programs in base58 and as
// the 32-byte key a program holds, and the engine of every compiler `V12_RELEASE_SETS` pairs, so an
// address a release replaced is caught too.
import { getAddressEncoder } from "@solana/kit";

/** The manual's one page of the release's addresses, relative to the package root. */
export const DEPLOYMENTS_PAGE = "docs/reference/deployments.md";
/** The skills' one file of them, relative to the skills directory. */
export const DEPLOYMENTS_FILE = "sauce-chains/references/deployments.json";

const svmKey = (programId) =>
  `0x${[...getAddressEncoder().encode(programId)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;

/**
 * Every release address, each as it is searched for (hex lowercased; base58 as Solana writes it),
 * with what it is. `sdk` is the package root module and `deployments` its `/deployments` module, of
 * the package the checker holds.
 */
export function releaseAddresses({ sdk, deployments }) {
  const named = new Map();
  const add = (needle, what) => {
    if (!named.has(needle)) named.set(needle, what);
  };
  const evm = (address, what) => add(address.toLowerCase(), what);
  const svm = (programId, what) => {
    add(programId, what);
    add(svmKey(programId), `${what}'s key`);
  };
  const release = deployments.v12DeployedAddresses();
  for (const [name, contract] of Object.entries(release.evm.contracts))
    evm(contract.address, `the EVM ${name}`);
  evm(release.evm.pot.initCodeHash, "the Pot init-code hash");
  for (const [name, program] of Object.entries(release.svm.programs))
    svm(program.programId, `the Solana ${name}`);
  for (const chain of sdk.CANONICAL_CHAINS) {
    try {
      evm(sdk.destinationPot(chain.slug), "the shared intent Pot");
    } catch {}
  }
  for (const set of deployments.V12_RELEASE_SETS) {
    if (set["v12-evm"]?.engine)
      evm(set["v12-evm"].engine, `the EVM engine for compiler ${set.compiler}`);
    if (set["v12-svm"]?.engine)
      svm(set["v12-svm"].engine, `the Solana engine for compiler ${set.compiler}`);
  }

  return named;
}

/** Each line of `text` (the file at `where`) that names a release address, as a problem; `home` is
 *  the one file that may, which the message names. */
export function releaseAddressProblems({ where, text, addresses, home }) {
  const problems = [];
  text.split("\n").forEach((line, index) => {
    const lower = line.toLowerCase();
    for (const [needle, what] of addresses) {
      if (!(needle.startsWith("0x") ? lower.includes(needle) : line.includes(needle))) continue;
      problems.push(
        `${where}:${index + 1}: names ${what}, ${needle}; the release's addresses are written ` +
          `once, in ${home}: point at it, or read it from the SDK's /deployments`,
      );
    }
  });

  return problems;
}
