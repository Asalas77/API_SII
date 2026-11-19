import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository, type EntityManager } from 'typeorm';
import { Documento } from '../documentos/entities/documento.entity.js';
import { noEncontrado, ProblemaHttp } from '../comun/problema.js';
import {
  BOLETAS_POR_SOBRE_RECOMENDADO,
  construirEnvioBoleta,
  construirEnvioDte,
  MAX_BOLETAS_POR_SOBRE,
  MAX_DTE_POR_SOBRE,
  type EnvioConstruido,
  type TipoDte,
} from '../dte-core/index.js';
import type { Empresa } from '../empresas/entities/empresa.entity.js';
import { EmpresasService } from '../empresas/empresas.service.js';
import { type CertificadoActivo, SiiClienteFactory } from '../sii/sii-cliente.factory.js';
import { clasificarEstadoEnvioDte } from '../sii-gateway/index.js';
import type { CrearEnvioDto } from './envios.dto.js';
import { EnvioDocumento } from './entities/envio-documento.entity.js';
import { Envio, type CanalEnvio } from './entities/envio.entity.js';
import {
  resolverResultado,
  resumenDeCuerpo,
  type DocumentoEnSobre,
} from './resultado-envio.js';

export interface EnvioRespuesta {
  id: string;
  canal: CanalEnvio;
  ambienteSii: string;
  trackId: string | null;
  estado: string | null;
  glosaEstado: string | null;
  esFinal: boolean;
  intentos: number;
  enviadoEn: Date | null;
  consultadoEn: Date | null;
  documentos: Array<{
    documentoId: string;
    tipoDte: number;
    folio: number;
    estado: string | null;
    glosa: string | null;
    estadoDocumento: string;
    reparos: unknown;
  }>;
}

const TIPOS_BOLETA = [39, 41];
const TIPOS_DTE_ENVIO = [33, 34, 52, 56, 61];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function estadoInvalido(detail: string) {
  return new ProblemaHttp(409, 'ESTADO_INVALIDO', 'Estado inválido', detail);
}

function sinResolucion() {
  return new ProblemaHttp(
    422,
    'EMPRESA_SIN_RESOLUCION',
    'Falta la resolución del SII',
    'La empresa no tiene número y fecha de resolución; actualícela con PATCH /v1/empresas/{rut} (en certificación: número 0 y la fecha publicada por el SII)',
  );
}

function trozos<T>(lista: T[], tamano: number): T[][] {
  const r: T[][] = [];
  for (let i = 0; i < lista.length; i += tamano) r.push(lista.slice(i, i + tamano));
  return r;
}

@Injectable()
export class EnviosService {
  constructor(
    @InjectRepository(Envio) private readonly envios: Repository<Envio>,
    @InjectRepository(EnvioDocumento)
    private readonly enviosDocs: Repository<EnvioDocumento>,
    private readonly dataSource: DataSource,
    private readonly empresas: EmpresasService,
    private readonly sii: SiiClienteFactory,
  ) {}

