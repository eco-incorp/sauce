/**
 * stageBuffer's content-hash pin: it is recorded before the first transaction,
 * so a staging run that dies after the on-chain finalize — the post-confirmation
 * `getTransaction` meta read is the realistic place — still leaves the buffer
 * addressable by executeStaged. Pinning last strands the caller instead: the
 * buffer IS finalized on-chain, so restaging at the same seed is barred, and
 * executeStaged rejects the address as "not staged by this client".
 *
 * The client builds its own RPC and subscriptions from `rpcUrl`, so the seams
 * are `globalThis.fetch` and `globalThis.WebSocket`. Kit's channel factory
 * captures `globalThis.WebSocket` ONCE, when its module loads — hence the
 * stub goes in at module scope and every import here is dynamic, including
 * @solana/kit itself (a static one would pull the channel in first).
 */
import type { Address, Signature, TransactionSigner } from '@solana/kit';
import type { AccountManifest } from 'sauce-compiler';
import type { AccountResolution } from '../../src/svm/index.js';

const RPC_URL = 'http://127.0.0.1:65535/';
const ENGINE_PROGRAM = 'Stake11111111111111111111111111111111111111' as Address;
const BLOCKHASH = '11111111111111111111111111111111';
const SIGNATURE =
  '5VERd6cyLU4t7yQxsjfqLNsRWjM4tt7YivsTMkYnbxHBjBHqvfMoSotYAtvyRZcpFvsPeqrDNbG7XNCn9SNWbfXo' as Signature;
const SEED = new Uint8Array(32).fill(7);
const BYTECODE = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
const MANIFEST: AccountManifest = { accounts: [] };
const RESOLUTION: AccountResolution = {};

/**
 * Minimal stand-in for the kit subscriptions channel's WebSocket: acks every
 * `*Subscribe` with a fresh subscription id and never notifies, so confirmation
 * resolves off the getSignatureStatuses leg of its race.
 */
class SubscriptionAckSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = SubscriptionAckSocket.OPEN;
  bufferedAmount = 0;
  private nextSubscriptionId = 1;

  constructor(_url: string) {
    super();
    setTimeout(() => this.dispatchEvent(new Event('open')), 0);
  }

  send(payload: string): void {
    const { id, method } = JSON.parse(payload) as { id: number; method: string };
    const result = method.endsWith('Unsubscribe') ? true : this.nextSubscriptionId++;
    setTimeout(
      () => this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ jsonrpc: '2.0', id, result }) })),
      0,
    );
  }

  close(): void {
    this.readyState = SubscriptionAckSocket.CLOSED;
    // CloseEvent is not a global under jest's node environment; the channel
    // only reads `code` and `wasClean` off the event.
    this.dispatchEvent(Object.assign(new Event('close'), { code: 1000, wasClean: true }));
  }
}

const nativeWebSocket = globalThis.WebSocket;
globalThis.WebSocket = SubscriptionAckSocket as unknown as typeof globalThis.WebSocket;

/** True when a base64 transaction payload carries the finalize-buffer instruction. */
function carriesFinalize(base64Transaction: string): boolean {
  return Buffer.from(base64Transaction, 'base64').includes(Buffer.from(finalizeDiscriminator));
}

/**
 * Answers the JSON-RPC calls a stage/execute round trip makes. With
 * `failMetaReadBehindFinalize`, ONLY the `getTransaction` behind the finalize
 * send answers a JSON-RPC error: every staging transaction confirms, so the
 * buffer really is finalized on-chain, and the failure lands exactly where
 * sendExecute reads meta AFTER irreversible confirmation. Failing every
 * `getTransaction` instead aborts on the init send — an unfinalized buffer,
 * freely restageable, which is a different scenario entirely.
 */
