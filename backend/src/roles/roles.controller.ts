import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { RolesService } from './roles.service';
import { CreateRoleDto, SetRolePermissionsDto, UpdateRoleDto } from './dto/role.dto';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { PermissionCode } from '../common/enums/permissions.enum';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';

@Controller({ path: 'roles', version: '1' })
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  @RequirePermissions(PermissionCode.RolesManage)
  findAll() {
    return this.roles.findAll();
  }

  @Post()
  @RequirePermissions(PermissionCode.RolesManage)
  create(
    @Body() dto: CreateRoleDto,
    @CurrentUser() user: AuthUser,
    @Ip() ip: string,
    @Req() req: Request,
  ) {
    return this.roles.create(dto, user, ip, req.headers['user-agent']);
  }

  @Patch(':id')
  @RequirePermissions(PermissionCode.RolesManage)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRoleDto,
    @CurrentUser() user: AuthUser,
    @Ip() ip: string,
    @Req() req: Request,
  ) {
    return this.roles.update(id, dto, user, ip, req.headers['user-agent']);
  }

  @Put(':id/permissions')
  @RequirePermissions(PermissionCode.RolesManage)
  setPermissions(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetRolePermissionsDto,
    @CurrentUser() user: AuthUser,
    @Ip() ip: string,
    @Req() req: Request,
  ) {
    return this.roles.setPermissions(id, dto, user, ip, req.headers['user-agent']);
  }

  @Delete(':id')
  @RequirePermissions(PermissionCode.RolesManage)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Ip() ip: string,
    @Req() req: Request,
  ) {
    return this.roles.remove(id, user, ip, req.headers['user-agent']);
  }
}
