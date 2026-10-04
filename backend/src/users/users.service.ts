import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SetUserRolesDto, UpdateUserStatusDto } from './dto/user.dto';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  findAll() {
    return this.prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        isActive: true,
        createdAt: true,
        lockedUntil: true,
        roles: { include: { role: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async setRoles(
    id: string,
    dto: SetUserRolesDto,
    actor: { id: string; email: string },
    ip: string,
    ua?: string,
  ) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    const roles = await this.prisma.role.findMany({
      where: { id: { in: dto.roleIds } },
      include: { permissions: { include: { permission: true } } },
    });
    if (roles.length !== dto.roleIds.length) {
      throw new BadRequestException('Uno o más roles no existen');
    }

    // Techo de privilegio: el actor no puede otorgar permisos que no posee.
    const actorCodes = await this.loadPermissionCodes(actor.id);
    for (const role of roles) {
      for (const rp of role.permissions) {
        if (!actorCodes.has(rp.permission.code)) {
          throw new ForbiddenException(
            'No puedes asignar roles con permisos que no posees (principio de mínimo privilegio)',
          );
        }
      }
    }
    // El actor no puede autoasignarse roles que ya no posee (evita escalada propia).
    if (id === actor.id) {
      const held = await this.prisma.userRole.findMany({ where: { userId: id } });
      const heldIds = new Set(held.map((h) => h.roleId));
      for (const rid of dto.roleIds) {
        if (!heldIds.has(rid)) {
          throw new ForbiddenException('No puedes autoasignarte roles que no posees');
        }
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.userRole.deleteMany({ where: { userId: id } });
      await tx.userRole.createMany({
        data: dto.roleIds.map((roleId) => ({ userId: id, roleId })),
      });
      await this.audit.record(
        {
          userId: actor.id,
          email: actor.email,
          action: 'users.set_roles',
          resource: 'user',
          resourceId: id,
          detail: roles.map((r) => r.name).join(', '),
          ipAddress: ip,
          userAgent: ua,
        },
        tx,
      );
    });

    return this.findOne(id);
  }

  async setStatus(
    id: string,
    dto: UpdateUserStatusDto,
    actor: { id: string; email: string },
    ip: string,
    ua?: string,
  ) {
    if (id === actor.id) {
      throw new BadRequestException('No puedes desactivar tu propia cuenta');
    }
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: { isActive: dto.isActive, lockedUntil: null, failedAttempts: 0 },
      });
      if (!dto.isActive) {
        await tx.refreshToken.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      await this.audit.record(
        {
          userId: actor.id,
          email: actor.email,
          action: dto.isActive ? 'users.enable' : 'users.disable',
          resource: 'user',
          resourceId: id,
          ipAddress: ip,
          userAgent: ua,
        },
        tx,
      );
    });
    return this.findOne(id);
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        isActive: true,
        createdAt: true,
        lockedUntil: true,
        roles: { include: { role: true } },
      },
    });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    return user;
  }

  private async loadPermissionCodes(userId: string): Promise<Set<string>> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: {
        roles: {
          include: { role: { include: { permissions: { include: { permission: true } } } } },
        },
      },
    });
    const codes = new Set<string>();
    for (const ur of user.roles) {
      for (const rp of ur.role.permissions) codes.add(rp.permission.code);
    }
    return codes;
  }
}
