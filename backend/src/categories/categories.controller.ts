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
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { PermissionCode } from '../common/enums/permissions.enum';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';

@Controller({ path: 'categories', version: '1' })
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  @RequirePermissions(PermissionCode.CategoriesRead)
  findAll() {
    return this.categories.findAll();
  }

  @Post()
  @RequirePermissions(PermissionCode.CategoriesWrite)
  create(
    @Body() dto: CreateCategoryDto,
    @CurrentUser() user: AuthUser,
    @Ip() ip: string,
    @Req() req: Request,
  ) {
    return this.categories.create(dto, user, ip, req.headers['user-agent']);
  }

  @Patch(':id')
  @RequirePermissions(PermissionCode.CategoriesWrite)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryDto,
    @CurrentUser() user: AuthUser,
    @Ip() ip: string,
    @Req() req: Request,
  ) {
    return this.categories.update(id, dto, user, ip, req.headers['user-agent']);
  }

  @Delete(':id')
  @RequirePermissions(PermissionCode.CategoriesDelete)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Ip() ip: string,
    @Req() req: Request,
  ) {
    return this.categories.remove(id, user, ip, req.headers['user-agent']);
  }
}
