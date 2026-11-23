/**
 * UTILIDAD DE PRUEBA - NO USAR EN PRODUCCION.
 * `fetch` falso que imita los endpoints del SII (autenticación, envío y consulta de estado de envíos y de
 * documentos, tanto DTE como boletas). Se inyecta con `SII_FETCH` (`SiiModule`) en los e2e.
 */
import { escaparXml } from '../dte-core/index.js';

export interface LlamadaSii {
  url: string;
  method: string;
  body?: unknown;
}

export interface EventoReclamoSimulado {
  codigo: string;
  descripcion?: string;
  rutResponsable?: string;
  dvResponsable?: string;
  /** `dd-mm-yyyy HH:MM:SS` (hora de Chile). */
  fecha?: string;
}

export interface SiiSimulado {
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  llamadas: LlamadaSii[];
  /** Respuesta de `GET boleta.electronica.envio/...`; modificable entre llamadas. */
  estadoBoleta: Record<string, unknown>;
  /** `ESTADO`, `GLOSA` y `RESP_BODY` (XML interno) de `getEstUp`; modificables. */
  estadoDte: { estado: string; glosa: string; cuerpoXml: string };
  /**
   * Respuesta de `getEstDte` por documento, con clave `tipo-folio` (p. ej. `33-1`). `estado` puede
   * ser un código de documento (DOK, FNA, ...) o de error (-4, 001). Sin entrada, responde DOK.
   */
  estadoDocumentoDte: Record<string, { estado: string; glosa?: string }>;
  /** Igual para `GET boleta.electronica/{rut}-{dv}-{tipo}-{folio}/estado` (clave `tipo-folio`); sin entrada, DOK. */
  estadoDocumentoBoleta: Record<string, { codigo: string; descripcion?: string }>;
  /**
   * Registro de aceptación/reclamo (RegistroReclamoDTE), por documento con clave `tipo-folio`. Aplica las
   * reglas del PDF v1.1: un reclamo bloquea ACD y ERM, un ACD bloquea reclamos, un ERM bloquea reclamos, el
   * mismo evento dos veces responde 7 y pasados 8 días desde `fechaRecepcionReclamo` responde 8.
   */
  eventosReclamo: Record<string, EventoReclamoSimulado[]>;
  /** Fecha de recepción en el SII (`dd-mm-yyyy HH:MM:SS`) por `tipo-folio`; sin entrada, hace 1 día. */
  fechaRecepcionReclamo: Record<string, string>;
  /** Fuerza el `codResp` de `ingresarAceptacionReclamoDoc` (para probar errores del SII). */
  forzarCodigoReclamo?: { codigo: number; descripcion: string };
  /** Siguiente track id (se incrementa en cada envío). */
  siguienteTrackId: number;
}

const soap = (operacion: string, retorno: string) =>
  '<?xml version="1.0" encoding="UTF-8"?>' +
  '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
  `<soapenv:Body><ns1:${operacion}Response xmlns:ns1="https://maullin.sii.cl/DTEWS/X.jws">` +
  `<${operacion}Return xsi:type="xsd:string">${escaparXml(retorno)}</${operacion}Return>` +
  `</ns1:${operacion}Response></soapenv:Body></soapenv:Envelope>`;

const respuesta = (hdr: string, body = '') =>
  `<?xml version="1.0" encoding="UTF-8"?><SII:RESPUESTA xmlns:SII="http://www.sii.cl/XMLSchema"><SII:RESP_HDR>${hdr}</SII:RESP_HDR>${body ? `<SII:RESP_BODY>${body}</SII:RESP_BODY>` : ''}</SII:RESPUESTA>`;

const xml = (cuerpo: string, status = 200, tipo = 'text/xml') =>
  new Response(cuerpo, { status, headers: { 'Content-Type': tipo } });

