import { Injectable } from '@nestjs/common';
import { Between, In } from 'typeorm';
import { type AccesoEmpresas, asegurarRecursoDeEmpresa } from '../auth/principal.js';
import { documentoInvalido, noEncontrado, ProblemaHttp } from '../comun/problema.js';
import { EjecutorEmpresa } from '../database/ejecutor-empresa.js';
import { Documento } from '../documentos/entities/documento.entity.js';
import { DteRecibido } from '../recepcion/entities/dte-recibido.entity.js';
import {
  aIso88591,
  construirLibroCompraVenta,
  construirLibroGuias,
  ErrorValidacionDte,
  formatearRut,
  validarXsd,
  type DetalleLibroCV,
  type EsquemaSii,
} from '../dte-core/index.js';
import type { Empresa } from '../empresas/entities/empresa.entity.js';
import { EmpresasService } from '../empresas/empresas.service.js';
import { type CertificadoActivo, SiiClienteFactory } from '../sii/sii-cliente.factory.js';
import { clasificarEstadoEnvioDte } from '../sii-gateway/index.js';
import { Libro, type TipoOperacionLibroDb } from './entities/libro.entity.js';
import type {
  DocumentoCompraDto,
  GenerarLibroComprasDto,
  GenerarLibroGuiasDto,
  GenerarLibroVentasDto,
} from './libros.dto.js';
import {
  documentoADetalleGuia,
  documentoADetalleVenta,
  entraAlLibro,
  rangoPeriodo,
  resumenesDeBoletas,
  TIPOS_BOLETA_RESUMEN,
  TIPOS_VENTA_DETALLE,
} from './libros-desde-documentos.js';

export interface LibroRespuesta {
  id: string;
  empresa: string;
  tipoOperacion: TipoOperacionLibroDb;
  tipoLibro: string;
  tipoEnvio: string;
  periodo: string;
  folioNotificacion: number | null;
  nroSegmento: number | null;
  ambienteSii: string;
  cantidadDocumentos: number;
  resumen: unknown;
  trackId: string | null;
  estado: string | null;
  glosaEstado: string | null;
  esFinal: boolean;
  intentos: number;
  enviadoEn: Date | null;
  consultadoEn: Date | null;
  creadoEn: Date;
  enlaces: { xml: string };
}

/** Libro ya construido y validado contra el XSD, todavía sin guardar. */
export interface LibroArmado {
  tipoOperacion: TipoOperacionLibroDb;
  tipoLibro: string;
  tipoEnvio: string;
  periodo: string;
  folioNotificacion: number | null;
  nroSegmento: number | null;
  /** Libro firmado, sin declaración XML. */
  xml: string;
  xmlIso: Buffer;
  resumen: unknown;
  cantidadDocumentos: number;
  advertencias: string[];
}

export interface OpcionesArmado {
  /** Si se omite se usa el certificado activo de la empresa. */
  certificado?: CertificadoActivo;
  fechaFirma?: Date;
}

const ESQUEMA: Record<TipoOperacionLibroDb, EsquemaSii> = {
  VENTA: 'LibroCV',
  COMPRA: 'LibroCV',
  GUIA: 'LibroGuia',
};

function sinResolucion() {
  return new ProblemaHttp(
    422,
    'EMPRESA_SIN_RESOLUCION',
    'Falta la resolución del SII',
    'La empresa no tiene número y fecha de resolución; actualícela con PATCH /v1/empresas/{rut} (en certificación: número 0 y la fecha publicada por el SII)',
  );
}

function estadoInvalido(detail: string) {
  return new ProblemaHttp(409, 'ESTADO_INVALIDO', 'Estado inválido', detail);
}

/** Convierte los errores de validación del dominio en 422. */
function conErroresDeDominio<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof ErrorValidacionDte) throw documentoInvalido(e.message);
    throw e;
  }
}

@Injectable()
export class LibrosService {
  constructor(
    private readonly ejecutor: EjecutorEmpresa,
    private readonly empresas: EmpresasService,
    private readonly sii: SiiClienteFactory,
  ) {}

  // -------------------------------------------------------------------------------------------
  // Armado (sin persistir)
  // -------------------------------------------------------------------------------------------

