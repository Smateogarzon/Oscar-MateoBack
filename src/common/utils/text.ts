// Texto libre (descripciones, motivos, referencias, notas) que se imprime en tirillas: sin caracteres de
// control. Un ESC (0x1B), GS (0x1D) o DLE (0x10) dentro de una descripción son comandos de la
// impresora térmica: `ESC p` abre el cajón y otros la dejan esperando datos. Se permiten el
// tabulador y los saltos de línea (0x09, 0x0A, 0x0D), que un campo de varias líneas usa a propósito.
// Los caracteres de control son justo lo que esta expresión busca: la regla no-control-regex no aplica.
// eslint-disable-next-line no-control-regex
export const SAFE_TEXT_PATTERN = /^[^\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]*$/;

export const SAFE_TEXT_MESSAGE = 'El texto no puede tener caracteres de control';
