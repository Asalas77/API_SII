import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import Joi from 'joi';
import { PERMISOS, PrincipalActual, RequierePermisos, type Principal } from '../auth/index.js';
import { type ArchivoSubido, LIMITE_RECEPCION_BYTES } from '../comun/archivo.js';
import { ProblemaHttp } from '../comun/problema.js';
import { type PdfQuery, pdfQuerySchema } from '../documentos/documentos.dto.js';
import { BuzonService } from './correo/buzon.service.js';
import { SondeoBuzonService } from './correo/sondeo-buzon.service.js';
import {
  type AceptarDto,
  aceptarSchema,
  type ConfigurarBuzonDto,
  configurarBuzonSchema,
  type FiltroDteRecibidosQuery,
  filtroDteRecibidosSchema,
  type PaginacionQuery,
  paginacionSchema,
  type ReciboMercaderiasDto,
  reciboMercaderiasSchema,
  type RecepcionCamposDto,
  recepcionCamposSchema,
  type RechazarDto,
  rechazarSchema,
  type RegistrarSiiDto,
  registrarSiiSchema,
} from './recepcion.dto.js';
import { RecepcionService } from './recepcion.service.js';
import { RegistroSiiService } from './registro-sii.service.js';
import { RespuestasService } from './respuestas.service.js';

const XML_ISO = 'application/xml; charset=ISO-8859-1';

function descarga(r: { buffer: Buffer; nombre: string }): StreamableFile {
  return new StreamableFile(r.buffer, { type: XML_ISO, disposition: `inline; filename="${r.nombre}"` });
}

interface EnviarAcuseDto {
  destinatario?: string;
}
const enviarAcuseSchema = Joi.object<EnviarAcuseDto>({
  destinatario: Joi.string().trim().email({ tlds: { allow: false } }).max(254),
});

/** Rutas por empresa: ingreso, listados y configuración del buzón. */
@Controller('empresas/:rut')
export class EmpresaRecepcionController {
  constructor(
    private readonly recepcion: RecepcionService,
    private readonly buzon: BuzonService,
    private readonly sondeo: SondeoBuzonService,
  ) {}

  /**
   * Recibe un `EnvioDTE` de un proveedor (multipart, campo `archivo`, máx. 5 MB): lo analiza, lo guarda,
   * genera el acuse `RecepcionEnvio` firmado y responde con el resumen por DTE. 201 al registrarlo; 200 si
   * el mismo archivo ya se había recibido (no se duplica).
   */
  @Post('recepcion')
  @RequierePermisos(PERMISOS.RECEPCION_RECIBIR)
  @UseInterceptors(FileInterceptor('archivo', { limits: { fileSize: LIMITE_RECEPCION_BYTES } }))
  async recibir(
    @Param('rut') rut: string,
    @Body({ schema: recepcionCamposSchema }) campos: RecepcionCamposDto,
    @Res({ passthrough: true }) res: Response,
    @UploadedFile() archivo?: ArchivoSubido,
  ) {
    if (!archivo || archivo.size === 0) {
      throw new ProblemaHttp(400, 'VALIDACION', 'Falta el archivo', 'Envíe el EnvioDTE en el campo multipart "archivo"');
    }
    const r = await this.recepcion.recibir(rut, archivo.buffer, {
      origen: 'upload',
      remitente: campos?.remitente ?? null,
      nombreArchivo: archivo.originalname,
    });
    let correo: { enviado: boolean; destinatario: string | null; error: string | null } | undefined;
    if (campos?.enviarCorreo && !r.repetido && r.envio.enlaces.recepcionEnvio) {
      correo = { enviado: false, destinatario: campos.remitente ?? null, error: null };
      if (!campos.remitente) {
        correo.error = 'enviarCorreo requiere el campo `remitente` (correo del emisor)';
      } else {
        try {
          const empresa = await this.empresaDe(rut);
          await this.recepcion.enviarAcuse(empresa, r.envio.id, campos.remitente);
          correo.enviado = true;
        } catch (e) {
          correo.error = e instanceof ProblemaHttp ? e.detail : (e as Error).message;
        }
      }
    }
    if (r.repetido) res.status(200);
    return { ...r.envio, ...(correo ? { correo } : {}) };
  }

  @Get('dte-recibidos')
  @RequierePermisos(PERMISOS.RECEPCION_LEER)
  listarDtes(@Param('rut') rut: string, @Query({ schema: filtroDteRecibidosSchema }) q: FiltroDteRecibidosQuery) {
    return this.recepcion.listarDtes(rut, q);
  }

