import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { type CrearEnvioDto, crearEnvioSchema } from './envios.dto.js';
import { EnviosService } from './envios.service.js';

@Controller()
export class EnviosController {
  constructor(private readonly servicio: EnviosService) {}

  /** Envía al SII (los boletas se agrupan en sobres de 50). Responde con la lista de envíos creados. */
  @Post('empresas/:rut/envios')
  async crear(
    @Param('rut') rut: string,
    @Body({ schema: crearEnvioSchema }) dto: CrearEnvioDto,
  ) {
    return { envios: await this.servicio.crear(rut, dto) };
  }

  @Get('empresas/:rut/envios')
  async listar(@Param('rut') rut: string) {
    return { datos: await this.servicio.listar(rut) };
  }

  /** Por id (UUID) o por track id. */
  @Get('envios/:id')
  obtener(@Param('id') id: string) {
    return this.servicio.obtener(id);
  }

  /** Consulta el estado al SII y actualiza el envío y sus documentos. */
  @Post('envios/:id/consultar')
  @HttpCode(200)
  consultar(@Param('id') id: string) {
    return this.servicio.consultar(id);
  }
}
