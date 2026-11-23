import { XMLParser } from 'fast-xml-parser';
import iconv from 'iconv-lite';
import { extraerMarcadoresNota, type CampoTraslado } from '../dte-core/documento/traslado.js';

/** Tipos soportados por la representación impresa. */
export type TipoImpresion = 33 | 34 | 39 | 41 | 52 | 56 | 61;

export const NOMBRES_DOCUMENTO: Readonly<Record<TipoImpresion, string>> = {
  33: 'FACTURA ELECTRÓNICA',
  34: 'FACTURA NO AFECTA O EXENTA ELECTRÓNICA',
  39: 'BOLETA ELECTRÓNICA',
  41: 'BOLETA NO AFECTA O EXENTA ELECTRÓNICA',
  52: 'GUÍA DE DESPACHO ELECTRÓNICA',
  56: 'NOTA DE DÉBITO ELECTRÓNICA',
  61: 'NOTA DE CRÉDITO ELECTRÓNICA',
};

/** Nombre en palabras de un documento referenciado (`TpoDocRef`). Si no se conoce se devuelve el código. */
export const NOMBRES_DOC_REFERENCIA: Readonly<Record<string, string>> = {
  '30': 'Factura',
  '32': 'Factura de venta bienes y servicios no afectos o exentos de IVA',
  '33': 'Factura Electrónica',
  '34': 'Factura No Afecta o Exenta Electrónica',
  '35': 'Boleta',
  '38': 'Boleta exenta',
  '39': 'Boleta Electrónica',
  '41': 'Boleta No Afecta o Exenta Electrónica',
  '45': 'Factura de Compra',
  '46': 'Factura de Compra Electrónica',
  '50': 'Guía de Despacho',
  '52': 'Guía de Despacho Electrónica',
  '55': 'Nota de Débito',
  '56': 'Nota de Débito Electrónica',
  '60': 'Nota de Crédito',
  '61': 'Nota de Crédito Electrónica',
  '801': 'Orden de Compra',
  '802': 'Nota de Pedido',
  '803': 'Contrato',
  '804': 'Resolución',
  '805': 'Proceso ChileCompra',
  '806': 'Ficha ChileCompra',
  '807': 'DUS',
  '808': 'B/L (Conocimiento de embarque)',
  '809': 'AWB (Air Will Bill)',
  '810': 'MIC/DTA',
  '811': 'Carta de Porte',
  '812': 'Resolución del SNA donde califica Servicios de Exportación',
  '813': 'Pasaporte',
  '814': 'Certificado de Depósito Bolsa Prod. Chile',
  '815': 'Vale de Prenda Bolsa Prod. Chile',
  SET: 'Set de pruebas',
  HES: 'Hoja de Entrada de Servicios',
};

export interface PersonaImpresion {
  /** RUT con separador de miles y guion: `76.086.428-5`. */
  rut: string;
  razonSocial: string;
  giro?: string;
  direccion?: string;
  comuna?: string;
  ciudad?: string;
  telefono?: string;
  correo?: string;
}

export interface LineaImpresion {
  numero: number;
  codigo?: string;
  nombre: string;
  descripcion?: string;
  cantidad: number;
  unidad?: string;
  precioUnitario: number;
  descuentoPorcentaje?: number;
  descuentoMonto?: number;
  monto: number;
  exento: boolean;
}

export interface DescuentoRecargoImpresion {
  tipo: 'D' | 'R';
  glosa?: string;
  tipoValor: '%' | '$';
  valor: number;
  /** Aplica a la base exenta (`IndExeDR`). */
  exento: boolean;
  /** Monto en CLP (si es porcentaje, calculado sobre la suma de las líneas de su base). */
  monto: number;
}

export interface ReferenciaImpresion {
  tipoDocumento: string;
  /** Nombre en palabras (`Factura Electrónica`, `Orden de Compra`...). */
  nombreTipoDocumento: string;
  folio: string;
  fecha?: string;
  codigo?: number;
  razon?: string;
}

export interface TotalesImpresion {
  neto?: number;
  exento?: number;
  tasaIva?: number;
  iva?: number;
  impuestosAdicionales: { codigo: number; tasa?: number; monto: number }[];
  total: number;
}

