import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
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
  type DocumentoDte,
} from '../dte-core/index.js';
import type { Empresa } from '../empresas/entities/empresa.entity.js';
import { EmpresasService, esViolacionUnica } from '../empresas/empresas.service.js';
import { resolverUrlVerificacion } from '../empresas/opciones-pdf.js';
import { FoliosService } from '../folios/folios.service.js';
import { generarPdf } from '../representacion/index.js';
import { SiiClienteFactory } from '../sii/sii-cliente.factory.js';
import type { EmitirDocumentoDto, PdfQuery } from './documentos.dto.js';
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
  creadoEn: Date;
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

  return {
    idDoc: { ...dto.idDoc, folio, fechaEmision },
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
    detalle: dto.detalle,
    descuentosRecargos: dto.descuentosRecargos,
    referencias: dto.referencias?.map((r) => ({
      ...r,
      fechaRef: r.fechaRef ?? fechaEmision,
    })),
    impuestosAdicionales: dto.impuestosAdicionales,
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
          { caf, certificado },
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
