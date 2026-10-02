import { registerEnumType } from '@nestjs/graphql';
import { InventorySide } from './inventory-side.enum.js';

// Registro único del enum para GraphQL (lo usan inventory-balance, inventory-movement e
// inventory-reservation); se importa por su efecto secundario desde cada dto/ que lo use, sin
// repetir la config (mismo patrón que common/dto/record-status.enum-type.ts).
registerEnumType(InventorySide, {
  name: 'InventorySide',
  description: 'Lado del par: completo, o solo el izquierdo o el derecho',
});
