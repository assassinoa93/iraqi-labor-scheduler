/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * v5.20.0 — AI tool registry.
 *
 * Single source of truth for the tool family: ties each tool name to
 * its JSON schema (sent to the LLM) and its handler (executed when the
 * LLM emits a tool_call).
 *
 * The handler signature is `(args, ctx) => unknown` where `ctx` carries
 * everything a query needs — the active CompanyData, the station-profile
 * map, and the dual-mode profile updater. The chat panel (phase 4) will
 * wire all three at session start.
 *
 * Phase 3 ships the registry + read tools + the profile mutator. The
 * advisory emitter (`emitAdvisory`) lands in phase 5 alongside the
 * finding-card UI; defining it here today would be a stub with no
 * downstream consumer.
 */

import type { CompanyData } from '../../../types';
import type { ChatTool } from '../openrouter';
import type { StationProfile } from '../profiles';
import { listAvailableData } from '../dataSurvey';
import {
  getSchedules, getPayroll, getCompliance,
  getLeaveBalances, getLeaveHistory,
  getStations, getStationProfile,
  getEmployees, getWFP,
  type MonthRangeArg,
} from './queries';
import { TOOL_SCHEMAS } from './schemas';
import { estimateTokens, classify, type BudgetVerdict } from './sizeEstimator';

export type ProfileMap = Record<string, StationProfile>;

export interface ToolContext {
  companyData: CompanyData;
  profiles: ProfileMap;
  /** Async profile mutator — wraps the dual-mode store from useStationProfiles. */
  updateProfile: (stationId: string, patch: Partial<StationProfile>) => Promise<void>;
}

export interface ToolRunResult {
  /** What the LLM sees — JSON-serializable, compact. */
  data: unknown;
  /** Estimated tokens of `data` for budget classification. */
  tokens: number;
  verdict: BudgetVerdict;
}

export interface ToolDefinition {
  name: string;
  schema: ChatTool;
  /** Validates and runs the tool. Throws on bad args; the chat panel
   *  catches and forwards the error to the LLM as a tool result. */
  run: (args: unknown, ctx: ToolContext) => Promise<ToolRunResult> | ToolRunResult;
}

// ─── Arg validators ─────────────────────────────────────────────────────

function asObj(args: unknown, toolName: string): Record<string, unknown> {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    throw new Error(`${toolName}: args must be an object`);
  }
  return args as Record<string, unknown>;
}

function asMonthRange(value: unknown, toolName: string): MonthRangeArg {
  if (!value || typeof value !== 'object') {
    throw new Error(`${toolName}: range must be an object`);
  }
  const r = value as Record<string, unknown>;
  const fy = Number(r.fromYear), fm = Number(r.fromMonth);
  const ty = Number(r.toYear), tm = Number(r.toMonth);
  if (![fy, fm, ty, tm].every((n) => Number.isFinite(n))) {
    throw new Error(`${toolName}: range fields must be numeric`);
  }
  if (fm < 1 || fm > 12 || tm < 1 || tm > 12) {
    throw new Error(`${toolName}: months must be 1..12`);
  }
  return { fromYear: fy, fromMonth: fm, toYear: ty, toMonth: tm };
}

