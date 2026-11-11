import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateSecureNoteDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  title: string;

  @IsString()
  @MinLength(2)
  @MaxLength(5000)
  body: string;
}
