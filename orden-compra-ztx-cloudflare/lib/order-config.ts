// Destinatarios internos que reciben avisos de firmas y recepciones confirmadas.
export const TEST_MODE = true;
export const TEST_EMAIL = 'santiagotdelsel@gmail.com';
export const INTERNAL_EMAILS = TEST_MODE ? [TEST_EMAIL] : ['notificaciones@tuempresa.com'];
// Remitente utilizado por Resend. En producción debe pertenecer a un dominio verificado.
export const FROM_EMAIL = 'onboarding@resend.dev';

export function parseEmailList(value: string) {
  return [...new Set(value.split(/[;,\s]+/).map((email) => email.trim().toLowerCase()).filter(Boolean))];
}
