import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity()
class DiscoverCollection {
  @PrimaryGeneratedColumn()
  public id: number;

  @Index({ unique: true })
  @Column({ type: 'varchar' })
  public collectionKey: string;

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

  constructor(init?: Partial<DiscoverCollection>) {
    Object.assign(this, init);
  }
}

export default DiscoverCollection;
