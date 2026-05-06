import { describe, it, expect } from 'vitest';
import { auditShiftLibrary } from '../shiftLibraryAudit';
import type { Shift, Schedule } from '../../types';

const shift = (over: Partial<Shift> & { code: string; start: string; end: string }): Shift => ({
  name: over.code,
  durationHrs: 8,
  breakMin: 60,
  isIndustrial: false,
  isHazardous: false,
  isWork: true,
  description: '',
  ...over,
});

describe('auditShiftLibrary', () => {
  it('flags shifts that have zero usage as unused', () => {
    const shifts = [
      shift({ code: 'M', start: '11:00', end: '19:00' }),
      shift({ code: 'C', start: '15:00', end: '23:00' }),
      shift({ code: 'X', start: '09:00', end: '13:00' }),
    ];
    const schedule: Schedule = { e1: { 1: { shiftCode: 'M', stationId: 's1' }, 2: { shiftCode: 'C', stationId: 's1' } } };
    const result = auditShiftLibrary({ shifts, schedule });
    const codes = result.findings.filter(f => f.kind === 'unused').map(f => f.shiftCode);
    expect(codes).toContain('X');
    expect(codes).not.toContain('M');
    expect(codes).not.toContain('C');
  });

  it('flags identical-window shifts as redundant', () => {
    const shifts = [
      shift({ code: 'A', start: '11:00', end: '19:00' }),
      shift({ code: 'B', start: '11:00', end: '19:00' }),
    ];
    const schedule: Schedule = { e1: { 1: { shiftCode: 'A' } } };
    const result = auditShiftLibrary({ shifts, schedule });
    const redundants = result.findings.filter(f => f.kind === 'redundant');
    expect(redundants.length).toBeGreaterThanOrEqual(1);
    // The less-used shift (B) is the one flagged.
    expect(redundants.find(f => f.shiftCode === 'B')).toBeTruthy();
  });

  it('flags shorter shifts subsumed by longer same-flag shifts', () => {
    const shifts = [
      shift({ code: 'LONG', start: '08:00', end: '20:00', durationHrs: 12 }),
      shift({ code: 'MID', start: '10:00', end: '18:00', durationHrs: 8 }),
    ];
    const schedule: Schedule = {};
    const result = auditShiftLibrary({ shifts, schedule });
    const subsumed = result.findings.filter(f => f.kind === 'subsumed');
    expect(subsumed.length).toBeGreaterThanOrEqual(1);
    expect(subsumed.find(f => f.shiftCode === 'MID')).toBeTruthy();
  });

  it('never flags system shifts (OFF/AL/SL/MAT/PH/CP)', () => {
    const shifts: Shift[] = [
      shift({ code: 'OFF', start: '00:00', end: '00:00', isWork: false }),
      shift({ code: 'AL', start: '00:00', end: '00:00', isWork: false }),
    ];
    const schedule: Schedule = {};
    const result = auditShiftLibrary({ shifts, schedule });
    expect(result.findings.length).toBe(0);
  });

  it('respects flag differences (hazardous vs non-hazardous)', () => {
    const shifts = [
      shift({ code: 'A', start: '11:00', end: '19:00', isHazardous: false }),
      shift({ code: 'B', start: '11:00', end: '19:00', isHazardous: true }),
    ];
    const result = auditShiftLibrary({ shifts, schedule: {} });
    // Different hazardous flag → not redundant.
    expect(result.findings.filter(f => f.kind === 'redundant')).toHaveLength(0);
  });

  it('considers history when allSchedules is provided', () => {
    const shifts = [shift({ code: 'OLD', start: '11:00', end: '19:00' })];
    const schedule: Schedule = {};
    const allSchedules = {
      'scheduler_schedule_2026_4': { e1: { 1: { shiftCode: 'OLD' } } },
    };
    const result = auditShiftLibrary({ shifts, schedule, allSchedules });
    // OLD has usage in last month, should NOT be flagged as unused.
    expect(result.findings.find(f => f.shiftCode === 'OLD' && f.kind === 'unused')).toBeUndefined();
  });
});
