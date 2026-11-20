export { PERMISOS, TODOS_LOS_PERMISOS, esPermiso } from './permisos.js';
export type { Permiso } from './permisos.js';
export { Publico, RequierePermisos, PrincipalActual } from './decoradores.js';
export {
  asegurarAccesoEmpresa,
  asegurarRecursoDeEmpresa,
  tieneAccesoEmpresa,
  normalizarRut,
  contieneAcceso,
} from './principal.js';
export type { Principal, AccesoEmpresas } from './principal.js';
