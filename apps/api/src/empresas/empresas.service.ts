import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { type DeepPartial, QueryFailedError, Repository } from 'typeorm';
import { Certificado } from '../certificados/entities/certificado.entity.js';
import { noEncontrado, ProblemaHttp } from '../comun/problema.js';
import { separarRut } from '../dte-core/index.js';
import type { ActualizarEmpresaDto, CrearEmpresaDto } from './empresas.dto.js';
import { Empresa } from './entities/empresa.entity.js';

export interface EmpresaRespuesta {
  id: string;
  rut: string;
  razonSocial: string;
  giro: string;
  actecos: number[];
  direccion: string;
  comuna: string;
  ciudad: string;
  codigoSucursalSii: string | null;
  telefono: string | null;
  correoIntercambio: string | null;
  nroResolucionSii: number | null;
  fechaResolucionSii: string | null;
  ambienteSii: string;
  proveedorSoftware: { rut: string } | null;
  activa: boolean;
  creadoEn: Date;
}

export function aRespuestaEmpresa(e: Empresa): EmpresaRespuesta {
  return {
    id: e.id,
    rut: `${e.rut}-${e.dv}`,
    razonSocial: e.razonSocial,
    giro: e.giro,
    actecos: e.actecos,
    direccion: e.direccion,
    comuna: e.comuna,
    ciudad: e.ciudad,
    codigoSucursalSii: e.codigoSucursalSii,
    telefono: e.telefono,
    correoIntercambio: e.correoIntercambio,
    nroResolucionSii: e.nroResolucionSii,
    fechaResolucionSii: e.fechaResolucionSii,
    ambienteSii: e.ambienteSii,
    proveedorSoftware:
      e.rutProveedorSoftware !== null
        ? { rut: `${e.rutProveedorSoftware}-${e.dvProveedorSoftware}` }
        : null,
    activa: e.activa,
    creadoEn: e.creadoEn,
  };
}

function partirRut(rut: string): { numero: number; dv: string } {
  const r = separarRut(rut);
  if (!r) {
    throw new ProblemaHttp(
      400,
      'VALIDACION',
      'RUT inválido',
      `RUT inválido: ${rut}`,
    );
  }
  return { numero: Number(r.numero), dv: r.dv };
}

/** Error 23505 de Postgres (violación de unicidad). */
export function esViolacionUnica(e: unknown): boolean {
  return (
    e instanceof QueryFailedError &&
    (e as QueryFailedError & { driverError?: { code?: string } }).driverError
      ?.code === '23505'
  );
}

@Injectable()
export class EmpresasService {
  constructor(
    @InjectRepository(Empresa) private readonly empresas: Repository<Empresa>,
    @InjectRepository(Certificado)
    private readonly certificados: Repository<Certificado>,
  ) {}

  /** Empresa por RUT (`76086428-5`); 404 si no existe. */
  async obtenerPorRut(rut: string): Promise<Empresa> {
    const { numero, dv } = partirRut(rut);
    const empresa = await this.empresas.findOne({ where: { rut: numero } });
    if (!empresa || empresa.dv !== dv) throw noEncontrado('La empresa', rut);
    return empresa;
  }

  async obtenerPorId(id: string): Promise<Empresa> {
    const empresa = await this.empresas.findOne({ where: { id } });
    if (!empresa) throw noEncontrado('La empresa', id);
    return empresa;
  }

  async crear(dto: CrearEmpresaDto): Promise<Empresa> {
    const { numero, dv } = partirRut(dto.rut);
    const datos: DeepPartial<Empresa> = {
      rut: numero,
      dv,
      razonSocial: dto.razonSocial,
      giro: dto.giro,
      actecos: dto.actecos,
      direccion: dto.direccion,
      comuna: dto.comuna,
      ciudad: dto.ciudad,
      codigoSucursalSii: dto.codigoSucursalSii ?? null,
      telefono: dto.telefono ?? null,
      correoIntercambio: dto.correoIntercambio ?? null,
      nroResolucionSii: dto.nroResolucionSii ?? null,
      fechaResolucionSii: dto.fechaResolucionSii ?? null,
      ambienteSii: dto.ambienteSii ?? 'certificacion',
      rutProveedorSoftware: null,
      dvProveedorSoftware: null,
      activa: true,
    };
    if (dto.proveedorSoftware) {
      const p = partirRut(dto.proveedorSoftware.rut);
      datos.rutProveedorSoftware = p.numero;
      datos.dvProveedorSoftware = p.dv;
    }
    try {
      return await this.empresas.save(this.empresas.create(datos));
    } catch (e) {
      if (esViolacionUnica(e)) {
        throw new ProblemaHttp(
          409,
          'EMPRESA_EXISTENTE',
          'Empresa existente',
          `Ya existe una empresa con RUT ${dto.rut}`,
        );
      }
      throw e;
    }
  }

  async actualizar(rut: string, dto: ActualizarEmpresaDto): Promise<Empresa> {
    const empresa = await this.obtenerPorRut(rut);
    if (
      dto.ambienteSii === 'produccion' &&
      empresa.ambienteSii !== 'produccion'
    ) {
      const activos = await this.certificados.count({
        where: { empresaId: empresa.id, activo: true },
      });
      if (activos === 0) {
        throw new ProblemaHttp(
          422,
          'CERTIFICADO_INVALIDO',
          'Sin certificado',
          'Pasar a producción exige un certificado activo',
        );
      }
    }
    const { proveedorSoftware, ...resto } = dto;
    Object.assign(empresa, resto);
    if (proveedorSoftware !== undefined) {
      if (proveedorSoftware === null) {
        empresa.rutProveedorSoftware = null;
        empresa.dvProveedorSoftware = null;
      } else {
        const p = partirRut(proveedorSoftware.rut);
        empresa.rutProveedorSoftware = p.numero;
        empresa.dvProveedorSoftware = p.dv;
      }
    }
    return this.empresas.save(empresa);
  }
}
