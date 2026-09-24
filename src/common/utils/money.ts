export const MONEY_PATTERN = /^\d{1,12}(\.\d{1,2})?$/;

export const QUANTITY_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;

// Un monto que puede ser negativo, como lo contado en el arqueo de un turno.
export const SIGNED_MONEY_PATTERN = /^-?\d{1,12}(\.\d{1,2})?$/;
