import { MigrationInterface, QueryRunner } from 'typeorm';

// Habilita la búsqueda por similitud de texto (trigramas) que usa
// ProductService.findSimilarByName para avisar "¿quisiste decir...?" al crear un producto:
// "adiddas hair forse 1" y "adidas air force one" comparten suficientes trigramas como para
// relacionarse aunque la segunda esté mal escrita. `unaccent` evita que una tilde de más o de
// menos baje el puntaje de similitud.
export class UpdateProduct1790713920235 implements MigrationInterface {
  name = 'UpdateProduct1790713920235';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS unaccent`);
    await queryRunner.query(`CREATE INDEX "IDX_products_name_trgm" ON "products" USING gin ("name" gin_trgm_ops)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_products_name_trgm"`);
  }
}
