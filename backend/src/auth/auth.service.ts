import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
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
  ConfirmTwoFactorDto,
  DisableTwoFactorDto,
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  ResendTwoFactorDto,
  ResetPasswordDto,
  VerifyTwoFactorDto,
} from './dto/auth.dto';
import {
  OTP_MAX_ATTEMPTS,
  OTP_TTL_SECONDS,
  generateOtp,
  hashOtp,
  maskEmail,
  verifyOtp,
} from './two-factor.util';
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
  private readonly otpSecret: string;

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
    this.otpSecret =
      this.config.get<string>('MFA_SECRET') ??
      this.config.get<string>('JWT_SECRET') ??
      crypto.randomBytes(32).toString('hex');
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
    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedAttempts: 0, lockedUntil: null },
    });

    // Segundo factor: la contraseña correcta NO emite sesión todavía.
    if (user.twoFactorEnabled) {
      await this.audit.record({
        userId: user.id,
        email,
        action: 'auth.login.2fa_challenge',
        resource: 'auth',
        detail: 'Contraseña válida; se envió código al correo',
        ipAddress: ip,
        userAgent,
      });
      return this.startTwoFactorChallenge(user);
    }

    await this.audit.record({
      userId: user.id,
      email,
      action: 'auth.login.success',
      resource: 'auth',
      ipAddress: ip,
      userAgent,
    });
    return this.buildSession(user, ip, userAgent);
  }

  /** Identificador opaco del reto: en Redis nunca se guarda el token en claro. */
  private challengeId(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  private async startTwoFactorChallenge(user: User) {
    const challengeToken = crypto.randomBytes(32).toString('base64url');
    const id = this.challengeId(challengeToken);
    const code = generateOtp();

    await this.redis.set(
      `mfa:login:${id}`,
      JSON.stringify({ userId: user.id, email: user.email, attempts: 0 }),
      OTP_TTL_SECONDS,
    );
    await this.redis.set(
      `mfa:login:code:${id}`,
      hashOtp(this.otpSecret, id, code),
      OTP_TTL_SECONDS,
    );

    try {
      await this.mail.sendTwoFactorCode(user.email, code, OTP_TTL_SECONDS / 60);
    } catch (err) {
      await this.redis.del(`mfa:login:${id}`);
      await this.redis.del(`mfa:login:code:${id}`);
      this.logger.error(`No se pudo enviar el código 2FA a ${user.email}`, err as Error);
      throw new ServiceUnavailableException(
        'No se pudo enviar el código de verificación. Intenta de nuevo.',
      );
    }

    return {
      mfaRequired: true,
      challengeToken,
      email: maskEmail(user.email),
      expiresInSeconds: OTP_TTL_SECONDS,
    };
  }

  async verifyTwoFactor(dto: VerifyTwoFactorDto, ip: string, userAgent?: string) {
    const id = this.challengeId(dto.challengeToken);
    const key = `mfa:login:${id}`;
    const codeKey = `mfa:login:code:${id}`;
    const raw = await this.redis.get(key);
    const expected = await this.redis.get(codeKey);
    if (!raw || !expected) {
      throw new UnauthorizedException('Código inválido o expirado');
    }

    let challenge: { userId: string; email: string; attempts: number };
    try {
      challenge = JSON.parse(raw);
    } catch {
      await this.redis.del(key);
      await this.redis.del(codeKey);
      throw new UnauthorizedException('Código inválido o expirado');
    }

    if (!verifyOtp(this.otpSecret, id, dto.code.trim(), expected)) {
      challenge.attempts += 1;
      await this.audit.record({
        userId: challenge.userId,
        email: challenge.email,
        action: 'auth.2fa.failed',
        resource: 'auth',
        detail: `Intento ${challenge.attempts} de ${OTP_MAX_ATTEMPTS}`,
        ipAddress: ip,
        userAgent,
      });
      if (challenge.attempts >= OTP_MAX_ATTEMPTS) {
        await this.redis.del(key);
        await this.redis.del(codeKey);
        throw new UnauthorizedException(
          'Demasiados intentos con el código. Inicia sesión de nuevo.',
        );
      }
      const ttl = await this.redis.client.ttl(key);
      await this.redis.set(key, JSON.stringify(challenge), ttl > 0 ? ttl : OTP_TTL_SECONDS);
      throw new UnauthorizedException('Código inválido o expirado');
    }

    await this.redis.del(key);
    await this.redis.del(codeKey);

    const user = await this.prisma.user.findUnique({ where: { id: challenge.userId } });
    if (!user || !user.isActive) throw new UnauthorizedException('Cuenta inactiva');

    await this.audit.record({
      userId: user.id,
      email: user.email,
      action: 'auth.login.success',
      resource: 'auth',
      detail: 'Segundo factor verificado',
      ipAddress: ip,
      userAgent,
    });
    return this.buildSession(user, ip, userAgent);
  }

  async resendTwoFactor(dto: ResendTwoFactorDto, ip: string, userAgent?: string) {
    const id = this.challengeId(dto.challengeToken);
    const key = `mfa:login:${id}`;
    const codeKey = `mfa:login:code:${id}`;
    const raw = await this.redis.get(key);
    if (!raw) throw new UnauthorizedException('El reto expiró. Inicia sesión de nuevo.');

    const cooldownKey = `mfa:login:resend:${id}`;
    if (await this.redis.get(cooldownKey)) {
      throw new HttpException(
        'Espera un minuto antes de pedir otro código',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    await this.redis.set(cooldownKey, '1', 60);

    const challenge = JSON.parse(raw) as { userId: string; email: string; attempts: number };
    challenge.attempts = 0;
    const code = generateOtp();
    const ttl = await this.redis.client.ttl(key);
    const remaining = ttl > 0 ? ttl : OTP_TTL_SECONDS;

    await this.redis.set(key, JSON.stringify(challenge), remaining);
    await this.redis.set(codeKey, hashOtp(this.otpSecret, id, code), remaining);
    try {
      await this.mail.sendTwoFactorCode(challenge.email, code, Math.ceil(remaining / 60));
    } catch (err) {
      this.logger.error(`No se pudo reenviar el código 2FA a ${challenge.email}`, err as Error);
      throw new ServiceUnavailableException('No se pudo reenviar el código. Intenta de nuevo.');
    }

    await this.audit.record({
      userId: challenge.userId,
      email: challenge.email,
      action: 'auth.2fa.resent',
      resource: 'auth',
      ipAddress: ip,
      userAgent,
    });
    return {
      message: 'Código reenviado',
      email: maskEmail(challenge.email),
      expiresInSeconds: remaining,
    };
  }

  async twoFactorStatus(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return {
      enabled: user.twoFactorEnabled,
      method: 'email' as const,
      email: maskEmail(user.email),
      enabledAt: user.twoFactorEnabledAt,
    };
  }

  /** Paso 1 de la activación: envía un código al correo ya registrado. */
  async setupTwoFactor(userId: string, ip: string, userAgent?: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.isActive) throw new ForbiddenException('Cuenta inactiva');
    if (user.twoFactorEnabled) {
      throw new BadRequestException('La verificación en dos pasos ya está activa');
    }

    const code = generateOtp();
    await this.redis.set(
      `mfa:setup:code:${userId}`,
      hashOtp(this.otpSecret, `setup:${userId}`, code),
      OTP_TTL_SECONDS,
    );
    await this.redis.del(`mfa:setup:attempts:${userId}`);

    try {
      await this.mail.sendTwoFactorCode(user.email, code, OTP_TTL_SECONDS / 60);
    } catch (err) {
      await this.redis.del(`mfa:setup:code:${userId}`);
      this.logger.error(`No se pudo enviar el código de activación a ${user.email}`, err as Error);
      throw new ServiceUnavailableException(
        'No se pudo enviar el código de verificación. Intenta de nuevo.',
      );
    }

    await this.audit.record({
      userId,
      email: user.email,
      action: 'auth.2fa.setup_requested',
      resource: 'user',
      resourceId: userId,
      ipAddress: ip,
      userAgent,
    });
    return {
      message: 'Código enviado al correo registrado',
      email: maskEmail(user.email),
      expiresInSeconds: OTP_TTL_SECONDS,
    };
  }

  /** Paso 2: confirma el código y activa el segundo factor. */
  async confirmTwoFactor(
    userId: string,
    dto: ConfirmTwoFactorDto,
    ip: string,
    userAgent?: string,
    keepRefreshToken?: string,
  ) {
    const codeKey = `mfa:setup:code:${userId}`;
    const expected = await this.redis.get(codeKey);
    if (!expected) {
      throw new BadRequestException('El código expiró. Solicita uno nuevo.');
    }

    const attempts = await this.redis.incr(
      `mfa:setup:attempts:${userId}`,
      OTP_TTL_SECONDS,
    );
    if (attempts > OTP_MAX_ATTEMPTS) {
      await this.redis.del(codeKey);
      await this.redis.del(`mfa:setup:attempts:${userId}`);
      throw new BadRequestException('Demasiados intentos. Solicita un código nuevo.');
    }
    if (!verifyOtp(this.otpSecret, `setup:${userId}`, dto.code.trim(), expected)) {
      throw new BadRequestException('Código inválido o expirado');
    }

    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { twoFactorEnabled: true, twoFactorEnabledAt: new Date() },
      });
      // Al activar 2FA se revocan las demás sesiones; la actual se conserva.
      await tx.refreshToken.updateMany({
        where: {
          userId,
          revokedAt: null,
          ...(keepRefreshToken ? { tokenHash: { not: hashToken(keepRefreshToken) } } : {}),
        },
        data: { revokedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          userId,
          email: user.email,
          action: 'auth.2fa.enabled',
          resource: 'user',
          resourceId: userId,
          detail: 'Segundo factor por correo activado; otras sesiones revocadas',
          ipAddress: ip,
          userAgent,
        },
      });
    });
    await this.redis.del(codeKey);
    await this.redis.del(`mfa:setup:attempts:${userId}`);

    return { enabled: true, method: 'email' as const };
  }

  async disableTwoFactor(
    userId: string,
    dto: DisableTwoFactorDto,
    ip: string,
    userAgent?: string,
  ) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const ok = await argon2.verify(user.passwordHash, dto.password).catch(() => false);
    if (!ok) throw new BadRequestException('La contraseña es incorrecta');

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { twoFactorEnabled: false, twoFactorEnabledAt: null },
      });
      await tx.auditLog.create({
        data: {
          userId,
          email: user.email,
          action: 'auth.2fa.disabled',
          resource: 'user',
          resourceId: userId,
          detail: 'Segundo factor desactivado por el usuario',
          ipAddress: ip,
          userAgent,
        },
      });
    });
    await this.redis.del(`mfa:setup:code:${userId}`);
    await this.redis.del(`mfa:setup:attempts:${userId}`);

    return { enabled: false, method: 'email' as const };
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
      // Invalida tokens previos no utilizados para evitar solicitudes paralelas o reutilizaciones
      await tx.passwordReset.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      });
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

    try {
      await this.mail.sendPasswordReset(user.email, token);
    } catch (err) {
      this.logger.error(`Error enviando correo de recuperación a ${user.email}: ${(err as Error).message}`);
    }
  }

  async resetPassword(dto: ResetPasswordDto, ip: string, userAgent?: string) {
    const tokenHash = hashToken(dto.token);
    const record = await this.prisma.passwordReset.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (!record || record.usedAt || record.expiresAt < new Date()) {
      throw new BadRequestException('El enlace de recuperación es inválido o expiró');
    }
    if (!record.user || !record.user.isActive) {
      throw new BadRequestException('El usuario no existe o se encuentra inactivo');
    }

    const passwordHash = await argon2.hash(dto.newPassword, { type: argon2.argon2id });
    await this.prisma.$transaction(async (tx) => {
      // 1) Actualiza contraseña y restablece bloqueos/intentos fallidos en BD
      await tx.user.update({
        where: { id: record.userId },
        data: {
          passwordHash,
          failedAttempts: 0,
          lockedUntil: null,
        },
      });
      // 2) Marca como usados todos los tokens pendientes de este usuario
      await tx.passwordReset.updateMany({
        where: { userId: record.userId, usedAt: null },
        data: { usedAt: new Date() },
      });
      // 3) Revoca todas las sesiones activas (refresh tokens) para expulsar sesiones previas
      await tx.refreshToken.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      // 4) Auditoría con el email del usuario
      await this.audit.record(
        {
          userId: record.userId,
          email: record.user.email,
          action: 'auth.reset_password',
          resource: 'user',
          resourceId: record.userId,
          ipAddress: ip,
          userAgent,
        },
        tx,
      );
    });

    // 5) Desbloquea en Redis cualquier bloqueo temporal activo por fuerza bruta previa
    const userEmail = record.user.email.toLowerCase().trim();
    try {
      const lockKeys = await this.redis.client.keys(`login:*:${userEmail}:*`);
      if (lockKeys && lockKeys.length > 0) {
        await this.redis.client.del(...lockKeys);
      }
    } catch {
      await this.redis.del(`login:lock:${userEmail}:${ip}`).catch(() => {});
      await this.redis.del(`login:fail:${userEmail}:${ip}`).catch(() => {});
    }
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
