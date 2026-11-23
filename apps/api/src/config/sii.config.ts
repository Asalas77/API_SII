import { registerAs } from '@nestjs/config';

export type AmbienteSii = 'certificacion' | 'produccion';

export const siiConfig = registerAs('sii', () => ({
  ambiente: (process.env.SII_AMBIENTE ?? 'certificacion') as AmbienteSii,
  /**
   * Acepta `IndTraslado` 10-12 (Res. Ex. SII 144/2026: GDT y traslados prolongados). Por defecto `false`: el
   * XSD oficial del SII (2026-02-19) no los enumera y no hay manual del ATT publicado.
   */
  permitirIndTrasladoRes144: String(process.env.PERMITIR_INDTRASLADO_RES144 ?? 'false').toLowerCase() === 'true',
}));
