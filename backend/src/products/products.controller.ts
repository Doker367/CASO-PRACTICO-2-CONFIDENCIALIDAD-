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
  Query,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { ProductsService } from './products.service';
import { CreateProductDto, UpdateProductDto } from './dto/product.dto';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { PermissionCode } from '../common/enums/permissions.enum';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';

@Controller({ path: 'products', version: '1' })
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  @RequirePermissions(PermissionCode.ProductsRead)
  findAll(@Query('search') search?: string) {
    return this.products.findAll(search);
  }

  @Get(':id')
  @RequirePermissions(PermissionCode.ProductsRead)
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.products.findOne(id);
  }

  @Post()
  @RequirePermissions(PermissionCode.ProductsCreate)
  create(
    @Body() dto: CreateProductDto,
    @CurrentUser() user: AuthUser,
    @Ip() ip: string,
    @Req() req: Request,
  ) {
    return this.products.create(dto, user, ip, req.headers['user-agent']);
  }

  @Patch(':id')
  @RequirePermissions(PermissionCode.ProductsUpdate)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
    @CurrentUser() user: AuthUser,
    @Ip() ip: string,
    @Req() req: Request,
  ) {
    return this.products.update(id, dto, user, ip, req.headers['user-agent']);
  }

  @Delete(':id')
  @RequirePermissions(PermissionCode.ProductsDelete)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Ip() ip: string,
    @Req() req: Request,
  ) {
    return this.products.remove(id, user, ip, req.headers['user-agent']);
  }
}
