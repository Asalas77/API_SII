import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { type ArchivoSubido, LIMITE_ARCHIVO_BYTES } from '../comun/archivo.js';
import { ProblemaHttp } from '../comun/problema.js';
import { PERMISOS, PrincipalActual, RequierePermisos, type Principal } from '../auth/index.js';
import { ApiKeysService } from '../auth/api-keys.service.js';
import {
  type ActualizarEmpresaDto,
  actualizarEmpresaSchema,
  type CrearEmpresaDto,
  crearEmpresaSchema,
} from './empresas.dto.js';
import { aRespuestaEmpresa, EmpresasService } from './empresas.service.js';

@Controller('empresas')
export class EmpresasController {
  constructor(
    private readonly servicio: EmpresasService,
    private readonly apiKeys: ApiKeysService,
  ) {}

  /** Una API key acotada a ciertas empresas recibe acceso a la que crea. */
  @Post()
  @RequierePermisos(PERMISOS.EMPRESAS_CREAR)
  async crear(
    @Body({ schema: crearEmpresaSchema }) dto: CrearEmpresaDto,
    @PrincipalActual() principal: Principal,
  ) {
    const empresa = await this.servicio.crear(dto);
    if (principal.tipo === 'api_key' && !principal.todasLasEmpresas && principal.apiKeyId) {
      await this.apiKeys.agregarEmpresa(principal.apiKeyId, `${empresa.rut}-${empresa.dv}`);
    }
    return aRespuestaEmpresa(empresa);
  }

  @Get(':rut')
  @RequierePermisos(PERMISOS.EMPRESAS_LEER)
  async obtener(@Param('rut') rut: string) {
    return aRespuestaEmpresa(await this.servicio.obtenerPorRut(rut));
  }

  @Patch(':rut')
  @RequierePermisos(PERMISOS.EMPRESAS_EDITAR)
  async actualizar(
    @Param('rut') rut: string,
    @Body({ schema: actualizarEmpresaSchema }) dto: ActualizarEmpresaDto,
  ) {
    return aRespuestaEmpresa(await this.servicio.actualizar(rut, dto));
  }

  /** Multipart `archivo`: PNG o JPEG (verificado por firma), máx. 300 KB. */
  @Put(':rut/logo')
  @HttpCode(204)
  @RequierePermisos(PERMISOS.EMPRESAS_EDITAR)
  @UseInterceptors(FileInterceptor('archivo', { limits: { fileSize: LIMITE_ARCHIVO_BYTES } }))
  async subirLogo(@Param('rut') rut: string, @UploadedFile() archivo?: ArchivoSubido): Promise<void> {
    if (!archivo) {
      throw new ProblemaHttp(400, 'VALIDACION', 'Falta el archivo', 'Envíe la imagen en el campo multipart "archivo"');
    }
    await this.servicio.guardarLogo(rut, archivo.buffer);
  }

  @Get(':rut/logo')
  @RequierePermisos(PERMISOS.EMPRESAS_LEER)
  @Header('Cache-Control', 'private, no-cache')
  async obtenerLogo(@Param('rut') rut: string): Promise<StreamableFile> {
    const logo = await this.servicio.obtenerLogoPorRut(rut);
    return new StreamableFile(logo.buffer, { type: logo.tipo });
  }

  @Delete(':rut/logo')
  @HttpCode(204)
  @RequierePermisos(PERMISOS.EMPRESAS_EDITAR)
  async eliminarLogo(@Param('rut') rut: string): Promise<void> {
    await this.servicio.eliminarLogo(rut);
  }
}
