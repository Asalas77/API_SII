import { firmarDocumentoCompleto, firmarXml } from './firma.js';

/**
 * Forma estructural de la interfaz `FirmadorXml` del gateway (`sii-gateway/comun/firmador.ts`);
 * se repite aquí para no depender de `sii-gateway`.
 */
export interface FirmadorSii {
  /**
   * @param xml documento a firmar
   * @param idReferencia `ID` del nodo a firmar; sin valor se firma el documento completo (`URI=""`)
   */
  firmarXml(xml: string, idReferencia?: string): string;
}

/**
 * Crea el firmador que se inyecta en `BoletaApiClient`/`DteSiiClient`: con `idReferencia` firma el
 * elemento por `ID` (`firmarXml`); sin él firma el documento completo (`firmarDocumentoCompleto`,
 * usado para la semilla de autenticación).
 */
export function crearFirmadorSii(certificado: { certificadoPem: string; clavePrivadaPem: string }): FirmadorSii {
  const { certificadoPem, clavePrivadaPem } = certificado;
  return {
    firmarXml(xml: string, idReferencia?: string): string {
      return idReferencia === undefined
        ? firmarDocumentoCompleto(xml, { certificadoPem, clavePrivadaPem })
        : firmarXml(xml, { certificadoPem, clavePrivadaPem, idReferencia });
    },
  };
}
