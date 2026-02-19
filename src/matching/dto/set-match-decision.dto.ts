import { IsIn, IsNotEmpty, IsString } from 'class-validator';
import type { MatchDecisionType } from '../match-decisions.repository';

export class SetMatchDecisionDto {
  @IsString()
  @IsNotEmpty()
  yourAccountId!: string;

  @IsString()
  @IsNotEmpty()
  theirAccountId!: string;

  @IsString()
  @IsIn(['accepted', 'rejected'])
  decision!: MatchDecisionType;
}
