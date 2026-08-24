import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from "typeorm";
import { User } from "./User";

@Entity()
class AiChatTrace {
  @PrimaryColumn({ type: "varchar" })
  public id: string;

  @ManyToOne(() => User, { nullable: false, onDelete: "CASCADE" })
  public user: User;

  @Column({ type: "int" })
  public schemaVersion: number;

  @Column({ type: "varchar" })
  public model: string;

  @Column({ type: "varchar" })
  public finishReason: string;

  @Column({ type: "int" })
  public durationMs: number;

  @Column({ type: "text" })
  public payload: string;

  @Column({ type: "varchar", nullable: true })
  public feedbackRating?: "up" | "down" | null;

  @Column({ type: "text", default: "[]" })
  public feedbackReasons: string;

  @Column({ type: "text", nullable: true })
  public feedbackComment?: string | null;

  @Column({ type: "datetime", nullable: true })
  public feedbackAt?: Date | null;

  @Index()
  @CreateDateColumn()
  public createdAt: Date;

  @UpdateDateColumn()
  public updatedAt: Date;

  constructor(init?: Partial<AiChatTrace>) {
    Object.assign(this, init);
  }
}

export default AiChatTrace;