  /** Libro de ventas del período desde la tabla `documentos` (33, 34, 56, 61 y exportación 110, 111, 112; boletas como resumen). */
  async armarVentas(
    empresa: Empresa,
    dto: GenerarLibroVentasDto,
    o: OpcionesArmado = {},
  ): Promise<LibroArmado> {
    this.exigirDesdeBase(dto.tipoEnvio, dto.documentoIds !== undefined);
    const tipoLibro = dto.tipoLibro ?? 'MENSUAL';
    const incluirBoletas = dto.incluirBoletas ?? tipoLibro === 'MENSUAL';
    const tipos = [...TIPOS_VENTA_DETALLE, ...(incluirBoletas ? TIPOS_BOLETA_RESUMEN : [])];
    const todos = await this.documentosDelPeriodo(empresa, dto.periodo, tipos, dto.documentoIds);
    const advertencias: string[] = [];
    const rechazados = todos.filter((d) => !entraAlLibro(d));
    if (rechazados.length > 0) {
      advertencias.push(
        `Se omitieron ${rechazados.length} documento(s) rechazados por el SII: ${rechazados.map((d) => `${d.tipoDte}-${d.folio}`).join(', ')}`,
      );
    }
    const docs = todos.filter(entraAlLibro);
    const conDetalle = docs.filter((d) => TIPOS_VENTA_DETALLE.includes(d.tipoDte));
    const boletas = docs.filter((d) => TIPOS_BOLETA_RESUMEN.includes(d.tipoDte));
    const certificado = o.certificado ?? (await this.sii.certificadoActivo(empresa.id));

    const libro = conErroresDeDominio(() =>
      construirLibroCompraVenta({
        caratula: this.caratulaCV(empresa, certificado, 'VENTA', dto),
        detalle: conDetalle.map(documentoADetalleVenta),
        resumenesAdicionales: dto.tipoEnvio === 'PARCIAL' ? undefined : resumenesDeBoletas(boletas),
        certificado,
        fechaFirma: o.fechaFirma,
      }),
    );
    return this.validarYEmpaquetar(
      'VENTA',
      dto,
      libro,
      libro.resumenPeriodo ?? libro.resumenSegmento,
      conDetalle.length + boletas.length,
      advertencias,
    );
  }

  /**
   * Libro de compras desde el JSON del cliente o, con `desdeRecibidos`, desde los DTE recibidos aceptados
   * del período (módulo `recepcion`).
   */
  async armarCompras(
    empresa: Empresa,
    dto: GenerarLibroComprasDto,
    o: OpcionesArmado = {},
  ): Promise<LibroArmado> {
    const certificado = o.certificado ?? (await this.sii.certificadoActivo(empresa.id));
    const advertencias: string[] = [];
    let documentos: DocumentoCompraDto[];
    if (dto.desdeRecibidos) {
      const r = await this.comprasDeRecibidos(empresa, dto.periodo);
      documentos = r.documentos;
      advertencias.push(...r.advertencias);
    } else {
      documentos = dto.documentos ?? [];
    }
    const libro = conErroresDeDominio(() =>
      construirLibroCompraVenta({
        caratula: this.caratulaCV(empresa, certificado, 'COMPRA', dto),
        detalle: documentos.map(aDetalleCompra),
        documentosPeriodo: dto.documentosPeriodo?.map(aDetalleCompra),
        factorProporcionalidad: dto.factorProporcionalidad,
        certificado,
        fechaFirma: o.fechaFirma,
      }),
    );
    return this.validarYEmpaquetar(
      'COMPRA',
      dto,
      libro,
      libro.resumenPeriodo ?? libro.resumenSegmento,
      documentos.length,
      advertencias,
    );
  }

