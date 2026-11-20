import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { PERMISOS, PrincipalActual, RequierePermisos, type Principal } from '../auth/index.js';
import { type CrearEnvioDto, crearEnvioSchema } from './envios.dto.js';
import { EnviosService } from './envios.service.js';

@Controller()
export class EnviosController {
  constructor(private readonly servicio: EnviosService) {}

  /** Envía al SII (los boletas se agrupan en sobres de 50). Responde con la lista de envíos creados. */
  @Post('empresas/:rut/envios')
  @RequierePermisos(PERMISOS.ENVIOS_CREAR)
  async crear(
    @Param('rut') rut: string,
    @Body({ schema: crearEnvioSchema }) dto: CrearEnvioDto,
  ) {
    return { envios: await this.servicio.crear(rut, dto) };
  }

  @Get('empresas/:rut/envios')
  @RequierePermisos(PERMISOS.ENVIOS_LEER)
  async listar(@Param('rut') rut: string) {
    return { datos: await this.servicio.listar(rut) };
  }

  /** Por id (UUID) o por track id. */
  @Get('envios/:id')
  @RequierePermisos(PERMISOS.ENVIOS_LEER)
  obtener(@Param('id') id: string, @PrincipalActual() principal: Principal) {
    return this.servicio.obtener(id, principal);
  }

  /** Consulta el estado al SII y actualiza el envío y sus documentos. */
  @Post('envios/:id/consultar')
  @HttpCode(200)
  @RequierePermisos(PERMISOS.ENVIOS_LEER)
  consultar(@Param('id') id: string, @PrincipalActual() principal: Principal) {
    return this.servicio.consultar(id, principal);
  }
}
