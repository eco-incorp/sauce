import { AccountRole, address, generateKeyPairSigner, getAddressDecoder, getCompiledTransactionMessageDecoder } from '@solana/kit';
import type { Blockhash, TransactionSigner } from '@solana/kit';
import type { Address } from '@solana/kit';
import {
  LOOKUP_TABLE_MAX_ADDRESSES,
  createAltWithAddresses,
  extendAlt,
  getTransactionSize,
  selectAltAddresses,
  waitForAltActive,
} from '../../src/svm/index.js';
import type { SignedExecuteTransaction } from '../../src/svm/index.js';

/** `count` unique deterministic addresses (a 16-bit counter in the first two bytes). */
function distinctAddresses(count: number): Address[] {
  return Array.from({ length: count }, (_, i) => {
    const bytes = new Uint8Array(32);
    bytes[0] = i & 0xff;
    bytes[1] = (i >> 8) & 0xff;

    return getAddressDecoder().decode(bytes);
  });
}

const A = address('So11111111111111111111111111111111111111112');
const B = address('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const C = address('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const BLOCKHASH = {
  blockhash: '11111111111111111111111111111111' as Blockhash,
  lastValidBlockHeight: 1000n,
};

type SlotRpc = Parameters<typeof waitForAltActive>[0];

function slotRpcStub(slots: bigint[]): { rpc: SlotRpc; calls: () => number } {
  let calls = 0;
  const rpc = {
    getSlot: () => ({
      send: async () => {
        const slot = slots[Math.min(calls, slots.length - 1)];
        calls += 1;
        return slot;
      },
    }),
  };

  return { rpc: rpc as unknown as SlotRpc, calls: () => calls };
}

describe('selectAltAddresses', () => {
  it('keeps non-signers only (signers cannot be looked up)', () => {
    const addresses = selectAltAddresses([
      { address: A, role: AccountRole.WRITABLE },
      { address: B, role: AccountRole.WRITABLE_SIGNER },
      { address: C, role: AccountRole.READONLY_SIGNER },
    ]);

    expect(addresses).toEqual([A]);
  });

  it('deduplicates repeated addresses in first-seen order', () => {
    const addresses = selectAltAddresses([
      { address: C, role: AccountRole.READONLY },
      { address: A, role: AccountRole.WRITABLE },
      { address: C, role: AccountRole.WRITABLE },
    ]);

    expect(addresses).toEqual([C, A]);
  });
});

describe('createAltWithAddresses', () => {
  // 30 unique deterministic addresses
  const addresses = Array.from({ length: 30 }, (_, i) => getAddressDecoder().decode(new Uint8Array(32).fill(i + 1)));

  function altRpcStub(): Parameters<typeof createAltWithAddresses>[0]['rpc'] {
    const rpc = {
      getSlot: () => ({ send: async () => 100n }),
      getLatestBlockhash: () => ({ send: async () => ({ context: { slot: 100n }, value: BLOCKHASH }) }),
    };

    return rpc as unknown as Parameters<typeof createAltWithAddresses>[0]['rpc'];
  }

  async function runWith(
    payer: TransactionSigner,
    authority: TransactionSigner,
    toAdd: readonly Address[] = addresses,
  ): Promise<SignedExecuteTransaction[]> {
    const sent: SignedExecuteTransaction[] = [];
    await createAltWithAddresses({
      rpc: altRpcStub(),
      payer,
      authority,
      addresses: toAdd,
      sendAndConfirm: async transaction => {
        sent.push(transaction);
      },
    });

    return sent;
  }

  /** Address count carried by the single extend instruction of a sent transaction: data = u32 discriminator + u64 count + N*32. */
  function extendedCount(transaction: SignedExecuteTransaction): number {
    const compiled = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes);
    if (compiled.version !== 0) throw new Error('expected a v0 compiled message');
    const [instruction] = compiled.instructions;

    return (instruction.data!.length - 12) / 32;
  }

  it('extends 30 addresses in one chunk when payer === authority, inside the packet limit', async () => {
    const payer = await generateKeyPairSigner();

    const sent = await runWith(payer, payer);

    expect(sent).toHaveLength(2); // create + 1 extend
    expect(extendedCount(sent[1])).toBe(30);
    for (const transaction of sent) expect(getTransactionSize(transaction)).toBeLessThanOrEqual(1232);
  });

  it('extends in chunks of 27 when payer and authority are distinct signers, inside the packet limit', async () => {
    // second signature (64B) + extra static account (32B) cost 3 address slots:
    // a 30-address chunk would compile to 1308 bytes (> 1232)
    const payer = await generateKeyPairSigner();
    const authority = await generateKeyPairSigner();

    const sent = await runWith(payer, authority);

    expect(sent).toHaveLength(3); // create + 2 extends
    expect(extendedCount(sent[1])).toBe(27);
    expect(extendedCount(sent[2])).toBe(3);
    for (const transaction of sent) expect(getTransactionSize(transaction)).toBeLessThanOrEqual(1232);
  });

  it('fills a table to exactly the on-chain 256-address capacity', async () => {
    const payer = await generateKeyPairSigner();

    const sent = await runWith(payer, payer, distinctAddresses(LOOKUP_TABLE_MAX_ADDRESSES));

    expect(sent).toHaveLength(10); // create + ceil(256 / 30) extends
    expect(extendedCount(sent[9])).toBe(16);
    for (const transaction of sent) expect(getTransactionSize(transaction)).toBeLessThanOrEqual(1232);
  });

  it('rejects one address past capacity before sending anything (a partial table cannot be un-funded)', async () => {
    const payer = await generateKeyPairSigner();
    const sent: SignedExecuteTransaction[] = [];

    await expect(
      createAltWithAddresses({
        rpc: altRpcStub(),
        payer,
        authority: payer,
        addresses: distinctAddresses(LOOKUP_TABLE_MAX_ADDRESSES + 1),
        sendAndConfirm: async transaction => {
          sent.push(transaction);
        },
      }),
    ).rejects.toThrow('cannot create an address lookup table with 257 addresses: one table holds at most 256');
    expect(sent).toHaveLength(0);
  });
});

