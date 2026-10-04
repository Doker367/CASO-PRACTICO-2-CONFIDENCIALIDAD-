import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateProductDto, UpdateProductDto } from './dto/product.dto';

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  findAll(search?: string) {
    return this.prisma.product.findMany({
      where: search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { sku: { contains: search, mode: 'insensitive' } },
            ],
          }
        : undefined,
      include: { category: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: { category: true },
    });
    if (!product) throw new NotFoundException('Producto no encontrado');
    return product;
  }

  async create(dto: CreateProductDto, actor: { id: string; email: string }, ip: string, ua?: string) {
    try {
      const product = await this.prisma.product.create({
        data: {
          name: dto.name.trim(),
          sku: dto.sku.trim().toUpperCase(),
          description: dto.description?.trim(),
          price: dto.price,
          stock: dto.stock,
          imageUrl: dto.imageUrl?.trim(),
          categoryId: dto.categoryId,
        },
        include: { category: true },
      });
      await this.audit.record({
        userId: actor.id,
        email: actor.email,
        action: 'products.create',
        resource: 'product',
        resourceId: product.id,
        detail: product.sku,
        ipAddress: ip,
        userAgent: ua,
      });
      return product;
    } catch {
      throw new ConflictException('El SKU ya existe');
    }
  }

  async update(
    id: string,
    dto: UpdateProductDto,
    actor: { id: string; email: string },
    ip: string,
    ua?: string,
  ) {
    await this.findOne(id);
    try {
      const product = await this.prisma.product.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.sku !== undefined ? { sku: dto.sku.trim().toUpperCase() } : {}),
          ...(dto.description !== undefined ? { description: dto.description?.trim() } : {}),
          ...(dto.price !== undefined ? { price: dto.price } : {}),
          ...(dto.stock !== undefined ? { stock: dto.stock } : {}),
          ...(dto.imageUrl !== undefined ? { imageUrl: dto.imageUrl?.trim() } : {}),
          ...(dto.categoryId !== undefined ? { categoryId: dto.categoryId } : {}),
        },
        include: { category: true },
      });
      await this.audit.record({
        userId: actor.id,
        email: actor.email,
        action: 'products.update',
        resource: 'product',
        resourceId: product.id,
        detail: product.sku,
        ipAddress: ip,
        userAgent: ua,
      });
      return product;
    } catch {
      throw new ConflictException('El SKU ya existe');
    }
  }

  async remove(id: string, actor: { id: string; email: string }, ip: string, ua?: string) {
    const product = await this.findOne(id);
    await this.prisma.product.delete({ where: { id } });
    await this.audit.record({
      userId: actor.id,
      email: actor.email,
      action: 'products.delete',
      resource: 'product',
      resourceId: id,
      detail: product.sku,
      ipAddress: ip,
      userAgent: ua,
    });
  }
}
