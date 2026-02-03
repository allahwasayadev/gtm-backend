import { IsArray, IsNotEmpty, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class AccountDto {
  @IsNotEmpty()
  @IsString()
  accountName: string;

  @IsOptional()
  @IsString()
  type?: string;
}

export class UpdateAccountsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AccountDto)
  accounts: AccountDto[];
}
