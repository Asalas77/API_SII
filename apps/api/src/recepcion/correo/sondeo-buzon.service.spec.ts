import { crearCorreoFalso } from '../../testing/correo-falso.js';
import type { BuzonCorreo } from '../entities/buzon-correo.entity.js';
import { SondeoBuzonService } from './sondeo-buzon.service.js';

const empresa = { id: 'emp-1', rut: 76086428, dv: '5', razonSocial: 'EMPRESA SPA' };
const xml = (n: number) => Buffer.from(`<EnvioDTE>${n}</EnvioDTE>`);

function crear(opciones: { smtp?: boolean; entorno?: Record<string, string>; recibir?: (c: Buffer) => unknown } = {}) {
  const correo = crearCorreoFalso();
  const actualizaciones: Array<Record<string, unknown>> = [];
  const buzones: Array<Partial<BuzonCorreo>> = [];
  const em = {
    update: async (_e: unknown, _w: unknown, v: Record<string, unknown>) => void actualizaciones.push(v),
    getRepository: () => ({ find: async () => buzones }),
  };
  const ejecutor = { ejecutar: async <T>(fn: (e: typeof em) => Promise<T>) => fn(em) };
  const recepcion = {
    recibirParaEmpresa: vi.fn(async (_e: unknown, contenido: Buffer) => {
      const r = opciones.recibir?.(contenido);
      if (r instanceof Error) throw r;
      return (
        r ?? {
          repetido: false,
          envio: { id: `envio-${contenido.toString()}`, enlaces: { recepcionEnvio: '/v1/envios-recibidos/x/recepcion-envio' } },
        }
      );
    }),
    enviarAcuse: vi.fn(async () => undefined),
  };
  const buzon = {
    credenciales: vi.fn(async () => ({
      buzon: { id: 'buzon-1', carpetaProcesados: 'Procesados' },
      imap: { host: 'imap.x.cl', puerto: 993, seguro: true, usuario: 'u', password: 'p', carpeta: 'INBOX' },
      smtp: opciones.smtp === false ? null : { host: 'smtp.x.cl', puerto: 587, seguro: false, usuario: 'u', password: 'p', remitente: 'dte@x.cl' },
    })),
  };
  const entorno: Record<string, string> = { NODE_ENV: 'production', ...opciones.entorno };
  const config = { get: (k: string) => entorno[k] };
  const servicio = new SondeoBuzonService(config as never, ejecutor as never, {} as never, recepcion as never, buzon as never, correo);
  return { servicio, correo, recepcion, actualizaciones, buzones };
}

const msg = (uid: string, adjuntos: number[], remitente: string | null = 'p@emisor.cl') => ({
  uid,
  remitente,
  asunto: `m${uid}`,
  adjuntos: adjuntos.map((n) => ({ nombre: `e${n}.xml`, contenido: xml(n) })),
  leido: false,
});

