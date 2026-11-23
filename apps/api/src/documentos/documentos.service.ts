import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import type { EntityManager } from 'typeorm';
import { siiConfig } from '../config/index.js';
import { fechaSantiago } from '../comun/fechas.js';
import { type AccesoEmpresas, asegurarRecursoDeEmpresa } from '../auth/principal.js';
import { EjecutorEmpresa } from '../database/ejecutor-empresa.js';
import { documentoInvalido, noEncontrado, ProblemaHttp } from '../comun/problema.js';
import {
  aIso88591,
  construirDte,
  esBoleta,
  parsearCaf,
  separarRut,
  TASA_IVA,
  type CampoTraslado,
  type DocumentoDte,
  type IndTraslado,
  type TrasladoDte,
} from '../dte-core/index.js';
import type { Empresa } from '../empresas/entities/empresa.entity.js';
import { EmpresasService, esViolacionUnica } from '../empresas/empresas.service.js';
import { resolverUrlVerificacion } from '../empresas/opciones-pdf.js';
import { FoliosService } from '../folios/folios.service.js';
import { generarPdf } from '../representacion/index.js';
import { SiiClienteFactory } from '../sii/sii-cliente.factory.js';
import type {
  ComplementarTrasladoDto,
  EmitirDocumentoDto,
  ListarDocumentosQuery,
  PdfQuery,
  TrasladoDto,
} from './documentos.dto.js';
import { Documento } from './entities/documento.entity.js';

export interface DocumentoRespuesta {
  id: string;
  empresa: string;
  tipoDte: number;
  folio: number;
  fechaEmision: string;
  estado: string;
  totales: {
    montoNeto: number | null;
    montoExento: number | null;
    tasaIva: number;
    iva: number | null;
    montoTotal: number;
  };
  trackId: string | null;
  reparos: unknown;
  /** Último estado informado por el SII para el documento (DOK, FAU, ...); null si nunca se consultó. */
  estadoSii: string | null;
  glosaSii: string | null;
  consultadoSiiEn: Date | null;
  enlaces: { xml: string; pdf: string };
  /** true si algún dato del traslado quedó "Diferido" o "Sin Dato" (Res. Ex. SII 144/2026). */
  trasladoPendiente: boolean;
  /** Traslado normalizado (sin la solicitud original); null si el documento no informa traslado. */
  traslado: Record<string, unknown> | null;
  creadoEn: Date;
}

/** Quita del jsonb `traslado` la solicitud original (solo sirve para complementar). */
function resumenTraslado(t: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!t) return null;
  const { solicitud: _solicitud, ...resto } = t;
  return resto;
}

export function aRespuestaDocumento(
  d: Documento,
  rutEmpresa: string,
): DocumentoRespuesta {
  return {
    id: d.id,
    empresa: rutEmpresa,
    tipoDte: d.tipoDte,
    folio: d.folio,
    fechaEmision: d.fechaEmision,
    estado: d.estado,
    totales: {
      montoNeto: d.montoNeto,
      montoExento: d.montoExento,
      tasaIva: d.montoNeto ? TASA_IVA : 0,
      iva: d.iva,
      montoTotal: d.montoTotal,
    },
    trackId: d.trackId,
    reparos: d.reparos ?? null,
    estadoSii: d.estadoSii ?? null,
    glosaSii: d.glosaSii ?? null,
    consultadoSiiEn: d.consultadoSiiEn ?? null,
    enlaces: { xml: `/v1/documentos/${d.id}/xml`, pdf: `/v1/documentos/${d.id}/pdf` },
    trasladoPendiente: d.trasladoPendiente ?? false,
    traslado: resumenTraslado(d.traslado),
    creadoEn: d.creadoEn,
  };
}

