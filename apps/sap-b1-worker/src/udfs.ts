import { ESTADOS } from './tipos-b1.js';
import { literal, type ClienteServiceLayer, ErrorServiceLayer } from './service-layer.js';
import type { Logger } from './log.js';

export type TablaB1 = 'OINV' | 'ORIN' | 'ODLN' | 'OCRD';

export interface DefinicionUdf {
  /** Nombre sin el prefijo `U_`. */
  nombre: string;
  descripcion: string;
  tipo: 'db_Alpha' | 'db_Memo' | 'db_Numeric' | 'db_Date';
  tamano?: number;
  tablas: readonly TablaB1[];
  valoresValidos?: ReadonlyArray<{ valor: string; descripcion: string }>;
}

const DOCS: readonly TablaB1[] = ['OINV', 'ORIN', 'ODLN'];
const NOTAS: readonly TablaB1[] = ['OINV', 'ORIN'];

const DESCRIPCION_ESTADO: Record<(typeof ESTADOS)[number], string> = {
  PENDIENTE: 'Pendiente de emision',
  ENVIANDO: 'Emitiendo (en proceso)',
  EMITIDO: 'Emitido, sin enviar al SII',
  ENVIADO: 'Enviado al SII',
  ACEPTADO: 'Aceptado por el SII',
  REPAROS: 'Aceptado con reparos',
  RECHAZADO: 'Rechazado por el SII',
  ERROR: 'Error (ver glosa)',
};

const TIPOS_VALIDOS: ReadonlyArray<{ valor: string; descripcion: string }> = [
  { valor: '33', descripcion: '33 Factura electronica' },
  { valor: '34', descripcion: '34 Factura exenta' },
  { valor: '39', descripcion: '39 Boleta electronica' },
  { valor: '41', descripcion: '41 Boleta exenta' },
  { valor: '52', descripcion: '52 Guia de despacho' },
  { valor: '56', descripcion: '56 Nota de debito' },
  { valor: '61', descripcion: '61 Nota de credito' },
  { valor: '110', descripcion: '110 Factura de exportacion' },
  { valor: '111', descripcion: '111 Nota de debito de exportacion' },
  { valor: '112', descripcion: '112 Nota de credito de exportacion' },
];

