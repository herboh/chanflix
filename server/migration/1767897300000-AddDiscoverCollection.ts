import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDiscoverCollection1767897300000 implements MigrationInterface {
  name = 'AddDiscoverCollection1767897300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "discover_collection" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "collectionKey" varchar NOT NULL, "payload" text NOT NULL, "fetchedAt" datetime NOT NULL, "expiresAt" datetime NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')))`
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_discover_collection_key" ON "discover_collection" ("collectionKey")`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_discover_collection_expires" ON "discover_collection" ("expiresAt")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_discover_collection_expires"`);
    await queryRunner.query(`DROP INDEX "IDX_discover_collection_key"`);
    await queryRunner.query(`DROP TABLE "discover_collection"`);
  }
}
