import { SetMetadata } from '@nestjs/common';
import { PermissionCode } from '../enums/permissions.enum';

export const PERMISSIONS_KEY = 'requiredPermissions';
export const RequirePermissions = (...permissions: PermissionCode[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