  /**
   * Detalle de compras a partir de `dte_recibidos`: solo los aceptados (con o sin reparos) y emitidos en el
   * período. Las guías de despacho (52) no van en el IECV (tienen su propio libro) y se omiten con una advertencia.
   */
  private async comprasDeRecibidos(
    empresa: Empresa,
    periodo: string,
  ): Promise<{ documentos: DocumentoCompraDto[]; advertencias: string[] }> {
    const { desde, hasta } = rangoPeriodo(periodo);
    const filas = await this.ejecutor.ejecutar((em) =>
      em.getRepository(DteRecibido).find({
        where: {
          empresaId: empresa.id,
          estadoComercial: In(['aceptado', 'aceptado_con_reparos']),
          fechaEmision: Between(desde, hasta),
        },
        select: {
          id: true,
          tipoDte: true,
          folio: true,
          rutEmisor: true,
          dvEmisor: true,
          razonSocialEmisor: true,
          fechaEmision: true,
          montoNeto: true,
          montoExento: true,
          iva: true,
          montoTotal: true,
          otrosImpuestos: true,
        },
        order: { tipoDte: 'ASC', folio: 'ASC', rutEmisor: 'ASC' },
      }),
    );
    const advertencias: string[] = [];
    const guias = filas.filter((f) => f.tipoDte === 52);
    if (guias.length > 0) {
      advertencias.push(
        `Se omitieron ${guias.length} guía(s) de despacho recibidas (van en el libro de guías): ${guias.map((g) => g.folio).join(', ')}`,
      );
    }
    const documentos = filas
      .filter((f) => f.tipoDte !== 52)
      .map(
        (f): DocumentoCompraDto => ({
          tipoDoc: f.tipoDte,
          folio: f.folio,
          fechaDoc: f.fechaEmision,
          rutProveedor: formatearRut(f.rutEmisor, f.dvEmisor),
          ...(f.razonSocialEmisor ? { razonSocial: f.razonSocialEmisor.slice(0, 50) } : {}),
          ...(f.montoExento ? { montoExento: f.montoExento } : {}),
          ...(f.montoNeto ? { montoNeto: f.montoNeto } : {}),
          ...(f.iva !== null && f.montoNeto ? { montoIva: f.iva } : {}),
          ...(f.otrosImpuestos && f.otrosImpuestos.length > 0 ? { otrosImpuestos: f.otrosImpuestos } : {}),
          montoTotal: f.montoTotal,
        }),
      );
    return { documentos, advertencias };
  }

  /** Libro de guías de despacho del período desde `documentos` tipo 52. */
  async armarGuias(
    empresa: Empresa,
    dto: GenerarLibroGuiasDto,
    o: OpcionesArmado = {},
  ): Promise<LibroArmado> {
    this.exigirDesdeBase(dto.tipoEnvio, dto.documentoIds !== undefined);
    const todos = await this.documentosDelPeriodo(empresa, dto.periodo, [52], dto.documentoIds);
    const advertencias: string[] = [];
    const rechazadas = todos.filter((d) => !entraAlLibro(d));
    if (rechazadas.length > 0) {
      advertencias.push(`Se omitieron ${rechazadas.length} guía(s) rechazadas por el SII`);
    }
    const guias = todos.filter(entraAlLibro);
    const certificado = o.certificado ?? (await this.sii.certificadoActivo(empresa.id));
    const libro = conErroresDeDominio(() =>
      construirLibroGuias({
        caratula: {
          rutEmisorLibro: formatearRut(empresa.rut, empresa.dv),
          rutEnvia: formatearRut(certificado.rutFirmante, certificado.dvFirmante),
          periodoTributario: dto.periodo,
          ...this.resolucion(empresa),
          tipoLibro: 'ESPECIAL',
          tipoEnvio: dto.tipoEnvio ?? 'TOTAL',
          ...(dto.nroSegmento !== undefined ? { nroSegmento: dto.nroSegmento } : {}),
          folioNotificacion: dto.folioNotificacion,
        },
        detalle: guias.map(documentoADetalleGuia),
        certificado,
        fechaFirma: o.fechaFirma,
      }),
    );
    return this.validarYEmpaquetar(
      'GUIA',
      { ...dto, tipoLibro: 'ESPECIAL' },
      libro,
      libro.resumenPeriodo ?? libro.resumenSegmento,
      guias.length,
      [...advertencias, ...libro.advertencias],
    );
  }

  // -------------------------------------------------------------------------------------------
  // Generación (arma, guarda y, opcionalmente, envía)
  // -------------------------------------------------------------------------------------------

  async generarVentas(rutEmpresa: string, dto: GenerarLibroVentasDto): Promise<LibroRespuesta> {
    const empresa = await this.empresas.obtenerPorRut(rutEmpresa);
    return this.guardarYEnviar(empresa, await this.armarVentas(empresa, dto), dto.enviar);
  }

