import { Inject, Injectable } from '@nestjs/common';
import { Certificado } from '../certificados/entities/certificado.entity.js';
import { ProblemaHttp } from '../comun/problema.js';
import { EjecutorEmpresa } from '../database/ejecutor-empresa.js';
import { cargarPfx, crearFirmadorSii } from '../dte-core/index.js';
import type { Empresa } from '../empresas/entities/empresa.entity.js';
import { CifradoService } from '../seguridad/cifrado.service.js';
import {
  BoletaApiClient,
  DteSiiClient,
  RegistroReclamoClient,
  type FetchImpl,
} from '../sii-gateway/index.js';
import type { AmbienteSii } from '../sii-gateway/index.js';
import { SII_FETCH } from './tokens.js';

/** Certificado activo de una empresa, ya descifrado (solo en memoria; nunca se persiste en claro). */
export interface CertificadoActivo {
  id: string;
  certificadoPem: string;
  clavePrivadaPem: string;
  /** Cuerpo numérico del RUT del firmante y su DV. */
  rutFirmante: number;
  dvFirmante: string;
}

export interface ClientesSii {
  boleta: BoletaApiClient;
  dte: DteSiiClient;
  /** Registro de aceptación/reclamo de DTE recibidos; comparte el token del cliente DTE. */
  reclamo: RegistroReclamoClient;
  certificado: CertificadoActivo;
}

/**
 * Fábrica de clientes del SII por empresa: descifra el certificado activo, crea el firmador real y
 * entrega `BoletaApiClient`/`DteSiiClient` del ambiente de la empresa (`empresas.ambiente_sii`)
 * con el RUT del firmante como usuario.
 */
@Injectable()
export class SiiClienteFactory {
  constructor(
    private readonly ejecutor: EjecutorEmpresa,
    private readonly cifrado: CifradoService,
    @Inject(SII_FETCH) private readonly fetchImpl: FetchImpl,
  ) {}

  /** Certificado activo (el más reciente) descifrado; 422 si la empresa no tiene uno vigente. */
  async certificadoActivo(empresaId: string): Promise<CertificadoActivo> {
    const cert = await this.ejecutor.ejecutar((em) =>
      em.getRepository(Certificado).findOne({
        where: { empresaId, activo: true },
        order: { creadoEn: 'DESC' },
      }),
    );
    if (!cert) {
      throw new ProblemaHttp(
        422,
        'CERTIFICADO_INVALIDO',
        'Sin certificado',
        'La empresa no tiene un certificado digital activo; cárguelo con POST /v1/empresas/{rut}/certificados',
      );
    }
    if (cert.validoHasta.getTime() < Date.now()) {
      throw new ProblemaHttp(
        422,
        'CERTIFICADO_INVALIDO',
        'Certificado vencido',
        `El certificado activo venció el ${cert.validoHasta.toISOString()}`,
      );
    }
    const pfx = this.cifrado.descifrar(cert.pfxCifrado);
    const password = this.cifrado
      .descifrar(cert.passwordCifrada)
      .toString('utf8');
    const abierto = cargarPfx(pfx, password);
    return {
      id: cert.id,
      certificadoPem: abierto.certificadoPem,
      clavePrivadaPem: abierto.clavePrivadaPem,
      rutFirmante: cert.rutFirmante,
      dvFirmante: cert.dvFirmante,
    };
  }

  /**
   * Clientes (boleta y DTE) listos para operar con el SII a nombre de la empresa. Por defecto usan
   * el ambiente de la empresa; `ambiente` permite consultar un envío hecho en otro ambiente.
   */
  async paraEmpresa(
    empresa: Empresa,
    ambiente: AmbienteSii = empresa.ambienteSii,
  ): Promise<ClientesSii> {
    const certificado = await this.certificadoActivo(empresa.id);
    const firmador = crearFirmadorSii(certificado);
    const comunes = {
      ambiente,
      rutEmpresa: empresa.rut,
      dvEmpresa: empresa.dv,
      rutUsuario: certificado.rutFirmante,
      dvUsuario: certificado.dvFirmante,
      firmador,
      fetchImpl: this.fetchImpl,
    };
    const dte = new DteSiiClient(comunes);
    return {
      boleta: new BoletaApiClient(comunes),
      dte,
      reclamo: new RegistroReclamoClient({ ambiente, tokens: dte, fetchImpl: this.fetchImpl }),
      certificado,
    };
  }
}