  /**
   * Arma el sobre (EnvioDTE para 33/34/52/56/61; EnvioBOLETA para 39/41, máximo 500 y en lotes de
   * 50), lo envía al SII, guarda `envios` y `envio_documentos` y marca los documentos `enviado`
   * con su track id.
   *
   * Los documentos se reservan (`encolado`) con bloqueo de fila antes de enviar, de modo que dos
   * solicitudes simultáneas no envían el mismo documento. Si el envío falla, vuelven a `emitido`
   * y el envío queda registrado con estado `ERR`.
   */
  async crear(rutEmpresa: string, dto: CrearEnvioDto): Promise<EnvioRespuesta[]> {
    const empresa = await this.empresas.obtenerPorRut(rutEmpresa);
    if (empresa.nroResolucionSii === null || empresa.fechaResolucionSii === null) {
      throw sinResolucion();
    }
    const clientes = await this.sii.paraEmpresa(empresa);

    // 1) Reservar documentos y registrar los envíos (una transacción).
    const lotes = await this.dataSource.transaction(async (em) => {
      const docs = await this.seleccionar(em, empresa, dto);
      const { canal, grupos } = this.agrupar(docs);

      const resultado: Array<{ envio: Envio; docs: Documento[]; canal: CanalEnvio }> = [];
      for (const grupo of grupos) {
        const envio = await em.save(
          em.create(Envio, {
            empresaId: empresa.id,
            canal,
            ambienteSii: empresa.ambienteSii,
            trackId: null,
            estado: null,
            glosaEstado: null,
            xmlEnvio: null,
            respuesta: null,
            intentos: 0,
            enviadoEn: null,
            consultadoEn: null,
          }),
        );
        await em.save(
          grupo.map((d) =>
            em.create(EnvioDocumento, {
              envioId: envio.id,
              documentoId: d.id,
              estado: null,
              glosa: null,
            }),
          ),
        );
        resultado.push({ envio, docs: grupo, canal });
      }
      await em.update(
        Documento,
        { id: In(docs.map((d) => d.id)) },
        { estado: 'encolado' },
      );
      return resultado;
    });

    // 2) Construir, enviar y registrar cada sobre.
    const respuestas: EnvioRespuesta[] = [];
    for (const { envio, docs, canal } of lotes) {
      try {
        const sobre = this.construirSobre(empresa, canal, docs, clientes.certificado);
        const nombre = `Envio${canal === 'boleta' ? 'BOLETA' : 'DTE'}_${empresa.rut}_${envio.id.slice(0, 8)}.xml`;
        const enviado =
          canal === 'boleta'
            ? await clientes.boleta.enviarBoletas(sobre.xmlIso, nombre)
            : await clientes.dte.enviarDte(sobre.xmlIso, nombre);
        await this.dataSource.transaction(async (em) => {
          await em.update(
            Envio,
            { id: envio.id },
            {
              xmlEnvio: sobre.xml,
              trackId: enviado.trackId,
              estado: 'REC',
              glosaEstado: 'Envío recibido',
              respuesta: enviado as unknown as object,
              intentos: 1,
              enviadoEn: new Date(),
            },
          );
          await em.update(
            Documento,
            { id: In(docs.map((d) => d.id)) },
            { estado: 'enviado', trackId: enviado.trackId },
          );
        });
      } catch (e) {
        await this.dataSource.transaction(async (em) => {
          await em.update(
            Envio,
            { id: envio.id },
            { estado: 'ERR', glosaEstado: String((e as Error).message).slice(0, 200), intentos: 1 },
          );
          await em.update(
            Documento,
            { id: In(docs.map((d) => d.id)) },
            { estado: 'emitido' },
          );
        });
        throw e;
      }
      respuestas.push(await this.detalle(envio.id));
    }
    return respuestas;
  }

  /**
   * Valida y agrupa documentos en sobres: todos boletas (39/41; máximo 500, en lotes de 50) o todos
   * DTE (33/34/52/56/61; máximo 2000, un solo sobre y en el orden dado).
   */
  agrupar(docs: Documento[]): { canal: CanalEnvio; grupos: Documento[][] } {
    const canal = this.canalDe(docs);
    if (canal === 'boleta' && docs.length > MAX_BOLETAS_POR_SOBRE) {
      throw new ProblemaHttp(
        422,
        'DOCUMENTO_INVALIDO',
        'Demasiadas boletas',
        `Un envío admite como máximo ${MAX_BOLETAS_POR_SOBRE} boletas (se pidieron ${docs.length})`,
      );
    }
    if (canal === 'dte' && docs.length > MAX_DTE_POR_SOBRE) {
      throw new ProblemaHttp(
        422,
        'DOCUMENTO_INVALIDO',
        'Demasiados documentos',
        `Un sobre EnvioDTE admite como máximo ${MAX_DTE_POR_SOBRE} documentos`,
      );
    }
    return {
      canal,
      grupos: canal === 'boleta' ? trozos(docs, BOLETAS_POR_SOBRE_RECOMENDADO) : [docs],
    };
  }

