import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDownloadHistory1767897000000 implements MigrationInterface {
  name = 'AddDownloadHistory1767897000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "download_history" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "downloadKey" varchar NOT NULL, "serverId" integer NOT NULL, "mediaType" varchar NOT NULL, "externalId" integer NOT NULL, "title" varchar NOT NULL, "size" integer NOT NULL, "sizeLeft" integer NOT NULL, "status" varchar NOT NULL, "timeLeft" varchar NOT NULL, "estimatedCompletionTime" datetime NOT NULL, "completedAt" datetime NOT NULL, "outcome" varchar NOT NULL, "seasonNumber" integer, "episodeNumber" integer, "absoluteEpisodeNumber" integer, "episodeId" integer, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')))`
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_download_history_key" ON "download_history" ("downloadKey")`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_download_history_completedAt" ON "download_history" ("completedAt")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_download_history_completedAt"`);
    await queryRunner.query(`DROP INDEX "IDX_download_history_key"`);
    await queryRunner.query(`DROP TABLE "download_history"`);
  }
}