  async generarCompras(rutEmpresa: string, dto: GenerarLibroComprasDto): Promise<LibroRespuesta> {
    const empresa = await this.empresas.obtenerPorRut(rutEmpresa);
    return this.guardarYEnviar(empresa, await this.armarCompras(empresa, dto), dto.enviar);
  }

  async generarGuias(rutEmpresa: string, dto: GenerarLibroGuiasDto): Promise<LibroRespuesta> {
    const empresa = await this.empresas.obtenerPorRut(rutEmpresa);
    return this.guardarYEnviar(empresa, await this.armarGuias(empresa, dto), dto.enviar);
  }

  /** Guarda un libro ya armado (y lo envía si `enviar`). Lo usa también la herramienta del set. */
  async guardarYEnviar(empresa: Empresa, armado: LibroArmado, enviar?: boolean): Promise<LibroRespuesta> {
    const libro = await this.ejecutor.ejecutar((em) =>
      em.save(
        em.create(Libro, {
          empresaId: empresa.id,
          tipoOperacion: armado.tipoOperacion,
          tipoLibro: armado.tipoLibro,
          tipoEnvio: armado.tipoEnvio,
          periodo: armado.periodo,
          folioNotificacion: armado.folioNotificacion,
          nroSegmento: armado.nroSegmento,
          ambienteSii: empresa.ambienteSii,
          xmlLibro: armado.xml,
          resumen: armado.resumen as object,
          cantidadDocumentos: armado.cantidadDocumentos,
          trackId: null,
          estado: null,
          glosaEstado: null,
          respuesta: null,
          intentos: 0,
          enviadoEn: null,
          consultadoEn: null,
        }),
      ),
    );
    if (enviar) await this.enviarLibro(libro, empresa);
    return this.respuesta(await this.cargar(libro.id), empresa);
  }

  // -------------------------------------------------------------------------------------------
  // Consulta y envío
  // -------------------------------------------------------------------------------------------

  async listar(rutEmpresa: string, periodo?: string): Promise<LibroRespuesta[]> {
    const empresa = await this.empresas.obtenerPorRut(rutEmpresa);
    const libros = await this.ejecutor.ejecutar((em) =>
      em.getRepository(Libro).find({
        where: { empresaId: empresa.id, ...(periodo ? { periodo } : {}) },
        order: { creadoEn: 'DESC' },
        take: 100,
      }),
    );
    return libros.map((l) => this.respuesta(l, empresa));
  }

  /** Libro por id restringido a las empresas de `acceso`: uno ajeno responde 404, igual que si no existiera. */
  async obtener(id: string, acceso: AccesoEmpresas): Promise<{ libro: Libro; empresa: Empresa }> {
    const libro = await this.ejecutor.ejecutar((em) =>
      em.getRepository(Libro).findOne({ where: { id }, relations: { empresa: true } }),
    );
    if (!libro?.empresa) throw noEncontrado('El libro', id);
    asegurarRecursoDeEmpresa(acceso, `${libro.empresa.rut}-${libro.empresa.dv}`, 'El libro', id);
    return { libro, empresa: libro.empresa };
  }

  async detalle(id: string, acceso: AccesoEmpresas): Promise<LibroRespuesta> {
    const { libro, empresa } = await this.obtener(id, acceso);
    return this.respuesta(libro, empresa);
  }

  /** XML firmado en ISO-8859-1 (con declaración). */
  async xml(id: string, acceso: AccesoEmpresas): Promise<{ buffer: Buffer; nombre: string }> {
    const { libro } = await this.obtener(id, acceso);
    return { buffer: aIso88591(libro.xmlLibro), nombre: nombreArchivo(libro) };
  }

  /** Sube el libro al SII (upload de DTE). Solo si nunca se envió o el último intento falló (`ERR`). */
  async enviar(id: string, acceso: AccesoEmpresas): Promise<LibroRespuesta> {
    const { libro, empresa } = await this.obtener(id, acceso);
    await this.enviarLibro(libro, empresa);
    return this.respuesta(await this.cargar(id), empresa);
  }

