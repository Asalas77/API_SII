import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
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
}
