import { MigrationInterface, QueryRunner } from 'typeorm';

// Habilita levenshtein(), que ProductService.findSimilarByNameWithin usa como refuerzo de
// pg_trgm para nombres cortos: un nombre de 5 letras tiene tan pocos trigramas que una sola
// letra cambiada ("samba" -> "zamba") tira el puntaje de similitud muy por debajo del umbral,
// aunque para un humano sea obviamente el mismo producto mal escrito.
export class UpdateProduct1790810585878 implements MigrationInterface {
  name = 'UpdateProduct1790810585878';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS fuzzystrmatch`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP EXTENSION IF EXISTS fuzzystrmatch`);
  }
}
