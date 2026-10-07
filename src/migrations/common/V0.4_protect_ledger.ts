import { MigrationInterface, QueryRunner } from 'typeorm';

// Candados en la base de datos para que el histórico de la caja no se pueda borrar desde una
// consola de SQL. Hasta ahora nada lo impedía: ninguna llave foránea apunta a cash_movements,
// sale_payments ni refund_payments (son hojas del esquema), las demás son ON DELETE NO ACTION pero
// eso solo protege al padre mientras el hijo exista, no había un solo trigger, y la app se conecta
// con el mismo usuario que es dueño de las tablas. Borrar "el día" —los movimientos, los pagos, los
// reembolsos, las ventas y por último el turno, de hijos a padres— salía sin una sola queja.
//
// Y eso descuadra la contabilidad de verdad: el efectivo esperado de un turno se calcula con los
// pagos, los movimientos y los reembolsos (ver cash-session-totals.ts) y al cerrarlo se CONGELA en
// cash_sessions.expectedAmount. Si después desaparece un movimiento, la cifra guardada ya no se
// puede reproducir con los datos que quedan; y si desaparece un reembolso, la devolución sigue
// diciendo que se le entregó al cliente un dinero que la caja nunca vio.
//
// Regla por tabla (los estados salen de los enums de cada módulo):
//   cash_movements, sale_payments, refund_payments  DELETE y UPDATE: nunca. Son asientos.
//   cash_sessions                                   DELETE: nunca. UPDATE: solo si sigue OPEN
//                                                   (al cerrar, el arqueo queda congelado).
//   sales, sale_items                               DELETE y UPDATE: solo mientras la venta es DRAFT.
//   discount_requests, discount_request_items       DELETE y UPDATE: solo si su venta es DRAFT.
//   sale_returns                                    DELETE: nunca (se cancela). UPDATE: no si ya
//                                                   está COMPLETED, REJECTED o CANCELLED.
//   sale_return_items                               DELETE y UPDATE: solo si su devolución es PENDING.
//   document_sequences                              DELETE: nunca (se reusarían números). UPDATE: sí,
//                                                   es el consecutivo y tiene que avanzar.
//   idempotency_keys                                DELETE: solo claves de más de 7 días. UPDATE: sí,
//                                                   ahí se guarda qué recurso creó la operación.
//   todas las de arriba                             TRUNCATE: nunca (no dispara los triggers de fila).
//
// Nada de esto le estorba a la aplicación: sus únicos borrados reales son de borradores —quitar una
// línea (SaleService.removeItem), descartar los borradores al cerrar el turno
// (CashSessionService.discardDraftSales), reemplazar las líneas de una devolución pendiente
// (SaleReturnService.edit)— y la purga de claves vencidas (idempotency.ts). Todos siguen pasando.
// Los UPDATE también: una venta solo se edita en borrador, un descuento solo mientras la venta es
// borrador, y un turno solo mientras está abierto.
//
// La llave explícita. Si algún día hay que tocar una fila de verdad (un dato corrupto, una
// corrección acordada con el contador), no se bajan los triggers: se pide permiso para esa
// transacción y queda un WARNING en el log del servidor con la tabla y la operación.
//
//   BEGIN;
//   SET LOCAL app.ledger_override = 'ON';
//   -- el arreglo, acotado con WHERE
//   COMMIT;
//
// No es una puerta trasera: es para que nadie tenga la tentación de hacer DROP TRIGGER (que sí es
// silencioso y queda así para siempre). Quien tiene acceso al SQL siempre podrá; lo que cambia es
// que ya no se puede por accidente ni de una sola línea. El candado que sí frena a un atacante con
// las credenciales de la app es el del punto 3 del plan: que la app se conecte con un rol que NO
// tenga el privilegio DELETE sobre estas tablas y que el dueño quede solo para las migraciones.
export class ProtectLedger1790500000000 implements MigrationInterface {
  name = 'ProtectLedger1790500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ¿Se pidió permiso explícito en esta transacción? `current_setting(..., true)` devuelve NULL
    // en vez de fallar cuando el parámetro no existe, que es el caso normal.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION ledger_override_active() RETURNS boolean
        LANGUAGE sql STABLE SET search_path = public, pg_temp AS
      $fn$ SELECT coalesce(current_setting('app.ledger_override', true), '') = 'ON' $fn$
    `);

    // Asientos puros: la fila se escribe una vez y no cambia nunca más.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION ledger_frozen_row() RETURNS trigger
        LANGUAGE plpgsql SET search_path = public, pg_temp AS
      $fn$
      BEGIN
        IF ledger_override_active() THEN
          RAISE WARNING '[contable] % permitido en % por app.ledger_override (fila %)', TG_OP, TG_TABLE_NAME, OLD.id;
          IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
          RETURN NEW;
        END IF;
        RAISE EXCEPTION '[contable] % bloqueado en %: es un registro contable, no se borra ni se edita', TG_OP, TG_TABLE_NAME
          USING ERRCODE = 'restrict_violation',
                HINT = 'Un error se corrige registrando otro movimiento o documento que lo compense, nunca borrando el original.';
      END $fn$
    `);

    // Vaciar la tabla no dispara los triggers de fila: TRUNCATE necesita su propio candado.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION ledger_no_truncate() RETURNS trigger
        LANGUAGE plpgsql SET search_path = public, pg_temp AS
      $fn$
      BEGIN
        IF ledger_override_active() THEN
          RAISE WARNING '[contable] TRUNCATE permitido en % por app.ledger_override', TG_TABLE_NAME;
          RETURN NULL;
        END IF;
        RAISE EXCEPTION '[contable] TRUNCATE bloqueado en %: vaciarla borra el histórico de la caja', TG_TABLE_NAME
          USING ERRCODE = 'restrict_violation';
      END $fn$
    `);

    // Un turno no se borra nunca. Se edita mientras está abierto (el cierre, el código del día, los
    // intentos fallidos); una vez cerrado, su arqueo queda como quedó.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION cash_sessions_guard() RETURNS trigger
        LANGUAGE plpgsql SET search_path = public, pg_temp AS
      $fn$
      BEGIN
        IF ledger_override_active() THEN
          RAISE WARNING '[contable] % permitido en cash_sessions por app.ledger_override (turno %)', TG_OP, OLD.id;
          IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
          RETURN NEW;
        END IF;
        IF TG_OP = 'UPDATE' THEN
          IF OLD.status <> 'CLOSED' THEN RETURN NEW; END IF;
          RAISE EXCEPTION '[contable] El turno % ya está cerrado: su arqueo no se edita', OLD.id
            USING ERRCODE = 'restrict_violation',
                  HINT = 'Un descuadre encontrado después del cierre se corrige con un movimiento de ajuste en un turno nuevo.';
        END IF;
        RAISE EXCEPTION '[contable] Un turno de caja no se borra (turno %)', OLD.id
          USING ERRCODE = 'restrict_violation';
      END $fn$
    `);

    // Una venta cobrada o anulada ya es un documento con número: no se borra ni se edita.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION sales_guard() RETURNS trigger
        LANGUAGE plpgsql SET search_path = public, pg_temp AS
      $fn$
      BEGIN
        IF ledger_override_active() THEN
          RAISE WARNING '[contable] % permitido en sales por app.ledger_override (venta %)', TG_OP, OLD.id;
          IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
          RETURN NEW;
        END IF;
        IF OLD.status = 'DRAFT' THEN
          IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
          RETURN NEW;
        END IF;
        RAISE EXCEPTION '[contable] % bloqueado en la venta %: ya está %', TG_OP, coalesce(OLD."saleNumber", OLD.id::text), OLD.status
          USING ERRCODE = 'restrict_violation',
                HINT = 'Una venta cobrada se corrige con una devolución; una anulada ya dejó por qué y quién.';
      END $fn$
    `);

    // Las líneas viven mientras su venta es borrador. Después son el detalle de la factura.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION sale_items_guard() RETURNS trigger
        LANGUAGE plpgsql SET search_path = public, pg_temp AS
      $fn$
      DECLARE sale_status text;
      BEGIN
        IF ledger_override_active() THEN
          RAISE WARNING '[contable] % permitido en sale_items por app.ledger_override (línea %)', TG_OP, OLD.id;
          IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
          RETURN NEW;
        END IF;
        SELECT s.status::text INTO sale_status FROM sales s WHERE s.id = OLD."saleId";
        IF sale_status = 'DRAFT' THEN
          IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
          RETURN NEW;
        END IF;
        RAISE EXCEPTION '[contable] % bloqueado en la línea %: su venta ya no es un borrador (%)', TG_OP, OLD.id, coalesce(sale_status, 'venta inexistente')
          USING ERRCODE = 'restrict_violation',
                HINT = 'Las líneas de una venta cobrada son el detalle de la factura: se devuelven, no se editan.';
      END $fn$
    `);

    // Un descuento solo se pide, aprueba, edita o cancela mientras la venta es borrador. Aprobado
    // sobre una venta ya cobrada, ese monto ya bajó el total de la factura.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION discount_requests_guard() RETURNS trigger
        LANGUAGE plpgsql SET search_path = public, pg_temp AS
      $fn$
      DECLARE sale_status text;
      BEGIN
        IF ledger_override_active() THEN
          RAISE WARNING '[contable] % permitido en discount_requests por app.ledger_override (solicitud %)', TG_OP, OLD.id;
          IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
          RETURN NEW;
        END IF;
        SELECT s.status::text INTO sale_status FROM sales s WHERE s.id = OLD."saleId";
        IF sale_status = 'DRAFT' THEN
          IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
          RETURN NEW;
        END IF;
        RAISE EXCEPTION '[contable] % bloqueado en la solicitud de descuento %: su venta ya no es un borrador (%)', TG_OP, OLD.id, coalesce(sale_status, 'venta inexistente')
          USING ERRCODE = 'restrict_violation',
                HINT = 'El descuento ya se aplicó al total cobrado: cambiarlo ahora cambiaría una factura.';
      END $fn$
    `);

    // Los montos por línea de una solicitud, con la misma regla. Llegan también por la cascada de
    // sale_items (el único ON DELETE CASCADE del esquema): ahí la venta todavía existe y es borrador.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION discount_request_items_guard() RETURNS trigger
        LANGUAGE plpgsql SET search_path = public, pg_temp AS
      $fn$
      DECLARE sale_status text;
      BEGIN
        IF ledger_override_active() THEN
          RAISE WARNING '[contable] % permitido en discount_request_items por app.ledger_override (fila %)', TG_OP, OLD.id;
          IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
          RETURN NEW;
        END IF;
        SELECT s.status::text INTO sale_status
          FROM discount_requests dr
          JOIN sales s ON s.id = dr."saleId"
         WHERE dr.id = OLD."discountRequestId";
        IF sale_status = 'DRAFT' THEN
          IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
          RETURN NEW;
        END IF;
        RAISE EXCEPTION '[contable] % bloqueado en el descuento por línea %: su venta ya no es un borrador (%)', TG_OP, OLD.id, coalesce(sale_status, 'venta inexistente')
          USING ERRCODE = 'restrict_violation';
      END $fn$
    `);

    // Una devolución nace con número (DEV-…): no se borra, se cancela. Y una vez terminada,
    // rechazada o cancelada, tampoco se edita.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION sale_returns_guard() RETURNS trigger
        LANGUAGE plpgsql SET search_path = public, pg_temp AS
      $fn$
      BEGIN
        IF ledger_override_active() THEN
          RAISE WARNING '[contable] % permitido en sale_returns por app.ledger_override (devolución %)', TG_OP, OLD.id;
          IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
          RETURN NEW;
        END IF;
        IF TG_OP = 'UPDATE' THEN
          IF OLD.status NOT IN ('COMPLETED', 'REJECTED', 'CANCELLED') THEN RETURN NEW; END IF;
          RAISE EXCEPTION '[contable] La devolución % ya está %: no se edita', OLD."returnNumber", OLD.status
            USING ERRCODE = 'restrict_violation';
        END IF;
        RAISE EXCEPTION '[contable] Una devolución no se borra: se cancela (devolución %)', OLD."returnNumber"
          USING ERRCODE = 'restrict_violation',
                HINT = 'Cancelarla deja quién y cuándo; borrarla deja la venta original diciendo que nunca se devolvió nada.';
      END $fn$
    `);

    // Las líneas de una devolución se reemplazan mientras está pendiente de aprobación (así la
    // edita el administrador). Aprobada, ya valoran un dinero que se va a entregar.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION sale_return_items_guard() RETURNS trigger
        LANGUAGE plpgsql SET search_path = public, pg_temp AS
      $fn$
      DECLARE return_status text;
      BEGIN
        IF ledger_override_active() THEN
          RAISE WARNING '[contable] % permitido en sale_return_items por app.ledger_override (línea %)', TG_OP, OLD.id;
          IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
          RETURN NEW;
        END IF;
        SELECT r.status::text INTO return_status FROM sale_returns r WHERE r.id = OLD."saleReturnId";
        IF return_status = 'PENDING' THEN
          IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
          RETURN NEW;
        END IF;
        RAISE EXCEPTION '[contable] % bloqueado en la línea de devolución %: su devolución ya no está pendiente (%)', TG_OP, OLD.id, coalesce(return_status, 'devolución inexistente')
          USING ERRCODE = 'restrict_violation';
      END $fn$
    `);

    // Borrar un consecutivo hace que la empresa vuelva a emitir números de venta o de devolución
    // que ya existen. Actualizarlo sí: es lo que hace avanzar la numeración.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION document_sequences_guard() RETURNS trigger
        LANGUAGE plpgsql SET search_path = public, pg_temp AS
      $fn$
      BEGIN
        IF ledger_override_active() THEN
          RAISE WARNING '[contable] DELETE permitido en document_sequences por app.ledger_override (fila %)', OLD.id;
          RETURN OLD;
        END IF;
        RAISE EXCEPTION '[contable] Un consecutivo no se borra: se volverían a emitir números ya usados (fila %)', OLD.id
          USING ERRCODE = 'restrict_violation';
      END $fn$
    `);

    // Las claves vencidas se purgan (idempotency.ts lo hace con las de más de 7 días). Borrar una
    // vigente deja repetir el cobro o el retiro que ya se hizo.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION idempotency_keys_guard() RETURNS trigger
        LANGUAGE plpgsql SET search_path = public, pg_temp AS
      $fn$
      BEGIN
        IF ledger_override_active() THEN
          RAISE WARNING '[contable] DELETE permitido en idempotency_keys por app.ledger_override (clave %)', OLD.id;
          RETURN OLD;
        END IF;
        IF OLD."createdAt" < now() - interval '7 days' THEN RETURN OLD; END IF;
        RAISE EXCEPTION '[contable] Una clave de idempotencia se borra solo después de 7 días: borrarla antes deja repetir un cobro o un retiro (clave %)', OLD.id
          USING ERRCODE = 'restrict_violation';
      END $fn$
    `);

    await queryRunner.query(`
      CREATE TRIGGER trg_cash_movements_ledger BEFORE UPDATE OR DELETE ON "cash_movements"
        FOR EACH ROW EXECUTE FUNCTION ledger_frozen_row()
    `);
    await queryRunner.query(`
      CREATE TRIGGER trg_sale_payments_ledger BEFORE UPDATE OR DELETE ON "sale_payments"
        FOR EACH ROW EXECUTE FUNCTION ledger_frozen_row()
    `);
    await queryRunner.query(`
      CREATE TRIGGER trg_refund_payments_ledger BEFORE UPDATE OR DELETE ON "refund_payments"
        FOR EACH ROW EXECUTE FUNCTION ledger_frozen_row()
    `);
    await queryRunner.query(`
      CREATE TRIGGER trg_cash_sessions_ledger BEFORE UPDATE OR DELETE ON "cash_sessions"
        FOR EACH ROW EXECUTE FUNCTION cash_sessions_guard()
    `);
    await queryRunner.query(`
      CREATE TRIGGER trg_sales_ledger BEFORE UPDATE OR DELETE ON "sales"
        FOR EACH ROW EXECUTE FUNCTION sales_guard()
    `);
    await queryRunner.query(`
      CREATE TRIGGER trg_sale_items_ledger BEFORE UPDATE OR DELETE ON "sale_items"
        FOR EACH ROW EXECUTE FUNCTION sale_items_guard()
    `);
    await queryRunner.query(`
      CREATE TRIGGER trg_discount_requests_ledger BEFORE UPDATE OR DELETE ON "discount_requests"
        FOR EACH ROW EXECUTE FUNCTION discount_requests_guard()
    `);
    await queryRunner.query(`
      CREATE TRIGGER trg_discount_request_items_ledger BEFORE UPDATE OR DELETE ON "discount_request_items"
        FOR EACH ROW EXECUTE FUNCTION discount_request_items_guard()
    `);
    await queryRunner.query(`
      CREATE TRIGGER trg_sale_returns_ledger BEFORE UPDATE OR DELETE ON "sale_returns"
        FOR EACH ROW EXECUTE FUNCTION sale_returns_guard()
    `);
    await queryRunner.query(`
      CREATE TRIGGER trg_sale_return_items_ledger BEFORE UPDATE OR DELETE ON "sale_return_items"
        FOR EACH ROW EXECUTE FUNCTION sale_return_items_guard()
    `);
    await queryRunner.query(`
      CREATE TRIGGER trg_document_sequences_ledger BEFORE DELETE ON "document_sequences"
        FOR EACH ROW EXECUTE FUNCTION document_sequences_guard()
    `);
    await queryRunner.query(`
      CREATE TRIGGER trg_idempotency_keys_ledger BEFORE DELETE ON "idempotency_keys"
        FOR EACH ROW EXECUTE FUNCTION idempotency_keys_guard()
    `);

    // El candado contra TRUNCATE para todas, y ENABLE ALWAYS para las dos series de triggers: un
    // trigger normal NO se dispara cuando la sesión pone session_replication_role = 'replica', que
    // es la receta más repetida de internet para "desactivar los triggers un momento". Con ALWAYS
    // se disparan igual.
    await queryRunner.query(`
      DO $do$
      DECLARE
        target text;
        ledger_tables text[] := ARRAY[
          'cash_movements', 'sale_payments', 'refund_payments', 'cash_sessions',
          'sales', 'sale_items', 'discount_requests', 'discount_request_items',
          'sale_returns', 'sale_return_items', 'document_sequences', 'idempotency_keys'
        ];
      BEGIN
        FOREACH target IN ARRAY ledger_tables LOOP
          EXECUTE format(
            'CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION ledger_no_truncate()',
            'trg_' || target || '_no_truncate', target);
          EXECUTE format('ALTER TABLE %I ENABLE ALWAYS TRIGGER %I', target, 'trg_' || target || '_no_truncate');
          EXECUTE format('ALTER TABLE %I ENABLE ALWAYS TRIGGER %I', target, 'trg_' || target || '_ledger');
        END LOOP;
      END $do$
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $do$
      DECLARE
        target text;
        ledger_tables text[] := ARRAY[
          'cash_movements', 'sale_payments', 'refund_payments', 'cash_sessions',
          'sales', 'sale_items', 'discount_requests', 'discount_request_items',
          'sale_returns', 'sale_return_items', 'document_sequences', 'idempotency_keys'
        ];
      BEGIN
        FOREACH target IN ARRAY ledger_tables LOOP
          EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', 'trg_' || target || '_no_truncate', target);
          EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', 'trg_' || target || '_ledger', target);
        END LOOP;
      END $do$
    `);

    await queryRunner.query(`DROP FUNCTION IF EXISTS idempotency_keys_guard()`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS document_sequences_guard()`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS sale_return_items_guard()`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS sale_returns_guard()`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS discount_request_items_guard()`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS discount_requests_guard()`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS sale_items_guard()`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS sales_guard()`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS cash_sessions_guard()`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS ledger_no_truncate()`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS ledger_frozen_row()`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS ledger_override_active()`);
  }
}