  /** Sobre firmado (EnvioDTE o EnvioBOLETA) con la carátula de la empresa. No envía nada. */
  construirSobre(
    empresa: Empresa,
    canal: CanalEnvio,
    docs: Documento[],
    certificado: CertificadoActivo,
  ): EnvioConstruido {
    if (empresa.nroResolucionSii === null || empresa.fechaResolucionSii === null) {
      throw sinResolucion();
    }
    const construir = canal === 'boleta' ? construirEnvioBoleta : construirEnvioDte;
    return construir({
      dtesFirmados: docs.map((d) => d.xmlFirmado),
      caratula: {
        rutEmisor: empresa.rut,
        dvEmisor: empresa.dv,
        rutEnvia: certificado.rutFirmante,
        dvEnvia: certificado.dvFirmante,
        fechaResolucion: empresa.fechaResolucionSii,
        numeroResolucion: empresa.nroResolucionSii,
      },
      certificado,
    });
  }

  private canalDe(docs: Documento[]): CanalEnvio {
    const boletas = docs.filter((d) => TIPOS_BOLETA.includes(d.tipoDte)).length;
    if (boletas === docs.length) return 'boleta';
    if (boletas === 0 && docs.every((d) => TIPOS_DTE_ENVIO.includes(d.tipoDte))) {
      return 'dte';
    }
    throw new ProblemaHttp(
      422,
      'DOCUMENTO_INVALIDO',
      'Tipos incompatibles',
      'Las boletas (39/41) y los demás DTE (33/34/52/56/61) viajan en sobres distintos: envíelos por separado',
    );
  }

  /** Documentos a enviar (con bloqueo de fila), en el orden pedido o por folio si son pendientes. */
  private async seleccionar(
    em: EntityManager,
    empresa: Empresa,
    dto: CrearEnvioDto,
  ): Promise<Documento[]> {
    let docs: Documento[];
    if (dto.documentoIds) {
      const encontrados = await em.find(Documento, {
        where: { id: In(dto.documentoIds), empresaId: empresa.id },
        lock: { mode: 'pessimistic_write' },
      });
      const porId = new Map(encontrados.map((d) => [d.id, d] as const));
      const faltan = dto.documentoIds.filter((id) => !porId.has(id));
      if (faltan.length > 0) {
        throw new ProblemaHttp(
          404,
          'NO_ENCONTRADO',
          'Documentos no encontrados',
          `No existen para la empresa: ${faltan.join(', ')}`,
        );
      }
      docs = dto.documentoIds.map((id) => porId.get(id) as Documento);
      const noPendientes = docs.filter((d) => d.estado !== 'emitido');
      if (noPendientes.length > 0) {
        throw estadoInvalido(
          `Solo se envían documentos en estado emitido; no lo están: ${noPendientes
            .map((d) => `${d.tipoDte}-${d.folio} (${d.estado})`)
            .join(', ')}`,
        );
      }
    } else {
      docs = await em.find(Documento, {
        where: { empresaId: empresa.id, tipoDte: dto.tipo, estado: 'emitido' },
        order: { folio: 'ASC' },
        lock: { mode: 'pessimistic_write' },
      });
      if (docs.length === 0) {
        throw new ProblemaHttp(
          422,
          'DOCUMENTO_INVALIDO',
          'Sin documentos pendientes',
          `No hay documentos emitidos pendientes de envío del tipo ${dto.tipo}`,
        );
      }
    }
    return docs;
  }

  /** Envío por UUID o por track id (numérico). */
  async obtener(idOTrack: string): Promise<EnvioRespuesta> {
    const envio = UUID.test(idOTrack)
      ? await this.envios.findOne({ where: { id: idOTrack } })
      : await this.envios.findOne({
          where: { trackId: idOTrack },
          order: { creadoEn: 'DESC' },
        });
    if (!envio) throw noEncontrado('El envío', idOTrack);
    return this.detalle(envio.id);
  }

  async listar(rutEmpresa: string): Promise<EnvioRespuesta[]> {
    const empresa = await this.empresas.obtenerPorRut(rutEmpresa);
    const envios = await this.envios.find({
      where: { empresaId: empresa.id },
      order: { creadoEn: 'DESC' },
      take: 100,
    });
    return Promise.all(envios.map((e) => this.detalle(e.id)));
  }

