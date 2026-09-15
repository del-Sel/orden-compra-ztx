// Remitente utilizado por Resend. En producción debe pertenecer a un dominio verificado.
export const FROM_EMAIL = 'onboarding@resend.dev';

export function parseEmailList(value: string) {
  return [...new Set(value.split(/[;,\s]+/).map((email) => email.trim().toLowerCase()).filter(Boolean))];
}