/** Datos de traslado (Res. Ex. SII 144/2026) leídos de `Transporte` y de la nota del detalle. */
export interface TrasladoImpresion {
  origen?: string;
  destino?: string;
  choferNombre?: string;
  choferRut?: string;
  rutTransportista?: string;
  patente?: string;
  patenteCarro?: string;
  fechaSalida?: string;
  horaSalida?: string;
  fechaLlegada?: string;
  /** Campos informados como "Diferido" o "Sin Dato" (literal del XML o nota del detalle). */
  marcadores: Partial<Record<CampoTraslado, 'Diferido' | 'Sin Dato'>>;
}

export interface DatosImpresion {
  tipo: TipoImpresion;
  nombreDocumento: string;
  folio: number;
  /** `yyyy-mm-dd`. */
  fechaEmision: string;
  fechaVencimiento?: string;
  /** Facturas: 1 contado, 2 crédito, 3 sin costo. */
  formaPago?: number;
  /** Guías: tipo de traslado (1 a 12). */
  indTraslado?: number;
  /** Presente si el documento trae `Transporte` o datos diferidos. */
  traslado?: TrasladoImpresion;
  emisor: PersonaImpresion & { actecos: number[]; sucursalSii?: number };
  receptor: PersonaImpresion;
  detalle: LineaImpresion[];
  descuentosRecargos: DescuentoRecargoImpresion[];
  referencias: ReferenciaImpresion[];
  totales: TotalesImpresion;
  /** `<TED ...>...</TED>` textual, tal como está en el XML. */
  tedXml: string;
  /** Marca de tiempo de firma del documento. */
  timestampFirma?: string;
}

const ETIQUETAS_ARREGLO = new Set(['Detalle', 'DscRcgGlobal', 'Referencia', 'Acteco', 'ImptoReten', 'CdgItem']);

const parser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,
  trimValues: true,
  removeNSPrefix: true,
  isArray: (nombre) => ETIQUETAS_ARREGLO.has(nombre),
});

type Nodo = Record<string, unknown>;

