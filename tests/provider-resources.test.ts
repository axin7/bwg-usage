import { describe, expect, it, vi } from 'vitest';
import { getVPSInfo } from '@/lib/server/provider';
import { parseProviderService } from '@/lib/server/provider-data';
import { parseProviderResources } from '@/lib/server/provider-resources';
import { transformVPSData } from '@/lib/server/vps-data';

const NOW = new Date('2026-10-05T12:00:00Z');
const RAW = {
  vm_type: 'kvm',
  plan_ram: 1_073_741_824,
  plan_swap: '536870912',
  plan_disk: 21_474_836_480,
  mem_available_kb: '524288',
  swap_total_kb: 524_288,
  swap_available_kb: 262_144,
  ve_used_disk_space_b: 4_294_967_296,
  load_average: '0.12 1.34 2.56 1/119 2865',
  is_cpu_throttled: 1,
  is_disk_throttled: '0',
};

describe('provider resource units and freshness', () => {
  it('keeps plan and mapped disk bytes and converts Linux memory kB using 1024', () => {
    expect(parseProviderResources(RAW, true)).toEqual({
      planRamBytes: 1_073_741_824,
      planSwapBytes: 536_870_912,
      planDiskBytes: 21_474_836_480,
      availableRamBytes: 536_870_912,
      swapTotalBytes: 536_870_912,
      swapAvailableBytes: 268_435_456,
      mappedDiskBytes: 4_294_967_296,
      loadAverage: [0.12, 1.34, 2.56],
      cpuThrottled: true,
      diskThrottled: false,
      live: true,
    });
  });

  it('returns basic plan data while disregarding any live metrics in a basic reply', () => {
    expect(parseProviderResources(RAW, false)).toEqual({
      planRamBytes: 1_073_741_824,
      planSwapBytes: 536_870_912,
      planDiskBytes: 21_474_836_480,
      availableRamBytes: null,
      swapTotalBytes: null,
      swapAvailableBytes: null,
      mappedDiskBytes: null,
      loadAverage: null,
      cpuThrottled: null,
      diskThrottled: null,
      live: false,
    });
  });

  it('represents missing measurements as null while preserving valid zero readings', () => {
    const absent = parseProviderResources({}, true);
    expect(Object.values(absent).filter((value) => value === null)).toHaveLength(10);
    expect(parseProviderResources({
      plan_ram: 0, mem_available_kb: 0, is_cpu_throttled: false,
    }, true)).toMatchObject({ planRamBytes: 0, availableRamBytes: 0, cpuThrottled: false });
  });
});

