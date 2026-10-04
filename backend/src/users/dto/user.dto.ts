import { ArrayNotEmpty, IsArray, IsBoolean, IsUUID } from 'class-validator';

export class SetUserRolesDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  roleIds: string[];
}

export class UpdateUserStatusDto {
  @IsBoolean()
  isActive: boolean;
}
