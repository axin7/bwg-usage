import { describe, expect, it } from 'vitest';
import { parseProviderService } from '@/lib/server/provider-data';
import { previousMonthClamped, transformVPSData } from '@/lib/server/vps-data';

const BASE = {
  data_counter: 120,
  plan_monthly_data: 100,
  data_next_reset: Date.parse('2026-03-31T00:00:00Z') / 1000,
  ip_addresses: ['192.0.2.1'],
};
const NOW = new Date('2026-03-15T00:00:00Z');

describe('validated traffic and cycle data', () => {
  it('applies the documented multiplier to usage and allowance without hiding overage', () => {
    const service = parseProviderService({ ...BASE, monthly_data_multiplier: 2 });
    const result = transformVPSData(service, NOW);
    expect(result.resources).toEqual({
      usedBytes: 240, totalBytes: 200, remainingBytes: 0, percentUsed: 120,
    });
    expect(result.observedAt).toBe('2026-03-15T00:00:00.000Z');
  });

  it('uses multiplier one when absent and accepts finite numeric strings', () => {
    const result = parseProviderService({
      ...BASE, data_counter: '10', plan_monthly_data: '100', monthly_data_multiplier: '0.5',
    });
    expect(result.usedBytes).toBe(5);
    expect(result.totalBytes).toBe(50);
    expect(parseProviderService(BASE).usedBytes).toBe(120);
  });

  it('represents unknown allowance/reset and flags without inventing zero or false', () => {
    const result = transformVPSData(parseProviderService({ data_counter: 0 }), NOW);
    expect(result.resources).toEqual({
      usedBytes: 0, totalBytes: null, remainingBytes: null, percentUsed: null,
    });
    expect(result.status).toMatchObject({
      resetAt: null, daysRemaining: null, dailyAverageBytes: null,
      averageIsEstimate: false, suspended: null, policy_violation: null, powerState: 'unknown',
    });
  });

  it('handles zero allowance without an infinite or fabricated percentage', () => {
    const result = transformVPSData(parseProviderService({ ...BASE, plan_monthly_data: 0 }), NOW);
    expect(result.resources).toEqual({
      usedBytes: 120, totalBytes: 0, remainingBytes: 0, percentUsed: null,
    });
  });
});

describe('provider field validation', () => {
  it.each([
    { data_counter: undefined }, { data_counter: 'NaN' }, { data_counter: Infinity },
    { data_counter: -1 }, { data_counter: true }, { plan_monthly_data: ' ' },
    { monthly_data_multiplier: 0 }, { monthly_data_multiplier: null },
    { monthly_data_multiplier: Infinity }, { ip_addresses: '192.0.2.1' },
    { ip_addresses: [false] }, { suspended: 'false' }, { data_next_reset: 1e20 },
    { data_counter: Number.MAX_SAFE_INTEGER + 1 },
  ])('rejects malformed consumed provider fields: %j', (patch) => {
    expect(() => parseProviderService({ ...BASE, ...patch })).toThrow();
  });

  it('normalizes documented flags and KVM live states', () => {
    const service = parseProviderService({
      ...BASE, suspended: '0', policy_violation: 1, ve_status: 'Starting',
    });
    expect(service.suspended).toBe(false);
    expect(service.policyViolation).toBe(true);
    expect(service.powerState).toBe('starting');
    expect(parseProviderService({ ...BASE, ve_status: 'FutureState' }).powerState).toBe('unknown');
  });
});

describe('UTC cycle estimates', () => {
  it.each([
    ['2026-03-31T12:30:00Z', '2026-02-28T12:30:00.000Z'],
    ['2024-03-31T12:30:00Z', '2024-02-29T12:30:00.000Z'],
    ['2026-01-31T12:30:00Z', '2025-12-31T12:30:00.000Z'],
  ])('clamps the UTC prior month for %s', (input, expected) => {
    expect(previousMonthClamped(new Date(input)).toISOString()).toBe(expected);
  });

  it('labels daily usage as an estimate of the clamped cycle', () => {
    const result = transformVPSData(parseProviderService(BASE), NOW);
    expect(result.status.dailyAverageBytes).toBe(8);
    expect(result.status.averageIsEstimate).toBe(true);
    expect(result.status.daysRemaining).toBe(16);
    expect(result.status.resetAt).toBe('2026-03-31T00:00:00.000Z');
  });

  it.each(['2026-03-31T00:00:00Z', '2026-04-01T00:00:00Z'])('handles reset/overdue %s', (time) => {
    const result = transformVPSData(parseProviderService(BASE), new Date(time));
    expect(result.status.daysRemaining).toBe(0);
    expect(result.status.dailyAverageBytes).toBeNull();
    expect(result.status.averageIsEstimate).toBe(false);
  });
});
