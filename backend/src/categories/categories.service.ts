import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto';

@Injectable()
export class CategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  findAll() {
    return this.prisma.category.findMany({
      include: { _count: { select: { products: true } } },
      orderBy: { name: 'asc' },
    });
  }

  async create(dto: CreateCategoryDto, actor: { id: string; email: string }, ip: string, ua?: string) {
    return this.prisma
      .$transaction(async (tx) => {
        const category = await tx.category.create({
          data: { name: dto.name.trim() },
        });
        await this.audit.record(
          {
            userId: actor.id,
            email: actor.email,
            action: 'categories.create',
            resource: 'category',
            resourceId: category.id,
            detail: category.name,
            ipAddress: ip,
            userAgent: ua,
          },
          tx,
        );
        return category;
      })
      .catch((err: unknown) => {
        if (err instanceof NotFoundException) throw err;
        throw new ConflictException('La categoría ya existe');
      });
  }

  async update(
    id: string,
    dto: UpdateCategoryDto,
    actor: { id: string; email: string },
    ip: string,
    ua?: string,
  ) {
    const existing = await this.prisma.category.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Categoría no encontrada');
    return this.prisma
      .$transaction(async (tx) => {
        const category = await tx.category.update({
          where: { id },
          data: { name: dto.name.trim() },
        });
        await this.audit.record(
          {
            userId: actor.id,
            email: actor.email,
            action: 'categories.update',
            resource: 'category',
            resourceId: category.id,
            detail: category.name,
            ipAddress: ip,
            userAgent: ua,
          },
          tx,
        );
        return category;
      })
      .catch((err: unknown) => {
        if (err instanceof NotFoundException) throw err;
        throw new ConflictException('La categoría ya existe');
      });
  }

  async remove(id: string, actor: { id: string; email: string }, ip: string, ua?: string) {
    const existing = await this.prisma.category.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Categoría no encontrada');
    await this.prisma.$transaction(async (tx) => {
      await tx.category.delete({ where: { id } });
      await this.audit.record(
        {
          userId: actor.id,
          email: actor.email,
          action: 'categories.delete',
          resource: 'category',
          resourceId: id,
          detail: existing.name,
          ipAddress: ip,
          userAgent: ua,
        },
        tx,
      );
    });
  }
}
