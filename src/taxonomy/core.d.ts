// Types for core.js and the records (src/taxonomy/schema).

export type Origin = 'natural' | 'regenerated' | 'synthetic' | 'unknown';
export type YarnType = Origin | 'blend';
export type ValueStatus = 'measured' | 'estimated' | 'generated';

export interface Fiber { schema_version: '0.2.0'; fiber_id: string; fiber_name: string; fiber_type: string; fiber_origin: Origin }
export interface Yarn { schema_version: '0.2.0'; yarn_id: string; yarn_name: string; date_added: string; composition: { fiber_id: string; percentage_value: number }[] }
export interface PerfValue { value: number; unit: string; method: string; status: ValueStatus; note?: string }
export interface Machine { status: 'measured' | 'generated'; machine_type?: string; gauge?: number; loop_length?: number; carriage_speed?: number; needles?: number; courses?: number; program?: string; [k: string]: string | number | undefined }
export interface Sample {
  schema_version: '0.2.0'; sample_id: string; sample_name: string; sample_date: string; data_as_of: string;
  status: 'demo' | 'draft' | 'reviewed' | 'final'; sample_yarn: { yarn_id: string; yarn_role: string }[];
  structure: string; pattern?: string; photo?: string; machine?: Machine; performance?: Record<string, PerfValue>; notes?: string;
}

/** A vocabulary term; vocabularies add their own fields. */
export interface Term { id: string; label: string; definition: string; status: string; [k: string]: unknown }

export interface TagContext {
  fibers: Map<string, Fiber>; yarns: Map<string, Yarn>;
  properties: (Term & { tag_key: string })[]; machine: (Term & { tag_key: string })[]; statusKey: Record<string, string>;
}

export const ORIGINS: Origin[];
export function typeOf(origins: Origin[]): YarnType;
export function yarnType(yarn: Yarn, fibers: Map<string, Fiber>): YarnType;
export function sampleOrigin(sample: Sample, yarns: Map<string, Yarn>, fibers: Map<string, Fiber>): YarnType;
export function yarnShares(yarn: Yarn, fibers: Map<string, Fiber>): { origin: Origin; pct: number }[];
export const TAG_BASE: string;
export const TAG_DATA_BYTES: number;
export function sampleUrl(id: string, base?: string): string;
export function ndefMessage(url: string, json?: string | null): Uint8Array;
export function ndefBytes(url: string, json?: string | null): number;
export function tlv(message: Uint8Array): Uint8Array;
export function tlvBytes(message: number): number;
export function tagPayload(sample: Sample, t: TagContext, base?: string): { url: string; json: string; bytes: number; cut: string[] };