  /** Consulta el estado del envío en el SII (`QueryEstUp`) y lo guarda. */
  async consultar(id: string, acceso: AccesoEmpresas): Promise<LibroRespuesta> {
    const { libro, empresa } = await this.obtener(id, acceso);
    if (!libro.trackId) throw estadoInvalido('El libro no tiene track id (no se ha enviado al SII)');
    const clientes = await this.sii.paraEmpresa(empresa, libro.ambienteSii);
    const r = await clientes.dte.consultarEstadoEnvio(libro.trackId);
    await this.ejecutor.ejecutar((em) =>
      em.update(
        Libro,
        { id },
        {
          estado: r.estado.slice(0, 10),
          glosaEstado: r.descripcionEstado.slice(0, 200),
          respuesta: { estado: r.estado, glosa: r.glosa, cabecera: r.cabecera, cuerpo: r.cuerpo } as object,
          consultadoEn: new Date(),
        },
      ),
    );
    return this.respuesta(await this.cargar(id), empresa);
  }

  // -------------------------------------------------------------------------------------------
  // Internos
  // -------------------------------------------------------------------------------------------

  private async enviarLibro(libro: Libro, empresa: Empresa): Promise<void> {
    if (libro.trackId && libro.estado !== 'ERR') {
      throw estadoInvalido(`El libro ya fue enviado al SII (track id ${libro.trackId})`);
    }
    const clientes = await this.sii.paraEmpresa(empresa, libro.ambienteSii);
    try {
      const enviado = await clientes.dte.enviarDte(aIso88591(libro.xmlLibro), nombreArchivo(libro));
      await this.ejecutor.ejecutar((em) =>
        em.update(
          Libro,
          { id: libro.id },
          {
            trackId: enviado.trackId,
            estado: 'REC',
            glosaEstado: 'Libro recibido',
            respuesta: enviado as unknown as object,
            intentos: libro.intentos + 1,
            enviadoEn: new Date(),
          },
        ),
      );
    } catch (e) {
      await this.ejecutor.ejecutar((em) =>
        em.update(
          Libro,
          { id: libro.id },
          {
            estado: 'ERR',
            glosaEstado: String((e as Error).message).slice(0, 200),
            intentos: libro.intentos + 1,
          },
        ),
      );
      throw e;
    }
  }

  private async cargar(id: string): Promise<Libro> {
    return this.ejecutor.ejecutar((em) => em.getRepository(Libro).findOneOrFail({ where: { id } }));
  }

  private respuesta(l: Libro, empresa: Empresa): LibroRespuesta {
    return {
      id: l.id,
      empresa: `${empresa.rut}-${empresa.dv}`,
      tipoOperacion: l.tipoOperacion,
      tipoLibro: l.tipoLibro,
      tipoEnvio: l.tipoEnvio,
      periodo: l.periodo,
      folioNotificacion: l.folioNotificacion,
      nroSegmento: l.nroSegmento,
      ambienteSii: l.ambienteSii,
      cantidadDocumentos: l.cantidadDocumentos,
      resumen: l.resumen ?? null,
      trackId: l.trackId,
      estado: l.estado,
      glosaEstado: l.glosaEstado,
      esFinal: l.estado ? clasificarEstadoEnvioDte(l.estado).esFinal : false,
      intentos: l.intentos,
      enviadoEn: l.enviadoEn,
      consultadoEn: l.consultadoEn,
      creadoEn: l.creadoEn,
      enlaces: { xml: `/v1/libros/${l.id}/xml` },
    };
  }

  private resolucion(empresa: Empresa): { fechaResolucion: string; numeroResolucion: number } {
    if (empresa.nroResolucionSii === null || empresa.fechaResolucionSii === null) throw sinResolucion();
    return { fechaResolucion: empresa.fechaResolucionSii, numeroResolucion: empresa.nroResolucionSii };
  }

