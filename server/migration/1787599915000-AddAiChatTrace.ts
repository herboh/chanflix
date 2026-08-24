import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddAiChatTrace1787599915000 implements MigrationInterface {
  name = "AddAiChatTrace1787599915000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "ai_chat_trace" ("id" varchar PRIMARY KEY NOT NULL, "schemaVersion" integer NOT NULL, "model" varchar NOT NULL, "finishReason" varchar NOT NULL, "durationMs" integer NOT NULL, "payload" text NOT NULL, "feedbackRating" varchar, "feedbackReasons" text NOT NULL DEFAULT ('[]'), "feedbackComment" text, "feedbackAt" datetime, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "userId" integer NOT NULL, CONSTRAINT "FK_ai_chat_trace_user" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ai_chat_trace_created" ON "ai_chat_trace" ("createdAt")`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ai_chat_trace_feedback" ON "ai_chat_trace" ("feedbackRating", "feedbackAt")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_ai_chat_trace_feedback"`);
    await queryRunner.query(`DROP INDEX "IDX_ai_chat_trace_created"`);
    await queryRunner.query(`DROP TABLE "ai_chat_trace"`);
  }
}
