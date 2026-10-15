// El recorrido completo de las órdenes internas contra un Postgres REAL, con la app entera levantada
// (servicios, transacciones, reservas, kárdex, triggers contables): ninguna Repository mockeada.
//
// Como el kárdex y las ventas no se pueden borrar (candados contables de
// migrations/common/V0.4_protect_ledger.ts), no corre sobre la base de desarrollo: crea una base
// desechable en el mismo servidor, le corre TODAS las migraciones, levanta la app contra ella, recorre
// los flujos y al final la borra entera. No deja una sola fila en la base de desarrollo.
//
// Cómo correr solo este archivo:
//   npx vitest run --config vitest.config.e2e.ts test/internal-order-flow.e2e-spec.ts
//
// SAFETY: igual que los tests de integración, solo corre contra el Postgres local (DB_HOST=localhost
// y DB_PORT=5432, o ALLOW_DB_WRITES=1); si no, se salta.
import 'dotenv/config';
import { execSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import pg from 'pg';

const RUN = `ordflow_${Date.now().toString(36)}`;
const dbPort = process.env.DB_PORT || '5432';
const local =
  (process.env.DB_HOST === 'localhost' || process.env.DB_HOST === '127.0.0.1') &&
  (dbPort === '5432' || process.env.ALLOW_DB_WRITES === '1');

const admin = new pg.Pool({
  host: process.env.DB_HOST,
  port: Number(dbPort),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  max: 1,
});

let available = false;
if (local) {
  try {
    await admin.query('SELECT 1');
    available = true;
  } catch {
    await admin.end().catch(() => {});
  }
}

const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Cada flujo son decenas de transacciones reales: el límite de 5 s por prueba no alcanza.
vi.setConfig({ testTimeout: 60_000 });

describe.skipIf(!available)('Órdenes internas: flujos completos (Postgres real)', () => {
  let app: INestApplication;
  let db: pg.Pool;
  // Los servicios, ya resueltos por Nest.
  let orders: import('../src/graphql/internal-order/internal-order.service.js').InternalOrderService;
  let sales: import('../src/graphql/sale/sale.service.js').SaleService;
  let payments: import('../src/graphql/sale-payment/sale-payment.service.js').SalePaymentService;

  const ids = {} as Record<
    'company' | 'seller' | 'warehouse' | 'runner' | 'cashier' | 'wh' | 'wh2' | 'store' | 'whStock' | 'wh2Stock' | 'storeStock' | 'variantA' | 'variantB' | 'register' | 'session' | 'cash',
    string
  >;
  const PRICE = 100000;

  // Los permisos de cada quien, como los dejaría el reparto por rol de la semilla.
  const actor = (key: 'seller' | 'warehouse' | 'runner' | 'cashier') => {
    const permissions = {
      seller: ['orders.view', 'orders.request_from_warehouse', 'orders.confirm_receipt'],
      warehouse: ['orders.view', 'warehouse.fulfill_orders', 'warehouse.receive_returns', 'inventory.transfer'],
      runner: ['orders.view', 'runner.pickup_orders', 'runner.confirm_delivery'],
      cashier: ['cash.register_payment', 'cash.charge_orders', 'sales.create', 'sales.view'],
    }[key];
    return { userId: ids[key], permissionCodes: permissions, isSuperAdmin: false };
  };
  const cashier = () => ({ userId: ids.cashier, canViewAll: false, canManageShifts: false });

  const balance = async (inventoryLocationId: string, variantId: string) => {
    const { rows } = await db.query(
      `SELECT COALESCE(SUM(quantity), 0)::float AS q FROM inventory_balances WHERE "inventoryLocationId" = $1 AND "productVariantId" = $2`,
      [inventoryLocationId, variantId],
    );
    return rows[0].q as number;
  };
  const reserved = async (sourceId: string) => {
    const { rows } = await db.query(
      `SELECT "inventoryLocationId", "sourceType", quantity::float AS q FROM inventory_reservations WHERE "sourceId" = $1`,
      [sourceId],
    );
    return rows as { inventoryLocationId: string; sourceType: string; q: number }[];
  };
  const runnerBag = async () => {
    const { rows } = await db.query(`SELECT id FROM inventory_locations WHERE type = 'RUNNER' AND "custodianUserId" = $1`, [ids.runner]);
    return rows[0]?.id as string;
  };
  const returnsOf = async (locationId: string) => {
    const { rows } = await db.query(`SELECT id FROM inventory_locations WHERE type = 'RETURNS' AND "locationId" = $1`, [locationId]);
    return rows[0]?.id as string;
  };

  const go = (key: 'seller' | 'warehouse' | 'runner' | 'cashier', id: string, to: string, extra: Record<string, unknown> = {}) =>
    orders.transition(ids.company, actor(key), { id, to: to as never, ...extra });

  beforeAll(async () => {
    await admin.query(`CREATE DATABASE "${RUN}"`);
    db = new pg.Pool({
      host: process.env.DB_HOST,
      port: Number(dbPort),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: RUN,
      max: 3,
    });
    await db.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');

    // Las migraciones con el mismo comando del proyecto (npm run migration:run), apuntado a esta base.
    execSync('npm run migration:run', { cwd: projectDir, env: { ...process.env, DB_NAME: RUN }, stdio: 'ignore' });

    process.env.DB_NAME = RUN;
    const { AppModule } = await import('../src/app.module.js');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    orders = app.get((await import('../src/graphql/internal-order/internal-order.service.js')).InternalOrderService);
    sales = app.get((await import('../src/graphql/sale/sale.service.js')).SaleService);
    payments = app.get((await import('../src/graphql/sale-payment/sale-payment.service.js')).SalePaymentService);

    // Una empresa con una bodega, una segunda bodega, una tienda, dos tallas de un producto y una caja abierta.
    const one = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows[0].id as string;
    ids.company = await one(`INSERT INTO companies (name, "taxId") VALUES ('Flujo', $1) RETURNING id`, [RUN.slice(0, 30)]);
    for (const key of ['seller', 'warehouse', 'runner', 'cashier'] as const) {
      ids[key] = await one(`INSERT INTO users ("firstName", "lastName", email, "passwordHash") VALUES ($1, 'Prueba', $2, 'x') RETURNING id`, [
        key,
        `${key}.${RUN}@test.local`,
      ]);
    }
    ids.wh = await one(`INSERT INTO locations ("companyId", name, type) VALUES ($1, 'Bodega Central', 'WAREHOUSE') RETURNING id`, [ids.company]);
    ids.wh2 = await one(`INSERT INTO locations ("companyId", name, type) VALUES ($1, 'Bodega Norte', 'WAREHOUSE') RETURNING id`, [ids.company]);
    ids.store = await one(`INSERT INTO locations ("companyId", name, type) VALUES ($1, 'Tienda Centro', 'STORE') RETURNING id`, [ids.company]);
    ids.whStock = await one(`INSERT INTO inventory_locations ("companyId", "locationId", type) VALUES ($1, $2, 'STOCK') RETURNING id`, [ids.company, ids.wh]);
    ids.wh2Stock = await one(`INSERT INTO inventory_locations ("companyId", "locationId", type) VALUES ($1, $2, 'STOCK') RETURNING id`, [ids.company, ids.wh2]);
    ids.storeStock = await one(`INSERT INTO inventory_locations ("companyId", "locationId", type) VALUES ($1, $2, 'STOCK') RETURNING id`, [ids.company, ids.store]);
    for (const key of ['seller', 'cashier'] as const) {
      await db.query(`INSERT INTO user_location_access ("userId", "locationId") VALUES ($1, $2)`, [ids[key], ids.store]);
    }
    const category = await one(`INSERT INTO categories ("companyId", name, slug) VALUES ($1, 'Tenis', 'tenis') RETURNING id`, [ids.company]);
    const color = await one(`INSERT INTO colors (name, hex) VALUES ($1, '#FFFFFF') RETURNING id`, [`Blanco ${RUN}`]);
    const size40 = await one(`INSERT INTO sizes (name) VALUES ($1) RETURNING id`, [`40 ${RUN}`]);
    const size41 = await one(`INSERT INTO sizes (name) VALUES ($1) RETURNING id`, [`41 ${RUN}`]);
    const product = await one(`INSERT INTO products ("companyId", "categoryId", name, reference) VALUES ($1, $2, 'Air Force 1', $3) RETURNING id`, [
      ids.company,
      category,
      `AF1-${RUN}`,
    ]);
    ids.variantA = await one(
      `INSERT INTO product_variants ("companyId", "productId", "colorId", "sizeId", sku, cost, price) VALUES ($1, $2, $3, $4, $5, 50000, $6) RETURNING id`,
      [ids.company, product, color, size40, `AF1-40-${RUN}`, PRICE],
    );
    ids.variantB = await one(
      `INSERT INTO product_variants ("companyId", "productId", "colorId", "sizeId", sku, cost, price) VALUES ($1, $2, $3, $4, $5, 50000, $6) RETURNING id`,
      [ids.company, product, color, size41, `AF1-41-${RUN}`, PRICE],
    );
    // Existencia inicial: 20 de cada talla en la bodega central, 3 de la 41 en la del norte.
    for (const [loc, variant, qty] of [
      [ids.whStock, ids.variantA, 20],
      [ids.whStock, ids.variantB, 20],
      [ids.wh2Stock, ids.variantB, 3],
    ] as const) {
      await db.query(`INSERT INTO inventory_balances ("productVariantId", "inventoryLocationId", quantity) VALUES ($1, $2, $3)`, [variant, loc, qty]);
    }
    ids.register = await one(`INSERT INTO cash_registers ("storeId", name, code) VALUES ($1, 'Caja 1', $2) RETURNING id`, [ids.store, `C${RUN}`.slice(0, 20)]);
    ids.session = await one(
      `INSERT INTO cash_sessions ("cashRegisterId", "openedBy", "cashierId", "movementCode", "openingAmount", status) VALUES ($1, $2, $2, '123456', 0, 'OPEN') RETURNING id`,
      [ids.register, ids.cashier],
    );
    ids.cash = await one(`INSERT INTO payment_methods ("companyId", name, type) VALUES ($1, 'Efectivo', 'CASH') RETURNING id`, [ids.company]);
    await db.query(`INSERT INTO store_payment_methods ("storeId", "paymentMethodId") VALUES ($1, $2)`, [ids.store, ids.cash]);
  }, 600_000);

  afterAll(async () => {
    await app?.close();
    await db?.end();
    await admin.query(`DROP DATABASE IF EXISTS "${RUN}" WITH (FORCE)`);
    await admin.end();
  });

  const request = (type: 'SO' | 'TR' | 'RS', variantId: string, quantity: string, source = ids.wh, by: 'seller' | 'warehouse' = 'seller') =>
    orders.request(ids.company, actor(by), {
      type: type as never,
      origin: 'SELLER' as never,
      sourceLocationId: source,
      destinationLocationId: ids.store,
      deliveryPoint: 'Probador #02',
      items: [{ productVariantId: variantId, quantity }],
    });

  // Lleva una SO desde que se pide hasta que el vendedor la tiene en la mano.
  const toSeller = async (id: string) => {
    await go('warehouse', id, 'ACCEPTED_BY_WAREHOUSE');
    await go('warehouse', id, 'PACKING');
    await go('warehouse', id, 'READY_FOR_RUNNER');
    await go('runner', id, 'IN_TRANSIT');
    await go('runner', id, 'DELIVERED_TO_STORE');
    await go('seller', id, 'RECEIVED_BY_SELLER');
  };

  it('SO: se pide, se aparta, recorre el flujo y se cobra en caja (queda pagada y ligada a la venta)', async () => {
    const order = await request('SO', ids.variantA, '2');
    expect(order.orderNumber).toBe('SO-000001');
    expect(order.status).toBe('NEW');
    expect(await reserved(order.id)).toEqual([{ inventoryLocationId: ids.whStock, sourceType: 'TRANSFER_REQUEST', q: 2 }]);

    await go('warehouse', order.id, 'ACCEPTED_BY_WAREHOUSE');
    await go('warehouse', order.id, 'PACKING');
    await go('warehouse', order.id, 'READY_FOR_RUNNER');
    // Solo un corredor recoge; nadie se salta pasos.
    await expect(go('seller', order.id, 'IN_TRANSIT')).rejects.toThrow();
    await expect(go('runner', order.id, 'DELIVERED_TO_STORE')).rejects.toThrow();

    await go('runner', order.id, 'IN_TRANSIT');
    expect(await reserved(order.id)).toEqual([]);
    expect(await balance(ids.whStock, ids.variantA)).toBe(18);
    expect(await balance(await runnerBag(), ids.variantA)).toBe(2);

    await go('runner', order.id, 'DELIVERED_TO_STORE');
    expect(await balance(ids.storeStock, ids.variantA)).toBe(2);
    expect(await reserved(order.id)).toEqual([{ inventoryLocationId: ids.storeStock, sourceType: 'TRANSFER_REQUEST', q: 2 }]);

    await go('seller', order.id, 'RECEIVED_BY_SELLER');
    await go('seller', order.id, 'PENDING_PAYMENT');

    const sale = await sales.createFromInternalOrder(ids.company, cashier(), { internalOrderId: order.id, cashSessionId: ids.session });
    expect(sale.internalOrderId).toBe(order.id);
    expect(Number(sale.total)).toBe(2 * PRICE);
    expect(await reserved(order.id)).toEqual([]);
    expect(await reserved(sale.id)).toEqual([{ inventoryLocationId: ids.storeStock, sourceType: 'SALE', q: 2 }]);
    // Abrirla otra vez devuelve el mismo cobro.
    const again = await sales.createFromInternalOrder(ids.company, cashier(), { internalOrderId: order.id, cashSessionId: ids.session });
    expect(again.id).toBe(sale.id);

    const paid = await payments.complete(ids.company, cashier(), {
      saleId: sale.id,
      payments: [{ paymentMethodId: ids.cash, amount: String(2 * PRICE) }],
    } as never);
    expect(paid.status).toBe('COMPLETED');
    expect(await balance(ids.storeStock, ids.variantA)).toBe(0);

    const view = await orders.findView(ids.company, order.id);
    expect(view.status).toBe('PAID');
    expect(view.saleId).toBe(sale.id);
    expect(view.saleNumber).toBe(paid.saleNumber);
    expect(view.events.filter((event) => event.kind === 'STATUS').map((event) => event.toStatus)).toEqual([
      'NEW',
      'ACCEPTED_BY_WAREHOUSE',
      'PACKING',
      'READY_FOR_RUNNER',
      'IN_TRANSIT',
      'DELIVERED_TO_STORE',
      'RECEIVED_BY_SELLER',
      'PENDING_PAYMENT',
      'PAID',
    ]);
  });

  it('SO: anular el cobro en caja le devuelve la reserva a la orden, que sigue por cobrar', async () => {
    const order = await request('SO', ids.variantA, '1');
    await toSeller(order.id);
    await go('seller', order.id, 'PENDING_PAYMENT');
    const sale = await sales.createFromInternalOrder(ids.company, cashier(), { internalOrderId: order.id, cashSessionId: ids.session });
    // Con el cobro abierto, la orden no se devuelve al vendedor.
    await expect(go('cashier', order.id, 'RECEIVED_BY_SELLER')).rejects.toThrow(/Caja tiene abierto/);

    await sales.cancel(ids.company, { userId: ids.cashier, canCancelAny: false }, sale.id, { reason: 'El cliente se arrepintió' });
    expect(await reserved(sale.id)).toEqual([]);
    expect(await reserved(order.id)).toEqual([{ inventoryLocationId: ids.storeStock, sourceType: 'TRANSFER_REQUEST', q: 1 }]);
    expect((await orders.findView(ids.company, order.id)).status).toBe('PENDING_PAYMENT');
  });

  it('SO → no compra: nace la RE, vuelve a bodega por el cajón de devoluciones y cierra la SO como devuelta', async () => {
    const stockBefore = await balance(ids.whStock, ids.variantB);
    const order = await request('SO', ids.variantB, '1');
    await toSeller(order.id);
    await go('seller', order.id, 'RETURN_REQUESTED');

    const sale = await orders.findView(ids.company, order.id);
    expect(sale.versionNumber).toBe(2);
    const ret = await orders.findView(ids.company, sale.relatedOrderId!);
    expect(ret.type).toBe('RE');
    expect(ret.orderNumber).toMatch(/^RE-0000\d\d$/);
    expect(ret.status).toBe('WAITING_FOR_RUNNER');
    expect(ret.relatedOrderId).toBe(order.id);
    expect(await reserved(order.id)).toEqual([]);
    expect(await reserved(ret.id)).toEqual([{ inventoryLocationId: ids.storeStock, sourceType: 'TRANSFER_REQUEST', q: 1 }]);

    await go('runner', ret.id, 'IN_TRANSIT_TO_WAREHOUSE');
    await go('runner', ret.id, 'DELIVERED_TO_WAREHOUSE');
    expect(await balance(await returnsOf(ids.wh), ids.variantB)).toBe(1);
    await go('warehouse', ret.id, 'RECEIVED_BY_WAREHOUSE');
    await go('warehouse', ret.id, 'RETURNED');
    expect(await balance(ids.whStock, ids.variantB)).toBe(stockBefore);
    expect((await orders.findView(ids.company, order.id)).status).toBe('RETURNED');
  });

  it('SO → cambio de pedido: RE de lo que sale + sub-orden de otra bodega que se une a la original', async () => {
    const order = await request('SO', ids.variantA, '1');
    await toSeller(order.id);
    const [item] = (await orders.findView(ids.company, order.id)).items;

    await orders.requestChange(ids.company, actor('seller'), {
      orderId: order.id,
      sourceLocationId: ids.wh2,
      lines: [{ itemId: item.id, productVariantId: ids.variantB, quantity: '1' }],
    });
    const parent = await orders.findView(ids.company, order.id);
    expect(parent.status).toBe('ITEM_CHANGE_REQUESTED');
    expect(parent.versionNumber).toBe(2);
    expect(parent.items).toHaveLength(0);
    const [sub] = await orders.findSubOrders(ids.company, order.id);
    expect(sub.parentOrderId).toBe(order.id);
    expect(sub.priority).toBe('HIGH');
    expect(await reserved(sub.id)).toEqual([{ inventoryLocationId: ids.wh2Stock, sourceType: 'TRANSFER_REQUEST', q: 1 }]);
    const ret = await orders.findView(ids.company, parent.relatedOrderId!);
    expect(ret.type).toBe('RE');
    expect(ret.status).toBe('WAITING_FOR_RUNNER');

    await toSeller(sub.id);
    // Una sub-orden recibida no se cobra: se une.
    await expect(go('seller', sub.id, 'PENDING_PAYMENT')).rejects.toThrow(/se une/);
    await go('seller', sub.id, 'MERGED_INTO_PARENT');

    const merged = await orders.findView(ids.company, order.id);
    expect(merged.status).toBe('RECEIVED_BY_SELLER');
    expect(merged.versionNumber).toBe(3);
    expect(merged.items.map((line) => line.productVariantId)).toEqual([ids.variantB]);
    expect(await reserved(order.id)).toEqual([{ inventoryLocationId: ids.storeStock, sourceType: 'TRANSFER_REQUEST', q: 1 }]);
    expect((await orders.findView(ids.company, sub.id)).status).toBe('MERGED_INTO_PARENT');
    expect(await orders.findVersions(ids.company, actor('seller'), order.id)).toHaveLength(3);
  });

  it('RS: un surtido de bodega a tienda recorre su flujo y mueve la existencia', async () => {
    const storeBefore = await balance(ids.storeStock, ids.variantA);
    const order = await request('RS', ids.variantA, '1', ids.wh, 'warehouse');
    expect(order.orderNumber).toBe('RS-000001');
    expect(order.status).toBe('RESTOCK_REQUESTED');
    await go('warehouse', order.id, 'WAITING_FOR_RUNNER');
    await go('runner', order.id, 'IN_TRANSIT');
    await go('runner', order.id, 'DELIVERED_TO_STORE');
    await go('warehouse', order.id, 'RECEIVED_BY_STORE');
    await go('warehouse', order.id, 'RESTOCKED');
    expect(await balance(ids.storeStock, ids.variantA)).toBe(storeBefore + 1);
    expect(await reserved(order.id)).toEqual([]);
  });

  it('no se aparta lo que no hay, y anular suelta lo apartado', async () => {
    await expect(request('SO', ids.variantA, '999')).rejects.toThrow(/No hay suficiente/);
    const order = await request('SO', ids.variantA, '1');
    await go('seller', order.id, 'CANCELLED', { reason: 'El cliente se fue' });
    expect(await reserved(order.id)).toEqual([]);
    const view = await orders.findView(ids.company, order.id);
    expect(view.status).toBe('CANCELLED');
    expect(view.cancellationReason).toBe('El cliente se fue');
  });

  it('dejar lista con faltante abre la novedad y aparta solo lo encontrado; el retorno por error recorre sus paradas', async () => {
    const order = await request('SO', ids.variantB, '2');
    await go('warehouse', order.id, 'ACCEPTED_BY_WAREHOUSE');
    await go('warehouse', order.id, 'PACKING');
    const [line] = (await orders.findView(ids.company, order.id)).items;
    await go('warehouse', order.id, 'READY_FOR_RUNNER', { lines: [{ itemId: line.id, quantity: '1' }] });
    const ready = await orders.findView(ids.company, order.id);
    expect(ready.items[0].incidentId).not.toBeNull();
    expect(await reserved(order.id)).toEqual([{ inventoryLocationId: ids.whStock, sourceType: 'TRANSFER_REQUEST', q: 1 }]);

    await go('runner', order.id, 'IN_TRANSIT');
    await go('runner', order.id, 'DELIVERED_TO_STORE');
    await orders.reportCorrection(ids.company, actor('seller'), order.id, 'Llegó la talla equivocada');
    await expect(orders.reportCorrection(ids.company, actor('seller'), order.id, 'Otra vez')).rejects.toThrow(/en curso/);
    for (let i = 0; i < 3; i += 1) await orders.advanceCorrection(ids.company, actor('runner'), order.id);
    const corrected = await orders.findView(ids.company, order.id);
    expect(corrected.status).toBe('DELIVERED_TO_STORE');
    expect(corrected.corrections[0].step).toBe(3);
    expect(corrected.corrections[0].closedAt).not.toBeNull();
  });

  it('el vendedor solo ve lo suyo y lo de su tienda; bodega ve todo', async () => {
    const all = await orders.findAll(ids.company, actor('warehouse'), {});
    const mine = await orders.findAll(ids.company, actor('seller'), { mine: true });
    expect(all.length).toBeGreaterThan(0);
    expect(mine.every((order) => order.requestedBy === ids.seller)).toBe(true);
    const outsider = { userId: ids.runner, permissionCodes: ['orders.view'], isSuperAdmin: false };
    expect(await orders.findAll(ids.company, outsider, {})).toHaveLength(0);
  });
});
