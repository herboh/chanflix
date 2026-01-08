import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import Media from './Media';
import { User } from './User';

@Entity()
@Unique(['user', 'media'])
class Review {
  @PrimaryGeneratedColumn()
  public id: number;

  @ManyToOne(() => User, {
    eager: true,
    onDelete: 'CASCADE',
  })
  public user: User;

  @ManyToOne(() => Media, {
    eager: true,
    onDelete: 'CASCADE',
  })
  public media: Media;

  @Column({ type: 'int' })
  public rating: number; // 1-5

  @Column({ type: 'text', default: '' })
  public content: string;

  @CreateDateColumn()
  public createdAt: Date;

  @UpdateDateColumn()
  public updatedAt: Date;

  constructor(init?: Partial<Review>) {
    Object.assign(this, init);
  }
}

export default Review;
