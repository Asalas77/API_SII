import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import { ProblemaHttp } from '../comun/problema.js';
import {
  type EmitirDocumentoDto,
  emitirDocumentoSchema,
  type PdfQuery,
  pdfQuerySchema,
} from './documentos.dto.js';
import { aRespuestaDocumento, DocumentosService } from './documentos.service.js';

@Controller('empresas/:rut/documentos')
export class EmpresaDocumentosController {
  constructor(private readonly servicio: DocumentosService) {}

  /**
   * Emite un documento (folio + TED + firma en una transacción). 201 al crear; 200 con
   * `Idempotent-Replayed: true` si la `Idempotency-Key` ya existía con el mismo cuerpo.
   */
  @Post()
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
export class DocumentosController {
  constructor(private readonly servicio: DocumentosService) {}

  @Get(':id')
  async obtener(@Param('id', new ParseUUIDPipe()) id: string) {
    const { documento, empresa } = await this.servicio.obtener(id);
    return aRespuestaDocumento(documento, `${empresa.rut}-${empresa.dv}`);
  }

  @Get(':id/xml')
  async xml(@Param('id', new ParseUUIDPipe()) id: string) {
    const { buffer, nombre } = await this.servicio.xml(id);
    return new StreamableFile(buffer, {
      type: 'application/xml; charset=ISO-8859-1',
      disposition: `inline; filename="${nombre}"`,
    });
  }

  @Get(':id/pdf')
  async pdf(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query({ schema: pdfQuerySchema }) query: PdfQuery,
  ) {
    const { buffer, nombre } = await this.servicio.pdf(id, query);
    return new StreamableFile(buffer, {
      type: 'application/pdf',
      disposition: `inline; filename="${nombre}"`,
    });
  }
}
