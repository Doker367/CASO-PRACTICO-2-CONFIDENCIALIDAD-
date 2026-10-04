import {
  Body,
  Controller,
  Get,
  Ip,
  Param,
  ParseUUIDPipe,
  Patch,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { UsersService } from './users.service';
import { SetUserRolesDto, UpdateUserStatusDto } from './dto/user.dto';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { PermissionCode } from '../common/enums/permissions.enum';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';

@Controller({ path: 'users', version: '1' })
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermissions(PermissionCode.UsersRead)
  findAll() {
    return this.users.findAll();
  }

  @Get(':id')
  @RequirePermissions(PermissionCode.UsersRead)
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.users.findOne(id);
  }

  @Patch(':id/roles')
  @RequirePermissions(PermissionCode.UsersManage)
  setRoles(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetUserRolesDto,
    @CurrentUser() user: AuthUser,
    @Ip() ip: string,
    @Req() req: Request,
  ) {
    return this.users.setRoles(id, dto, user, ip, req.headers['user-agent']);
  }

  @Patch(':id/status')
  @RequirePermissions(PermissionCode.UsersManage)
  setStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserStatusDto,
    @CurrentUser() user: AuthUser,
    @Ip() ip: string,
    @Req() req: Request,
  ) {
    return this.users.setStatus(id, dto, user, ip, req.headers['user-agent']);
  }
}
