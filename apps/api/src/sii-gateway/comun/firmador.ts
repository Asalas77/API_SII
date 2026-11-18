/**
 * Firmador XMLDSig inyectado por el integrador (lo implementa `dte-core`).
 * Debe firmar con rsa-sha1 / c14n 2001 / enveloped-signature.
 */
export interface FirmadorXml {
  /**
   * Firma el XML y devuelve el documento firmado.
   * @param xml documento a firmar
   * @param idReferencia id del nodo a referenciar; sin valor firma el documento completo (URI="")
   */
  firmarXml(xml: string, idReferencia?: string): string;
}
