import fs from 'node:fs';
const txt = fs.readFileSync('anexo51.txt','utf8').split('\n');
const sec = (a,b)=>txt.slice(a-1,b-1).map(l=>l.replace(/\t/g,' ').trim()).filter(Boolean);
const outDir = process.argv[2];
const q = s=>JSON.stringify(s);
const FUENTE = 'Servicio Nacional de Aduanas, Compendio de Normas Aduaneras, Anexo 51 (https://www.aduana.cl/compendio-de-normas-anexo-51/aduana/2009-11-19/163937.html), descargado el 2026-11-23.';
const head = (n)=>`// GENERADO a partir de los datos oficiales descargados (ver docs/referencias-aduana/README.md). No editar a mano.\n// Fuente: ${FUENTE}\n// Tabla: ${n}\n`;
const w=(f,s)=>fs.writeFileSync(`${outDir}/${f}`,s);
const acentos = s=>s.normalize('NFD').replace(/[̀-ͯ]/g,'');

// países (51-9): líneas 1909..2403
{
 const L=sec(1909,2403).slice(2); // sin título ni cabeceras
 const rows=[];let name=null;
 for(const l of L){ if(l==='NOMBRE'||l==='CODIGO'||l==='Top')continue;
  const m=/^(\d{3})(?:; Abreviatura: (.+))?$/.exec(l);
  if(m&&name){rows.push({codigo:+m[1],nombre:name,...(m[2]?{abreviatura:m[2]}:{})});name=null}else if(!m)name=l;}
 w('paises.ts',head('51-9 Países y territorios aduaneros')+`export interface PaisAduana { codigo: number; nombre: string; abreviatura?: string }\n\nexport const PAISES_ADUANA: readonly PaisAduana[] = ${JSON.stringify(rows,null,1)};\n`);
 console.log('paises',rows.length, rows.find(r=>r.nombre==='CHILE'));
}
// puertos (51-11)
{
 const L=sec(3419,4185).slice(2);
 const rows=[];let region='',pais='',name=null;
 for(const l of L){ if(l==='Top'||l.startsWith('Resolución'))continue;
  if(/^\d{2,4}$/.test(l)&&name){rows.push({codigo:+l,nombre:name,pais,region});name=null;continue}
  if(name!==null){ // nombre sin código: era encabezado
    if(/:$/.test(name))pais=name.replace(/:$/,''); else if(name===name.toUpperCase()&&!/^[A-ZÁÉÍÓÚÑ ]*PUERTOS/.test(name)) region=name; }
  name=l; }
 w('puertos.ts',head('51-11 Puertos (región/país tal como los agrupa el Anexo)')+`export interface PuertoAduana { codigo: number; nombre: string; pais: string; region: string }\n\nexport const PUERTOS_ADUANA: readonly PuertoAduana[] = ${JSON.stringify(rows,null,1)};\n`);
 console.log('puertos',rows.length, rows.filter(r=>r.pais==='CHILE'||r.region==='CHILE').slice(0,6), rows.slice(0,3));
}
// vías
{
 const L=sec(4206,4260);const i=L.findIndex(l=>l==='CÓDIGO');const rows=[];
 for(let k=i+1;k+1<L.length;k+=2){ if(!/^\d{2}$/.test(L[k+1]))break; rows.push({codigo:+L[k+1],nombre:L[k]});}
 w('vias-transporte.ts',head('51-13 Vías de transporte')+`export interface ViaTransporteAduana { codigo: number; nombre: string }\n\nexport const VIAS_TRANSPORTE_ADUANA: readonly ViaTransporteAduana[] = ${JSON.stringify(rows,null,1)};\n`);
 console.log('vias',rows);
}

