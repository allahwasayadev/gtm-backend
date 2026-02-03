import { IsNotEmpty, IsString } from 'class-validator';

export class CreateAccountListDto {
  @IsNotEmpty()
  @IsString()
  name: string;
}
