import { Controller, Get } from '@nestjs/common';
import { PermissionsService } from './permissions.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { PermissionCode } from '../common/enums/permissions.enum';

@Controller({ path: 'permissions', version: '1' })
export class PermissionsController {
  constructor(private readonly permissions: PermissionsService) {}

  @Get()
  @RequirePermissions(PermissionCode.PermissionsRead)
  findAll() {
    return this.permissions.findAll();
  }
}
