import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  userId?: string;
  email?: string;
  action: string;
  resource?: string;
  resourceId?: string;
  detail?: string;
  ipAddress: string;
  userAgent?: string;
}

type Db = Prisma.TransactionClient | PrismaService;

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Escritura fail-closed: si la auditoría no puede registrarse, la operación
   * asociada no debe considerarse completada. Pasa `tx` para escribir dentro de
   * la misma transacción que el cambio de estado auditado.
   */
  async record(entry: AuditEntry, db: Db = this.prisma): Promise<void> {
    await db.auditLog.create({
      data: {
        userId: entry.userId,
        email: entry.email,
        action: entry.action,
        resource: entry.resource,
        resourceId: entry.resourceId,
        detail: entry.detail,
        ipAddress: entry.ipAddress,
        userAgent: entry.userAgent,
      },
    });
  }

  async findAll(page = 1, limit = 50) {
    const take = Math.min(Math.max(limit, 1), 200);
    const skip = (Math.max(page, 1) - 1) * take;
    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        select: {
          id: true,
          userId: true,
          email: true,
          action: true,
          resource: true,
          resourceId: true,
          detail: true,
          ipAddress: true,
          userAgent: true,
          createdAt: true,
        },
      }),
      this.prisma.auditLog.count(),
    ]);
    return { items, total, page: Math.max(page, 1), limit: take };
  }
}
