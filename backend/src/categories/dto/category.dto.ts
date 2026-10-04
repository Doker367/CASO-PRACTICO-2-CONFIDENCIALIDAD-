import { IsString, MinLength, MaxLength } from 'class-validator';

export class CreateCategoryDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name: string;
}

export class UpdateCategoryDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name: string;
}
