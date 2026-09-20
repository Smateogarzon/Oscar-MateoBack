import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

@Injectable()
export class DocumentSequenceService {
  // Entrega el siguiente número de la serie de una empresa (1, 2, 3...). Se pide con el
  // manager de la transacción de quien va a usar el número: si esa transacción se revierte, el
  // número también, así que no quedan huecos en la numeración. Y como la fila del contador se
  // bloquea hasta que la transacción termina, dos peticiones a la vez nunca reciben el mismo.
  async next(manager: EntityManager, companyId: string, series: string): Promise<number> {
    const rows: { lastValue: number | string }[] = await manager.query(
      `INSERT INTO "document_sequences" ("companyId", "series", "lastValue")
       VALUES ($1, $2, 1)
       ON CONFLICT ("companyId", "series")
       DO UPDATE SET "lastValue" = "document_sequences"."lastValue" + 1
       RETURNING "lastValue"`,
      [companyId, series],
    );
    return Number(rows[0].lastValue);
  }
}