export function crearSiiSimulado(): SiiSimulado {
  const sim: SiiSimulado = {
    llamadas: [],
    // Base aleatoria: varios archivos e2e corren en paralelo sobre la misma BD y buscan envíos por track id.
    siguienteTrackId: 1000 + Math.floor(Math.random() * 1_000_000_000),
    estadoBoleta: { estado: 'EPR', estadistica: [], detalle_rep_rech: [] },
    estadoDte: {
      estado: 'EPR',
      glosa: 'Envio Procesado',
      cuerpoXml:
        '<TIPO_DOCTO>33</TIPO_DOCTO><INFORMADOS>1</INFORMADOS><ACEPTADOS>1</ACEPTADOS><RECHAZADOS>0</RECHAZADOS><REPAROS>0</REPAROS>',
    },
    estadoDocumentoDte: {},
    estadoDocumentoBoleta: {},
    eventosReclamo: {},
    fechaRecepcionReclamo: {},
    fetch: async (url, init) => {
      const method = init?.method ?? 'GET';
      sim.llamadas.push({ url, method, body: init?.body });
      const u = new URL(url);

      // --- Boletas (API REST) ---
      if (u.pathname.endsWith('/boleta.electronica.semilla')) {
        return xml(respuesta('<ESTADO>00</ESTADO>', '<SEMILLA>030530912644</SEMILLA>'));
      }
      if (u.pathname.endsWith('/boleta.electronica.token')) {
        return xml(respuesta('<ESTADO>00</ESTADO>', '<TOKEN>TOKENBOLETA</TOKEN>'));
      }
      if (u.pathname.endsWith('/boleta.electronica.envio') && method === 'POST') {
        return Response.json({
          rut_emisor: '0-0',
          rut_envia: '0-0',
          trackid: sim.siguienteTrackId++,
          fecha_recepcion: '2026-11-18 10:00:00',
          estado: 'REC',
        });
      }
      const m = /boleta\.electronica\.envio\/(\d+)-(\w)-(\d+)$/.exec(u.pathname);
      if (m && method === 'GET') {
        return Response.json({
          rut_emisor: `${m[1]}-${m[2]}`,
          rut_envia: `${m[1]}-${m[2]}`,
          trackid: Number(m[3]),
          fecha_recepcion: '18/11/2026 10:00:00',
          ...sim.estadoBoleta,
        });
      }

      const mb = /boleta\.electronica\/\d+-\w-(\d+)-(\d+)\/estado$/.exec(u.pathname);
      if (mb && method === 'GET') {
        const e = sim.estadoDocumentoBoleta[`${mb[1]}-${mb[2]}`] ?? { codigo: 'DOK' };
        return Response.json({
          codigo: e.codigo,
          descripcion: e.descripcion ?? `Estado simulado ${e.codigo}`,
        });
      }

      // --- DTE (SOAP + upload) ---
      if (u.pathname.endsWith('/CrSeed.jws')) {
        return xml(soap('getSeed', respuesta('<ESTADO>00</ESTADO>', '<SEMILLA>1234567890123</SEMILLA>')));
      }
      if (u.pathname.endsWith('/GetTokenFromSeed.jws')) {
        return xml(soap('getToken', respuesta('<ESTADO>00</ESTADO>', '<TOKEN>TOKENDTE</TOKEN>')));
      }
      if (u.pathname.endsWith('/DTEUpload')) {
        return xml(
          `<?xml version="1.0" encoding="UTF-8"?><RECEPCIONDTE><RUTSENDER>1-9</RUTSENDER><RUTCOMPANY>1-9</RUTCOMPANY><FILE>envio.xml</FILE><TIMESTAMP>2026-11-18 10:00:00</TIMESTAMP><STATUS>0</STATUS><TRACKID>${sim.siguienteTrackId++}</TRACKID></RECEPCIONDTE>`,
        );
      }
      if (u.pathname.endsWith('/registroreclamodteservice') && method === 'POST') {
        return reclamoSimulado(sim, typeof init?.body === 'string' ? init.body : '');
      }
      if (u.pathname.endsWith('/QueryEstDte.jws')) {
        const cuerpo = (typeof init?.body === 'string' ? init.body : '');
        const tipo = /<TipoDte>(\d+)<\/TipoDte>/.exec(cuerpo)?.[1];
        const folio = /<FolioDte>(\d+)<\/FolioDte>/.exec(cuerpo)?.[1];
        const e = sim.estadoDocumentoDte[`${tipo}-${folio}`] ?? { estado: 'DOK' };
        return xml(
          soap(
            'getEstDte',
            respuesta(
              `<ESTADO>${e.estado}</ESTADO><GLOSA_ESTADO>${e.glosa ?? `Estado simulado ${e.estado}`}</GLOSA_ESTADO>`,
            ),
          ),
        );
      }
      if (u.pathname.endsWith('/QueryEstUp.jws')) {
        const { estado, glosa, cuerpoXml } = sim.estadoDte;
        return xml(
          soap(
            'getEstUp',
            respuesta(`<TRACKID>1</TRACKID><ESTADO>${estado}</ESTADO><GLOSA>${glosa}</GLOSA>`, cuerpoXml),
          ),
        );
      }
      return new Response(`Ruta no simulada: ${method} ${url}`, { status: 404 });
    },
  };
  return sim;
}


// --- RegistroReclamoDTE -------------------------------------------------------------------------

const NS_RECLAMO = 'http://ws.registroreclamodte.diii.sdi.sii.cl';
const RECLAMOS = ['RCD', 'RFP', 'RFT'];

function ahoraChile(d: Date): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'America/Santiago',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return `${p.day}-${p.month}-${p.year} ${p.hour === '24' ? '00' : p.hour}:${p.minute}:${p.second}`;
}

function parteChile(texto: string): Date {
  const m = /^(\d{2})-(\d{2})-(\d{4}) (\d{2}):(\d{2}):(\d{2})$/.exec(texto);
  if (!m) return new Date(Number.NaN);
  // Aproximación suficiente para medir 8 días (±1 h por cambio de hora no afecta las pruebas).
  return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4] + 3, +m[5], +m[6]));
}

