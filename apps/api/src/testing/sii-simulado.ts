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