/** JSON con las claves ordenadas: misma huella sin importar el orden en que llegaron. */
function canonico(valor: unknown): string {
  if (Array.isArray(valor)) return `[${valor.map(canonico).join(',')}]`;
  if (valor !== null && typeof valor === 'object') {
    const o = valor as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonico(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(valor);
}

export function huellaSolicitud(dto: unknown): string {
  return createHash('sha256').update(canonico(dto)).digest('hex');
}

function partirRut(rut: string): { rut: string; dv: string } {
  const r = separarRut(rut);
  if (!r) throw documentoInvalido(`RUT inválido: ${rut}`);
  return { rut: r.numero, dv: r.dv };
}

/** Arma el `DocumentoDte` de dte-core (sin folio real) con el emisor tomado de la empresa. */
export function armarDocumento(
  empresa: Empresa,
  dto: EmitirDocumentoDto,
  folio: number,
  fechaEmision: string,
): DocumentoDte {
  const tipo = dto.idDoc.tipoDte;
  const boleta = esBoleta(tipo);
  if (!dto.receptor && !boleta) {
    throw documentoInvalido('El receptor es obligatorio salvo en boletas', [
      { campo: 'receptor', mensaje: 'es obligatorio' },
    ]);
  }
  const receptor = dto.receptor
    ? { ...dto.receptor, ...partirRut(dto.receptor.rut) }
    : { rut: '66666666', dv: '6', razonSocial: 'Consumidor final' };
  const sucursal = Number(empresa.codigoSucursalSii);

  // `traslado.indTraslado` es un alias de `idDoc.indTraslado`.
  const { indTraslado: indEnTraslado, ...traslado } = dto.traslado ?? {};
  if (indEnTraslado !== undefined && dto.idDoc.indTraslado !== undefined && indEnTraslado !== dto.idDoc.indTraslado) {
    throw documentoInvalido('idDoc.indTraslado y traslado.indTraslado no coinciden', [
      { campo: 'traslado.indTraslado', mensaje: 'debe coincidir con idDoc.indTraslado (o informe solo uno)' },
    ]);
  }
  const indTraslado = dto.idDoc.indTraslado ?? indEnTraslado;
  const conTraslado = dto.traslado !== undefined;
  const detalle = dto.detalle.map((l, i) => {
    if (l.precioUnitario === undefined && tipo !== 52 && !conTraslado) {
      throw documentoInvalido(`detalle[${i}].precioUnitario es obligatorio`, [
        { campo: `detalle[${i}].precioUnitario`, mensaje: 'es obligatorio (solo guías y traslados pueden omitirlo)' },
      ]);
    }
    return { ...l, precioUnitario: l.precioUnitario ?? 0 };
  });

  return {
    idDoc: { ...dto.idDoc, folio, fechaEmision, ...(indTraslado !== undefined ? { indTraslado } : {}) },
    emisor: {
      rut: String(empresa.rut),
      dv: empresa.dv,
      razonSocial: empresa.razonSocial,
      giro: empresa.giro,
      ...(boleta ? {} : { actecos: empresa.actecos }),
      direccion: empresa.direccion,
      comuna: empresa.comuna,
      ciudad: empresa.ciudad,
      ...(Number.isInteger(sucursal) && empresa.codigoSucursalSii
        ? { codigoSucursalSii: sucursal }
        : {}),
      ...(empresa.correoIntercambio ? { correo: empresa.correoIntercambio } : {}),
      ...(empresa.telefono ? { telefono: empresa.telefono } : {}),
    },
    receptor,
    detalle,
    descuentosRecargos: dto.descuentosRecargos,
    referencias: dto.referencias?.map((r) => ({
      ...r,
      fechaRef: r.fechaRef ?? fechaEmision,
    })),
    impuestosAdicionales: dto.impuestosAdicionales,
    ...(conTraslado ? { traslado: traslado as TrasladoDte } : {}),
    ...(boleta && empresa.rutProveedorSoftware !== null
      ? {
          proveedorSoftware: {
            rut: String(empresa.rutProveedorSoftware),
            dv: empresa.dvProveedorSoftware ?? '',
          },
        }
      : {}),
  };
}

export interface ResultadoComplemento {
  /** Documento nuevo (la guía complementaria). */
  documento: Documento;
  repetido: boolean;
  /** Documento original, ya sin `trasladoPendiente`. */
  original: Documento;
  modalidad: 'guia_posterior' | 'gdt';
  /** Se informa si la modalidad pedida no pudo usarse (p. ej. GDT no habilitada). */
  advertencia?: string;
}

/** Campos que, al informarse con valor, dejan de estar "Diferido"/"Sin Dato". */
function camposInformados(t: Omit<TrasladoDto, 'indTraslado' | 'retiroComprador'>): Set<CampoTraslado> {
  const s = new Set<CampoTraslado>();
  if (t.transportista?.rut) s.add('transportista');
  if (t.chofer?.rut) s.add('choferRut');
  if (t.chofer?.nombre) s.add('choferNombre');
  if (t.patente) s.add('patente');
  if (t.patenteCarro) s.add('patenteCarro');
  if (t.fechaSalida) s.add('fechaSalida');
  return s;
}

/**
 * Fusiona los datos nuevos sobre el traslado original: lo no informado se conserva; un campo informado con valor
 * deja de estar marcado; un campo marcado de nuevo pierde su valor anterior.
 */
export function fusionarTraslado(
  base: TrasladoDto,
  nuevo: Omit<TrasladoDto, 'indTraslado' | 'retiroComprador'>,
): TrasladoDto {
  const marcas = new Map<CampoTraslado, 'diferido' | 'sinDato'>();
  for (const c of base.diferido ?? []) marcas.set(c, 'diferido');
  for (const c of base.sinDato ?? []) marcas.set(c, 'sinDato');
  for (const c of camposInformados(nuevo)) marcas.delete(c);
  for (const c of nuevo.diferido ?? []) marcas.set(c, 'diferido');
  for (const c of nuevo.sinDato ?? []) marcas.set(c, 'sinDato');

  const r: TrasladoDto = { ...base };
  const { diferido: _d, sinDato: _s, chofer, transportista, origen, destino, ...simples } = nuevo;
  Object.assign(r, Object.fromEntries(Object.entries(simples).filter(([, v]) => v !== undefined)));
  if (origen) r.origen = origen;
  if (destino) r.destino = destino;
  if (transportista) r.transportista = transportista;
  if (chofer) r.chofer = { ...base.chofer, ...Object.fromEntries(Object.entries(chofer).filter(([, v]) => v !== undefined)) };
  // Un campo que queda marcado no conserva el valor anterior.
  for (const c of marcas.keys()) {
    if (c === 'transportista') delete r.transportista;
    else if (c === 'choferRut' && r.chofer) delete r.chofer.rut;
    else if (c === 'choferNombre' && r.chofer) delete r.chofer.nombre;
    else if (c === 'patente') delete r.patente;
    else if (c === 'patenteCarro') delete r.patenteCarro;
    else if (c === 'fechaSalida') {
      delete r.fechaSalida;
      delete r.horaSalida;
    }
  }
  const diferido = [...marcas].filter(([, m]) => m === 'diferido').map(([c]) => c);
  const sinDato = [...marcas].filter(([, m]) => m === 'sinDato').map(([c]) => c);
  if (diferido.length > 0) r.diferido = diferido;
  else delete r.diferido;
  if (sinDato.length > 0) r.sinDato = sinDato;
  else delete r.sinDato;
  return r;
}

/** Opciones internas de emisión: NO forman parte del DTO HTTP público. */
export interface OpcionesEmision {
  /** Emite guías (52) sin bloque `traslado` aunque `EXIGIR_TRASLADO_GUIAS` sea true (set de pruebas del SII). */
  omitirExigenciaTraslado?: boolean;
}

export interface ResultadoEmision {
  documento: Documento;
  /** true si la `Idempotency-Key` ya existía: se devuelve el documento original sin emitir otro. */
  repetido: boolean;
}

@Injectable()
export class DocumentosService {
  constructor(
    private readonly ejecutor: EjecutorEmpresa,
    private readonly empresas: EmpresasService,
    private readonly folios: FoliosService,
    private readonly sii: SiiClienteFactory,
    @Inject(siiConfig.KEY) private readonly configSii: ConfigType<typeof siiConfig>,
  ) {}

  /**
   * Emite un documento en UNA transacción: asigna el folio (bloqueando el CAF), construye y firma el
   * DTE (TED incluido) y guarda `documentos`. Si cualquier paso falla se revierte todo y el folio
   * NO se consume. Si ya hay una transacción en curso (ver `EjecutorEmpresa`; p. ej. la simulación de
   * la CLI de certificación) participa en ella mediante un savepoint: si el llamador la revierte, el
   * folio y el documento desaparecen.
   */
  async emitir(
    rutEmpresa: string,
    dto: EmitirDocumentoDto,
    claveIdempotencia?: string,
    opciones: OpcionesEmision = {},
  ): Promise<{ resultado: ResultadoEmision; empresa: Empresa }> {
    const empresa = await this.empresas.obtenerPorRut(rutEmpresa);
    const huella = huellaSolicitud(dto);

    if (claveIdempotencia) {
      const previo = await this.reutilizar(empresa.id, claveIdempotencia, huella);
      if (previo) return { resultado: previo, empresa };
    }

    // Descifrar y abrir el PFX es lento: se hace antes de abrir la transacción y tomar bloqueos.
    const certificado = await this.sii.certificadoActivo(empresa.id);
    const fechaEmision = dto.idDoc.fechaEmision ?? fechaSantiago();

    try {
      const documento = await this.ejecutor.ejecutar((externo) =>
        externo.transaction(async (em: EntityManager) => {
        const asignado = await this.folios.asignarSiguienteFolio(
          empresa.id,
          dto.idDoc.tipoDte,
          fechaEmision,
          em,
        );
        const caf = parsearCaf(asignado.xmlCaf);
        const construido = construirDte(
          armarDocumento(empresa, dto, asignado.folio, fechaEmision),
          {
            caf,
            certificado,
            permitirIndTrasladoRes144: this.configSii.permitirIndTrasladoRes144,
            exigirTrasladoGuias: this.configSii.exigirTrasladoGuias && !opciones.omitirExigenciaTraslado,
          },
        );
        const t = construido.totales;
        return em.save(
          em.create(Documento, {
            empresaId: empresa.id,
            cafId: asignado.cafId,
            tipoDte: dto.idDoc.tipoDte,
            folio: asignado.folio,
            fechaEmision,
            ...receptorColumnas(dto),
            montoNeto: t.mntNeto,
            montoExento: t.mntExe,
            iva: t.iva,
            montoTotal: t.mntTotal,
            estado: 'emitido',
            trackId: null,
            xmlFirmado: construido.xmlFirmado,
            ted: construido.ted,
            reparos: null,
            claveIdempotencia: claveIdempotencia ?? null,
            huellaSolicitud: huella,
            origen: dto.origen ?? null,
            traslado: construido.traslado ? { ...construido.traslado, solicitud: dto } : null,
            trasladoPendiente: construido.traslado?.pendiente ?? false,
          }),
        );
        }),
      );
      return { resultado: { documento, repetido: false }, empresa };
    } catch (e) {
      // Dos solicitudes simultáneas con la misma clave: la perdedora revierte (sin consumir folio)
      // y devuelve el documento de la ganadora.
      if (claveIdempotencia && esViolacionUnica(e)) {
        const previo = await this.reutilizar(empresa.id, claveIdempotencia, huella);
        if (previo) return { resultado: previo, empresa };
      }
      throw e;
    }
  }

  /** Documentos de la empresa (más recientes primero), con filtro por traslado pendiente y tipo. */
  async listar(rutEmpresa: string, q: ListarDocumentosQuery): Promise<Documento[]> {
    const empresa = await this.empresas.obtenerPorRut(rutEmpresa);
    return this.ejecutor.ejecutar((em) =>
      em.getRepository(Documento).find({
        where: {
          empresaId: empresa.id,
          ...(q.trasladoPendiente !== undefined ? { trasladoPendiente: q.trasladoPendiente } : {}),
          ...(q.tipo !== undefined ? { tipoDte: q.tipo } : {}),
        },
        order: { creadoEn: 'DESC' },
        take: q.limite ?? 50,
      }),
    );
  }

  /**
   * Complementa o corrige el traslado de un documento (Res. Ex. SII 144/2026, resolutivos 1°, 4° y 5°) emitiendo
   * una NUEVA guía 52 que referencia a la original:
   * - `guia_posterior`: copia la guía original (mismo `IndTraslado`, detalle y precios) con los datos actualizados;
   * - `gdt`: guía de despacho tercerizada (`IndTraslado` 10) con detalle mínimo; solo si `PERMITIR_INDTRASLADO_RES144`
   *   la habilita, de lo contrario se emite como `guia_posterior` (con `advertencia`). Una factura solo admite `gdt`.
   * La original queda sin `trasladoPendiente` y apunta a la nueva (`traslado.complementadoPor`). Todo en una transacción.
   * La anulación de la guía original en el Registro de Guías de Despacho del SII es manual (no hay web service).
   */
  async complementarTraslado(
    id: string,
    dto: ComplementarTrasladoDto,
    claveIdempotencia: string | undefined,
    acceso: AccesoEmpresas,
  ): Promise<ResultadoComplemento> {
    const { documento: original, empresa } = await this.obtener(id, acceso);
    const guardado = original.traslado as ({ solicitud?: EmitirDocumentoDto; retiroComprador?: boolean; complementadoPor?: { documentoId: string; folio: number } }) | null;
    const solicitud = guardado?.solicitud;
    if (!guardado || !solicitud) {
      throw new ProblemaHttp(409, 'SIN_TRASLADO', 'Documento sin traslado', 'El documento no informa datos de traslado (Res. Ex. SII 144/2026): no hay nada que complementar');
    }
    if (guardado.retiroComprador) {
      throw new ProblemaHttp(409, 'SIN_TRASLADO', 'Retiro por el comprador', 'La factura es retirada por el comprador (resolutivo 15°) y no lleva datos de transporte');
    }

    let modalidad = dto.modalidad ?? 'guia_posterior';
    let advertencia: string | undefined;
    const gdtHabilitada = this.configSii.permitirIndTrasladoRes144;
    if (modalidad === 'gdt' && !gdtHabilitada) {
      if (original.tipoDte !== 52) {
        throw new ProblemaHttp(422, 'DOCUMENTO_INVALIDO', 'GDT no habilitada', 'Una factura solo se complementa con una guía de despacho tercerizada (IndTraslado 10), y está deshabilitada: el XSD oficial del SII aún no la enumera (PERMITIR_INDTRASLADO_RES144=false)', [{ campo: 'modalidad', mensaje: 'gdt no habilitada' }]);
      }
      modalidad = 'guia_posterior';
      advertencia = 'La guía de despacho tercerizada (IndTraslado 10) está deshabilitada porque el XSD oficial del SII aún no la enumera (PERMITIR_INDTRASLADO_RES144=false): se emitió una guía posterior con el mismo IndTraslado (resolutivo 4°)';
    }
    if (modalidad === 'guia_posterior' && original.tipoDte !== 52) {
      throw new ProblemaHttp(422, 'DOCUMENTO_INVALIDO', 'Modalidad no aplicable', 'Una factura no se complementa con una guía posterior de la misma factura: use la modalidad gdt o emita una nota de crédito y una factura nueva (resolutivo 1°)', [{ campo: 'modalidad', mensaje: 'use gdt' }]);
    }

    const fechaEmision = dto.fechaEmision ?? fechaSantiago();
    const rutEmpresa = `${empresa.rut}-${empresa.dv}`;
    const trasladoBase = solicitud.traslado ?? {};
    const indOriginal = (trasladoBase.indTraslado ?? solicitud.idDoc.indTraslado) as IndTraslado | undefined;
    const fusionado = fusionarTraslado(trasladoBase, dto.traslado);
    delete fusionado.indTraslado;
    const referencia = {
      tipoDocRef: String(original.tipoDte),
      folioRef: original.folio,
      fechaRef: original.fechaEmision,
      razonRef: 'Complementa datos de traslado (Res. Ex. SII 144/2026)',
    };

    let nuevo: EmitirDocumentoDto;
    if (modalidad === 'gdt') {
      const primero = solicitud.detalle[0];
      nuevo = {
        idDoc: { tipoDte: 52, indTraslado: 10, fechaEmision },
        ...(solicitud.receptor ? { receptor: solicitud.receptor } : {}),
        detalle: [{ nombre: primero?.nombre ?? 'Traslado', descripcion: 'Detalle según el documento referenciado' }],
        referencias: [referencia],
        traslado: { ...fusionado, categoria: 'tercerizado', motivoSinPrecio: undefined, descripcionProlongado: undefined },
        origen: { complementaDocumentoId: original.id },
      };
    } else {
      nuevo = {
        ...solicitud,
        idDoc: { ...solicitud.idDoc, fechaEmision, indTraslado: indOriginal },
        referencias: [
          ...(solicitud.referencias ?? []).map((r) => ({ ...r, fechaRef: r.fechaRef ?? original.fechaEmision })),
          referencia,
        ],
        traslado: fusionado,
        origen: { ...solicitud.origen, complementaDocumentoId: original.id },
      };
    }
    // `fechaVencimiento` y similares de la original no se arrastran a una fecha de emisión distinta.
    delete nuevo.idDoc.fechaVencimiento;

    const resultado = await this.ejecutor.ejecutar(async (em) => {
      // La original se bloquea: dos complementos simultáneos no pueden partir del mismo documento.
      const bloqueado = await em.getRepository(Documento).findOne({ where: { id: original.id }, lock: { mode: 'pessimistic_write' } });
      if (!bloqueado) throw noEncontrado('El documento', id);
      const previo = (bloqueado.traslado as { complementadoPor?: { documentoId: string; folio: number } } | null)?.complementadoPor;
      const { resultado: r } = await this.emitir(rutEmpresa, nuevo, claveIdempotencia);
      if (previo && !r.repetido) {
        // Revierte la transacción: no queda la segunda guía ni se consume el folio.
        throw new ProblemaHttp(409, 'TRASLADO_YA_COMPLEMENTADO', 'Traslado ya complementado', `La guía ya fue complementada por el documento ${previo.documentoId} (folio ${previo.folio}); complemente esa última guía`);
      }
      if (!r.repetido) {
        bloqueado.trasladoPendiente = false;
        bloqueado.traslado = { ...bloqueado.traslado, pendiente: false, complementadoPor: { documentoId: r.documento.id, folio: r.documento.folio } };
        await em.save(bloqueado);
      }
      return { r, bloqueado };
    });
    return {
      documento: resultado.r.documento,
      repetido: resultado.r.repetido,
      original: resultado.bloqueado,
      modalidad,
      ...(advertencia ? { advertencia } : {}),
    };
  }

  private async reutilizar(
    empresaId: string,
    clave: string,
    huella: string,
  ): Promise<ResultadoEmision | null> {
    const previo = await this.ejecutor.ejecutar((em) =>
      em.getRepository(Documento).findOne({
        where: { empresaId, claveIdempotencia: clave },
      }),
    );
    if (!previo) return null;
    if (previo.huellaSolicitud !== huella) {
      throw new ProblemaHttp(
        409,
        'IDEMPOTENCIA_CONFLICTO',
        'Conflicto de idempotencia',
        'La Idempotency-Key ya se usó con un cuerpo distinto',
      );
    }
    return { documento: previo, repetido: true };
  }

  /**
   * Documento por id. Si pertenece a una empresa fuera del alcance de `acceso` responde 404 (igual
   * que si no existiera) para no revelar su existencia.
   */
  async obtener(
    id: string,
    acceso: AccesoEmpresas,
  ): Promise<{ documento: Documento; empresa: Empresa }> {
    const documento = await this.ejecutor.ejecutar((em) =>
      em.getRepository(Documento).findOne({
        where: { id },
        relations: { empresa: true },
      }),
    );
    if (!documento?.empresa) throw noEncontrado('El documento', id);
    asegurarRecursoDeEmpresa(
      acceso,
      `${documento.empresa.rut}-${documento.empresa.dv}`,
      'El documento',
      id,
    );
    return { documento, empresa: documento.empresa };
  }

  /** XML del DTE firmado en ISO-8859-1 (con declaración). */
  async xml(id: string, acceso: AccesoEmpresas): Promise<{ buffer: Buffer; nombre: string }> {
    const { documento } = await this.obtener(id, acceso);
    return {
      buffer: aIso88591(documento.xmlFirmado),
      nombre: `DTE_${documento.tipoDte}_${documento.folio}.xml`,
    };
  }

  /** Representación impresa (PDF con timbre PDF417). */
  async pdf(
    id: string,
    opciones: PdfQuery,
    acceso: AccesoEmpresas,
  ): Promise<{ buffer: Buffer; nombre: string }> {
    const { documento, empresa } = await this.obtener(id, acceso);
    return this.pdfDe(documento, empresa, opciones);
  }

  /** Igual que `pdf` pero sobre un documento ya cargado (p. ej. recién emitido en una simulación). */
  async pdfDe(
    documento: Documento,
    empresa: Empresa,
    opciones: PdfQuery,
  ): Promise<{ buffer: Buffer; nombre: string }> {
    const logo = empresa.logoTipo ? await this.empresas.obtenerLogo(empresa.id) : null;
    const urlVerificacion = empresa.urlVerificacion
      ? resolverUrlVerificacion(empresa.urlVerificacion, {
          id: documento.id,
          tipo: documento.tipoDte,
          folio: documento.folio,
          rutEmisor: `${empresa.rut}-${empresa.dv}`,
        })
      : undefined;
    const generar = (conLogo: Buffer | undefined) =>
      generarPdf(documento.xmlFirmado, {
        formato: opciones.formato,
        cedible: opciones.cedible,
        unidadSii: empresa.unidadSii ?? undefined,
        logo: conLogo,
        urlVerificacion,
        resolucion: {
          numero: empresa.nroResolucionSii ?? 0,
          fecha: empresa.fechaResolucionSii ?? documento.fechaEmision,
        },
      });
    let buffer: Buffer;
    try {
      buffer = await generar(logo?.buffer);
    } catch (e) {
      if (!logo) throw e;
      // Si falla con logo, se prueba sin él para distinguir un logo corrupto de otro problema.
      try {
        await generar(undefined);
      } catch {
        throw e;
      }
      throw new ProblemaHttp(
        422,
        'LOGO_INVALIDO',
        'Logo inválido',
        `PDFKit no pudo incrustar el logo de la empresa (${logo.tipo}): ${(e as Error).message}. Suba otro con PUT /v1/empresas/:rut/logo o elimínelo con DELETE.`,
      );
    }
    return {
      buffer,
      nombre: `DTE_${documento.tipoDte}_${documento.folio}.pdf`,
    };
  }
}

function receptorColumnas(dto: EmitirDocumentoDto) {
  if (!dto.receptor) {
    return {
      rutReceptor: 66666666,
      dvReceptor: '6',
      razonSocialReceptor: 'Consumidor final',
    };
  }
  const r = partirRut(dto.receptor.rut);
  return {
    rutReceptor: Number(r.rut),
    dvReceptor: r.dv,
    razonSocialReceptor: dto.receptor.razonSocial.slice(0, 100),
  };
}