function nodo(v: unknown): Nodo {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Nodo) : {};
}
function arreglo(v: unknown): Nodo[] {
  return Array.isArray(v) ? v.map(nodo) : v === undefined ? [] : [nodo(v)];
}
function texto(v: unknown): string | undefined {
  if (typeof v !== 'string' && typeof v !== 'number') return undefined;
  const t = String(v).trim();
  return t === '' ? undefined : t;
}
function numero(v: unknown): number | undefined {
  const t = texto(v);
  if (t === undefined) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

/** `76086428-5` -> `76.086.428-5`. Si no tiene el formato esperado se devuelve igual. */
export function rutConPuntos(rut: string): string {
  const m = /^(\d+)-([0-9Kk])$/.exec(rut.trim());
  if (!m) return rut;
  return `${m[1]!.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}-${m[2]!.toUpperCase()}`;
}

/** Decodifica el XML según su declaración (ISO-8859-1 si lo declara; UTF-8 si no declara nada). */
function aTexto(xml: string | Buffer): string {
  if (typeof xml === 'string') return xml;
  const cabecera = xml.subarray(0, 200).toString('latin1');
  const enc = /<\?xml[^>]*encoding=["']([^"']+)["']/i.exec(cabecera)?.[1]?.toUpperCase();
  if (enc === undefined || enc === 'UTF-8' || enc === 'UTF8') return xml.toString('utf8');
  return iconv.decode(xml, enc);
}

/** Texto del `<DTE>` número `indice` (0 = primero) dentro de un sobre, o el propio XML si es un DTE suelto. */
function extraerDte(xml: string, indice: number): string {
  const coincidencias = xml.match(/<DTE[\s>][\s\S]*?<\/DTE>/g);
  if (!coincidencias || coincidencias.length <= indice) {
    throw new Error(indice === 0 ? 'No se encontró un elemento <DTE> en el XML' : `El XML no tiene el DTE número ${indice}`);
  }
  return coincidencias[indice]!;
}

interface CamposPersona {
  razon: unknown;
  giro: unknown;
  dir: unknown;
  comuna: unknown;
  ciudad: unknown;
  tel?: unknown;
  correo?: unknown;
}

function persona(rut: unknown, o: CamposPersona): PersonaImpresion {
  return {
    rut: rutConPuntos(texto(rut) ?? ''),
    razonSocial: texto(o.razon) ?? '',
    giro: texto(o.giro),
    direccion: texto(o.dir),
    comuna: texto(o.comuna),
    ciudad: texto(o.ciudad),
    telefono: texto(o.tel),
    correo: texto(o.correo),
  };
}

const LITERAL_MARCADOR = /^(diferido|sin dato)$/i;

function marcadorDeLiteral(v: string | undefined): 'Diferido' | 'Sin Dato' | undefined {
  if (!v || !LITERAL_MARCADOR.test(v)) return undefined;
  return v.toLowerCase() === 'diferido' ? 'Diferido' : 'Sin Dato';
}

function direccionTraslado(dir: unknown, comuna: unknown, ciudad?: unknown): string | undefined {
  const partes = [texto(dir), texto(comuna), texto(ciudad)].filter((x): x is string => !!x);
  return partes.length > 0 ? [...new Set(partes)].join(', ') : undefined;
}

function extraerTraslado(tr: Nodo, emisor: Nodo, dscPrimerItem: string | undefined): TrasladoImpresion | undefined {
  const marcadores = extraerMarcadoresNota(dscPrimerItem);
  if (Object.keys(tr).length === 0 && Object.keys(marcadores).length === 0) return undefined;
  const chofer = nodo(tr.Chofer);
  const patente = texto(tr.Patente);
  const carro = texto(tr.PatenteCarro);
  const nombre = texto(chofer.NombreChofer);
  const mPatente = marcadorDeLiteral(patente);
  const mCarro = marcadorDeLiteral(carro);
  const mNombre = marcadorDeLiteral(nombre);
  if (mPatente) marcadores.patente = mPatente;
  if (mCarro) marcadores.patenteCarro = mCarro;
  if (mNombre) marcadores.choferNombre = mNombre;
  return {
    origen: direccionTraslado(emisor.DirOrigen, emisor.CmnaOrigen),
    destino: direccionTraslado(tr.DirDest, tr.CmnaDest, tr.CiudadDest),
    choferNombre: mNombre ? undefined : nombre,
    choferRut: texto(chofer.RUTChofer) ? rutConPuntos(texto(chofer.RUTChofer)!) : undefined,
    rutTransportista: texto(tr.RUTTrans) ? rutConPuntos(texto(tr.RUTTrans)!) : undefined,
    patente: mPatente ? undefined : patente,
    patenteCarro: mCarro ? undefined : carro,
    fechaSalida: texto(tr.FchSalida),
    horaSalida: texto(tr.HraSalida),
    fechaLlegada: texto(tr.FchLlegada),
    marcadores,
  };
}

/**
 * Parsea un DTE firmado (o el DTE número `indice` de un sobre EnvioDTE/EnvioBOLETA) y devuelve el modelo
 * necesario para imprimirlo. Acepta string (ya decodificado) o Buffer (se decodifica según la declaración XML,
 * normalmente ISO-8859-1). El TED se devuelve textualmente (sin re-serializar) para el PDF417.
 */
export function extraerDatosImpresion(xml: string | Buffer, indice = 0): DatosImpresion {
  const dteTxt = extraerDte(aTexto(xml), indice);
  const raiz = nodo(parser.parse(dteTxt));
  const doc = nodo(nodo(raiz.DTE).Documento);
  const enc = nodo(doc.Encabezado);
  const idDoc = nodo(enc.IdDoc);
  const em = nodo(enc.Emisor);
  const re = nodo(enc.Receptor);
  const tot = nodo(enc.Totales);

  const tipo = numero(idDoc.TipoDTE);
  if (tipo === undefined || !(tipo in NOMBRES_DOCUMENTO)) {
    throw new Error(`Tipo de DTE no soportado para impresión: ${String(idDoc.TipoDTE)}`);
  }
  const tedXml = /<TED[\s>][\s\S]*?<\/TED>/.exec(dteTxt)?.[0];
  if (!tedXml) throw new Error('El DTE no contiene TED');

  const detalle: LineaImpresion[] = arreglo(doc.Detalle).map((d, i) => {
    const cdg = arreglo(d.CdgItem)[0];
    const indExe = numero(d.IndExe);
    return {
      numero: numero(d.NroLinDet) ?? i + 1,
      codigo: texto(cdg?.VlrCodigo),
      nombre: texto(d.NmbItem) ?? '',
      descripcion: texto(d.DscItem),
      cantidad: numero(d.QtyItem) ?? 1,
      unidad: texto(d.UnmdItem),
      precioUnitario: numero(d.PrcItem) ?? 0,
      descuentoPorcentaje: numero(d.DescuentoPct),
      descuentoMonto: numero(d.DescuentoMonto),
      monto: numero(d.MontoItem) ?? 0,
      exento: indExe !== undefined && indExe !== 0,
    };
  });

  const descuentosRecargos: DescuentoRecargoImpresion[] = arreglo(doc.DscRcgGlobal).map((d) => {
    const exento = (numero(d.IndExeDR) ?? 0) !== 0;
    const tipoValor = texto(d.TpoValor) === '%' ? '%' : '$';
    const valor = numero(d.ValorDR) ?? 0;
    const base = detalle.filter((l) => l.exento === exento).reduce((s, l) => s + l.monto, 0);
    return {
      tipo: texto(d.TpoMov) === 'R' ? 'R' : 'D',
      glosa: texto(d.GlosaDR),
      tipoValor,
      valor,
      exento,
      monto: tipoValor === '%' ? Math.round((base * valor) / 100) : valor,
    };
  });

  const referencias: ReferenciaImpresion[] = arreglo(doc.Referencia).map((r) => {
    const cod = texto(r.TpoDocRef) ?? '';
    return {
      tipoDocumento: cod,
      nombreTipoDocumento: NOMBRES_DOC_REFERENCIA[cod] ?? cod,
      folio: texto(r.FolioRef) ?? '',
      fecha: texto(r.FchRef),
      codigo: numero(r.CodRef),
      razon: texto(r.RazonRef),
    };
  });

  const traslado = extraerTraslado(nodo(enc.Transporte), em, detalle[0]?.descripcion);

  return {
    tipo: tipo as TipoImpresion,
    nombreDocumento: NOMBRES_DOCUMENTO[tipo as TipoImpresion],
    folio: numero(idDoc.Folio) ?? 0,
    fechaEmision: texto(idDoc.FchEmis) ?? '',
    fechaVencimiento: texto(idDoc.FchVenc),
    formaPago: numero(idDoc.FmaPago),
    indTraslado: numero(idDoc.IndTraslado),
    ...(traslado ? { traslado } : {}),
    emisor: {
      ...persona(em.RUTEmisor, {
        razon: em.RznSoc ?? em.RznSocEmisor,
        giro: em.GiroEmis ?? em.GiroEmisor,
        dir: em.DirOrigen,
        comuna: em.CmnaOrigen,
        ciudad: em.CiudadOrigen,
        tel: em.Telefono,
        correo: em.CorreoEmisor,
      }),
      actecos: (Array.isArray(em.Acteco) ? (em.Acteco as unknown[]) : []).map(Number).filter(Number.isFinite),
      sucursalSii: numero(em.CdgSIISucur),
    },
    receptor: persona(re.RUTRecep, {
      razon: re.RznSocRecep,
      giro: re.GiroRecep,
      dir: re.DirRecep,
      comuna: re.CmnaRecep,
      ciudad: re.CiudadRecep,
      tel: re.Contacto,
      correo: re.CorreoRecep,
    }),
    detalle,
    descuentosRecargos,
    referencias,
    totales: {
      neto: numero(tot.MntNeto),
      exento: numero(tot.MntExe),
      tasaIva: numero(tot.TasaIVA),
      iva: numero(tot.IVA),
      impuestosAdicionales: arreglo(tot.ImptoReten).map((i) => ({
        codigo: numero(i.TipoImp) ?? 0,
        tasa: numero(i.TasaImp),
        monto: numero(i.MontoImp) ?? 0,
      })),
      total: numero(tot.MntTotal) ?? 0,
    },
    tedXml,
    timestampFirma: texto(doc.TmstFirma),
  };
}
