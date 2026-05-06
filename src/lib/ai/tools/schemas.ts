/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * v5.20.0 — Tool schemas for OpenRouter / OpenAI-compatible tool use.
 *
 * Each schema describes the shape of arguments the LLM may send when it
 * calls a tool. The descriptions are written FOR the LLM — they're the
 * primary signal it uses to decide when a tool is appropriate.
 *
 * Conventions:
 *   - Month range args are `{ fromYear, fromMonth, toYear, toMonth }`
 *     with months 1..12 (matching the rest of this codebase). The system
 *     prompt in phase 4 will tell the model to read available windows
 *     from `listAvailableData` first so it doesn't pick a window with
 *     no data.
 *   - WFP takes a single `year` (the locked decision: full-year forecast).
 *   - Leave queries split into balances (`asOf`) and history
 *     (`from` + `to`) — the model often only needs the snapshot.
 *   - Profile mutations are EXPLICIT: the model has to call
 *     `updateStationProfile` with a station id and a patch.
 */

import type { ChatTool } from '../openrouter';

// Re-used building blocks ────────────────────────────────────────────────
const monthRangeSchema = {
  type: 'object' as const,
  properties: {
    fromYear: { type: 'integer', minimum: 2000, maximum: 2100, description: 'Starting year (inclusive).' },
    fromMonth: { type: 'integer', minimum: 1, maximum: 12, description: 'Starting month, 1..12 (inclusive).' },
    toYear: { type: 'integer', minimum: 2000, maximum: 2100, description: 'Ending year (inclusive).' },
    toMonth: { type: 'integer', minimum: 1, maximum: 12, description: 'Ending month, 1..12 (inclusive).' },
  },
  required: ['fromYear', 'fromMonth', 'toYear', 'toMonth'],
};

const dateString = {
  type: 'string',
  pattern: '^\\d{4}-\\d{2}-\\d{2}$',
  description: 'ISO date string in YYYY-MM-DD format.',
};

// ─── Tool definitions ───────────────────────────────────────────────────

export const TOOL_SCHEMAS: ChatTool[] = [
  {
    type: 'function',
    function: {
      name: 'listAvailableData',
      description:
        "Survey what data exists in the workspace and over what time windows. Always call this FIRST before proposing a session scope so you don't pick a window with no data on file.",
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getStations',
      description:
        'List every station with operational config (HC, hours, required roles, hourly demand) and the AI-managed profile if one is set. Use this to understand the workplace structure before asking interview questions.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getStationProfile',
      description:
        'Read the AI profile for one station (gameType, peakHours, concurrentTasks, safetyConstraints, notes, confidence). Use to check whether you have enough info to advise on a station, or if interview is needed first.',
      parameters: {
        type: 'object',
        properties: {
          stationId: { type: 'string', description: 'Station id.' },
        },
        required: ['stationId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'updateStationProfile',
      description:
        'Persist interview answers for a station. Pass a partial patch — fields you do not include are left unchanged. Use ONLY after the user has confirmed the answer (typically via a chip-click in the chat panel). Never write speculatively.',
      parameters: {
        type: 'object',
        properties: {
          stationId: { type: 'string', description: 'Station id.' },
          patch: {
            type: 'object',
            description: 'Partial profile fields to update.',
            properties: {
              gameType: { type: 'string', description: "Activity category, e.g. 'slot-bank', 'cashier', 'restaurant'." },
              activityDescription: { type: 'string', description: 'Free-text description of what runs at this station.' },
              peakHours: { type: 'array', items: { type: 'string' }, description: "Peak windows as readable HH:mm-HH:mm strings, e.g. ['19:00-23:00']." },
              concurrentTasks: { type: 'array', items: { type: 'string' }, description: 'Tasks happening concurrently at the station.' },
              safetyConstraints: { type: 'array', items: { type: 'string' }, description: 'Safety / regulatory / staffing constraints.' },
              notes: { type: 'string', description: 'Any other relevant notes.' },
            },
          },
        },
        required: ['stationId', 'patch'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getEmployees',
      description:
        'Compact roster of every employee — id, name, role, contract type, weekly hours, base salary, eligibility lists, leave balances. Does NOT include leave history (use getLeaveHistory for that).',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getSchedules',
      description:
        'Per-employee, per-month rollup of hours worked, OT hours, work days, leave days by type, and holiday-work days for the given month range. Use to identify OT pressure, coverage strain, or holiday-work imbalance.',
      parameters: {
        type: 'object',
        properties: { range: monthRangeSchema },
        required: ['range'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getPayroll',
      description:
        'Per-employee, per-month payroll estimate (base salary + estimated OT cost) over the given month range. Numbers in IQD. Use to surface cost-reduction opportunities.',
      parameters: {
        type: 'object',
        properties: { range: monthRangeSchema },
        required: ['range'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getCompliance',
      description:
        'Per-month compliance summary — total findings, violations vs. info, top rules and top employees by finding count. Drives liability advisories.',
      parameters: {
        type: 'object',
        properties: { range: monthRangeSchema },
        required: ['range'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getLeaveBalances',
      description:
        "Snapshot of every employee's annual-leave balance, holiday bank, and any active leave on the given asOf date.",
      parameters: {
        type: 'object',
        properties: { asOf: dateString },
        required: ['asOf'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getLeaveHistory',
      description:
        'Every leave range across every employee that intersects [from, to]. Includes legacy single-range fields for older records.',
      parameters: {
        type: 'object',
        properties: {
          from: dateString,
          to: dateString,
        },
        required: ['from', 'to'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getWFP',
      description:
        'Workforce-planning forecast for a target year (full-year). Returns current HC by role and category, projected holiday count for that year, and total leave days already scheduled inside it.',
      parameters: {
        type: 'object',
        properties: {
          year: { type: 'integer', minimum: 2000, maximum: 2100, description: 'Target year for the forecast.' },
        },
        required: ['year'],
      },
    },
  },
];
