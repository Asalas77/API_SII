import fs from 'node:fs';
const h = fs.readFileSync(process.argv[2],'utf8');
const dec = s => s.replace(/&nbsp;/g,' ').replace(/&aacute;/g,'á').replace(/&eacute;/g,'é').replace(/&iacute;/g,'í').replace(/&oacute;/g,'ó').replace(/&uacute;/g,'ú').replace(/&ntilde;/g,'ñ').replace(/&Ntilde;/g,'Ñ').replace(/&amp;/g,'&').replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(+n)).replace(/&[a-z]+;/gi,' ');
let t = h.replace(/<script[\s\S]*?<\/script>/gi,'').replace(/<style[\s\S]*?<\/style>/gi,'');
t = t.replace(/<\/t[dh]>/gi,'\t').replace(/<\/tr>/gi,'\n').replace(/<br\s*\/?>/gi,' ').replace(/<\/(p|h\d|div|li)>/gi,'\n').replace(/<[^>]+>/g,'');
t = dec(t).replace(/[  ]+/g,' ').replace(/ *\t */g,'\t').replace(/\n\s*\n+/g,'\n');
fs.writeFileSync(process.argv[3], t);
