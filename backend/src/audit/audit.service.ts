import { Injectable, Logger } from '@nestjs/common';
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

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
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
    } catch (err) {
      this.logger.error('No se pudo registrar la auditoría', err as Error);
    }
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
