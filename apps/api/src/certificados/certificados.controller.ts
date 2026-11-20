import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import Joi from 'joi';
import { PERMISOS, RequierePermisos } from '../auth/index.js';
import { type ArchivoSubido, LIMITE_ARCHIVO_BYTES } from '../comun/archivo.js';
import { rutSchema } from '../comun/joi.js';
import { ProblemaHttp } from '../comun/problema.js';
import {
  aRespuestaCertificado,
  CertificadosService,
} from './certificados.service.js';

interface CargarCertificadoDto {
  password: string;
  rutFirmante?: string;
}

const cargarCertificadoSchema = Joi.object<CargarCertificadoDto>({
  password: Joi.string().min(1).max(200).required(),
  rutFirmante: rutSchema,
});

@Controller('empresas/:rut/certificados')
@RequierePermisos(PERMISOS.CERTIFICADOS_GESTIONAR)
export class CertificadosController {
  constructor(private readonly servicio: CertificadosService) {}

  /** Multipart: `archivo` (PFX) y `password`. Nunca devuelve el PFX ni la contraseña. */
  @Post()
  @UseInterceptors(
    FileInterceptor('archivo', { limits: { fileSize: LIMITE_ARCHIVO_BYTES } }),
  )
  async cargar(
    @Param('rut') rut: string,
    @Body({ schema: cargarCertificadoSchema }) dto: CargarCertificadoDto,
    @UploadedFile() archivo?: ArchivoSubido,
  ) {
    if (!archivo) {
      throw new ProblemaHttp(
        400,
        'VALIDACION',
        'Falta el archivo',
        'Envíe el PFX en el campo multipart "archivo"',
      );
    }
    const cert = await this.servicio.cargar(
      rut,
      archivo.buffer,
      dto.password,
      dto.rutFirmante,
    );
    return aRespuestaCertificado(cert);
  }

  @Get()
  async listar(@Param('rut') rut: string) {
    return {
      datos: (await this.servicio.listar(rut)).map(aRespuestaCertificado),
    };
  }

  @Delete(':id')
  @HttpCode(204)
  async desactivar(
    @Param('rut') rut: string,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.servicio.desactivar(rut, id);
  }
}
