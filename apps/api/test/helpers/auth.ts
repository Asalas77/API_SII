/** Clave de administración de los e2e (≥ 32 caracteres). Se fija ANTES de crear el módulo Nest. */
export const ADMIN_KEY = 'clave-admin-e2e-0123456789-abcdefghijklmnopqrstuvwxyz';

export function configurarAdminKey(): void {
  process.env.API_ADMIN_KEY = ADMIN_KEY;
}
