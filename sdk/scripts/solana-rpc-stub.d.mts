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
  refuseScans?: string[];
  rateLimitScans?: number;
  /** What a scan of each program finds, whatever its filters. */
  scans?: Record<string, ReadonlyArray<{ pubkey: string; data: Uint8Array }>>;
}): Promise<SolanaRpcStub>;