  @Get('envios-recibidos')
  @RequierePermisos(PERMISOS.RECEPCION_LEER)
  listarEnvios(@Param('rut') rut: string, @Query({ schema: paginacionSchema }) q: PaginacionQuery) {
    return this.recepcion.listarEnvios(rut, q);
  }

  /** Configuración del buzón de intercambio. La contraseña nunca se devuelve. */
  @Get('buzon-correo')
  @RequierePermisos(PERMISOS.RECEPCION_CONFIGURAR)
  obtenerBuzon(@Param('rut') rut: string) {
    return this.buzon.obtener(rut);
  }

  /** Crea o actualiza el buzón (la contraseña es obligatoria solo al crear). 201 al crear, 200 al actualizar. */
  @Put('buzon-correo')
  @RequierePermisos(PERMISOS.RECEPCION_CONFIGURAR)
  async guardarBuzon(
    @Param('rut') rut: string,
    @Body({ schema: configurarBuzonSchema }) dto: ConfigurarBuzonDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { buzon, creado } = await this.buzon.guardar(rut, dto);
    res.status(creado ? 201 : 200);
    return buzon;
  }

  @Delete('buzon-correo')
  @HttpCode(204)
  @RequierePermisos(PERMISOS.RECEPCION_CONFIGURAR)
  async eliminarBuzon(@Param('rut') rut: string): Promise<void> {
    await this.buzon.eliminar(rut);
  }

  /** Revisa ahora el buzón (además del sondeo automático, si está habilitado). */
  @Post('buzon-correo/sondear')
  @HttpCode(200)
  @RequierePermisos(PERMISOS.RECEPCION_RECIBIR)
  sondear(@Param('rut') rut: string) {
    return this.sondeo.sondearPorRut(rut);
  }

  private empresaDe(rut: string) {
    // La empresa ya fue resuelta (y autorizada) al recibir; se vuelve a leer por RUT para el envío del acuse.
    return this.recepcion.empresaPorRut(rut);
  }
}

/** Rutas por id de un envío recibido. */
@Controller('envios-recibidos')
export class EnviosRecibidosController {
  constructor(private readonly recepcion: RecepcionService) {}

  @Get(':id')
  @RequierePermisos(PERMISOS.RECEPCION_LEER)
  obtener(@Param('id', new ParseUUIDPipe()) id: string, @PrincipalActual() principal: Principal) {
    return this.recepcion.detalleEnvio(id, principal);
  }

  /** XML original del envío, byte a byte tal como llegó. */
  @Get(':id/xml')
  @RequierePermisos(PERMISOS.RECEPCION_LEER)
  async xml(@Param('id', new ParseUUIDPipe()) id: string, @PrincipalActual() principal: Principal) {
    return descarga(await this.recepcion.xmlEnvio(id, principal));
  }

  /** Acuse `RecepcionEnvio` generado (ISO-8859-1). */
  @Get(':id/recepcion-envio')
  @RequierePermisos(PERMISOS.RECEPCION_LEER)
  async recepcionEnvio(@Param('id', new ParseUUIDPipe()) id: string, @PrincipalActual() principal: Principal) {
    return descarga(await this.recepcion.xmlRecepcionEnvio(id, principal));
  }

  /** Envía por SMTP el acuse `RecepcionEnvio` (a `destinatario` o, por defecto, al remitente del envío). */
  @Post(':id/enviar-acuse')
  @HttpCode(200)
  @RequierePermisos(PERMISOS.RECEPCION_RESPONDER)
  async enviarAcuse(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body({ schema: enviarAcuseSchema }) dto: EnviarAcuseDto | undefined,
    @PrincipalActual() principal: Principal,
  ) {
    const { envio, empresa } = await this.recepcion.obtenerEnvio(id, principal);
    const destino = dto?.destinatario ?? envio.remitente;
    if (!destino) {
      throw new ProblemaHttp(422, 'SIN_DESTINATARIO', 'Sin destinatario', 'Indique `destinatario`: el envío no tiene remitente de correo');
    }
    await this.recepcion.enviarAcuse(empresa, id, destino);
    return this.recepcion.detalleEnvio(id, principal);
  }
}

