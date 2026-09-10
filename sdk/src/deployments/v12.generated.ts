// NOT GENERATED ANY MORE — hand-maintained, and hand-checked.
//
// It was written by sdk/scripts/sync-engine-artifacts.mjs from the engine dep's deployments/v12.json.
// That dep is gone and no v12 release publishes a deploy record, so nothing regenerates this and
// nothing checks it. **These addresses describe the stack deployed BEFORE the engine became a `cook`
// argument** — CREATE2 is over the initcode, so a redeploy of the current contracts lands on
// different addresses. Treat every address here as stale until a deploy record exists again; in
// particular `v12Runtime` is an interpreter of the older lineage, which is why nothing defaults to
// it (see routes/sauce-route.ts#SauceEvmExecutionInput.engine).
//
// The EVM addresses are CREATE2-deterministic (factory + salt + initcode only),
// so they are the SAME on every chain — hence one flat address set plus per-chain
// liveness, rather than the same three addresses repeated per chain.

/** CREATE2 salt the stack was deployed with. */
export const V12_SALT = '0x0000000000000000000000000000000000000000000000000000000000000001' as const;

/** Which tool in the engine repo produced the underlying record. */
export const V12_GENERATED_BY = 'dev-tools/scripts/deploy-v12.ts' as const;

/** Chain-invariant EVM addresses (identical on every chain — see the note above). */
export const V12_EVM_CONTRACTS = {
  router: '0x20BbEc03eE401B26938880cd23Aac00Cf927F06a',
  v12Runtime: '0x3dfE79fBB6C62D00986F476c3F86E7D19E0cabeD',
  v12Kitchen: '0xd57b452634c653D80A85160fea895BB07Ac41D8F',
} as const;

/** Per-chain deploy outcome. `live` is the only field callers should gate on. */
export const V12_EVM_CHAINS = {
  1: { name: 'ethereum', live: true, status: 'live' },
  10: { name: 'optimism', live: true, status: 'live' },
  56: { name: 'bsc', live: true, status: 'live' },
  130: { name: 'unichain', live: true, status: 'live' },
  137: { name: 'polygon', live: true, status: 'live' },
  143: { name: 'monad', live: true, status: 'live' },
  146: { name: 'sonic', live: true, status: 'live' },
  2020: { name: 'ronin', live: false, status: 'failed', error: 'Contracts deployed with a Solidity version equal or higher than 0.8.20 might not work properly. For more information, please see https://eips.ethereum.org/EIPS/eip-3855 Error: Failed to send transacti' },
  8453: { name: 'base', live: true, status: 'live' },
  9745: { name: 'plasma', live: true, status: 'live' },
  42161: { name: 'arbitrum', live: true, status: 'live' },
  42220: { name: 'celo', live: true, status: 'live' },
  57073: { name: 'ink', live: true, status: 'live' },
} as const;

/** The SVM engine program (non-upgradeable when `upgradeable` is false). */
export const V12_SVM = {
  programId: 'CuHCniNMWLSkZWBQKon9tudGujZeXJRUwG2PCLDq4ipJ',
  upgradeable: false,
  clusters: {
    'devnet': { cluster: 'devnet', status: 'already-deployed' },
    'mainnet-beta': { cluster: 'mainnet-beta', status: 'already-deployed' },
  },
} as const;
