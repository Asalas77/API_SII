/** Permisos atómicos de la API. El código nunca consulta nombres de rol: solo estos códigos. */
export const PERMISOS = {
  EMPRESAS_CREAR: 'empresas.crear',
  EMPRESAS_LEER: 'empresas.leer',
  EMPRESAS_EDITAR: 'empresas.editar',
  CERTIFICADOS_GESTIONAR: 'certificados.gestionar',
  CAFS_GESTIONAR: 'cafs.gestionar',
  FOLIOS_LEER: 'folios.leer',
  DOCUMENTOS_EMITIR: 'documentos.emitir',
  DOCUMENTOS_LEER: 'documentos.leer',
  ENVIOS_CREAR: 'envios.crear',
  ENVIOS_LEER: 'envios.leer',
  API_KEYS_GESTIONAR: 'api_keys.gestionar',
} as const;

export type Permiso = (typeof PERMISOS)[keyof typeof PERMISOS];

export const TODOS_LOS_PERMISOS: readonly Permiso[] = Object.values(PERMISOS);

export function esPermiso(valor: string): valor is Permiso {
  return (TODOS_LOS_PERMISOS as readonly string[]).includes(valor);
}
