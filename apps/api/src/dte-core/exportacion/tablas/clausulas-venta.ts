// GENERADO a partir de los datos oficiales descargados (ver docs/referencias-aduana/README.md). No editar a mano.
// Fuente: Servicio Nacional de Aduanas, Compendio de Normas Aduaneras, Anexo 51 (https://www.aduana.cl/compendio-de-normas-anexo-51/aduana/2009-11-19/163937.html), descargado el 2026-11-23.
// Tabla: 51-21 Cláusulas de compraventa. En el Anexo, CPT (transporte pagado hasta), CIP (transporte y seguro pagado hasta), DPU (entregada en lugar descargado) y DAP (entregada en lugar acordado) no tienen código propio: se declaran con el código 8 "OTRA"
export interface ClausulaVentaAduana { codigo: number; sigla: string; nombre: string }

export const CLAUSULAS_VENTA_ADUANA: readonly ClausulaVentaAduana[] = [
 {
  "codigo": 1,
  "sigla": "CIF",
  "nombre": "COSTOS, SEGURO Y FLETE"
 },
 {
  "codigo": 2,
  "sigla": "CFR",
  "nombre": "COSTOS Y FLETE"
 },
 {
  "codigo": 3,
  "sigla": "EXW",
  "nombre": "EN FÁBRICA"
 },
 {
  "codigo": 4,
  "sigla": "FAS",
  "nombre": "FRANCO AL COSTADO DEL BUQUE"
 },
 {
  "codigo": 5,
  "sigla": "FOB",
  "nombre": "FRANCO A BORDO"
 },
 {
  "codigo": 6,
  "sigla": "S/CL",
  "nombre": "SIN CLÁUSULA DE COMPRAVENTA"
 },
 {
  "codigo": 7,
  "sigla": "FCA",
  "nombre": "FRANCO TRANSPORTISTA"
 },
 {
  "codigo": 8,
  "sigla": "OTRA",
  "nombre": "OTRA (incluye CPT, CIP, DPU y DAP)"
 },
 {
  "codigo": 9,
  "sigla": "DDP",
  "nombre": "ENTREGADAS DERECHOS PAGADOS"
 }
];