/** Rutas por id de un DTE recibido: consulta, respuesta comercial y registro ante el SII. */
@Controller('dte-recibidos')
export class DteRecibidosController {
  constructor(
    private readonly recepcion: RecepcionService,
    private readonly respuestas: RespuestasService,
    private readonly registro: RegistroSiiService,
  ) {}

  @Get(':id')
  @RequierePermisos(PERMISOS.RECEPCION_LEER)
  obtener(@Param('id', new ParseUUIDPipe()) id: string, @PrincipalActual() principal: Principal) {
    return this.recepcion.detalleDte(id, principal);
  }

  @Get(':id/xml')
  @RequierePermisos(PERMISOS.RECEPCION_LEER)
  async xml(@Param('id', new ParseUUIDPipe()) id: string, @PrincipalActual() principal: Principal) {
    return descarga(await this.recepcion.xmlDte(id, principal));
  }

  @Get(':id/pdf')
  @RequierePermisos(PERMISOS.RECEPCION_LEER)
  async pdf(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query({ schema: pdfQuerySchema }) query: PdfQuery,
    @PrincipalActual() principal: Principal,
  ) {
    const { buffer, nombre } = await this.recepcion.pdfDte(id, query, principal);
    return new StreamableFile(buffer, { type: 'application/pdf', disposition: `inline; filename="${nombre}"` });
  }

  /** `ResultadoDTE` generado al aceptar o rechazar. */
  @Get(':id/resultado-dte')
  @RequierePermisos(PERMISOS.RECEPCION_LEER)
  async resultadoDte(@Param('id', new ParseUUIDPipe()) id: string, @PrincipalActual() principal: Principal) {
    return descarga(await this.respuestas.xmlResultado(id, principal));
  }

  /** `EnvioRecibos` (Ley 19.983) generado. */
  @Get(':id/envio-recibos')
  @RequierePermisos(PERMISOS.RECEPCION_LEER)
  async envioRecibos(@Param('id', new ParseUUIDPipe()) id: string, @PrincipalActual() principal: Principal) {
    return descarga(await this.respuestas.xmlRecibos(id, principal));
  }

  /** Acepta el DTE (con `reparos: true`, con discrepancias) y genera el `ResultadoDTE` firmado. */
  @Post(':id/aceptar')
  @HttpCode(200)
  @RequierePermisos(PERMISOS.RECEPCION_RESPONDER)
  aceptar(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body({ schema: aceptarSchema }) dto: AceptarDto | undefined,
    @PrincipalActual() principal: Principal,
  ) {
    return this.respuestas.aceptar(id, dto ?? {}, principal);
  }

  /** Rechaza el DTE (`glosa` obligatoria) y genera el `ResultadoDTE` firmado. */
  @Post(':id/rechazar')
  @HttpCode(200)
  @RequierePermisos(PERMISOS.RECEPCION_RESPONDER)
  rechazar(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body({ schema: rechazarSchema }) dto: RechazarDto,
    @PrincipalActual() principal: Principal,
  ) {
    return this.respuestas.rechazar(id, dto, principal);
  }

  /** Genera el `EnvioRecibos` con la declaración de la Ley 19.983. */
  @Post(':id/recibo-mercaderias')
  @HttpCode(200)
  @RequierePermisos(PERMISOS.RECEPCION_RESPONDER)
  reciboMercaderias(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body({ schema: reciboMercaderiasSchema }) dto: ReciboMercaderiasDto,
    @PrincipalActual() principal: Principal,
  ) {
    return this.respuestas.reciboMercaderias(id, dto, principal);
  }

  /** Registra ACD, RCD, ERM, RFP o RFT en el SII (web service RegistroReclamoDTE). */
  @Post(':id/registrar-sii')
  @HttpCode(200)
  @RequierePermisos(PERMISOS.RECEPCION_RESPONDER)
  registrarSii(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body({ schema: registrarSiiSchema }) dto: RegistrarSiiDto,
    @PrincipalActual() principal: Principal,
  ) {
    return this.registro.registrar(id, dto.accion, principal);
  }

  /** Consulta eventos, fecha de recepción y cedibilidad en el SII; con la fecha real recalcula el plazo. */
  @Post(':id/consultar-sii')
  @HttpCode(200)
  @RequierePermisos(PERMISOS.RECEPCION_LEER)
  consultarSii(@Param('id', new ParseUUIDPipe()) id: string, @PrincipalActual() principal: Principal) {
    return this.registro.consultar(id, principal);
  }
}
