/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * v5.22.0 — Coverage preset library. Replaces the raw `coverageMode` +
 * `downtimeAssumptions` (5 rates) + `peakSafetyFactor` configuration
 * surface with three named presets:
 *
 *   • bare         — pre-v5.21 behaviour. recommendedFTE = ceil(hours / cap).
 *                    No buffer. Fastest to read, riskiest in practice
 *                    (one sick day breaks coverage). Maps to `coverageMode='simple'`.
 *
 *   • realistic    — default for new installs. Adds annual leave + sick +
 *                    public-holiday + rest-day-gap multipliers on top of
 *                    the bare math. Ships the canonical 12h × 7d × 1-HC
 *                    station to 3 FTE = 2 base + 1 floater.
 *                    Maps to `coverageMode='realistic'`, defaults from
 *                    DEFAULT_CONFIG.downtimeAssumptions, peakSafetyFactor=1.0.
 *
 *   • safety-critical — realistic + 1.20 peak safety factor for stations
 *                    where stochastic absence (P95 service level) matters.
 *                    Same downtime rates, peakSafetyFactor=1.2.
 *
 * Why presets and not the raw 7 fields:
 *   The supervisor's question is "do I want a buffer for absences and how
 *   conservative should I be?" — three answers cover 99% of cases. Power
 *   users still get a "Customize" disclosure that exposes the raw rates.
 */

import type { Config } from '../types';

export type CoveragePresetId = 'bare' | 'realistic' | 'safety-critical';

export interface CoveragePresetMeta {
  id: CoveragePresetId;
  // i18n keys — resolved at render time so language toggles update labels live.
  titleKey: string;
  descKey: string;
  // Tone for the picker tile colour (matches the existing 3-tile pattern in
  // the Variables tab's holiday-comp-mode picker — emerald = practitioner
  // default, blue = balanced, purple = strict / safety-critical).
  tone: 'slate' | 'emerald' | 'purple';
}

export const COVERAGE_PRESETS: CoveragePresetMeta[] = [
  {
    id: 'bare',
    titleKey: 'variables.coverage.preset.bare.title',
    descKey: 'variables.coverage.preset.bare.desc',
    tone: 'slate',
  },
  {
    id: 'realistic',
    titleKey: 'variables.coverage.preset.realistic.title',
    descKey: 'variables.coverage.preset.realistic.desc',
    tone: 'emerald',
  },
  {
    id: 'safety-critical',
    titleKey: 'variables.coverage.preset.safetyCritical.title',
    descKey: 'variables.coverage.preset.safetyCritical.desc',
    tone: 'purple',
  },
];

// Default downtime breakdown shared by 'realistic' and 'safety-critical'.
// Mirrors DEFAULT_CONFIG.downtimeAssumptions in initialData.ts so the two
// stay in lockstep — the live rates apply on every load.
const DEFAULT_DOWNTIME = {
  annualLeaveRate: 21 / 365,    // ≈ 0.0575
  sickRate: 11 / 365,           // ≈ 0.0301
  publicHolidayRate: 13 / 365,  // ≈ 0.0356
  restDayGapRate: 1 / 7,        // ≈ 0.1429
  operatesOnHolidays: true,
} as const;

// Apply a preset to a config patch. Returns the partial Config that the
// caller spreads into `setConfig(prev => ({ ...prev, ...patch }))`. The
// preset wholesale resets coverageMode + downtimeAssumptions +
// peakSafetyFactor — power-users who want a custom blend should toggle
// the Customize disclosure, not click a preset.
export function applyCoveragePreset(preset: CoveragePresetId): Partial<Config> {
  switch (preset) {
    case 'bare':
      return {
        coverageMode: 'simple',
        // Keep the rates around (don't wipe them) so toggling back to
        // realistic restores whatever the user previously had.
      };
    case 'realistic':
      return {
        coverageMode: 'realistic',
        downtimeAssumptions: { ...DEFAULT_DOWNTIME },
        peakSafetyFactor: 1.0,
      };
    case 'safety-critical':
      return {
        coverageMode: 'realistic',
        downtimeAssumptions: { ...DEFAULT_DOWNTIME },
        peakSafetyFactor: 1.2,
      };
  }
}

// Reverse-derive the preset that best matches the current config state.
// Used to highlight the active tile in the picker. Heuristic:
//   • coverageMode=='simple'                            → 'bare'
//   • coverageMode=='realistic' && peakSafetyFactor>=1.15 → 'safety-critical'
//   • coverageMode=='realistic' otherwise               → 'realistic'
// A custom blend (e.g. tweaked downtime rates) still resolves to the
// closest preset; the Customize disclosure makes the override visible.
export function detectCoveragePreset(config: Partial<Config>): CoveragePresetId {
  if (config.coverageMode !== 'realistic') return 'bare';
  const sf = config.peakSafetyFactor ?? 1.0;
  if (sf >= 1.15) return 'safety-critical';
  return 'realistic';
}

// True when the current config's downtime breakdown deviates from the
// preset defaults — drives the "Customize active" badge in the UI so a
// power-user who tweaked rates sees their work isn't being silently
// overwritten by a preset click.
export function isCoverageCustomized(config: Partial<Config>): boolean {
  if (config.coverageMode !== 'realistic') return false;
  const dt = config.downtimeAssumptions;
  if (!dt) return false;
  const eq = (a: number, b: number) => Math.abs(a - b) < 1e-6;
  return !(
    eq(dt.annualLeaveRate, DEFAULT_DOWNTIME.annualLeaveRate)
    && eq(dt.sickRate, DEFAULT_DOWNTIME.sickRate)
    && eq(dt.publicHolidayRate, DEFAULT_DOWNTIME.publicHolidayRate)
    && eq(dt.restDayGapRate, DEFAULT_DOWNTIME.restDayGapRate)
    && dt.operatesOnHolidays === DEFAULT_DOWNTIME.operatesOnHolidays
  );
}
