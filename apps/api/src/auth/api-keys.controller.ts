import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { siiConfig } from '../config/index.js';
import {
  ApiKeysService,
  aRespuestaApiKey,
  type CrearApiKeyDatos,
} from './api-keys.service.js';
import { type CrearApiKeyDto, crearApiKeySchema } from './api-keys.dto.js';
import { PrincipalActual, RequierePermisos } from './decoradores.js';
import { PERMISOS, type Permiso } from './permisos.js';
import type { Principal } from './principal.js';

@Controller('api-keys')
@RequierePermisos(PERMISOS.API_KEYS_GESTIONAR)
export class ApiKeysController {
  constructor(
    private readonly servicio: ApiKeysService,
    @Inject(siiConfig.KEY) private readonly sii: ConfigType<typeof siiConfig>,
  ) {}

  /** Devuelve la clave completa UNA sola vez (campo `clave`). */
  @Post()
  async crear(
    @Body({ schema: crearApiKeySchema }) dto: CrearApiKeyDto,
    @PrincipalActual() principal: Principal,
  ) {
    const datos: CrearApiKeyDatos = {
      nombre: dto.nombre,
      permisos: dto.permisos as Permiso[],
      empresas: dto.empresas ?? [],
      todasLasEmpresas: dto.todasLasEmpresas === true,
      expiraEn: dto.expiraEn ?? null,
    };
    const { apiKey, clave } = await this.servicio.crear(
      datos,
      principal,
      this.sii.ambiente === 'produccion' ? 'live' : 'test',
    );
    return { ...aRespuestaApiKey(apiKey), clave };
  }

  @Get()
  async listar(@PrincipalActual() principal: Principal) {
    return { datos: (await this.servicio.listar(principal)).map(aRespuestaApiKey) };
  }

  @Delete(':id')
  @HttpCode(204)
  async revocar(
    @Param('id', new ParseUUIDPipe()) id: string,
    @PrincipalActual() principal: Principal,
  ): Promise<void> {
    await this.servicio.revocar(id, principal);
  }
}
