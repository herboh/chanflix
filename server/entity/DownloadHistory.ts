import { MediaType } from '@server/constants/media';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity()
class DownloadHistory {
  @PrimaryGeneratedColumn()
  public id: number;

  @Index({ unique: true })
  @Column({ type: 'varchar' })
  public downloadKey: string;

  @Column({ type: 'int' })
  public serverId: number;

  @Column({ type: 'varchar' })
  public mediaType: MediaType;

  @Column({ type: 'int' })
  public externalId: number;

  @Column({ type: 'varchar' })
  public title: string;

  @Column({ type: 'int' })
  public size: number;

  @Column({ type: 'int' })
  public sizeLeft: number;

  @Column({ type: 'varchar' })
  public status: string;

  @Column({ type: 'varchar' })
  public timeLeft: string;

  @Column({ type: 'datetime' })
  public estimatedCompletionTime: Date;

  @Column({ type: 'datetime' })
  public completedAt: Date;

  @Column({ type: 'varchar' })
  public outcome: 'completed' | 'cleared';

  @Column({ type: 'int', nullable: true })
  public seasonNumber?: number;

  @Column({ type: 'int', nullable: true })
  public episodeNumber?: number;

  @Column({ type: 'int', nullable: true })
  public absoluteEpisodeNumber?: number;

  @Column({ type: 'int', nullable: true })
  public episodeId?: number;

  @CreateDateColumn()
  public createdAt: Date;

  @UpdateDateColumn()
  public updatedAt: Date;

  constructor(init?: Partial<DownloadHistory>) {
    Object.assign(this, init);
  }
}

export default DownloadHistory;
