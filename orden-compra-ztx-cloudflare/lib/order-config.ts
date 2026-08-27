// Modo de prueba: todos los avisos se envían a esta dirección hasta desactivarlo.
export const TEST_MODE = true;
export const TEST_EMAIL = 'santiagotdelsel@gmail.com';

// En producción, reemplazá estos destinatarios y desactivá TEST_MODE.
export const CLIENT_EMAIL = TEST_MODE ? TEST_EMAIL : 'cliente@empresa.com';
export const INTERNAL_EMAIL = TEST_MODE ? TEST_EMAIL : 'notificaciones@tuempresa.com';
// Remitente de prueba aceptado por Resend. En producción debe ser un dominio verificado.
export const FROM_EMAIL = 'onboarding@resend.dev';