function asDateString(value: unknown, toolName: string, field: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${toolName}: ${field} must be YYYY-MM-DD`);
  }
  return value;
}

function asString(value: unknown, toolName: string, field: string): string {
  if (typeof value !== 'string' || !value) {
    throw new Error(`${toolName}: ${field} must be a non-empty string`);
  }
  return value;
}

function asInt(value: unknown, toolName: string, field: string): number {
  const n = Number(value);
  if (!Number.isInteger(n)) throw new Error(`${toolName}: ${field} must be an integer`);
  return n;
}

function wrap(data: unknown): ToolRunResult {
  const tokens = estimateTokens(data);
  return { data, tokens, verdict: classify(tokens) };
}

// ─── Registry ──────────────────────────────────────────────────────────

const schemaByName = new Map<string, ChatTool>(
  TOOL_SCHEMAS.map((t) => [t.function.name, t]),
);

function need(name: string): ChatTool {
  const s = schemaByName.get(name);
  if (!s) throw new Error(`No schema registered for tool '${name}'`);
  return s;
}

export const TOOLS: Record<string, ToolDefinition> = {
  listAvailableData: {
    name: 'listAvailableData',
    schema: need('listAvailableData'),
    run: (_args, ctx) => {
      // Pass the full profile map so the survey can produce per-station
      // `profiled` flags + group rollups — lets the AI batch interview
      // questions across a group instead of one per station.
      return wrap(listAvailableData(ctx.companyData, ctx.profiles));
    },
  },

  getStations: {
    name: 'getStations',
    schema: need('getStations'),
    run: (_args, ctx) => wrap(getStations(ctx.companyData, ctx.profiles)),
  },

  getStationProfile: {
    name: 'getStationProfile',
    schema: need('getStationProfile'),
    run: (args, ctx) => {
      const a = asObj(args, 'getStationProfile');
      const stationId = asString(a.stationId, 'getStationProfile', 'stationId');
      return wrap(getStationProfile(ctx.profiles, stationId));
    },
  },

  updateStationProfile: {
    name: 'updateStationProfile',
    schema: need('updateStationProfile'),
    run: async (args, ctx) => {
      const a = asObj(args, 'updateStationProfile');
      const stationId = asString(a.stationId, 'updateStationProfile', 'stationId');
      const patch = a.patch;
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
        throw new Error('updateStationProfile: patch must be an object');
      }
      await ctx.updateProfile(stationId, patch as Partial<StationProfile>);
      return wrap({ ok: true, stationId });
    },
  },

  getEmployees: {
    name: 'getEmployees',
    schema: need('getEmployees'),
    run: (_args, ctx) => wrap(getEmployees(ctx.companyData)),
  },

  getSchedules: {
    name: 'getSchedules',
    schema: need('getSchedules'),
    run: (args, ctx) => {
      const a = asObj(args, 'getSchedules');
      const range = asMonthRange(a.range, 'getSchedules');
      return wrap(getSchedules(ctx.companyData, range));
    },
  },

  getPayroll: {
    name: 'getPayroll',
    schema: need('getPayroll'),
    run: (args, ctx) => {
      const a = asObj(args, 'getPayroll');
      const range = asMonthRange(a.range, 'getPayroll');
      return wrap(getPayroll(ctx.companyData, range));
    },
  },

  getCompliance: {
    name: 'getCompliance',
    schema: need('getCompliance'),
    run: (args, ctx) => {
      const a = asObj(args, 'getCompliance');
      const range = asMonthRange(a.range, 'getCompliance');
      return wrap(getCompliance(ctx.companyData, range));
    },
  },

  getLeaveBalances: {
    name: 'getLeaveBalances',
    schema: need('getLeaveBalances'),
    run: (args, ctx) => {
      const a = asObj(args, 'getLeaveBalances');
      const asOf = asDateString(a.asOf, 'getLeaveBalances', 'asOf');
      return wrap(getLeaveBalances(ctx.companyData, asOf));
    },
  },

  getLeaveHistory: {
    name: 'getLeaveHistory',
    schema: need('getLeaveHistory'),
    run: (args, ctx) => {
      const a = asObj(args, 'getLeaveHistory');
      const from = asDateString(a.from, 'getLeaveHistory', 'from');
      const to = asDateString(a.to, 'getLeaveHistory', 'to');
      return wrap(getLeaveHistory(ctx.companyData, from, to));
    },
  },

  getWFP: {
    name: 'getWFP',
    schema: need('getWFP'),
    run: (args, ctx) => {
      const a = asObj(args, 'getWFP');
      const year = asInt(a.year, 'getWFP', 'year');
      return wrap(getWFP(ctx.companyData, year));
    },
  },
};

/** Convenience: the schema array the chat panel hands to OpenRouter. */
export function allToolSchemas(): ChatTool[] {
  return Object.values(TOOLS).map((t) => t.schema);
}

/** Names of every read-only tool. Used by the Tool Inspector preview
 *  to filter out mutators (which should never be auto-run from a UI
 *  preview). */
export const READ_ONLY_TOOL_NAMES: ReadonlyArray<string> = [
  'listAvailableData', 'getStations', 'getStationProfile',
  'getEmployees', 'getSchedules', 'getPayroll', 'getCompliance',
  'getLeaveBalances', 'getLeaveHistory', 'getWFP',
];

export type { ToolDefinition as Tool, MonthRangeArg };
export { estimateTokens, classify, TOKEN_BUDGET, type BudgetVerdict } from './sizeEstimator';
