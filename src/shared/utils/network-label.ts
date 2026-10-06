import type { Network } from '@prisma/client';

export const NETWORK_LABEL: Record<Network, string> = {
  mtn: 'MTN',
  glo: 'Glo',
  airtel: 'Airtel',
  nine_mobile: '9mobile',
};