/** UDFs de la sección 4 del diseño (más los de referencia manual y el giro del socio). */
export const UDFS: readonly DefinicionUdf[] = [
  { nombre: 'SII_TipoDTE', descripcion: 'SII Tipo DTE', tipo: 'db_Alpha', tamano: 3, tablas: DOCS, valoresValidos: TIPOS_VALIDOS },
  {
    nombre: 'SII_Estado',
    descripcion: 'SII Estado',
    tipo: 'db_Alpha',
    tamano: 20,
    tablas: DOCS,
    valoresValidos: ESTADOS.map((e) => ({ valor: e, descripcion: DESCRIPCION_ESTADO[e] })),
  },
  { nombre: 'SII_Folio', descripcion: 'SII Folio', tipo: 'db_Numeric', tamano: 11, tablas: DOCS },
  { nombre: 'SII_TrackId', descripcion: 'SII Track ID', tipo: 'db_Alpha', tamano: 20, tablas: DOCS },
  { nombre: 'SII_Glosa', descripcion: 'SII Glosa', tipo: 'db_Memo', tablas: DOCS },
  { nombre: 'SII_DocId', descripcion: 'SII Id documento API', tipo: 'db_Alpha', tamano: 36, tablas: DOCS },
  { nombre: 'SII_XmlUrl', descripcion: 'SII URL XML', tipo: 'db_Alpha', tamano: 254, tablas: DOCS },
  { nombre: 'SII_PdfUrl', descripcion: 'SII URL PDF', tipo: 'db_Alpha', tamano: 254, tablas: DOCS },
  { nombre: 'SII_IdemKey', descripcion: 'SII Idempotency-Key', tipo: 'db_Alpha', tamano: 100, tablas: DOCS },
  {
    nombre: 'SII_IndTraslado',
    descripcion: 'SII Ind. traslado',
    tipo: 'db_Alpha',
    tamano: 2,
    tablas: ['ODLN'],
    valoresValidos: [
      { valor: '1', descripcion: '1 Operacion constituye venta' },
      { valor: '2', descripcion: '2 Ventas por efectuar' },
      { valor: '3', descripcion: '3 Consignaciones' },
      { valor: '4', descripcion: '4 Entrega gratuita' },
      { valor: '5', descripcion: '5 Traslados internos' },
      { valor: '6', descripcion: '6 Otros traslados no venta' },
      { valor: '7', descripcion: '7 Devolucion de mercaderias' },
      { valor: '8', descripcion: '8 Traslado para exportacion (no venta)' },
      { valor: '9', descripcion: '9 Venta de exportacion' },
      { valor: '10', descripcion: '10 Traslado tercerizado (GDT)' },
      { valor: '11', descripcion: '11 Traslado prolongado, importa venta' },
      { valor: '12', descripcion: '12 Traslado prolongado, no venta' },
    ],
  },
  // OBSOLETO desde la Res. Ex. SII 144/2026: se conserva por compatibilidad; usar los UDF estructurados.
  { nombre: 'SII_Transporte', descripcion: 'SII Transporte (obsoleto)', tipo: 'db_Alpha', tamano: 254, tablas: ['ODLN'] },
  {
    nombre: 'SII_CatTraslado',
    descripcion: 'SII Categoria traslado',
    tipo: 'db_Alpha',
    tamano: 20,
    tablas: ['ODLN'],
    valoresValidos: [
      { valor: 'AUTOGESTIONADO', descripcion: 'Transporte autogestionado (todos los datos)' },
      { valor: 'TERCERIZADO', descripcion: 'Transporte tercerizado (datos diferidos)' },
      { valor: 'REGIMEN_ESPECIAL', descripcion: 'Regimen especial (Aduanas, SAG, etc.)' },
    ],
  },
  { nombre: 'SII_DirOrigen', descripcion: 'SII Direccion origen', tipo: 'db_Alpha', tamano: 70, tablas: ['ODLN'] },
  { nombre: 'SII_CmnaOrigen', descripcion: 'SII Comuna origen', tipo: 'db_Alpha', tamano: 20, tablas: ['ODLN'] },
  { nombre: 'SII_RutTrans', descripcion: 'SII RUT transportista', tipo: 'db_Alpha', tamano: 12, tablas: ['ODLN'] },
  { nombre: 'SII_RutChofer', descripcion: 'SII RUT chofer', tipo: 'db_Alpha', tamano: 12, tablas: ['ODLN'] },
  { nombre: 'SII_NomChofer', descripcion: 'SII Nombre chofer', tipo: 'db_Alpha', tamano: 30, tablas: ['ODLN'] },
  { nombre: 'SII_Patente', descripcion: 'SII Patente', tipo: 'db_Alpha', tamano: 10, tablas: ['ODLN'] },
  { nombre: 'SII_PatenteCarro', descripcion: 'SII Patente carro', tipo: 'db_Alpha', tamano: 10, tablas: ['ODLN'] },
  { nombre: 'SII_FchSalida', descripcion: 'SII Fecha salida', tipo: 'db_Date', tablas: ['ODLN'] },
  { nombre: 'SII_HraSalida', descripcion: 'SII Hora salida', tipo: 'db_Alpha', tamano: 8, tablas: ['ODLN'] },
  { nombre: 'SII_FchLlegada', descripcion: 'SII Fecha llegada', tipo: 'db_Date', tablas: ['ODLN'] },
  { nombre: 'SII_CodRef', descripcion: 'SII Cod. referencia', tipo: 'db_Alpha', tamano: 1, tablas: NOTAS },
  { nombre: 'SII_RazonRef', descripcion: 'SII Razon referencia', tipo: 'db_Alpha', tamano: 90, tablas: NOTAS },
  { nombre: 'SII_TipoDocRef', descripcion: 'SII Tipo doc. referencia', tipo: 'db_Alpha', tamano: 3, tablas: NOTAS },
  { nombre: 'SII_FolioRef', descripcion: 'SII Folio referencia', tipo: 'db_Alpha', tamano: 18, tablas: NOTAS },
  // Exportación (110-112): códigos de las tablas de Aduana (Anexo 51 del Compendio de Normas Aduaneras).
  { nombre: 'SII_ModVenta', descripcion: 'SII Modalidad de venta (Aduana)', tipo: 'db_Alpha', tamano: 2, tablas: NOTAS },
  { nombre: 'SII_ClausulaVenta', descripcion: 'SII Clausula de venta (Aduana)', tipo: 'db_Alpha', tamano: 2, tablas: NOTAS },
  { nombre: 'SII_TotClausula', descripcion: 'SII Total clausula de venta', tipo: 'db_Alpha', tamano: 20, tablas: NOTAS },
  { nombre: 'SII_ViaTransp', descripcion: 'SII Via de transporte (Aduana)', tipo: 'db_Alpha', tamano: 2, tablas: NOTAS },
  { nombre: 'SII_PtoEmbarque', descripcion: 'SII Puerto de embarque (Aduana)', tipo: 'db_Alpha', tamano: 4, tablas: NOTAS },
  { nombre: 'SII_PtoDesemb', descripcion: 'SII Puerto de desembarque (Aduana)', tipo: 'db_Alpha', tamano: 4, tablas: NOTAS },
  { nombre: 'SII_PaisReceptor', descripcion: 'SII Pais receptor (Aduana)', tipo: 'db_Alpha', tamano: 3, tablas: NOTAS },
  { nombre: 'SII_PaisDestino', descripcion: 'SII Pais destino (Aduana)', tipo: 'db_Alpha', tamano: 3, tablas: NOTAS },
  { nombre: 'SII_TotBultos', descripcion: 'SII Total bultos', tipo: 'db_Numeric', tamano: 11, tablas: NOTAS },
  { nombre: 'SII_TipoBulto', descripcion: 'SII Tipo de bulto (Aduana)', tipo: 'db_Alpha', tamano: 3, tablas: NOTAS },
  { nombre: 'SII_FormaPagoExp', descripcion: 'SII Forma de pago exportacion (Aduana)', tipo: 'db_Alpha', tamano: 2, tablas: NOTAS },
  { nombre: 'SII_IndServicio', descripcion: 'SII Ind. servicio exportacion', tipo: 'db_Alpha', tamano: 1, tablas: NOTAS },
  { nombre: 'SII_Giro', descripcion: 'SII Giro', tipo: 'db_Alpha', tamano: 40, tablas: ['OCRD'] },
];

