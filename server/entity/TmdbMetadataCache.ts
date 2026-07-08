import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity()
class TmdbMetadataCache {
  @PrimaryGeneratedColumn()
  public id: number;

  @Index({ unique: true })
  @Column({ type: 'varchar' })
  public cacheKey: string;

  @Index()
  @Column({ type: 'varchar' })
  public mediaType: 'movie' | 'tv';

  @Index()
  @Column({ type: 'int' })
  public tmdbId: number;

  @Column({ type: 'varchar' })
  public language: string;

  @Column({ type: 'varchar' })
  public appendToResponse: string;

  @Column({ type: 'text' })
  public payload: string;

  @Column({ type: 'datetime' })
  public fetchedAt: Date;

  @Index()
  @Column({ type: 'datetime' })
  public expiresAt: Date;

  @CreateDateColumn()
  public createdAt: Date;

  @UpdateDateColumn()
  public updatedAt: Date;

  constructor(init?: Partial<TmdbMetadataCache>) {
    Object.assign(this, init);
  }
}

export default TmdbMetadataCache;
