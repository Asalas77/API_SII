import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { PERMISOS, PrincipalActual, RequierePermisos, type Principal } from '../auth/index.js';
import {
  type FiltroLibrosQuery,
  filtroLibrosSchema,
  type GenerarLibroComprasDto,
  generarLibroComprasSchema,
  type GenerarLibroGuiasDto,
  generarLibroGuiasSchema,
  type GenerarLibroVentasDto,
  generarLibroVentasSchema,
} from './libros.dto.js';
import { LibrosService } from './libros.service.js';

@Controller('empresas/:rut/libros')
export class EmpresaLibrosController {
  constructor(private readonly servicio: LibrosService) {}

  /** Genera el libro de ventas del período desde los documentos emitidos (y lo envía si `enviar`). */
  @Post('ventas')
  @RequierePermisos(PERMISOS.LIBROS_GENERAR)
  ventas(@Param('rut') rut: string, @Body({ schema: generarLibroVentasSchema }) dto: GenerarLibroVentasDto) {
    return this.servicio.generarVentas(rut, dto);
  }

  /** Genera el libro de compras desde el JSON de documentos recibidos. */
  @Post('compras')
  @RequierePermisos(PERMISOS.LIBROS_GENERAR)
  compras(@Param('rut') rut: string, @Body({ schema: generarLibroComprasSchema }) dto: GenerarLibroComprasDto) {
    return this.servicio.generarCompras(rut, dto);
  }

  /** Genera el libro de guías de despacho del período desde las guías (tipo 52) emitidas. */
  @Post('guias')
  @RequierePermisos(PERMISOS.LIBROS_GENERAR)
  guias(@Param('rut') rut: string, @Body({ schema: generarLibroGuiasSchema }) dto: GenerarLibroGuiasDto) {
    return this.servicio.generarGuias(rut, dto);
  }

  @Get()
  @RequierePermisos(PERMISOS.LIBROS_LEER)
  async listar(@Param('rut') rut: string, @Query({ schema: filtroLibrosSchema }) q: FiltroLibrosQuery) {
    return { datos: await this.servicio.listar(rut, q.periodo) };
  }
}

@Controller('libros')
export class LibrosController {
  constructor(private readonly servicio: LibrosService) {}

  @Get(':id')
  @RequierePermisos(PERMISOS.LIBROS_LEER)
  obtener(@Param('id', new ParseUUIDPipe()) id: string, @PrincipalActual() principal: Principal) {
    return this.servicio.detalle(id, principal);
  }

  @Get(':id/xml')
  @RequierePermisos(PERMISOS.LIBROS_LEER)
  async xml(@Param('id', new ParseUUIDPipe()) id: string, @PrincipalActual() principal: Principal) {
    const { buffer, nombre } = await this.servicio.xml(id, principal);
    return new StreamableFile(buffer, {
      type: 'application/xml; charset=ISO-8859-1',
      disposition: `inline; filename="${nombre}"`,
    });
  }

  /** Sube el libro al SII; solo si nunca se envió o el último intento falló. */
  @Post(':id/enviar')
  @HttpCode(200)
  @RequierePermisos(PERMISOS.LIBROS_GENERAR)
  enviar(@Param('id', new ParseUUIDPipe()) id: string, @PrincipalActual() principal: Principal) {
    return this.servicio.enviar(id, principal);
  }

  /** Consulta el estado del envío al SII y lo guarda. */
  @Post(':id/consultar')
  @HttpCode(200)
  @RequierePermisos(PERMISOS.LIBROS_LEER)
  consultar(@Param('id', new ParseUUIDPipe()) id: string, @PrincipalActual() principal: Principal) {
    return this.servicio.consultar(id, principal);
  }
}
