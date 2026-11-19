import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { noEncontrado, ProblemaHttp } from '../comun/problema.js';
import { cargarPfx, separarRut } from '../dte-core/index.js';
import { EmpresasService } from '../empresas/empresas.service.js';
import { CifradoService } from '../seguridad/cifrado.service.js';
import { Certificado } from './entities/certificado.entity.js';

/** Metadatos públicos de un certificado: jamás incluye el PFX ni la contraseña. */
export interface CertificadoRespuesta {
  id: string;
  rutFirmante: string;
  nombreFirmante: string;
  validoDesde: Date;
  validoHasta: Date;
  activo: boolean;
}

export function aRespuestaCertificado(c: Certificado): CertificadoRespuesta {
  return {
    id: c.id,
    rutFirmante: `${c.rutFirmante}-${c.dvFirmante}`,
    nombreFirmante: c.nombreFirmante,
    validoDesde: c.validoDesde,
    validoHasta: c.validoHasta,
    activo: c.activo,
  };
}

const invalido = (detail: string) =>
  new ProblemaHttp(422, 'CERTIFICADO_INVALIDO', 'Certificado inválido', detail);

@Injectable()
export class CertificadosService {
  constructor(
    @InjectRepository(Certificado)
    private readonly certificados: Repository<Certificado>,
    private readonly dataSource: DataSource,
    private readonly empresas: EmpresasService,
    private readonly cifrado: CifradoService,
  ) {}

  /**
   * Valida el PFX con `cargarPfx`, lo guarda cifrado (con su contraseña) y lo deja como el único
   * certificado activo de la empresa.
   * @param rutFirmante solo si el certificado no trae el RUT en el SAN.
   */
  async cargar(
    rutEmpresa: string,
    pfx: Buffer,
    password: string,
    rutFirmante?: string,
  ): Promise<Certificado> {
    const empresa = await this.empresas.obtenerPorRut(rutEmpresa);

    let abierto: ReturnType<typeof cargarPfx>;
    try {
      abierto = cargarPfx(pfx, password);
    } catch (e) {
      throw invalido((e as Error).message);
    }
    if (!abierto.vigente()) {
      throw invalido(
        `El certificado no está vigente (válido ${abierto.validoDesde.toISOString()} a ${abierto.validoHasta.toISOString()})`,
      );
    }
    const rut = separarRut(abierto.rutFirmante ?? rutFirmante ?? '');
    if (!rut) {
      throw invalido(
        'El certificado no trae el RUT del titular; indique el campo rutFirmante (12345678-5)',
      );
    }

    return this.dataSource.transaction(async (em) => {
      await em.update(
        Certificado,
        { empresaId: empresa.id, activo: true },
        { activo: false },
      );
      return em.save(
        em.create(Certificado, {
          empresaId: empresa.id,
          rutFirmante: Number(rut.numero),
          dvFirmante: rut.dv,
          nombreFirmante: (abierto.sujeto ?? '').slice(0, 100),
          pfxCifrado: this.cifrado.cifrar(pfx),
          passwordCifrada: this.cifrado.cifrar(Buffer.from(password, 'utf8')),
          validoDesde: abierto.validoDesde,
          validoHasta: abierto.validoHasta,
          activo: true,
        }),
      );
    });
  }

  async listar(rutEmpresa: string): Promise<Certificado[]> {
    const empresa = await this.empresas.obtenerPorRut(rutEmpresa);
    return this.certificados.find({
      where: { empresaId: empresa.id },
      order: { creadoEn: 'DESC' },
    });
  }

  /** Desactiva (no borra) un certificado de la empresa. */
  async desactivar(rutEmpresa: string, id: string): Promise<void> {
    const empresa = await this.empresas.obtenerPorRut(rutEmpresa);
    const r = await this.certificados.update(
      { id, empresaId: empresa.id },
      { activo: false },
    );
    if (!r.affected) throw noEncontrado('El certificado', id);
  }
}
