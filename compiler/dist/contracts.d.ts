export interface AbiParameter {
    name?: string;
    type: string;
    components?: AbiParameter[];
    indexed?: boolean;
}
export interface AbiFunction {
    type: 'function';
    name: string;
    inputs: AbiParameter[];
    outputs?: AbiParameter[];
    stateMutability?: 'pure' | 'view' | 'nonpayable' | 'payable';
}
export type AbiItem = AbiFunction | {
    type: 'event';
    name: string;
    inputs: AbiParameter[];
} | {
    type: 'error';
    name: string;
    inputs: AbiParameter[];
} | {
    type: 'constructor';
    inputs: AbiParameter[];
} | {
    type: 'fallback';
} | {
    type: 'receive';
};
export type Abi = readonly AbiItem[];
export interface ContractConfig {
    abi: Abi;
}
export type ContractsConfig = Record<string, ContractConfig>;
export interface MethodInfo {
    name: string;
    selector: string;
    inputs: AbiParameter[];
    outputs?: AbiParameter[];
    stateMutability: string;
}
export interface ContractInfo {
    name: string;
    abi: Abi;
    methods: Map<string, MethodInfo>;
}
export declare function parseAbiMethods(abi: Abi): Map<string, MethodInfo>;
export declare function hexToBytes(hex: string): Uint8Array;
//# sourceMappingURL=contracts.d.ts.map