import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateRoleDto, SetRolePermissionsDto, UpdateRoleDto } from './dto/role.dto';

const SYSTEM_ROLES = ['Administrador', 'Editor', 'Usuario Regular'];

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  findAll() {
    return this.prisma.role.findMany({
      include: {
        permissions: { include: { permission: true } },
        _count: { select: { users: true } },
      },
      orderBy: { name: 'asc' },
    });
  }

  async create(dto: CreateRoleDto, actor: { id: string; email: string }, ip: string, ua?: string) {
    if (dto.permissionIds?.length) {
      await this.assertCanGrant(actor.id, dto.permissionIds);
    }
    try {
      const role = await this.prisma.role.create({
        data: {
          name: dto.name.trim(),
          description: dto.description?.trim(),
          permissions: dto.permissionIds?.length
            ? {
                create: dto.permissionIds.map((permissionId) => ({ permissionId })),
              }
            : undefined,
        },
        include: { permissions: { include: { permission: true } } },
      });
      await this.audit.record({
        userId: actor.id,
        email: actor.email,
        action: 'roles.create',
        resource: 'role',
        resourceId: role.id,
        detail: role.name,
        ipAddress: ip,
        userAgent: ua,
      });
      return role;
    } catch {
      throw new ConflictException('El rol ya existe');
    }
  }

  async update(
    id: string,
    dto: UpdateRoleDto,
    actor: { id: string; email: string },
    ip: string,
    ua?: string,
  ) {
    const role = await this.findOrThrow(id);
    if (role.isSystem && dto.name && dto.name !== role.name) {
      throw new BadRequestException('Los roles del sistema no pueden renombrarse');
    }
    try {
      const updated = await this.prisma.role.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.description !== undefined ? { description: dto.description?.trim() } : {}),
        },
        include: { permissions: { include: { permission: true } } },
      });
      await this.audit.record({
        userId: actor.id,
        email: actor.email,
        action: 'roles.update',
        resource: 'role',
        resourceId: id,
        detail: updated.name,
        ipAddress: ip,
        userAgent: ua,
      });
      return updated;
    } catch {
      throw new ConflictException('El nombre del rol ya está en uso');
    }
  }

  async setPermissions(
    id: string,
    dto: SetRolePermissionsDto,
    actor: { id: string; email: string },
    ip: string,
    ua?: string,
  ) {
    const role = await this.findOrThrow(id);
    const perms = await this.prisma.permission.findMany({
      where: { id: { in: dto.permissionIds } },
    });
    if (perms.length !== dto.permissionIds.length) {
      throw new BadRequestException('Uno o más permisos no existen');
    }
    await this.assertCanGrant(actor.id, dto.permissionIds);
    if (role.name === 'Administrador') {
      const all = await this.prisma.permission.count();
      if (perms.length < all) {
        throw new BadRequestException('El rol Administrador debe conservar todos los permisos');
      }
    }

    await this.prisma.$transaction([
      this.prisma.rolePermission.deleteMany({ where: { roleId: id } }),
      this.prisma.rolePermission.createMany({
        data: dto.permissionIds.map((permissionId) => ({ roleId: id, permissionId })),
      }),
    ]);

    await this.audit.record({
      userId: actor.id,
      email: actor.email,
      action: 'roles.set_permissions',
      resource: 'role',
      resourceId: id,
      detail: perms.map((p) => p.code).join(', '),
      ipAddress: ip,
      userAgent: ua,
    });
    return this.findOrThrow(id);
  }

  async remove(id: string, actor: { id: string; email: string }, ip: string, ua?: string) {
    const role = await this.findOrThrow(id);
    if (role.isSystem || SYSTEM_ROLES.includes(role.name)) {
      throw new BadRequestException('No se pueden eliminar roles del sistema');
    }
    await this.prisma.role.delete({ where: { id } });
    await this.audit.record({
      userId: actor.id,
      email: actor.email,
      action: 'roles.delete',
      resource: 'role',
      resourceId: id,
      detail: role.name,
      ipAddress: ip,
      userAgent: ua,
    });
  }

  private async findOrThrow(id: string) {
    const role = await this.prisma.role.findUnique({
      where: { id },
      include: { permissions: { include: { permission: true } }, _count: { select: { users: true } } },
    });
    if (!role) throw new NotFoundException('Rol no encontrado');
    return role;
  }

  /** Techo de privilegio: no se pueden otorgar permisos que el actor no posee. */
  private async assertCanGrant(actorId: string, permissionIds: string[]) {
    const actor = await this.prisma.user.findUniqueOrThrow({
      where: { id: actorId },
      include: {
        roles: {
          include: { role: { include: { permissions: { include: { permission: true } } } } },
        },
      },
    });
    const held = new Set<string>();
    for (const ur of actor.roles) {
      for (const rp of ur.role.permissions) held.add(rp.permission.code);
    }
    const target = await this.prisma.permission.findMany({
      where: { id: { in: permissionIds } },
    });
    for (const p of target) {
      if (!held.has(p.code)) {
        throw new ForbiddenException(
          `No puedes otorgar el permiso ${p.code} porque no lo posees (principio de mínimo privilegio)`,
        );
      }
    }
  }
}
