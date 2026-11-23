// GENERADO a partir de los datos oficiales descargados (ver docs/referencias-aduana/README.md). No editar a mano.
// Fuente: Servicio Nacional de Aduanas, Compendio de Normas Aduaneras, Anexo 51 (https://www.aduana.cl/compendio-de-normas-anexo-51/aduana/2009-11-19/163937.html), descargado el 2026-11-23.
// Tabla: 51-24 Unidades de medida. El Anexo no trae una tabla de códigos separada: la unidad por defecto es kilogramo (sigla KN, código 06, según el texto del Anexo) y las demás se deducen de la columna "sigla a indicar en declaración" (SIGLA-CÓDIGO) de la tabla por partida arancelaria. Lista incompleta respecto de las unidades que Aduana usa en otros anexos
export interface UnidadMedidaAduana { codigo: number; sigla: string; nombre: string; abreviatura: string }

export const UNIDADES_MEDIDA_ADUANA: readonly UnidadMedidaAduana[] = [
 {
  "codigo": 3,
  "sigla": "MKWH-03",
  "nombre": "1000 kilowatt hora",
  "abreviatura": "1000 kWh"
 },
 {
  "codigo": 5,
  "sigla": "KLT-05",
  "nombre": "kilate",
  "abreviatura": "KLT"
 },
 {
  "codigo": 6,
  "sigla": "KN-06",
  "nombre": "kilogramo",
  "abreviatura": "KN"
 },
 {
  "codigo": 9,
  "sigla": "LT-09",
  "nombre": "litro",
  "abreviatura": "l"
 },
 {
  "codigo": 10,
  "sigla": "U-10",
  "nombre": "piezas o ítems",
  "abreviatura": "U"
 },
 {
  "codigo": 12,
  "sigla": "U(JGO)-12",
  "nombre": "juegos o mazos",
  "abreviatura": "U(JUEGO/MAZO)"
 },
 {
  "codigo": 13,
  "sigla": "MU-13",
  "nombre": "1000 piezas o ítems",
  "abreviatura": "1000 U"
 },
 {
  "codigo": 14,
  "sigla": "MT-14",
  "nombre": "metro",
  "abreviatura": "m"
 },
 {
  "codigo": 15,
  "sigla": "MT2-15",
  "nombre": "metro cuadrado",
  "abreviatura": "m²"
 },
 {
  "codigo": 16,
  "sigla": "MT3-16",
  "nombre": "metro cúbico",
  "abreviatura": "m³"
 },
 {
  "codigo": 17,
  "sigla": "2U-17",
  "nombre": "par",
  "abreviatura": "2U"
 }
];