/** Cuerpo de `POST /UserFieldsMD` para un UDF en una tabla. */
export function cuerpoUdf(u: DefinicionUdf, tabla: TablaB1): Record<string, unknown> {
  const cuerpo: Record<string, unknown> = {
    TableName: tabla,
    Name: u.nombre,
    Description: u.descripcion,
    Type: u.tipo,
  };
  if (u.tamano !== undefined) {
    cuerpo['Size'] = u.tamano;
    cuerpo['EditSize'] = u.tamano;
  }
  if (u.valoresValidos) {
    cuerpo['ValidValuesMD'] = u.valoresValidos.map((v) => ({ Value: v.valor, Description: v.descripcion }));
  }
  return cuerpo;
}

export interface ResultadoInstalacion {
  creados: string[];
  existentes: string[];
  errores: string[];
}

/**
 * Crea los UDFs en B1 por `UserFieldsMD`. Es idempotente: si el campo ya existe lo informa y sigue.
 * Con `dryRun` solo imprime el cuerpo que enviaría y no se conecta.
 */
export async function instalarUdfs(
  sl: Pick<ClienteServiceLayer, 'listar' | 'crear'> | null,
  log: Logger,
  opciones: { dryRun: boolean; imprimir?: (linea: string) => void } = { dryRun: false },
): Promise<ResultadoInstalacion> {
  const imprimir = opciones.imprimir ?? ((l: string) => process.stdout.write(`${l}\n`));
  const r: ResultadoInstalacion = { creados: [], existentes: [], errores: [] };
  for (const u of UDFS) {
    for (const tabla of u.tablas) {
      const id = `${tabla}.U_${u.nombre}`;
      const cuerpo = cuerpoUdf(u, tabla);
      if (opciones.dryRun || !sl) {
        imprimir(`[dry-run] POST UserFieldsMD ${JSON.stringify(cuerpo)}`);
        continue;
      }
      try {
        const existe = await sl.listar('UserFieldsMD', {
          filter: `TableName eq ${literal(tabla)} and Name eq ${literal(u.nombre)}`,
          select: ['FieldID'],
        });
        if (existe.length > 0) {
          r.existentes.push(id);
          log.info('UDF ya existe', { udf: id });
          continue;
        }
        await sl.crear('UserFieldsMD', cuerpo);
        r.creados.push(id);
        log.info('UDF creado', { udf: id });
      } catch (e) {
        // Carrera o consulta de existencia no soportada: "ya existe" (-2035) se trata como existente.
        if (e instanceof ErrorServiceLayer && (String(e.codigo) === '-2035' || /already exists|ya existe/i.test(e.message))) {
          r.existentes.push(id);
          log.info('UDF ya existe', { udf: id });
        } else {
          r.errores.push(`${id}: ${(e as Error).message}`);
          log.error('no se pudo crear el UDF', { udf: id, error: (e as Error).message });
        }
      }
    }
  }
  return r;
}
