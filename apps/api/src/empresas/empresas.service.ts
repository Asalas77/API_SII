import { Injectable } from '@nestjs/common';
import { type AccesoEmpresas, normalizarRut } from '../auth/principal.js';
import { type DeepPartial, In, QueryFailedError } from 'typeorm';
import { Certificado } from '../certificados/entities/certificado.entity.js';
import { noEncontrado, ProblemaHttp } from '../comun/problema.js';
import { EjecutorEmpresa } from '../database/ejecutor-empresa.js';
import { separarRut } from '../dte-core/index.js';
import type { ActualizarEmpresaDto, CrearEmpresaDto } from './empresas.dto.js';
import { Empresa } from './entities/empresa.entity.js';
import { detectarImagen, LIMITE_LOGO_BYTES, normalizarUnidadSii, type TipoImagen } from './opciones-pdf.js';

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
  unidadSii: string | null;
  urlVerificacion: string | null;
  tieneLogo: boolean;
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
    unidadSii: e.unidadSii,
    urlVerificacion: e.urlVerificacion,
    tieneLogo: e.logoTipo !== null,
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
  constructor(private readonly ejecutor: EjecutorEmpresa) {}

  /** Empresa por RUT (`76086428-5`); 404 si no existe. */
  async obtenerPorRut(rut: string): Promise<Empresa> {
    const { numero, dv } = partirRut(rut);
    const empresa = await this.ejecutor.ejecutar((em) =>
      em.getRepository(Empresa).findOne({ where: { rut: numero } }),
    );
    if (!empresa || empresa.dv !== dv) throw noEncontrado('La empresa', rut);
    return empresa;
  }

  /**
   * Ids de las empresas a las que da acceso `acceso`; `null` si son todas (sin filtro). Sirve para
   * acotar consultas de recursos que solo conocen `empresa_id`.
   */
  async idsPermitidos(acceso: AccesoEmpresas): Promise<string[] | null> {
    if (acceso.todasLasEmpresas) return null;
    const permitidos = new Set(acceso.empresas);
    const numeros = [...permitidos]
      .map((r) => Number.parseInt(r, 10))
      .filter((n) => Number.isFinite(n));
    if (numeros.length === 0) return [];
    const filas = await this.ejecutor.ejecutar((em) =>
      em.getRepository(Empresa).find({ where: { rut: In(numeros) } }),
    );
    return filas
      .filter((e) => permitidos.has(normalizarRut(`${e.rut}-${e.dv}`) ?? ''))
      .map((e) => e.id);
  }

  async obtenerPorId(id: string): Promise<Empresa> {
    const empresa = await this.ejecutor.ejecutar((em) =>
      em.getRepository(Empresa).findOne({ where: { id } }),
    );
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
      unidadSii: normalizarUnidadSii(dto.unidadSii),
      urlVerificacion: dto.urlVerificacion ?? null,
      activa: true,
    };
    if (dto.proveedorSoftware) {
      const p = partirRut(dto.proveedorSoftware.rut);
      datos.rutProveedorSoftware = p.numero;
      datos.dvProveedorSoftware = p.dv;
    }
    try {
      // La empresa nueva aún no está en el alcance de una key acotada: se amplía el contexto con su
      // RUT solo para este INSERT (WITH CHECK de RLS); luego el controlador se la agrega a la key.
      return await this.ejecutor.ejecutar(
        (em) => {
          const repo = em.getRepository(Empresa);
          return repo.save(repo.create(datos));
        },
        { ampliarRuts: [`${numero}-${dv}`] },
      );
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
      const activos = await this.ejecutor.ejecutar((em) =>
        em.getRepository(Certificado).count({
          where: { empresaId: empresa.id, activo: true },
        }),
      );
      if (activos === 0) {
        throw new ProblemaHttp(
          422,
          'CERTIFICADO_INVALIDO',
          'Sin certificado',
          'Pasar a producción exige un certificado activo',
        );
      }
    }
    const { proveedorSoftware, unidadSii, ...resto } = dto;
    Object.assign(empresa, resto);
    if (unidadSii !== undefined) empresa.unidadSii = normalizarUnidadSii(unidadSii);
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
    return this.ejecutor.ejecutar((em) => em.getRepository(Empresa).save(empresa));
  }

  /** Logo de la empresa (columna `select: false`, por eso se pide aparte); `null` si no tiene. */
  async obtenerLogo(empresaId: string): Promise<{ buffer: Buffer; tipo: TipoImagen } | null> {
    const e = await this.ejecutor.ejecutar((em) =>
      em
        .getRepository(Empresa)
        .createQueryBuilder('e')
        .addSelect('e.logo')
        .where('e.id = :empresaId', { empresaId })
        .getOne(),
    );
    if (!e?.logo || !e.logoTipo) return null;
    return { buffer: e.logo, tipo: e.logoTipo as TipoImagen };
  }

  async obtenerLogoPorRut(rut: string): Promise<{ buffer: Buffer; tipo: TipoImagen }> {
    const empresa = await this.obtenerPorRut(rut);
    const logo = await this.obtenerLogo(empresa.id);
    if (!logo) throw new ProblemaHttp(404, 'NO_ENCONTRADO', 'No encontrado', `La empresa ${rut} no tiene logo`);
    return logo;
  }

  /** Guarda el logo tras verificar su firma de bytes (PNG o JPEG) y su tamaño. */
  async guardarLogo(rut: string, buffer: Buffer): Promise<void> {
    if (buffer.length === 0) {
      throw new ProblemaHttp(400, 'VALIDACION', 'Logo inválido', 'El archivo está vacío');
    }
    if (buffer.length > LIMITE_LOGO_BYTES) {
      throw new ProblemaHttp(
        400,
        'VALIDACION',
        'Logo demasiado grande',
        `El logo pesa ${buffer.length} bytes; el máximo es ${LIMITE_LOGO_BYTES} (300 KB)`,
      );
    }
    const tipo = detectarImagen(buffer);
    if (!tipo) {
      throw new ProblemaHttp(
        400,
        'VALIDACION',
        'Logo inválido',
        'El archivo no es una imagen PNG ni JPEG (se verifica por contenido, no por extensión)',
      );
    }
    const empresa = await this.obtenerPorRut(rut);
    await this.ejecutor.ejecutar((em) =>
      em.getRepository(Empresa).update({ id: empresa.id }, { logo: buffer, logoTipo: tipo }),
    );
  }

  async eliminarLogo(rut: string): Promise<void> {
    const empresa = await this.obtenerPorRut(rut);
    await this.ejecutor.ejecutar((em) =>
      em.getRepository(Empresa).update({ id: empresa.id }, { logo: null, logoTipo: null }),
    );
  }
}
