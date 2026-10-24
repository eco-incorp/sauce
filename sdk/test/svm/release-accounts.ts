/**
 * The release's engine and Kitchen as a cluster running them holds them, for an offline endpoint
 * to answer `getAccountInfo` with: each program's account under the upgradeable loader, naming its
 * programdata, and the programdata, holding the packaged binary. What the release check reads.
 */
import { address, getAddressEncoder, getBase64Decoder } from "@solana/kit";

import { packagedRelease } from "../../src/cli/solana-release.js";
import { v12SvmEngineProgramId, v12SvmKitchenProgramId } from "../../src/deployments/index.js";
import { deriveProgramDataPda } from "../../src/svm/index.js";

const UPGRADEABLE = "BPFLoaderUpgradeab1e11111111111111111111111";
/** The programdata account's header: a 4-byte tag (3), the slot, and the optional authority. */
const PROGRAMDATA_HEADER = 45;

/** An account as `getAccountInfo` returns it, in base64. */
export interface RpcAccount {
  readonly data: [string, "base64"];
  readonly executable: boolean;
  readonly lamports: number;
  readonly owner: string;
  readonly rentEpoch: number;
  readonly space: number;
}

const account = (data: Uint8Array, executable: boolean): RpcAccount => ({
  data: [getBase64Decoder().decode(data), "base64"],
  executable,
  lamports: 1,
  owner: UPGRADEABLE,
  rentEpoch: 0,
  space: data.length,
});

/** Every account the release check reads, by address. */
export async function releasedProgramAccounts(): Promise<Record<string, RpcAccount>> {
  const release = packagedRelease();
  const accounts: Record<string, RpcAccount> = {};
  for (const [program, bytes] of [
    [v12SvmEngineProgramId(), release.engine[0]!],
    [v12SvmKitchenProgramId(), release.kitchen],
  ] as const) {
    const { address: programData } = await deriveProgramDataPda(address(program));
    const head = new Uint8Array(36);
    new DataView(head.buffer).setUint32(0, 2, true);
    head.set(getAddressEncoder().encode(programData), 4);
    const data = new Uint8Array(PROGRAMDATA_HEADER + bytes.length);
    new DataView(data.buffer).setUint32(0, 3, true);
    data.set(bytes, PROGRAMDATA_HEADER);
    accounts[program] = account(head, true);
    accounts[programData] = account(data, false);
  }

  return accounts;
}
