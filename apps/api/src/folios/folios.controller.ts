import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import Joi from 'joi';
import { PERMISOS, RequierePermisos } from '../auth/index.js';
import { type ArchivoSubido, LIMITE_ARCHIVO_BYTES } from '../comun/archivo.js';
import { ProblemaHttp } from '../comun/problema.js';
import {
  cafVigente,
  claveCafCoincide,
  parsearCaf,
  TIPOS_DTE,
} from '../dte-core/index.js';
import { EmpresasService } from '../empresas/empresas.service.js';
import { CafInvalidoError } from './folios.errors.js';
import { FoliosService, calcularVencimientoCaf } from './folios.service.js';

interface CargarCafDto {
  xml?: string;
}
const cargarCafSchema = Joi.object<CargarCafDto>({
  xml: Joi.string().max(LIMITE_ARCHIVO_BYTES),
});

interface FoliosQuery {
  tipoDte?: number;
}
const foliosQuerySchema = Joi.object<FoliosQuery>({
  tipoDte: Joi.number().valid(...TIPOS_DTE),
});

@Controller('empresas/:rut')
export class FoliosController {
  constructor(
    private readonly folios: FoliosService,
    private readonly empresas: EmpresasService,
  ) {}

  /**
   * Sube el XML del CAF (multipart `archivo` o JSON `{ "xml": "..." }`): lo parsea, verifica que la
   * clave privada corresponde a la pública, que el RUT es el de la empresa y lo registra cifrado.
   */
  @Post('cafs')
  @RequierePermisos(PERMISOS.CAFS_GESTIONAR)
  @UseInterceptors(
    FileInterceptor('archivo', { limits: { fileSize: LIMITE_ARCHIVO_BYTES } }),
  )
  async cargarCaf(
    @Param('rut') rut: string,
    @Body({ schema: cargarCafSchema }) dto: CargarCafDto,
    @UploadedFile() archivo?: ArchivoSubido,
  ) {
    const xml = archivo ? archivo.buffer.toString('utf8') : dto.xml;
    if (!xml) {
      throw new ProblemaHttp(
        400,
        'VALIDACION',
        'Falta el CAF',
        'Envíe el archivo en el campo multipart "archivo" o { "xml": "..." }',
      );
    }
    const empresa = await this.empresas.obtenerPorRut(rut);

    let caf: ReturnType<typeof parsearCaf>;
    try {
      caf = parsearCaf(xml);
    } catch (e) {
      throw new CafInvalidoError((e as Error).message);
    }
    if (!(TIPOS_DTE as readonly number[]).includes(caf.tipoDte)) {
      throw new CafInvalidoError(`Tipo de DTE no soportado: ${caf.tipoDte}`);
    }
    if (!claveCafCoincide(caf)) {
      throw new CafInvalidoError(
        'La clave privada del CAF (RSASK) no corresponde a su clave pública (RSAPUBK)',
      );
    }
    const vencimiento = calcularVencimientoCaf(
      caf.tipoDte,
      caf.fechaAutorizacion,
    );
    if (vencimiento !== null && !cafVigente(caf)) {
      throw new CafInvalidoError(`El CAF venció el ${vencimiento}`);
    }

    const guardado = await this.folios.registrarCaf(empresa.id, {
      tipoDte: caf.tipoDte,
      folioDesde: caf.folioDesde,
      folioHasta: caf.folioHasta,
      fechaAutorizacion: caf.fechaAutorizacion,
      xml,
      rutEmisor: caf.rutEmisor,
    });
    return {
      cafId: guardado.id,
      tipoDte: guardado.tipoDte,
      folioDesde: guardado.folioDesde,
      folioHasta: guardado.folioHasta,
      folioSiguiente: guardado.folioSiguiente,
      disponibles: guardado.folioHasta - guardado.folioSiguiente + 1,
      fechaAutorizacion: guardado.fechaAutorizacion,
      fechaVencimiento: guardado.fechaVencimiento,
    };
  }

  @Get('folios')
  @RequierePermisos(PERMISOS.FOLIOS_LEER)
  async folios_(
    @Param('rut') rut: string,
    @Query({ schema: foliosQuerySchema }) query: FoliosQuery,
  ) {
    const empresa = await this.empresas.obtenerPorRut(rut);
    return {
      datos: await this.folios.foliosDisponibles(empresa.id, query.tipoDte),
    };
  }
}
