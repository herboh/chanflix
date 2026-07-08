import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTmdbMetadataCache1767897100000 implements MigrationInterface {
  name = 'AddTmdbMetadataCache1767897100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "tmdb_metadata_cache" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "cacheKey" varchar NOT NULL, "mediaType" varchar NOT NULL, "tmdbId" integer NOT NULL, "language" varchar NOT NULL, "appendToResponse" varchar NOT NULL, "payload" text NOT NULL, "fetchedAt" datetime NOT NULL, "expiresAt" datetime NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')))`
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_tmdb_metadata_cache_key" ON "tmdb_metadata_cache" ("cacheKey")`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_tmdb_metadata_cache_mediaType" ON "tmdb_metadata_cache" ("mediaType")`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_tmdb_metadata_cache_tmdbId" ON "tmdb_metadata_cache" ("tmdbId")`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_tmdb_metadata_cache_expiresAt" ON "tmdb_metadata_cache" ("expiresAt")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_tmdb_metadata_cache_expiresAt"`);
    await queryRunner.query(`DROP INDEX "IDX_tmdb_metadata_cache_tmdbId"`);
    await queryRunner.query(`DROP INDEX "IDX_tmdb_metadata_cache_mediaType"`);
    await queryRunner.query(`DROP INDEX "IDX_tmdb_metadata_cache_key"`);
    await queryRunner.query(`DROP TABLE "tmdb_metadata_cache"`);
  }
}
