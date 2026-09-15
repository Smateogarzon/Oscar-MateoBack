import { registerEnumType } from '@nestjs/graphql';
import { RecordStatus } from '../enums/record-status.enum.js';

// Registro único del enum para GraphQL; se importa por su efecto secundario
// desde cada dto/ que use RecordStatus, sin repetir la config.
registerEnumType(RecordStatus, {
  name: 'RecordStatus',
  description: 'Estado genérico activo/inactivo',
});