describe('SondeoBuzonService', () => {
  describe('activación', () => {
    it('está desactivado por defecto', () => {
      expect(crear().servicio.habilitado()).toBe(false);
      expect(crear({ entorno: { BUZON_CORREO_HABILITADO: 'false' } }).servicio.habilitado()).toBe(false);
    });

    it('se activa solo con BUZON_CORREO_HABILITADO=true y nunca en NODE_ENV=test', () => {
      expect(crear({ entorno: { BUZON_CORREO_HABILITADO: 'true' } }).servicio.habilitado()).toBe(true);
      expect(crear({ entorno: { BUZON_CORREO_HABILITADO: 'true', NODE_ENV: 'test' } }).servicio.habilitado()).toBe(false);
    });

    it('onModuleInit no programa nada si está desactivado', () => {
      const t = vi.spyOn(globalThis, 'setInterval');
      crear().servicio.onModuleInit();
      expect(t).not.toHaveBeenCalled();
      t.mockRestore();
    });
  });

  describe('sondear', () => {
    it('procesa los adjuntos, responde el acuse al remitente y mueve el mensaje a la carpeta de procesados', async () => {
      const { servicio, correo, recepcion } = crear();
      correo.bandeja.push({ ...msg('1', [1, 2]) }, { ...msg('2', []) });
      const r = await servicio.sondear(empresa as never);
      expect(r).toMatchObject({ mensajes: 2, adjuntos: 2, nuevos: 2, repetidos: 0, acusesEnviados: 2, errores: [] });
      expect(recepcion.recibirParaEmpresa).toHaveBeenCalledWith(
        empresa,
        xml(1),
        { origen: 'correo', remitente: 'p@emisor.cl', nombreArchivo: 'e1.xml' },
      );
      expect(recepcion.enviarAcuse).toHaveBeenCalledWith(empresa, 'envio-<EnvioDTE>1</EnvioDTE>', 'p@emisor.cl');
      expect(correo.bandeja.map((m) => [m.leido, m.movidoA])).toEqual([
        [true, 'Procesados'],
        [true, null], // sin adjuntos XML: solo se marca leído
      ]);
    });

    it('los repetidos se cuentan y no se responden de nuevo', async () => {
      const { servicio, correo, recepcion } = crear({
        recibir: () => ({ repetido: true, envio: { id: 'x', enlaces: { recepcionEnvio: null } } }),
      });
      correo.bandeja.push(msg('1', [1]));
      const r = await servicio.sondear(empresa as never);
      expect(r).toMatchObject({ nuevos: 0, repetidos: 1, acusesEnviados: 0 });
      expect(recepcion.enviarAcuse).not.toHaveBeenCalled();
      expect(correo.bandeja[0].leido).toBe(true);
    });

    it('sin SMTP no responde pero igual guarda y marca el mensaje', async () => {
      const { servicio, correo, recepcion } = crear({ smtp: false });
      correo.bandeja.push(msg('1', [1]));
      const r = await servicio.sondear(empresa as never);
      expect(r).toMatchObject({ nuevos: 1, acusesEnviados: 0 });
      expect(recepcion.enviarAcuse).not.toHaveBeenCalled();
      expect(correo.bandeja[0].leido).toBe(true);
    });

    it('un fallo al procesar un adjunto deja el mensaje sin leer (se reintenta) y no frena a los demás', async () => {
      const { servicio, correo } = crear({ recibir: (c) => (c.toString().includes('>1<') ? new Error('sin certificado') : undefined) });
      correo.bandeja.push(msg('1', [1]), msg('2', [2]));
      const r = await servicio.sondear(empresa as never);
      expect(r.errores).toEqual(['e1.xml: sin certificado']);
      expect(r.nuevos).toBe(1);
      expect(correo.bandeja.map((m) => m.leido)).toEqual([false, true]);
    });

    it('si falla el acuse por SMTP el mensaje igual se da por procesado y el error queda en el resumen', async () => {
      const { servicio, correo, recepcion } = crear();
      recepcion.enviarAcuse.mockRejectedValueOnce(new Error('smtp caído'));
      correo.bandeja.push(msg('1', [1]));
      const r = await servicio.sondear(empresa as never);
      expect(r.acusesEnviados).toBe(0);
      expect(r.errores[0]).toContain('smtp caído');
      expect(correo.bandeja[0].leido).toBe(true);
    });

    it('registra el sondeo (fecha y último error) y traduce los fallos de IMAP a 502', async () => {
      const ok = crear();
      await ok.servicio.sondear(empresa as never);
      expect(ok.actualizaciones.at(-1)).toMatchObject({ ultimoError: null });
      expect(ok.actualizaciones.at(-1)?.ultimoSondeoEn).toBeInstanceOf(Date);

      const mal = crear();
      mal.correo.fallarImap = new Error('login failed');
      await expect(mal.servicio.sondear(empresa as never)).rejects.toMatchObject({ code: 'CORREO_NO_DISPONIBLE' });
      expect(mal.actualizaciones.at(-1)?.ultimoError).toContain('login failed');
    });
  });

  describe('tick', () => {
    const ahora = new Date('2026-03-01T12:00:00Z');
    const buzonDe = (ultimoSondeoEn: Date | null, intervaloSegundos = 300): Partial<BuzonCorreo> => ({
      id: 'b',
      activo: true,
      intervaloSegundos,
      ultimoSondeoEn,
      empresa: empresa as never,
    });

    it('sondea solo los buzones cuyo intervalo ya se cumplió (o nunca sondeados)', async () => {
      const { servicio, correo, buzones } = crear();
      correo.bandeja.push(msg('1', []));
      buzones.push(buzonDe(new Date(ahora.getTime() - 60_000))); // hace 1 min: aún no
      await servicio.tick(ahora);
      expect(correo.sesiones).toHaveLength(0);

      buzones.length = 0;
      buzones.push(buzonDe(new Date(ahora.getTime() - 301_000)));
      await servicio.tick(ahora);
      expect(correo.sesiones).toHaveLength(1);

      buzones.length = 0;
      buzones.push(buzonDe(null));
      await servicio.tick(ahora);
      expect(correo.sesiones).toHaveLength(2);
    });

    it('un buzón que falla no detiene el ciclo ni lanza', async () => {
      const { servicio, correo, buzones } = crear();
      correo.fallarImap = new Error('timeout');
      buzones.push(buzonDe(null));
      await expect(servicio.tick(ahora)).resolves.toBeUndefined();
    });
  });
});