describe('extendAlt', () => {
  const TABLE = address('11111111111111111111111111111112');
  const addresses = Array.from({ length: 30 }, (_, i) => getAddressDecoder().decode(new Uint8Array(32).fill(i + 1)));

  function altRpcStub(): Parameters<typeof extendAlt>[0]['rpc'] {
    const rpc = {
      getSlot: () => ({ send: async () => 200n }),
      getLatestBlockhash: () => ({ send: async () => ({ context: { slot: 200n }, value: BLOCKHASH }) }),
    };

    return rpc as unknown as Parameters<typeof extendAlt>[0]['rpc'];
  }

  function extendedCount(transaction: SignedExecuteTransaction): number {
    const compiled = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes);
    if (compiled.version !== 0) throw new Error('expected a v0 compiled message');

    return (compiled.instructions[0].data!.length - 12) / 32;
  }

  async function runExtend(payer: TransactionSigner, authority: TransactionSigner, toAdd: typeof addresses): Promise<{ sent: SignedExecuteTransaction[]; slot: bigint }> {
    const sent: SignedExecuteTransaction[] = [];
    const { lastExtendedSlot } = await extendAlt({
      rpc: altRpcStub(),
      payer,
      authority,
      lookupTableAddress: TABLE,
      addresses: toAdd,
      sendAndConfirm: async transaction => {
        sent.push(transaction);
      },
    });

    return { sent, slot: lastExtendedSlot };
  }

  it('appends 30 addresses in one extend tx (no create) when payer === authority, inside the packet', async () => {
    const payer = await generateKeyPairSigner();

    const { sent, slot } = await runExtend(payer, payer, addresses);

    expect(sent).toHaveLength(1);
    expect(extendedCount(sent[0])).toBe(30);
    expect(getTransactionSize(sent[0])).toBeLessThanOrEqual(1232);
    expect(slot).toBe(200n);
  });

  it('chunks at 27 with a distinct authority, all inside the packet', async () => {
    const payer = await generateKeyPairSigner();
    const authority = await generateKeyPairSigner();

    const { sent } = await runExtend(payer, authority, addresses);

    expect(sent).toHaveLength(2);
    expect(extendedCount(sent[0])).toBe(27);
    expect(extendedCount(sent[1])).toBe(3);
    for (const transaction of sent) expect(getTransactionSize(transaction)).toBeLessThanOrEqual(1232);
  });

  it('sends nothing for an empty address set (the idempotent reuse no-op)', async () => {
    const payer = await generateKeyPairSigner();

    const { sent, slot } = await runExtend(payer, payer, []);

    expect(sent).toHaveLength(0);
    expect(slot).toBe(200n);
  });

  it('appends exactly the on-chain 256-address capacity', async () => {
    const payer = await generateKeyPairSigner();

    const { sent } = await runExtend(payer, payer, distinctAddresses(LOOKUP_TABLE_MAX_ADDRESSES));

    expect(sent).toHaveLength(9); // ceil(256 / 30)
    expect(extendedCount(sent[8])).toBe(16);
    for (const transaction of sent) expect(getTransactionSize(transaction)).toBeLessThanOrEqual(1232);
  });

  it('rejects one address past capacity before sending anything (a partial table cannot be un-funded)', async () => {
    const payer = await generateKeyPairSigner();
    const sent: SignedExecuteTransaction[] = [];

    await expect(
      extendAlt({
        rpc: altRpcStub(),
        payer,
        authority: payer,
        lookupTableAddress: TABLE,
        addresses: distinctAddresses(LOOKUP_TABLE_MAX_ADDRESSES + 1),
        sendAndConfirm: async transaction => {
          sent.push(transaction);
        },
      }),
    ).rejects.toThrow(`cannot extend lookup table ${TABLE} with 257 addresses: one table holds at most 256`);
    expect(sent).toHaveLength(0);
  });
});

describe('waitForAltActive', () => {
  it('resolves only once the slot passes lastExtendedSlot (extend in N, usable N+1)', async () => {
    const { rpc, calls } = slotRpcStub([5n, 5n, 6n]);

    await waitForAltActive(rpc, 5n, { pollMs: 1 });

    expect(calls()).toBe(3);
  });

  it('resolves immediately when the slot has already advanced', async () => {
    const { rpc, calls } = slotRpcStub([9n]);

    await waitForAltActive(rpc, 5n, { pollMs: 1 });

    expect(calls()).toBe(1);
  });

  it('times out with a clear error while the slot is stuck', async () => {
    const { rpc } = slotRpcStub([5n]);

    await expect(waitForAltActive(rpc, 5n, { timeoutMs: 10, pollMs: 1 })).rejects.toThrow(
      'address lookup table not active after 10ms: current slot 5 has not passed last extended slot 5',
    );
  });
});
