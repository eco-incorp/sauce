import { keccak256, toBytes } from 'viem';

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

export type AbiItem =
  | AbiFunction
  | { type: 'event'; name: string; inputs: AbiParameter[] }
  | { type: 'error'; name: string; inputs: AbiParameter[] }
  | { type: 'constructor'; inputs: AbiParameter[] }
  | { type: 'fallback' }
  | { type: 'receive' };

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

function formatType(param: AbiParameter): string {
  if (param.type === 'tuple' || param.type === 'tuple[]') {
    const inner = (param.components ?? []).map(formatType).join(',');

    return param.type === 'tuple' ? `(${inner})` : `(${inner})[]`;
  }

  return param.type;
}

function computeSelector(fn: AbiFunction): string {
  const sig = `${fn.name}(${fn.inputs.map(formatType).join(',')})`;
  const hash = keccak256(toBytes(sig));

  return hash.slice(0, 10); // "0x" + 4 bytes
}

export function parseAbiMethods(abi: Abi): Map<string, MethodInfo> {
  const methods = new Map<string, MethodInfo>();
  for (const item of abi) {
    if (item.type !== 'function') continue;

    const fn = item as AbiFunction;
    methods.set(fn.name, {
      name: fn.name,
      selector: computeSelector(fn),
      inputs: fn.inputs,
      outputs: fn.outputs,
      stateMutability: fn.stateMutability ?? 'nonpayable',
    });
  }

  return methods;
}

export function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(h.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(h.substring(i * 2, i * 2 + 2), 16);
  }

  return bytes;
}