function installFetchStub({ failMetaReadBehindFinalize = false } = {}): { methods: () => string[]; restore: () => void } {
  const original = globalThis.fetch;
  const methods: string[] = [];
  let finalizeSent = false;
  const results: Record<string, unknown> = {
    getLatestBlockhash: { context: { slot: 100 }, value: { blockhash: BLOCKHASH, lastValidBlockHeight: 10_000 } },
    getAccountInfo: { context: { slot: 100 }, value: null },
    sendTransaction: SIGNATURE,
    getSignatureStatuses: {
      context: { slot: 101 },
      value: [{ confirmationStatus: 'confirmed', confirmations: 0, err: null, slot: 101 }],
    },
    getEpochInfo: { absoluteSlot: 101, blockHeight: 101, epoch: 0, slotIndex: 101, slotsInEpoch: 432_000, transactionCount: 1 },
    getTransaction: null,
  };

  const stub = async (_url: unknown, init: { body: string }): Promise<unknown> => {
    const { id, method, params } = JSON.parse(init.body) as { id: number; method: string; params: unknown[] };
    methods.push(method);

    // Each send is followed by its own meta read, so this flips exactly before
    // the finalize transaction's getTransaction and stays set for it.
    if (method === 'sendTransaction' && carriesFinalize(params[0] as string)) finalizeSent = true;

    const body =
      method === 'getTransaction' && failMetaReadBehindFinalize && finalizeSent
        ? { jsonrpc: '2.0', id, error: { code: -32004, message: 'Block not available for slot 101' } }
        : { jsonrpc: '2.0', id, result: results[method] ?? null };

    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  };

  globalThis.fetch = stub as unknown as typeof globalThis.fetch;

  return {
    methods: () => methods,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

let createSauceSvmClient: typeof import('../../src/svm/client.js')['createSauceSvmClient'];
let deriveBufferPda: typeof import('../../src/svm/pda.js')['deriveBufferPda'];
let finalizeDiscriminator: Uint8Array;
let newPayer: () => Promise<TransactionSigner>;

beforeAll(async () => {
  ({ createSauceSvmClient } = await import('../../src/svm/client.js'));
  ({ deriveBufferPda } = await import('../../src/svm/pda.js'));
  ({ FINALIZE_BUFFER_DISCRIMINATOR: finalizeDiscriminator } = await import('../../src/svm/engine-abi.generated.js'));
  const { generateKeyPairSigner } = await import('@solana/kit');
  newPayer = generateKeyPairSigner;
});

afterAll(() => {
  globalThis.WebSocket = nativeWebSocket;
});

describe('stageBuffer', () => {
  it('returns the buffer address, seed, digest and one signature per staging transaction', async () => {
    const payer = await newPayer();
    const stub = installFetchStub();

    try {
      const client = await createSauceSvmClient({ rpcUrl: RPC_URL, programId: ENGINE_PROGRAM, payer });
      const { address: buffer } = await deriveBufferPda(ENGINE_PROGRAM, payer.address, SEED);
      const staged = await client.stageBuffer(SEED, BYTECODE);

      expect(staged.address).toBe(buffer);
      expect(staged.seed).toBe(SEED);
      expect(staged.sha256).toHaveLength(32);
      expect(staged.signatures).toHaveLength(3); // init + one write + finalize
      expect(new Set(staged.signatures).size).toBe(3);
      expect(stub.methods()).toContain('sendTransaction');
    } finally {
      stub.restore();
    }
  });

  it('records the pin even when the post-confirmation meta read fails, keeping executeStaged usable', async () => {
    const payer = await newPayer();
    const staging = installFetchStub({ failMetaReadBehindFinalize: true });
    let buffer: Address;

    try {
      const client = await createSauceSvmClient({ rpcUrl: RPC_URL, programId: ENGINE_PROGRAM, payer });
      ({ address: buffer } = await deriveBufferPda(ENGINE_PROGRAM, payer.address, SEED));

      // Every staging transaction confirms; only the meta read behind the last
      // one fails, so the buffer is finalized on-chain and cannot be restaged.
      await expect(client.stageBuffer(SEED, BYTECODE)).rejects.toThrow('Block not available');
      // All three staging transactions went out (init + one write + finalize)
      // and each was confirmed and read back: the buffer IS finalized, and the
      // read that failed is the finalize one. Without this the stub would abort
      // on the init send and never exercise a finalized buffer at all.
      expect(staging.methods().filter((method) => method === 'sendTransaction')).toHaveLength(3);
      expect(staging.methods().filter((method) => method === 'getTransaction')).toHaveLength(3);
      staging.restore();

      const executing = installFetchStub();
      try {
        // Without the hoisted pin this throws "was not staged by this client".
        await expect(client.executeStaged(buffer, MANIFEST, RESOLUTION)).resolves.toMatchObject({ logs: [] });
      } finally {
        executing.restore();
      }
    } finally {
      staging.restore();
    }
  });
});