  /** Consulta el estado al SII y actualiza el envío y sus documentos. */
  async consultar(idOTrack: string): Promise<EnvioRespuesta> {
    const actual = await this.obtener(idOTrack);
    const envio = await this.envios.findOneOrFail({ where: { id: actual.id } });
    if (!envio.trackId) {
      throw estadoInvalido('El envío no tiene track id (no llegó a enviarse al SII)');
    }
    const empresa = await this.empresas.obtenerPorId(envio.empresaId);
    const clientes = await this.sii.paraEmpresa(empresa, envio.ambienteSii);

    const enSobre: DocumentoEnSobre[] = actual.documentos.map((d) => ({
      documentoId: d.documentoId,
      tipoDte: d.tipoDte,
      folio: d.folio,
    }));

    let estado: string;
    let glosa: string;
    let esFinal: boolean;
    let respuesta: unknown;
    let resultados: ReturnType<typeof resolverResultado>;
    if (envio.canal === 'boleta') {
      const r = await clientes.boleta.consultarEstadoEnvio(envio.trackId);
      estado = r.estado;
      glosa = r.descripcionEstado;
      esFinal = r.esFinal;
      respuesta = r;
      resultados = resolverResultado({
        estado,
        glosa,
        esFinal,
        documentos: enSobre,
        detalleBoleta: r.detalle_rep_rech ?? [],
      });
    } else {
      const r = await clientes.dte.consultarEstadoEnvio(envio.trackId);
      estado = r.estado;
      glosa = r.descripcionEstado;
      esFinal = r.esFinal;
      respuesta = { estado: r.estado, glosa: r.glosa, cabecera: r.cabecera, cuerpo: r.cuerpo };
      resultados = resolverResultado({
        estado,
        glosa,
        esFinal,
        documentos: enSobre,
        resumenDte: resumenDeCuerpo(r.cuerpo),
      });
    }

    await this.dataSource.transaction(async (em) => {
      await em.update(
        Envio,
        { id: envio.id },
        {
          estado,
          glosaEstado: glosa.slice(0, 200),
          respuesta: respuesta as object,
          consultadoEn: new Date(),
        },
      );
      for (const r of resultados) {
        await em.update(
          EnvioDocumento,
          { envioId: envio.id, documentoId: r.documentoId },
          { estado: r.codigo.slice(0, 10), glosa: r.glosa.slice(0, 200) },
        );
        if (r.estado !== null) {
          await em.update(
            Documento,
            { id: r.documentoId },
            { estado: r.estado, reparos: (r.reparos === null ? () => 'NULL' : r.reparos) as object },
          );
        }
      }
    });
    return this.detalle(envio.id);
  }

  private async detalle(envioId: string): Promise<EnvioRespuesta> {
    const envio = await this.envios.findOneOrFail({ where: { id: envioId } });
    const filas = await this.enviosDocs.find({
      where: { envioId },
      relations: { documento: true },
    });
    // Orden de los documentos dentro del sobre: por tipo y folio.
    filas.sort(
      (a, b) =>
        (a.documento?.tipoDte ?? 0) - (b.documento?.tipoDte ?? 0) ||
        (a.documento?.folio ?? 0) - (b.documento?.folio ?? 0),
    );
    return {
      id: envio.id,
      canal: envio.canal,
      ambienteSii: envio.ambienteSii,
      trackId: envio.trackId,
      estado: envio.estado,
      glosaEstado: envio.glosaEstado,
      esFinal: envio.estado ? clasificarEstadoEnvioDte(envio.estado).esFinal : false,
      intentos: envio.intentos,
      enviadoEn: envio.enviadoEn,
      consultadoEn: envio.consultadoEn,
      documentos: filas.map((f) => ({
        documentoId: f.documentoId,
        tipoDte: f.documento?.tipoDte as TipoDte,
        folio: f.documento?.folio as number,
        estado: f.estado,
        glosa: f.glosa,
        estadoDocumento: f.documento?.estado ?? 'desconocido',
        reparos: f.documento?.reparos ?? null,
      })),
    };
  }
}
