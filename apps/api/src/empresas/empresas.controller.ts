import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import {
  type ActualizarEmpresaDto,
  actualizarEmpresaSchema,
  type CrearEmpresaDto,
  crearEmpresaSchema,
} from './empresas.dto.js';
import { aRespuestaEmpresa, EmpresasService } from './empresas.service.js';

@Controller('empresas')
export class EmpresasController {
  constructor(private readonly servicio: EmpresasService) {}

  @Post()
  async crear(@Body({ schema: crearEmpresaSchema }) dto: CrearEmpresaDto) {
    return aRespuestaEmpresa(await this.servicio.crear(dto));
  }

  @Get(':rut')
  async obtener(@Param('rut') rut: string) {
    return aRespuestaEmpresa(await this.servicio.obtenerPorRut(rut));
  }

  @Patch(':rut')
  async actualizar(
    @Param('rut') rut: string,
    @Body({ schema: actualizarEmpresaSchema }) dto: ActualizarEmpresaDto,
  ) {
    return aRespuestaEmpresa(await this.servicio.actualizar(rut, dto));
  }
}