function respuestaRpc(operacion: string, interior: string): Response {
  return xml(
    '<?xml version="1.0" encoding="UTF-8"?>' +
      '<S:Envelope xmlns:S="http://schemas.xmlsoap.org/soap/envelope/"><S:Body>' +
      `<ns2:${operacion}Response xmlns:ns2="${NS_RECLAMO}">${interior}</ns2:${operacion}Response>` +
      '</S:Body></S:Envelope>',
  );
}

const resp_ = (codigo: number, descripcion: string, eventos = '') =>
  `<return><codResp>${codigo}</codResp><descResp>${escaparXml(descripcion)}</descResp>${eventos}</return>`;

function reclamoSimulado(sim: SiiSimulado, cuerpo: string): Response {
  const operacion = /<(?:\w+:)?(ingresarAceptacionReclamoDoc|listarEventosHistDoc|consultarDocDteCedible|consultarFechaRecepcionSii|getVersion)[ >/]/.exec(cuerpo)?.[1];
  const campo = (n: string) => new RegExp(`<${n}>([^<]*)</${n}>`).exec(cuerpo)?.[1] ?? '';
  const clave = `${campo('tipoDoc')}-${campo('folio')}`;
  const eventos = (sim.eventosReclamo[clave] ??= []);
  const recepcion = sim.fechaRecepcionReclamo[clave] ?? ahoraChile(new Date(Date.now() - 24 * 3600 * 1000));

  switch (operacion) {
    case 'getVersion':
      return respuestaRpc('getVersion', '<return>1.1-simulado</return>');
    case 'consultarFechaRecepcionSii':
      return respuestaRpc('consultarFechaRecepcionSii', `<return>${recepcion}</return>`);
    case 'consultarDocDteCedible': {
      if (eventos.some((e) => RECLAMOS.includes(e.codigo))) {
        return respuestaRpc(operacion, resp_(24, 'DTE No Cedible, DTE reclamado por el receptor'));
      }
      return respuestaRpc(operacion, resp_(23, 'DTE Cedible, sin reclamos'));
    }
    case 'listarEventosHistDoc': {
      if (eventos.length === 0) return respuestaRpc(operacion, resp_(16, 'Documento no presenta eventos de reclamos o acuse de recibo'));
      const lista = eventos
        .map(
          (e) =>
            `<listaEventosDoc><codEvento>${e.codigo}</codEvento><descEvento>${escaparXml(e.descripcion ?? e.codigo)}</descEvento>` +
            `<rutResponsable>${e.rutResponsable ?? '12345678'}</rutResponsable><dvResponsable>${e.dvResponsable ?? '5'}</dvResponsable>` +
            `<fechaEvento>${e.fecha ?? ahoraChile(new Date())}</fechaEvento></listaEventosDoc>`,
        )
        .join('');
      return respuestaRpc(operacion, resp_(15, 'Listado de eventos del documento', lista));
    }
    case 'ingresarAceptacionReclamoDoc': {
      if (sim.forzarCodigoReclamo) return respuestaRpc(operacion, resp_(sim.forzarCodigoReclamo.codigo, sim.forzarCodigoReclamo.descripcion));
      const accion = campo('accionDoc');
      if (!['ACD', 'RCD', 'ERM', 'RFP', 'RFT'].includes(accion)) return respuestaRpc(operacion, resp_(4, 'Acción inválida'));
      if (Date.now() - parteChile(recepcion).getTime() > 8 * 24 * 3600 * 1000) {
        return respuestaRpc(operacion, resp_(8, 'Pasados 8 días después de la recepción no es posible registrar reclamos o eventos'));
      }
      const previo = eventos.find((e) => RECLAMOS.includes(e.codigo));
      const hay = (c: string) => eventos.some((e) => e.codigo === c);
      if (hay(accion)) return respuestaRpc(operacion, resp_(7, 'Evento registrado previamente'));
      if (previo && accion === 'ERM') return respuestaRpc(operacion, resp_(6, `No se puede acusar recibo de mercadería de DTE previamente reclamado por ${previo.codigo}`));
      if (previo && accion === 'ACD') return respuestaRpc(operacion, resp_(12, `No se puede dar por aceptado DTE previamente rechazado por ${previo.codigo}`));
      if (hay('ACD') && RECLAMOS.includes(accion)) return respuestaRpc(operacion, resp_(11, 'No se puede reclamar DTE previamente aceptado'));
      if (hay('ERM') && RECLAMOS.includes(accion)) return respuestaRpc(operacion, resp_(13, 'No se puede reclamar DTE previamente registrado como que acuso recibo mercaderia'));
      eventos.push({ codigo: accion, fecha: ahoraChile(new Date()) });
      return respuestaRpc(operacion, resp_(0, 'Acción completada OK'));
    }
    default:
      return new Response(`Operación de reclamo no simulada: ${cuerpo.slice(0, 200)}`, { status: 500 });
  }
}