  private caratulaCV(
    empresa: Empresa,
    certificado: CertificadoActivo,
    tipoOperacion: 'COMPRA' | 'VENTA',
    dto: GenerarLibroVentasDto | GenerarLibroComprasDto,
  ) {
    return {
      rutEmisorLibro: formatearRut(empresa.rut, empresa.dv),
      rutEnvia: formatearRut(certificado.rutFirmante, certificado.dvFirmante),
      periodoTributario: dto.periodo,
      ...this.resolucion(empresa),
      tipoOperacion,
      tipoLibro: dto.tipoLibro ?? ('MENSUAL' as const),
      tipoEnvio: dto.tipoEnvio ?? ('TOTAL' as const),
      ...(dto.nroSegmento !== undefined ? { nroSegmento: dto.nroSegmento } : {}),
      ...(dto.folioNotificacion !== undefined ? { folioNotificacion: dto.folioNotificacion } : {}),
      ...(dto.codAutRec ? { codAutRec: dto.codAutRec } : {}),
    };
  }

  /** Desde la base solo tienen sentido TOTAL, FINAL y PARCIAL (este último eligiendo los documentos). */
  private exigirDesdeBase(tipoEnvio: string | undefined, conIds: boolean): void {
    if (tipoEnvio === 'AJUSTE') {
      throw documentoInvalido(
        'El envío AJUSTE no se puede generar desde la base (requiere indicar agregados y eliminados); use el libro de compras con JSON o el dominio dte-core',
      );
    }
    if (tipoEnvio === 'PARCIAL' && !conIds) {
      throw documentoInvalido('El envío PARCIAL requiere documentoIds (los documentos de ese segmento)');
    }
  }

  private async documentosDelPeriodo(
    empresa: Empresa,
    periodo: string,
    tipos: number[],
    ids?: string[],
  ): Promise<Documento[]> {
    const { desde, hasta } = rangoPeriodo(periodo);
    const docs = await this.ejecutor.ejecutar((em) =>
      em.getRepository(Documento).find({
        where: {
          empresaId: empresa.id,
          tipoDte: In(tipos),
          fechaEmision: Between(desde, hasta),
          ...(ids ? { id: In(ids) } : {}),
        },
        order: { tipoDte: 'ASC', folio: 'ASC' },
      }),
    );
    if (ids) {
      const faltan = ids.filter((id) => !docs.some((d) => d.id === id));
      if (faltan.length > 0) {
        throw new ProblemaHttp(
          404,
          'NO_ENCONTRADO',
          'Documentos no encontrados',
          `No existen para la empresa, no son del período ${periodo} o no corresponden a este libro: ${faltan.join(', ')}`,
        );
      }
    }
    return docs;
  }

  private validarYEmpaquetar(
    tipoOperacion: TipoOperacionLibroDb,
    dto: { periodo: string; tipoLibro?: string; tipoEnvio?: string; folioNotificacion?: number; nroSegmento?: number },
    libro: { xml: string; xmlIso: Buffer; advertencias: string[] },
    resumen: unknown,
    cantidadDocumentos: number,
    advertencias: string[],
  ): LibroArmado {
    const xsd = validarXsd(libro.xmlIso, ESQUEMA[tipoOperacion]);
    if (!xsd.valido) {
      throw documentoInvalido(`El libro generado no valida contra el XSD del SII: ${xsd.errores.slice(0, 5).join('; ')}`);
    }
    return {
      tipoOperacion,
      tipoLibro: dto.tipoLibro ?? 'MENSUAL',
      tipoEnvio: dto.tipoEnvio ?? 'TOTAL',
      periodo: dto.periodo,
      folioNotificacion: dto.folioNotificacion ?? null,
      nroSegmento: dto.nroSegmento ?? null,
      xml: libro.xml,
      xmlIso: libro.xmlIso,
      resumen,
      cantidadDocumentos,
      advertencias: [...advertencias, ...(tipoOperacion === 'GUIA' ? [] : libro.advertencias)],
    };
  }
}

function nombreArchivo(l: Pick<Libro, 'tipoOperacion' | 'periodo' | 'id'>): string {
  const base = { VENTA: 'LibroVentas', COMPRA: 'LibroCompras', GUIA: 'LibroGuias' }[l.tipoOperacion];
  return `${base}_${l.periodo.replace('-', '')}_${l.id.slice(0, 8)}.xml`;
}

function aDetalleCompra(d: DocumentoCompraDto): DetalleLibroCV {
  const { rutProveedor, ...resto } = d;
  return { ...resto, ...(rutProveedor ? { rutContraparte: rutProveedor } : {}) };
}
