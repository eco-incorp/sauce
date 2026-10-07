export interface SolanaRpcStub {
  readonly url: string;
  readonly methods: ReadonlyMap<string, number>;
  close(): Promise<void>;
}
export declare function solanaRpcStub(options?: {
  feeConfig?: string;
  kitchen?: string;
  fee?: bigint;
  accounts?: Record<string, { owner: string; data: Uint8Array }>;
  slot?: bigint;
}): Promise<SolanaRpcStub>;
