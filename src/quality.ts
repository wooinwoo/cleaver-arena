export interface DeviceCaps { cores: number; memoryGB: number; saveData: boolean }
export interface Quality { pixelCap: number; shadowMap: number; tier: 'high' | 'low' }

export function readCaps(): DeviceCaps {
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  return {
    cores: navigator.hardwareConcurrency ?? 8,
    memoryGB: nav.deviceMemory ?? 8,
    saveData: nav.connection?.saveData === true,
  };
}

export function pickQuality(caps: DeviceCaps = readCaps()): Quality {
  const low = caps.saveData || caps.cores <= 4 || caps.memoryGB <= 4;
  return low ? { pixelCap: 1, shadowMap: 512, tier: 'low' } : { pixelCap: 1.5, shadowMap: 1024, tier: 'high' };
}
