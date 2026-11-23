// GENERADO a partir de los datos oficiales descargados (ver docs/referencias-aduana/README.md). No editar a mano.
// Fuente: Servicio Nacional de Aduanas, Compendio de Normas Aduaneras, Anexo 51 (https://www.aduana.cl/compendio-de-normas-anexo-51/aduana/2009-11-19/163937.html), descargado el 2026-11-23.
// Tabla: 51-26 Modalidad de venta
export interface ModalidadVentaAduana { codigo: number; nombre: string; sigla: string }

export const MODALIDADES_VENTA_ADUANA: readonly ModalidadVentaAduana[] = [
 {
  "codigo": 1,
  "nombre": "A FIRME",
  "sigla": "FIRME"
 },
 {
  "codigo": 2,
  "nombre": "BAJO CONDICION",
  "sigla": "BAJO COND."
 },
 {
  "codigo": 3,
  "nombre": "EN CONSIGNACION LIBRE",
  "sigla": "CONS-LIBRE"
 },
 {
  "codigo": 4,
  "nombre": "EN CONSIGNACION CON UN MINIMO A FIRME",
  "sigla": "COND-M.F."
 },
 {
  "codigo": 9,
  "nombre": "SIN PAGO",
  "sigla": "SIN PAGO"
 }
];
