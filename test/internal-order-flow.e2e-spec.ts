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

  // Los permisos de cada quien, como los dejaría el reparto por rol de la semilla. La misma tabla
  // alimenta los roles de verdad (ver la semilla), para que los AVISOS encuentren destinatarios:
  // `findUserIdsWithPermission` los busca por rol en la base, no por el actor que se arma aquí.
  const PERMISSIONS = {
    seller: ['orders.view', 'orders.request_from_warehouse', 'orders.confirm_receipt'],
    warehouse: ['orders.view', 'warehouse.fulfill_orders', 'warehouse.receive_returns', 'inventory.transfer'],
    runner: ['orders.view', 'runner.pickup_orders', 'runner.confirm_delivery'],
    cashier: ['cash.register_payment', 'cash.charge_orders', 'sales.create', 'sales.view'],
  } as const;

  const actor = (key: 'seller' | 'warehouse' | 'runner' | 'cashier') => ({
    userId: ids[key],
    permissionCodes: [...PERMISSIONS[key]] as string[],
    isSuperAdmin: false,
    isAdmin: false,
  });

  // El administrador de la empresa: anula una orden pasado el punto del vendedor y maneja el cajón
  // de devoluciones. No necesita permisos sueltos; manda su rol.
  const companyAdmin = () => ({ userId: ids.cashier, permissionCodes: [], isSuperAdmin: false, isAdmin: true });
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
  // Una talla nueva con existencia SOLO en la bodega que se diga: con esto se fuerza de qué bodega
  // va a salir un pedido, que es lo que el servidor decide solo.
  const variantOnlyAt = async (label: string, stockLocationId: string, quantity: number) => {
    const { rows: productRows } = await db.query(`SELECT id FROM products WHERE "companyId" = $1 LIMIT 1`, [ids.company]);
    const { rows: colorRows } = await db.query(`SELECT "colorId" FROM product_variants WHERE id = $1`, [ids.variantA]);
    const sizeId = (await db.query(`INSERT INTO sizes (name) VALUES ($1) RETURNING id`, [`${label} ${RUN}`])).rows[0].id as string;
    const variantId = (
      await db.query(
        `INSERT INTO product_variants ("companyId", "productId", "colorId", "sizeId", sku, cost, price) VALUES ($1, $2, $3, $4, $5, 50000, $6) RETURNING id`,
        [ids.company, productRows[0].id, colorRows[0].colorId, sizeId, `AF1-${label}-${RUN}`, PRICE],
      )
    ).rows[0].id as string;
    await db.query(`INSERT INTO inventory_balances ("productVariantId", "inventoryLocationId", quantity) VALUES ($1, $2, $3)`, [variantId, stockLocationId, quantity]);
    return variantId;
  };

  // Los tipos de aviso que dejó una orden (la bandeja de Notificaciones).
  const noticesOf = async (orderId: string) => {
    const { rows } = await db.query(`SELECT type FROM notifications WHERE "entityId" = $1 ORDER BY "createdAt" ASC`, [orderId]);
    return (rows as { type: string }[]).map((row) => row.type);
  };

  const go = (key: 'seller' | 'warehouse' | 'runner' | 'cashier', id: string, to: string, extra: Record<string, unknown> = {}) =>
    orders.transition(ids.company, actor(key), { id, to: to as never, ...extra });

  // Recoger exige haber tomado la orden antes (claim): son dos pasos distintos, y solo recoge quien
  // la tomó. Este atajo hace los dos, que es lo que hace el corredor en la app.
  const pickUp = async (id: string, to: 'IN_TRANSIT' | 'IN_TRANSIT_TO_WAREHOUSE' = 'IN_TRANSIT') => {
    await orders.claim(ids.company, actor('runner'), id);
    await go('runner', id, to);
  };

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
    // Personal por ubicación, como lo dejaría Configuración: el vendedor y la caja trabajan en la
    // tienda; el bodeguero, en las dos bodegas; el corredor va y viene, así que tiene las tres. Sin
    // esto, las reglas de visibilidad por sede (internal-order-visibility.ts) le esconden al
    // bodeguero la orden que acaba de llegarle y ningún paso de bodega pasa.
    for (const [key, locations] of [
      ['seller', [ids.store]],
      ['cashier', [ids.store]],
      ['warehouse', [ids.wh, ids.wh2]],
      ['runner', [ids.store, ids.wh, ids.wh2]],
    ] as const) {
      for (const locationId of locations) {
        await db.query(`INSERT INTO user_location_access ("userId", "locationId") VALUES ($1, $2)`, [ids[key], locationId]);
      }
    }
    // Un rol de empresa por puesto, con sus permisos y su membresía. Sin esto los avisos no
    // encuentran a nadie (`notify` no deja aviso sin destinatarios) y el flujo se vería bien aunque
    // bodega o los corredores nunca se enteraran de nada.
    for (const key of ['seller', 'warehouse', 'runner', 'cashier'] as const) {
      const roleId = await one(`INSERT INTO roles (code, name, scope) VALUES ($1, $2, 'COMPANY') RETURNING id`, [
        `${key}-${RUN}`.slice(0, 50),
        key,
      ]);
      for (const code of PERMISSIONS[key]) {
        const { rows } = await db.query(`SELECT id FROM permissions WHERE code = $1`, [code]);
        if (rows.length === 0) throw new Error(`La semilla de permisos no trae ${code}`);
        await db.query(`INSERT INTO role_permissions ("companyId", "roleId", "permissionId") VALUES ($1, $2, $3)`, [ids.company, roleId, rows[0].id]);
      }
      await db.query(`INSERT INTO user_company_roles ("userId", "companyId", "roleId") VALUES ($1, $2, $3)`, [ids[key], ids.company, roleId]);
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

  // Una SO no dice de qué bodega sale (lo decide el servidor) y puede nacer repartida en varias
  // órdenes; estos atajos devuelven la primera, que es lo que miran casi todas las pruebas.
  const requestAll = (type: 'SO' | 'TR' | 'RS', variantId: string, quantity: string, source = ids.wh, by: 'seller' | 'warehouse' = 'seller') =>
    orders.request(ids.company, actor(by), {
      type: type as never,
      origin: 'SELLER' as never,
      ...(type === 'SO' ? {} : { sourceLocationId: source }),
      destinationLocationId: ids.store,
      items: [{ productVariantId: variantId, quantity }],
    });

  const request = async (type: 'SO' | 'TR' | 'RS', variantId: string, quantity: string, source = ids.wh, by: 'seller' | 'warehouse' = 'seller') =>
    (await requestAll(type, variantId, quantity, source, by))[0];

  // Lleva una SO desde que se pide hasta que el vendedor la tiene en la mano.
  const toSeller = async (id: string) => {
    await go('warehouse', id, 'PACKING');
    await go('warehouse', id, 'READY_FOR_RUNNER');
    await pickUp(id);
    await go('runner', id, 'DELIVERED_TO_STORE');
    await go('seller', id, 'RECEIVED_BY_SELLER');
  };

  it('SO: se pide, se aparta, recorre el flujo y se cobra en caja (queda pagada y ligada a la venta)', async () => {
    const order = await request('SO', ids.variantA, '2');
    expect(order.orderNumber).toBe('SO-000001');
    expect(order.status).toBe('NEW');
    expect(await reserved(order.id)).toEqual([{ inventoryLocationId: ids.whStock, sourceType: 'TRANSFER_REQUEST', q: 2 }]);

    await go('warehouse', order.id, 'PACKING');
    await go('warehouse', order.id, 'READY_FOR_RUNNER');
    // Solo un corredor recoge; nadie se salta pasos.
    await expect(go('seller', order.id, 'IN_TRANSIT')).rejects.toThrow();
    await expect(go('runner', order.id, 'DELIVERED_TO_STORE')).rejects.toThrow();

    await pickUp(order.id);
    expect(await reserved(order.id)).toEqual([]);
    expect(await balance(ids.whStock, ids.variantA)).toBe(18);
    expect(await balance(await runnerBag(), ids.variantA)).toBe(2);

    // El corredor marca que entregó, pero su custodia no termina ahí: la mercancía sigue en su bolsa
    // hasta que el vendedor confirma el recibo (ver `leftRunner` en internal-order-stock.ts).
    await go('runner', order.id, 'DELIVERED_TO_STORE');
    expect(await balance(ids.storeStock, ids.variantA)).toBe(0);
    expect(await balance(await runnerBag(), ids.variantA)).toBe(2);

    await go('seller', order.id, 'RECEIVED_BY_SELLER');
    // Con la confirmación sale de la bolsa, entra al STOCK de la tienda y queda apartada para su cliente.
    expect(await balance(await runnerBag(), ids.variantA)).toBe(0);
    expect(await balance(ids.storeStock, ids.variantA)).toBe(2);
    expect(await reserved(order.id)).toEqual([{ inventoryLocationId: ids.storeStock, sourceType: 'TRANSFER_REQUEST', q: 2 }]);
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

  it('SO → no compra: queda en el cajón y el administrador lo manda a la bodega que lo despachó', async () => {
    const stockBefore = await balance(ids.whStock, ids.variantB);
    const order = await request('SO', ids.variantB, '1');
    // Nadie eligió bodega: el sistema la buscó (Central tiene las dos tallas; Norte, solo la 41).
    expect(order.sourceLocationId).toBe(ids.wh);
    await toSeller(order.id);
    await go('seller', order.id, 'RETURNED');

    // Lo que el cliente no se lleva NO vuelve solo a bodega: queda en la tienda, apartado a nombre
    // del cajón de devoluciones.
    expect((await orders.findView(ids.company, order.id)).status).toBe('RETURNED');
    expect(await reserved(order.id)).toEqual([{ inventoryLocationId: ids.storeStock, sourceType: 'RETURNS_BIN', q: 1 }]);
    expect(await balance(ids.storeStock, ids.variantB)).toBeGreaterThanOrEqual(1);

    // El cajón ya sabe a qué bodega vuelve cada cosa: la que la despachó.
    const bin = await orders.returnsBinContents(ids.company, companyAdmin());
    const line = bin.find((row) => row.productVariantId === ids.variantB && row.storeId === ids.store);
    expect(line?.originWarehouseId).toBe(ids.wh);
    expect(line?.originWarehouseName).toBe('Bodega Central');

    // Y se manda sin elegir bodega: sale una RE por bodega de origen.
    const created = await orders.createReturnFromBin(ids.company, companyAdmin(), { storeId: ids.store, productVariantIds: [ids.variantB] });
    expect(created).toHaveLength(1);
    const [ret] = created;
    expect(ret.type).toBe('RE');
    expect(ret.sourceLocationId).toBe(ids.store);
    expect(ret.destinationLocationId).toBe(ids.wh);
    expect(ret.status).toBe('WAITING_FOR_RUNNER');
    // Salió del cajón y quedó apartada para la RE.
    expect(await reserved(order.id)).toEqual([]);
    expect(await reserved(ret.id)).toEqual([{ inventoryLocationId: ids.storeStock, sourceType: 'TRANSFER_REQUEST', q: 1 }]);

    // El camino de vuelta, con la custodia del corredor terminando cuando bodega recibe.
    await pickUp(ret.id, 'IN_TRANSIT_TO_WAREHOUSE');
    await go('runner', ret.id, 'DELIVERED_TO_WAREHOUSE');
    const [retLine] = (await orders.findView(ids.company, ret.id)).items;
    await go('warehouse', ret.id, 'RETURNED', { lines: [{ itemId: retLine.id, quantity: '1' }] });
    expect((await orders.findView(ids.company, ret.id)).status).toBe('RETURNED');
    expect(await balance(ids.whStock, ids.variantB)).toBe(stockBefore);
  });

  it('SO → cambio de pedido: lo que sale va al cajón y la sub-orden es la que se cobra', async () => {
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
    // Lo que el cliente cambia queda en el cajón de la tienda (no vuelve solo a bodega).
    expect(await reserved(order.id)).toEqual([{ inventoryLocationId: ids.storeStock, sourceType: 'RETURNS_BIN', q: 1 }]);

    // La sub-orden sale de la bodega elegida para el cambio, con prioridad alta.
    const [sub] = await orders.findSubOrders(ids.company, order.id);
    expect(sub.parentOrderId).toBe(order.id);
    expect(sub.priority).toBe('HIGH');
    expect(sub.sourceLocationId).toBe(ids.wh2);
    expect(await reserved(sub.id)).toEqual([{ inventoryLocationId: ids.wh2Stock, sourceType: 'TRANSFER_REQUEST', q: 1 }]);

    // Al llegar, la sub-orden se queda con todo y la original termina sin cobro.
    await toSeller(sub.id);
    expect((await orders.findView(ids.company, order.id)).status).toBe('CLOSED_BY_CHANGE');
    const subView = await orders.findView(ids.company, sub.id);
    expect(subView.status).toBe('RECEIVED_BY_SELLER');
    expect(subView.items.map((line) => line.productVariantId)).toEqual([ids.variantB]);
    expect(await reserved(sub.id)).toEqual([{ inventoryLocationId: ids.storeStock, sourceType: 'TRANSFER_REQUEST', q: 1 }]);

    // Y es ella la que sigue hasta el cobro.
    await go('seller', sub.id, 'PENDING_PAYMENT');
    expect((await orders.findView(ids.company, sub.id)).status).toBe('PENDING_PAYMENT');
  });

  it('RS: un surtido de bodega a tienda recorre su flujo y mueve la existencia', async () => {
    const storeBefore = await balance(ids.storeStock, ids.variantA);
    const order = await request('RS', ids.variantA, '1', ids.wh, 'warehouse');
    expect(order.orderNumber).toBe('RS-000001');
    expect(order.status).toBe('RESTOCK_REQUESTED');
    await go('warehouse', order.id, 'WAITING_FOR_RUNNER');
    await pickUp(order.id);
    await go('runner', order.id, 'DELIVERED_TO_STORE');
    await go('warehouse', order.id, 'RECEIVED_BY_STORE');
    await go('warehouse', order.id, 'RESTOCKED');
    expect(await balance(ids.storeStock, ids.variantA)).toBe(storeBefore + 1);
    expect(await reserved(order.id)).toEqual([]);
  });

  it('no se aparta lo que no hay, y anular suelta lo apartado', async () => {
    // Ninguna bodega tiene 999 y una línea no se parte entre dos: se rechaza nombrando la referencia.
    await expect(request('SO', ids.variantA, '999')).rejects.toThrow(/en una sola bodega/);
    const order = await request('SO', ids.variantA, '1');
    await go('seller', order.id, 'CANCELLED', { reason: 'El cliente se fue' });
    expect(await reserved(order.id)).toEqual([]);
    const view = await orders.findView(ids.company, order.id);
    expect(view.status).toBe('CANCELLED');
    expect(view.cancellationReason).toBe('El cliente se fue');
  });

  it('dejar lista con faltante abre la novedad y aparta solo lo encontrado; el retorno por error recorre sus paradas', async () => {
    const order = await request('SO', ids.variantB, '2');
    await go('warehouse', order.id, 'PACKING');
    const [line] = (await orders.findView(ids.company, order.id)).items;
    await go('warehouse', order.id, 'READY_FOR_RUNNER', { lines: [{ itemId: line.id, quantity: '1' }] });
    const ready = await orders.findView(ids.company, order.id);
    expect(ready.items[0].incidentId).not.toBeNull();
    expect(await reserved(order.id)).toEqual([{ inventoryLocationId: ids.whStock, sourceType: 'TRANSFER_REQUEST', q: 1 }]);

    await pickUp(order.id);
    await go('runner', order.id, 'DELIVERED_TO_STORE');
    // El retorno por error señala CUÁLES líneas llegaron mal (desde la rama `inventory`).
    await orders.reportCorrection(ids.company, actor('seller'), order.id, [line.id], 'Llegó la talla equivocada');
    await expect(orders.reportCorrection(ids.company, actor('seller'), order.id, [line.id], 'Otra vez')).rejects.toThrow(/en curso/);
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
    // Alguien que entra a Pedidos sin alcance y sin ninguna sede asignada no ve nada: ni las que
    // pidió (ninguna) ni las de sedes suyas (no tiene). Es un usuario aparte a propósito: el corredor
    // sí tiene sedes asignadas, así que con él la prueba no diría nada.
    const { rows } = await db.query(
      `INSERT INTO users ("firstName", "lastName", email, "passwordHash") VALUES ('Ajeno', 'Prueba', $1, 'x') RETURNING id`,
      [`ajeno-${RUN}@prueba.test`],
    );
    const outsider = { userId: rows[0].id as string, permissionCodes: ['orders.view'], isSuperAdmin: false, isAdmin: false };
    expect(await orders.findAll(ids.company, outsider, {})).toHaveLength(0);
  });

  // ─── Lo acordado en esta tanda ───────────────────────────────────────────────────────────────

  it('SO repartida: lo que está en dos bodegas nace como una orden por bodega', async () => {
    // Una talla que SOLO existe en la bodega del norte, para forzar el reparto.
    const variantC = await variantOnlyAt('42', ids.wh2Stock, 5);

    const created = await orders.request(ids.company, actor('seller'), {
      type: 'SO' as never,
      origin: 'SELLER' as never,
      destinationLocationId: ids.store,
      items: [
        { productVariantId: ids.variantA, quantity: '1' },
        { productVariantId: variantC, quantity: '2' },
      ],
    });

    // Una orden por bodega, las dos del mismo envío.
    expect(created).toHaveLength(2);
    expect(new Set(created.map((order) => order.requestGroupId)).size).toBe(1);
    expect(created[0].requestGroupId).not.toBeNull();
    const bySource = new Map(created.map((order) => [order.sourceLocationId, order]));
    expect([...bySource.keys()].sort()).toEqual([ids.wh, ids.wh2].sort());

    // Cada una aparta lo suyo en SU bodega, y lleva solo la línea que esa bodega puede surtir.
    const central = bySource.get(ids.wh)!;
    const norte = bySource.get(ids.wh2)!;
    expect(await reserved(central.id)).toEqual([{ inventoryLocationId: ids.whStock, sourceType: 'TRANSFER_REQUEST', q: 1 }]);
    expect(await reserved(norte.id)).toEqual([{ inventoryLocationId: ids.wh2Stock, sourceType: 'TRANSFER_REQUEST', q: 2 }]);
    expect((await orders.findView(ids.company, central.id)).items.map((line) => line.productVariantId)).toEqual([ids.variantA]);
    expect((await orders.findView(ids.company, norte.id)).items.map((line) => line.productVariantId)).toEqual([variantC]);
    // Y cada bodega recibió su aviso.
    expect(await noticesOf(central.id)).toContain('ORDER_REQUESTED');
    expect(await noticesOf(norte.id)).toContain('ORDER_REQUESTED');
  });

  it('el vendedor anula su pedido mientras ningún corredor lo tomó, y a bodega le llega el aviso', async () => {
    const order = await request('SO', ids.variantA, '1');
    // Nadie lo ha tocado: se anula sin avisarle a nadie.
    await go('seller', order.id, 'CANCELLED', { reason: 'El cliente se fue' });
    expect((await orders.findView(ids.company, order.id)).status).toBe('CANCELLED');
    expect(await reserved(order.id)).toEqual([]);
    expect(await noticesOf(order.id)).not.toContain('ORDER_CANCELLED');

    // Con bodega ya alistando, anular sí le avisa.
    const packed = await request('SO', ids.variantA, '1');
    await go('warehouse', packed.id, 'PACKING');
    await go('seller', packed.id, 'CANCELLED', { reason: 'El cliente se arrepintió' });
    const cancelled = await orders.findView(ids.company, packed.id);
    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.cancellationReason).toBe('El cliente se arrepintió');
    expect(await reserved(packed.id)).toEqual([]);
    expect(await noticesOf(packed.id)).toContain('ORDER_CANCELLED');
  });

  it('tomada por un corredor, el vendedor ya no la anula: queda para el administrador', async () => {
    const order = await request('SO', ids.variantA, '1');
    await go('warehouse', order.id, 'PACKING');
    await go('warehouse', order.id, 'READY_FOR_RUNNER');
    await orders.claim(ids.company, actor('runner'), order.id);

    await expect(go('seller', order.id, 'CANCELLED', { reason: 'El cliente se fue' })).rejects.toThrow(/corredor ya tomó/);
    // Bodega tampoco: no es suya esa decisión.
    await expect(go('warehouse', order.id, 'CANCELLED', { reason: 'porque sí' })).rejects.toThrow();

    await orders.transition(ids.company, companyAdmin(), { id: order.id, to: 'CANCELLED' as never, reason: 'Anulada por el administrador' });
    expect((await orders.findView(ids.company, order.id)).status).toBe('CANCELLED');
    expect(await reserved(order.id)).toEqual([]);
  });

  it('la caja que cobra una orden quita líneas y agrega no inventariados, pero no catálogo', async () => {
    const order = await request('SO', ids.variantA, '2');
    await toSeller(order.id);
    await go('seller', order.id, 'PENDING_PAYMENT');
    const sale = await sales.createFromInternalOrder(ids.company, cashier(), { internalOrderId: order.id, cashSessionId: ids.session });

    // Sin sales.create (la caja), el catálogo no se agrega a la venta de una orden.
    await expect(
      sales.addItem(
        ids.company,
        cashier(),
        { saleId: sale.id, productVariantId: ids.variantB, description: 'Otra talla', quantity: '1', unitPrice: String(PRICE) },
        undefined,
        { canSellCatalog: false },
      ),
    ).rejects.toThrow(/solo se quitan líneas o se agregan productos no inventariados/);

    // Un no inventariado sí: eso es justo lo que la caja puede sumar.
    const withGeneric = await sales.addItem(
      ids.company,
      cashier(),
      { saleId: sale.id, description: 'Medias', quantity: '1', unitPrice: '5000' },
      undefined,
      { canSellCatalog: false },
    );
    expect(Number(withGeneric.total)).toBe(2 * PRICE + 5000);

    // Y quitar una línea del catálogo sigue siendo suyo.
    const reader = { userId: ids.cashier, canViewAll: false, canReadAny: false };
    const [line] = (await sales.findItems(ids.company, reader, sale.id)).filter((item) => item.productVariantId === ids.variantA);
    const withoutLine = await sales.removeItem(ids.company, cashier(), sale.id, line.id);
    expect(Number(withoutLine.total)).toBe(5000);

    // Con sales.create (un vendedor en el mostrador) la misma línea de catálogo sí pasa el permiso:
    // si falla, falla por existencia, no por el bloqueo de la caja.
    await sales
      .addItem(
        ids.company,
        cashier(),
        { saleId: sale.id, productVariantId: ids.variantA, description: 'Air Force 1 40', quantity: '1', unitPrice: String(PRICE) },
        undefined,
        { canSellCatalog: true },
      )
      .catch((error: Error) => {
        expect(error.message).not.toMatch(/solo se quitan líneas/);
      });
  });

  it('el cajón con cosas de dos bodegas se manda en una RE por bodega, cada una a la que la despachó', async () => {
    // Una talla solo del norte: su pedido sale de allá sin que nadie lo elija.
    const fromNorte = await variantOnlyAt('43', ids.wh2Stock, 4);
    const central = await request('SO', ids.variantA, '1');
    expect(central.sourceLocationId).toBe(ids.wh);
    const norte = (
      await orders.request(ids.company, actor('seller'), {
        type: 'SO' as never,
        origin: 'SELLER' as never,
        destinationLocationId: ids.store,
        items: [{ productVariantId: fromNorte, quantity: '1' }],
      })
    )[0];
    expect(norte.sourceLocationId).toBe(ids.wh2);

    // Las dos llegan y el cliente no se lleva ninguna: las dos quedan en el cajón de la tienda.
    for (const order of [central, norte]) {
      await toSeller(order.id);
      await go('seller', order.id, 'RETURNED');
    }

    const bin = await orders.returnsBinContents(ids.company, companyAdmin());
    const mine = bin.filter((row) => row.storeId === ids.store && [ids.variantA, fromNorte].includes(row.productVariantId));
    expect(mine.find((row) => row.productVariantId === ids.variantA)?.originWarehouseId).toBe(ids.wh);
    expect(mine.find((row) => row.productVariantId === fromNorte)?.originWarehouseId).toBe(ids.wh2);

    const created = await orders.createReturnFromBin(ids.company, companyAdmin(), {
      storeId: ids.store,
      productVariantIds: [ids.variantA, fromNorte],
    });
    expect(created).toHaveLength(2);
    expect(created.every((order) => order.type === 'RE')).toBe(true);

    const byDestination = new Map(created.map((order) => [order.destinationLocationId, order]));
    expect([...byDestination.keys()].sort()).toEqual([ids.wh, ids.wh2].sort());
    // Cada RE lleva solo lo que salió de esa bodega.
    const centralItems = (await orders.findView(ids.company, byDestination.get(ids.wh)!.id)).items;
    const norteItems = (await orders.findView(ids.company, byDestination.get(ids.wh2)!.id)).items;
    expect(centralItems.map((line) => line.productVariantId)).toEqual([ids.variantA]);
    expect(norteItems.map((line) => line.productVariantId)).toEqual([fromNorte]);
    // Y las dos esperan corredor, cada una apartada en la tienda con TODO lo que el cajón tiene de
    // esa referencia para esa bodega (una referencia marcada viaja entera; el cajón puede traer
    // unidades de pruebas anteriores, y eso es el comportamiento acordado).
    const binQty = (variantId: string, warehouseId: string) =>
      mine
        .filter((row) => row.productVariantId === variantId && row.originWarehouseId === warehouseId)
        .reduce((total, row) => total + Number(row.quantity), 0);
    for (const [warehouseId, variantId] of [
      [ids.wh, ids.variantA],
      [ids.wh2, fromNorte],
    ] as const) {
      const order = byDestination.get(warehouseId)!;
      expect(order.status).toBe('WAITING_FOR_RUNNER');
      expect(await reserved(order.id)).toEqual([
        { inventoryLocationId: ids.storeStock, sourceType: 'TRANSFER_REQUEST', q: binQty(variantId, warehouseId) },
      ]);
      expect(await noticesOf(order.id)).toContain('ORDER_READY_FOR_RUNNER');
    }
    // Y el cajón ya no tiene esas referencias con bodega de origen.
    const after = await orders.returnsBinContents(ids.company, companyAdmin());
    expect(
      after.filter((row) => row.storeId === ids.store && [ids.variantA, fromNorte].includes(row.productVariantId) && row.originWarehouseId !== null),
    ).toEqual([]);
  });

  it('doble clic en "pedir a bodega": la misma clave devuelve el grupo entero y no duplica nada', async () => {
    const onlyNorte = await variantOnlyAt('44', ids.wh2Stock, 3);
    const input = {
      type: 'SO' as never,
      origin: 'SELLER' as never,
      destinationLocationId: ids.store,
      items: [
        { productVariantId: ids.variantA, quantity: '1' },
        { productVariantId: onlyNorte, quantity: '1' },
      ],
    };
    const key = `doble-${RUN}`;
    const first = await orders.request(ids.company, actor('seller'), input, key);
    const second = await orders.request(ids.company, actor('seller'), input, key);

    // El reintento no crea otras dos órdenes: devuelve LAS MISMAS, el grupo completo (no solo la
    // primera, que es lo que guarda la clave de idempotencia).
    expect(first).toHaveLength(2);
    expect(second).toHaveLength(2);
    expect(second.map((order) => order.id).sort()).toEqual(first.map((order) => order.id).sort());

    // Y lo apartado sigue siendo una sola vez por bodega.
    const bySource = new Map(first.map((order) => [order.sourceLocationId, order]));
    expect(await reserved(bySource.get(ids.wh)!.id)).toEqual([{ inventoryLocationId: ids.whStock, sourceType: 'TRANSFER_REQUEST', q: 1 }]);
    expect(await reserved(bySource.get(ids.wh2)!.id)).toEqual([{ inventoryLocationId: ids.wh2Stock, sourceType: 'TRANSFER_REQUEST', q: 1 }]);
    const { rows } = await db.query(`SELECT COUNT(*)::int AS n FROM internal_orders WHERE "requestGroupId" = $1`, [first[0].requestGroupId]);
    expect(rows[0].n).toBe(2);
  });
});
