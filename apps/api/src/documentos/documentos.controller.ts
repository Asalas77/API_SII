import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import { PERMISOS, PrincipalActual, RequierePermisos, type Principal } from '../auth/index.js';
import { ProblemaHttp } from '../comun/problema.js';
import {
  type ComplementarTrasladoDto,
  complementarTrasladoSchema,
  type ConsultarEstadosDto,
  consultarEstadosSchema,
  type EmitirDocumentoDto,
  emitirDocumentoSchema,
  type ListarDocumentosQuery,
  listarDocumentosSchema,
  type PdfQuery,
  pdfQuerySchema,
} from './documentos.dto.js';
import { aRespuestaDocumento, DocumentosService } from './documentos.service.js';
import { EstadoSiiService } from './estado-sii.service.js';

@Controller('empresas/:rut/documentos')
export class EmpresaDocumentosController {
  constructor(
    private readonly servicio: DocumentosService,
    private readonly estados: EstadoSiiService,
  ) {}

  /**
   * Consulta al SII el estado de los documentos `enviado` de la empresa (o de `documentoIds`), con
   * concurrencia baja. Un fallo por documento se informa en su ítem y no aborta el lote.
   */
  @Post('consultar-estados')
  @HttpCode(200)
  @RequierePermisos(PERMISOS.DOCUMENTOS_LEER)
  consultarEstados(
    @Param('rut') rut: string,
    @Body({ schema: consultarEstadosSchema }) dto: ConsultarEstadosDto | undefined,
  ) {
    return this.estados.consultarLote(rut, dto ?? {});
  }

  /**
   * Lista documentos de la empresa (más recientes primero). `?trasladoPendiente=true` devuelve los que tienen
   * datos de traslado "Diferido" o "Sin Dato" por completar (Res. Ex. SII 144/2026).
   */
  @Get()
  @RequierePermisos(PERMISOS.DOCUMENTOS_LEER)
  async listar(
    @Param('rut') rut: string,
    @Query({ schema: listarDocumentosSchema }) query: ListarDocumentosQuery,
  ) {
    const docs = await this.servicio.listar(rut, query);
    return { datos: docs.map((d) => aRespuestaDocumento(d, rut)) };
  }

  /**
   * Emite un documento (folio + TED + firma en una transacción). 201 al crear; 200 con
   * `Idempotent-Replayed: true` si la `Idempotency-Key` ya existía con el mismo cuerpo.
   */
  @Post()
  @RequierePermisos(PERMISOS.DOCUMENTOS_EMITIR)
  async emitir(
    @Param('rut') rut: string,
    @Body({ schema: emitirDocumentoSchema }) dto: EmitirDocumentoDto,
    @Headers('idempotency-key') clave: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (clave !== undefined && (clave.length === 0 || clave.length > 100)) {
      throw new ProblemaHttp(
        400,
        'VALIDACION',
        'Idempotency-Key inválida',
        'La Idempotency-Key debe tener entre 1 y 100 caracteres',
      );
    }
    const { resultado, empresa } = await this.servicio.emitir(rut, dto, clave);
    if (resultado.repetido) {
      res.status(200).setHeader('Idempotent-Replayed', 'true');
    }
    return aRespuestaDocumento(
      resultado.documento,
      `${empresa.rut}-${empresa.dv}`,
    );
  }
}

@Controller('documentos')
@RequierePermisos(PERMISOS.DOCUMENTOS_LEER)
export class DocumentosController {
  constructor(
    private readonly servicio: DocumentosService,
    private readonly estados: EstadoSiiService,
  ) {}

  @Get(':id')
  async obtener(
    @Param('id', new ParseUUIDPipe()) id: string,
    @PrincipalActual() principal: Principal,
  ) {
    const { documento, empresa } = await this.servicio.obtener(id, principal);
    return aRespuestaDocumento(documento, `${empresa.rut}-${empresa.dv}`);
  }

  /**
   * Complementa o corrige los datos de traslado emitiendo una NUEVA guía 52 que referencia a la original
   * (guía posterior o GDT; Res. Ex. SII 144/2026, resolutivos 4° y 5°). 201 al crear; 200 con
   * `Idempotent-Replayed: true` si la `Idempotency-Key` ya existía.
   */
  @Post(':id/complementar-traslado')
  @RequierePermisos(PERMISOS.DOCUMENTOS_EMITIR)
  async complementarTraslado(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body({ schema: complementarTrasladoSchema }) dto: ComplementarTrasladoDto,
    @Headers('idempotency-key') clave: string | undefined,
    @PrincipalActual() principal: Principal,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (clave !== undefined && (clave.length === 0 || clave.length > 100)) {
      throw new ProblemaHttp(400, 'VALIDACION', 'Idempotency-Key inválida', 'La Idempotency-Key debe tener entre 1 y 100 caracteres');
    }
    const r = await this.servicio.complementarTraslado(id, dto, clave, principal);
    if (r.repetido) res.status(200).setHeader('Idempotent-Replayed', 'true');
    const { documento: orig, empresa } = await this.servicio.obtener(r.original.id, principal);
    const rutEmpresa = `${empresa.rut}-${empresa.dv}`;
    return {
      modalidad: r.modalidad,
      documento: aRespuestaDocumento(r.documento, rutEmpresa),
      original: aRespuestaDocumento(orig, rutEmpresa),
      ...(r.advertencia ? { advertencia: r.advertencia } : {}),
    };
  }

  /**
   * Consulta al SII el estado del documento (getEstDte o estado de boleta), lo guarda y aplica el
   * mapeo al estado de emisión. 409 si el documento aún no se envió; 502/503 si el SII falla.
   */
  @Post(':id/consultar-estado')
  @HttpCode(200)
  async consultarEstado(
    @Param('id', new ParseUUIDPipe()) id: string,
    @PrincipalActual() principal: Principal,
  ) {
    const r = await this.estados.consultarEstadoDocumento(id, principal);
    return {
      documento: aRespuestaDocumento(r.documento, r.rutEmpresa),
      estadoSii: r.estadoSii,
      glosaSii: r.glosaSii,
      esFinal: r.esFinal,
      descripcionEstado: r.descripcionEstado,
      ...(r.advertencia ? { advertencia: r.advertencia } : {}),
    };
  }

  @Get(':id/xml')
  async xml(
    @Param('id', new ParseUUIDPipe()) id: string,
    @PrincipalActual() principal: Principal,
  ) {
    const { buffer, nombre } = await this.servicio.xml(id, principal);
    return new StreamableFile(buffer, {
      type: 'application/xml; charset=ISO-8859-1',
      disposition: `inline; filename="${nombre}"`,
    });
  }

  @Get(':id/pdf')
  async pdf(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query({ schema: pdfQuerySchema }) query: PdfQuery,
    @PrincipalActual() principal: Principal,
  ) {
    const { buffer, nombre } = await this.servicio.pdf(id, query, principal);
    return new StreamableFile(buffer, {
      type: 'application/pdf',
      disposition: `inline; filename="${nombre}"`,
    });
  }
}
