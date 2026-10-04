import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import * as crypto from 'crypto';
import { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { MailService } from '../mail/mail.service';
import { AuditService } from '../audit/audit.service';
import { hashToken } from './strategies/jwt-refresh.strategy';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
} from './dto/auth.dto';
import { User } from '@prisma/client';

const RESET_TTL_MINUTES = 30;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly maxAttempts: number;
  private readonly lockMinutes: number;
  private readonly accessTtl: string;
  private readonly refreshTtlDays: number;
  private readonly cookieSecure: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {
    this.maxAttempts = Number(this.config.get('LOGIN_MAX_ATTEMPTS') ?? 5);
    this.lockMinutes = Number(this.config.get('LOGIN_LOCK_MINUTES') ?? 15);
    this.accessTtl = this.config.get<string>('JWT_ACCESS_TTL') ?? '15m';
    this.refreshTtlDays = Number(this.config.get('JWT_REFRESH_TTL_DAYS') ?? 7);
    this.cookieSecure = this.config.get<string>('COOKIE_SECURE') === 'true';
  }

  async register(dto: RegisterDto, ip: string, userAgent?: string) {
    const email = dto.email.toLowerCase().trim();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      await this.audit.record({
        email,
        action: 'auth.register.duplicate',
        resource: 'user',
        ipAddress: ip,
        userAgent,
      });
      // Respuesta independiente de la existencia de la cuenta (anti-enumeración).
      return;
    }
    const passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id });
    const defaultRole = await this.prisma.role.findUnique({ where: { name: 'Usuario Regular' } });
    await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name: dto.name.trim(),
          email,
          passwordHash,
          roles: defaultRole ? { create: { roleId: defaultRole.id } } : undefined,
        },
      });
      await this.audit.record(
        {
          userId: user.id,
          email: user.email,
          action: 'auth.register',
          resource: 'user',
          resourceId: user.id,
          ipAddress: ip,
          userAgent,
        },
        tx,
      );
    });
  }

  async login(dto: LoginDto, ip: string, userAgent?: string) {
    const email = dto.email.toLowerCase().trim();
    // El bloqueo se limita al par (email, IP) para que un tercero no pueda bloquear una cuenta ajena.
    const lockKey = `login:lock:${email}:${ip}`;
    const locked = await this.redis.get(lockKey);
    if (locked) {
      await this.audit.record({
        email,
        action: 'auth.login.blocked',
        resource: 'auth',
        detail: 'Cuenta temporalmente bloqueada',
        ipAddress: ip,
        userAgent,
      });
      throw new ForbiddenException(
        `Demasiados intentos fallidos. Intenta de nuevo en ${this.lockMinutes} minutos.`,
      );
    }

    const user = await this.prisma.user.findUnique({ where: { email } });
    const invalid = new UnauthorizedException('Credenciales inválidas');

    if (!user || !user.isActive) {
      await this.registerFailure(email, ip);
      await this.audit.record({
        email,
        action: 'auth.login.failed',
        resource: 'auth',
        detail: 'Usuario inexistente o inactivo',
        ipAddress: ip,
        userAgent,
      });
      throw invalid;
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new ForbiddenException('Cuenta temporalmente bloqueada');
    }

    const ok = await argon2.verify(user.passwordHash, dto.password).catch(() => false);
    if (!ok) {
      await this.registerFailure(email, ip);
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedAttempts: { increment: 1 } },
      });
      await this.audit.record({
        userId: user.id,
        email,
        action: 'auth.login.failed',
        resource: 'auth',
        detail: 'Contraseña incorrecta',
        ipAddress: ip,
        userAgent,
      });
      throw invalid;
    }

    await this.redis.del(lockKey);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { failedAttempts: 0, lockedUntil: null },
      });
      await this.audit.record(
        {
          userId: user.id,
          email,
          action: 'auth.login.success',
          resource: 'auth',
          ipAddress: ip,
          userAgent,
        },
        tx,
      );
    });
    return this.buildSession(user, ip, userAgent);
  }

  private async registerFailure(email: string, ip: string) {
    const attempts = await this.redis.incr(`login:fail:${email}:${ip}`, this.lockMinutes * 60);
    if (attempts >= this.maxAttempts) {
      await this.redis.set(`login:lock:${email}:${ip}`, '1', this.lockMinutes * 60);
    }
  }

  async refresh(userId: string, tokenHash: string, ip: string, userAgent?: string) {
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (!stored || stored.userId !== userId || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token inválido o expirado');
    }

    // Reutilización de un refresh token ya rotado/revocado => posible robo de token:
    // se revoca toda la familia de sesiones del usuario y se registra el evento.
    if (stored.revokedAt) {
      await this.prisma.$transaction(async (tx) => {
        await tx.refreshToken.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await this.audit.record(
          {
            userId,
            action: 'auth.refresh.reuse_detected',
            resource: 'auth',
            detail: 'refresh token reutilizado; todas las sesiones fueron revocadas',
            ipAddress: ip,
            userAgent,
          },
          tx,
        );
      });
      throw new UnauthorizedException('Sesión invalidada por reutilización de token');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive) throw new UnauthorizedException('Cuenta inactiva');

    await this.prisma.$transaction(async (tx) => {
      await tx.refreshToken.update({
        where: { id: stored.id },
        data: { revokedAt: new Date() },
      });
      await this.audit.record(
        {
          userId,
          action: 'auth.refresh.rotated',
          resource: 'auth',
          ipAddress: ip,
          userAgent,
        },
        tx,
      );
    });
    return this.buildSession(user, ip, userAgent);
  }

  async logout(userId: string, tokenHash: string, ip: string, userAgent?: string) {
    await this.prisma.$transaction(async (tx) => {
      await tx.refreshToken.updateMany({
        where: { tokenHash, userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.record(
        {
          userId,
          action: 'auth.logout',
          resource: 'auth',
          ipAddress: ip,
          userAgent,
        },
        tx,
      );
    });
  }

  async changePassword(userId: string, dto: ChangePasswordDto, ip: string, userAgent?: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const ok = await argon2.verify(user.passwordHash, dto.currentPassword).catch(() => false);
    if (!ok) throw new BadRequestException('La contraseña actual es incorrecta');
    const passwordHash = await argon2.hash(dto.newPassword, { type: argon2.argon2id });
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { passwordHash } });
      await tx.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.record(
        {
          userId,
          email: user.email,
          action: 'auth.change_password',
          resource: 'user',
          resourceId: userId,
          ipAddress: ip,
          userAgent,
        },
        tx,
      );
    });
  }

  async forgotPassword(dto: ForgotPasswordDto, ip: string, userAgent?: string) {
    const email = dto.email.toLowerCase().trim();
    const user = await this.prisma.user.findUnique({ where: { email } });
    await this.audit.record({
      userId: user?.id,
      email,
      action: 'auth.forgot_password',
      resource: 'user',
      resourceId: user?.id,
      ipAddress: ip,
      userAgent,
    });
    if (!user || !user.isActive) return;

    const token = crypto.randomBytes(32).toString('base64url');
    await this.prisma.$transaction(async (tx) => {
      await tx.passwordReset.create({
        data: {
          tokenHash: hashToken(token),
          userId: user.id,
          expiresAt: new Date(Date.now() + RESET_TTL_MINUTES * 60 * 1000),
        },
      });
      await this.audit.record(
        {
          userId: user.id,
          email: user.email,
          action: 'auth.forgot_password.issued',
          resource: 'user',
          resourceId: user.id,
          ipAddress: ip,
          userAgent,
        },
        tx,
      );
    });
    await this.mail.sendPasswordReset(user.email, token);
  }

  async resetPassword(dto: ResetPasswordDto, ip: string, userAgent?: string) {
    const tokenHash = hashToken(dto.token);
    const record = await this.prisma.passwordReset.findUnique({ where: { tokenHash } });
    if (!record || record.usedAt || record.expiresAt < new Date()) {
      throw new BadRequestException('El enlace de recuperación es inválido o expiró');
    }
    const passwordHash = await argon2.hash(dto.newPassword, { type: argon2.argon2id });
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: record.userId }, data: { passwordHash } });
      await tx.passwordReset.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      });
      await tx.refreshToken.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.record(
        {
          userId: record.userId,
          action: 'auth.reset_password',
          resource: 'user',
          resourceId: record.userId,
          ipAddress: ip,
          userAgent,
        },
        tx,
      );
    });
  }

  private async buildSession(user: User, ip: string, userAgent?: string) {
    const grants = await this.loadGrants(user.id);
    const accessToken = await this.jwt.signAsync(
      {
        sub: user.id,
        email: user.email,
        name: user.name,
        roles: grants.roles,
        permissions: grants.permissions,
        typ: 'access',
      },
      {
        secret: this.config.get<string>('JWT_SECRET'),
        expiresIn: this.accessTtl,
      },
    );

    const jti = crypto.randomUUID();
    const refreshToken = await this.jwt.signAsync(
      { sub: user.id, jti, typ: 'refresh' },
      {
        secret: this.config.get<string>('JWT_REFRESH_SECRET'),
        expiresIn: `${this.refreshTtlDays}d`,
      },
    );
    await this.prisma.refreshToken.create({
      data: {
        tokenHash: hashToken(refreshToken),
        userId: user.id,
        expiresAt: new Date(Date.now() + this.refreshTtlDays * 24 * 60 * 60 * 1000),
        ip,
        userAgent,
      },
    });

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        roles: grants.roles,
        permissions: grants.permissions,
      },
    };
  }

  async loadGrants(userId: string): Promise<{ roles: string[]; permissions: string[] }> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: {
        roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
      },
    });
    const roles = user.roles.map((r) => r.role.name);
    const permissions = new Set<string>();
    for (const ur of user.roles) {
      for (const rp of ur.role.permissions) {
        permissions.add(rp.permission.code);
      }
    }
    return { roles, permissions: Array.from(permissions).sort() };
  }

  setRefreshCookie(res: Response, token: string) {
    res.cookie('refreshToken', token, {
      httpOnly: true,
      secure: this.cookieSecure,
      sameSite: 'strict',
      path: '/api/v1/auth',
      maxAge: this.refreshTtlDays * 24 * 60 * 60 * 1000,
    });
  }

  clearRefreshCookie(res: Response) {
    res.clearCookie('refreshToken', {
      httpOnly: true,
      secure: this.cookieSecure,
      sameSite: 'strict',
      path: '/api/v1/auth',
    });
  }
}
