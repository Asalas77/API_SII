import Joi from 'joi';
import { type DocumentoCompraDto, documentoCompraSchema } from '../libros/libros.dto.js';
import { ErrorSetPruebas } from './tipos.js';

/**
 * Datos del set de pruebas del Libro de Compras. El SII entrega, junto al set de documentos, una
 * lista de documentos RECIBIDOS con sus montos; como no se conoce el formato textual exacto, esta
 * herramienta los toma de un JSON (ver `src/certificacion/README.md`):
 *
 * ```json
 * {
 *   "factorProporcionalidad": 0.6,
 *   "documentos": [
 *     { "tipoDoc": 30, "folio": 234, "fechaDoc": "2026-11-05", "rutProveedor": "96792430-K",
 *       "razonSocial": "Proveedor SA", "montoNeto": 12000 },
 *     { "tipoDoc": 33, "folio": 32, "fechaDoc": "2026-11-06", "rutProveedor": "96792430-K",
 *       "montoNeto": 9000, "montoIva": 0, "ivaUsoComun": 1710 },
 *     { "tipoDoc": 60, "folio": 451, "fechaDoc": "2026-11-07", "rutProveedor": "96792430-K",
 *       "montoNeto": 1000, "tipoDocRef": 30, "folioDocRef": 234 }
 *   ]
 * }
 * ```
 */
export interface ComprasSet {
  documentos: DocumentoCompraDto[];
  factorProporcionalidad?: number;
}

const esquema = Joi.object<ComprasSet>({
  documentos: Joi.array().items(documentoCompraSchema).min(1).required(),
  factorProporcionalidad: Joi.number().min(0.001).max(99.999),
});

export function parsearComprasSet(texto: string): ComprasSet {
  let crudo: unknown;
  try {
    crudo = JSON.parse(texto);
  } catch (e) {
    throw new ErrorSetPruebas(`JSON de compras inválido: ${(e as Error).message}`);
  }
  const { value, error } = esquema.validate(crudo, { abortEarly: false });
  if (error) throw new ErrorSetPruebas(`Set de compras inválido: ${error.message}`);
  return value;
}
