import { Controller, Get, Query } from '@nestjs/common';
import { AuditService } from './audit.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { PermissionCode } from '../common/enums/permissions.enum';

@Controller({ path: 'audit', version: '1' })
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePermissions(PermissionCode.AuditRead)
  findAll(@Query('page') page?: string, @Query('limit') limit?: string) {
    return this.audit.findAll(Number(page ?? 1) || 1, Number(limit ?? 50) || 50);
  }
}
