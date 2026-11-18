import { registerAs } from '@nestjs/config';

export type AmbienteSii = 'certificacion' | 'produccion';

export const siiConfig = registerAs('sii', () => ({
  ambiente: (process.env.SII_AMBIENTE ?? 'certificacion') as AmbienteSii,
}));