describe('resource observation integration', () => {
  it('shares the injected observation timestamp with the top-level DTO', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      error: 0, data_counter: 10, ...RAW,
    }));
    const result = await getVPSInfo({ veid: '123', apiKey: 'synthetic-key' }, true,
      { fetcher }, () => NOW);
    expect(result.system?.observedAt).toBe(result.observedAt);
    expect(result.system?.observedAt).toBe('2026-10-05T12:00:00.000Z');
    expect(result.system?.availableRamBytes).toBe(536_870_912);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('includes a system DTO in basic getVPSInfo without issuing a live request', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      error: 0, data_counter: 10, ...RAW,
    }));
    const result = await getVPSInfo({ veid: '123', apiKey: 'synthetic-key' }, false,
      { fetcher }, () => NOW);
    expect(result.system).toMatchObject({
      planRamBytes: 1_073_741_824, availableRamBytes: null, live: false,
    });
    expect(fetcher.mock.calls[0][0]).toBe('https://api.64clouds.com/v1/getServiceInfo');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe('independent optional resource validation', () => {
  it.each([
    undefined, null, true, {}, [], '', ' ', 'NaN', Infinity, -1, 1.5,
    '1.5', '0x100', '1e3', Number.MAX_SAFE_INTEGER + 1,
  ])('nulls only the malformed resource field: %j', (value) => {
    const service = parseProviderService({
      ...RAW, data_counter: 10, plan_monthly_data: 100, plan_ram: value,
    }, true);
    const result = transformVPSData(service, NOW);
    expect(result.resources.usedBytes).toBe(10);
    expect(result.resources.totalBytes).toBe(100);
    expect(result.system?.planRamBytes).toBeNull();
    expect(result.system?.availableRamBytes).toBe(536_870_912);
  });

  it('rejects conversion overflow and validates each memory field independently', () => {
    expect(parseProviderResources({
      ...RAW,
      mem_available_kb: Number.MAX_SAFE_INTEGER,
      swap_total_kb: 'invalid',
    }, true)).toMatchObject({
      availableRamBytes: null, swapTotalBytes: null, swapAvailableBytes: 268_435_456,
    });
  });

  it('keeps independent observations without deriving guest disk use or memory use', () => {
    const system = parseProviderResources({
      ...RAW, plan_ram: 1, swap_total_kb: 0,
    }, true);
    expect(system.availableRamBytes).toBe(536_870_912);
    expect(system.swapAvailableBytes).toBe(268_435_456);
    expect(Object.keys(system)).not.toContain('usedDiskBytes');
    expect(Object.keys(system)).not.toContain('remainingDiskBytes');
    expect(Object.keys(system)).not.toContain('usedRamBytes');
  });

  it.each([
    [true, true], [false, false], [1, true], [0, false], ['1', true], ['0', false],
    ['true', null], ['false', null], ['yes', null], [2, null], [null, null],
  ])('normalizes only documented flag forms %j', (value, expected) => {
    expect(parseProviderResources({
      ...RAW, is_cpu_throttled: value, is_disk_throttled: value,
    }, true)).toMatchObject({ cpuThrottled: expected, diskThrottled: expected });
  });
});

describe('KVM and OpenVZ metric boundaries', () => {
  it.each(['ovz', 'OVZ', 'openvz', 'xen'])('ignores KVM internals for explicit %s', (vmType) => {
    const system = parseProviderResources({
      ...RAW, vm_type: vmType, vz_status: { memory: 'undocumented' },
      vz_quota: { disk: 'undocumented' },
    }, true);
    expect(system).toMatchObject({
      planRamBytes: 1_073_741_824, cpuThrottled: true, diskThrottled: null,
      availableRamBytes: null, swapTotalBytes: null, swapAvailableBytes: null,
      mappedDiskBytes: null, loadAverage: null,
    });
  });

  it('allows documented named metrics when vm_type is omitted', () => {
    const system = parseProviderResources({ ...RAW, vm_type: undefined }, true);
    expect(system.availableRamBytes).toBe(536_870_912);
    expect(system.loadAverage).toEqual([0.12, 1.34, 2.56]);
  });

  it('whitelists system data without forwarding credentials or screen contents', () => {
    const system = parseProviderResources({
      ...RAW, api_key: 'secret', screendump_png_base64: 'screen',
      ssh_port: 22, ip_addresses: ['192.0.2.1'], vz_status: { secret: 'private' },
    }, true);
    expect(JSON.stringify(system)).not.toMatch(/secret|screen|192\.0\.2\.1|ssh_port|vz_status/);
  });
});

describe('load average parsing', () => {
  it.each([
    '0.12 1.34 2.56', '  0.12\t1.34 2.56 1/119 2865\n',
  ])('accepts defined three-value and Linux proc forms: %s', (value) => {
    expect(parseProviderResources({ ...RAW, load_average: value }, true).loadAverage)
      .toEqual([0.12, 1.34, 2.56]);
  });

  it.each([
    null, 0, [0.12, 1.34, 2.56], '', '0.12 1.34', '0.12 1.34 2.56 trailing',
    '0.12 1.34 2.56 invalid 2865', '0.12 1.34 2.56 1/119 pid',
    '-0.12 1.34 2.56', 'NaN 1.34 2.56', 'Infinity 1.34 2.56',
    '1e3 1.34 2.56', '0.12, 1.34, 2.56', '9'.repeat(400) + ' 1.34 2.56',
  ])('returns null for malformed or ambiguous load data: %j', (value) => {
    expect(parseProviderResources({ ...RAW, load_average: value }, true).loadAverage).toBeNull();
  });
});
