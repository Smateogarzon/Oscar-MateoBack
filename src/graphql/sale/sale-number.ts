// Serie de numeración de las ventas en DocumentSequence: un consecutivo por empresa.
export const SALE_SERIES = 'SALE';

// 1 -> VTA-000001. Si algún día pasa de un millón, el número simplemente crece (VTA-1000000).
export const formatSaleNumber = (value: number): string =>
  `VTA-${String(value).padStart(6, '0')}`;