// monedas
{
 const L=sec(4966,5183);const i=L.findIndex(l=>l==='PAÍS');const rows=[];
 for(let k=i+1;k+3<L.length;k+=4){ if(!/^\d{3}$/.test(L[k]))break; if(L[k+2].length<=20) rows.push({codigo:+L[k],nombre:L[k+1],abreviatura:L[k+2],pais:L[k+3],glosaSii:acentos(L[k+2]).toUpperCase()});}
 const xsd=fs.readFileSync(process.argv[3],'latin1');
 const ini=xsd.indexOf('name="TipMonType"');
 const glosas=[...xsd.slice(ini,xsd.indexOf('</xs:simpleType>',ini)).matchAll(/<xs:enumeration value="([^"]+)"/g)].map(m=>m[1]);
 w('monedas.ts',head('51-20 Monedas (código, nombre, abreviatura, país). `glosaSii` = abreviatura sin acentos. `GLOSAS_MONEDA_XSD` = enumeración `TipMonType` del XSD oficial del SII (SiiTypes_v10.xsd), la que valida `TpoMoneda`')+
  `export interface MonedaAduana { codigo: number; nombre: string; abreviatura: string; pais: string; glosaSii: string }\n\nexport const MONEDAS_ADUANA: readonly MonedaAduana[] = ${JSON.stringify(rows,null,1)};\n\nexport const GLOSAS_MONEDA_XSD: readonly string[] = ${JSON.stringify(glosas)};\n`);
 console.log('monedas',rows.length, glosas.length, rows.filter(r=>!glosas.includes(r.glosaSii)).map(r=>r.glosaSii).join('|'));
}
// cláusulas
{
 const rows=[['CIF','COSTOS, SEGURO Y FLETE',1],['CFR','COSTOS Y FLETE',2],['EXW','EN FÁBRICA',3],['FAS','FRANCO AL COSTADO DEL BUQUE',4],['FOB','FRANCO A BORDO',5],['S/CL','SIN CLÁUSULA DE COMPRAVENTA',6],['FCA','FRANCO TRANSPORTISTA',7],['OTRA','OTRA (incluye CPT, CIP, DPU y DAP)',8],['DDP','ENTREGADAS DERECHOS PAGADOS',9]].map(([sigla,nombre,codigo])=>({codigo,sigla,nombre}));
 w('clausulas-venta.ts',head('51-21 Cláusulas de compraventa. En el Anexo, CPT (transporte pagado hasta), CIP (transporte y seguro pagado hasta), DPU (entregada en lugar descargado) y DAP (entregada en lugar acordado) no tienen código propio: se declaran con el código 8 "OTRA"')+`export interface ClausulaVentaAduana { codigo: number; sigla: string; nombre: string }\n\nexport const CLAUSULAS_VENTA_ADUANA: readonly ClausulaVentaAduana[] = ${JSON.stringify(rows,null,1)};\n`);
}
// modalidades
{
 const L=sec(6412,6470);const i=L.findIndex(l=>l==='CODIGO');const rows=[];
 for(let k=i+1;k+2<L.length;k+=3){ if(!/^\d$/.test(L[k+2]))break; rows.push({codigo:+L[k+2],nombre:L[k],sigla:L[k+1]});}
 w('modalidades-venta.ts',head('51-26 Modalidad de venta')+`export interface ModalidadVentaAduana { codigo: number; nombre: string; sigla: string }\n\nexport const MODALIDADES_VENTA_ADUANA: readonly ModalidadVentaAduana[] = ${JSON.stringify(rows,null,1)};\n`);
 console.log('modalidades',rows);
}
// formas de pago
{
 const L=sec(5225,5375);const rows=[];
 for(let k=0;k+2<L.length;k++){ if(/^\d{2}$/.test(L[k])&&!/^\d{2}$/.test(L[k+1])&&L[k+2]&&!/^\d{2}$/.test(L[k+2])&&!/^(CÓDIGO|FORMA|SIGLA)/.test(L[k+1])){ rows.push({codigo:+L[k],glosa:L[k+1],sigla:L[k+2]}); k+=2;} }
 w('formas-pago.ts',head('51-22 Formas de pago')+`export interface FormaPagoAduana { codigo: number; glosa: string; sigla: string }\n\nexport const FORMAS_PAGO_ADUANA: readonly FormaPagoAduana[] = ${JSON.stringify(rows,null,1)};\n`);
 console.log('fp',rows.length, rows.slice(0,6), rows.slice(-3));
}
// tipos de bulto
{
 const L=sec(5375,5671);const i=L.findIndex(l=>l==='GLOSA');const rows=[];
 for(let k=i+1;k+1<L.length;k++){ if(/^\d{2,3}$/.test(L[k])&&!/^\d{2,3}$/.test(L[k+1])){ const r={codigo:+L[k],descripcion:L[k+1]}; k+=1; if(L[k+1]&&!/^\d{2,3}$/.test(L[k+1])&&!L[k+1].startsWith('NOTA')&&!L[k+1].startsWith('Resol')){r.glosa=L[k+1];k+=1;} rows.push(r);} }
 w('tipos-bulto.ts',head('51-23 Tipo de bulto')+`export interface TipoBultoAduana { codigo: number; descripcion: string; glosa?: string }\n\nexport const TIPOS_BULTO_ADUANA: readonly TipoBultoAduana[] = ${JSON.stringify(rows,null,1)};\n`);
 console.log('bultos',rows.length, rows.slice(0,4), rows.slice(-2).map(r=>r.codigo+r.descripcion.slice(0,20)));
}
// unidades
{
 const L=sec(5671,6412);const set=new Map();
 set.set('KN-06',{codigo:6,sigla:'KN-06',nombre:'kilogramo',abreviatura:'KN'});
 for(let k=0;k+3<L.length;k++){ const m=/^([A-Za-z0-9()\/]+)-(\d{2})$/.exec(L[k+3]??''); if(m&&/^\d/.test(L[k])){ set.set(L[k+3],{codigo:+m[2],sigla:L[k+3],nombre:L[k+1],abreviatura:L[k+2]}); } }
 const rows=[...set.values()].sort((a,b)=>a.codigo-b.codigo);
 w('unidades-medida.ts',head('51-24 Unidades de medida. El Anexo no trae una tabla de códigos separada: la unidad por defecto es kilogramo (sigla KN, código 06, según el texto del Anexo) y las demás se deducen de la columna "sigla a indicar en declaración" (SIGLA-CÓDIGO) de la tabla por partida arancelaria. Lista incompleta respecto de las unidades que Aduana usa en otros anexos')+`export interface UnidadMedidaAduana { codigo: number; sigla: string; nombre: string; abreviatura: string }\n\nexport const UNIDADES_MEDIDA_ADUANA: readonly UnidadMedidaAduana[] = ${JSON.stringify(rows,null,1)};\n`);
 console.log('unidades',rows.length);
}
