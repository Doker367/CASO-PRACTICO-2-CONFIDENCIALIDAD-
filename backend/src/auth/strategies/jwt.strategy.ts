import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';

interface JwtPayload {
  sub: string;
  email: string;
  name: string;
  roles: string[];
  permissions: string[];
  typ: 'access';
}

const PLACEHOLDER_SECRETS = new Set([
  'CHANGE_ME_USE_openssl_rand_base64_64_BYTES',
  'CHANGE_ME_USE_openssl_rand_base64_64_BYTES_OTHER',
  'dev_only_secret_change_in_production_0123456789abcdef',
  'dev_only_refresh_secret_change_in_production_0123456789',
]);

export function requireSecret(config: ConfigService, name: string): string {
  const value = config.get<string>(name);
  if (!value || value.length < 32 || PLACEHOLDER_SECRETS.has(value)) {
    throw new Error(
      `${name} debe ser un secreto aleatorio de al menos 32 caracteres (genera uno con: openssl rand -base64 64)`,
    );
  }
  return value;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: requireSecret(config, 'JWT_SECRET'),
    });
  }

  async validate(payload: JwtPayload): Promise<AuthUser> {
    if (payload.typ !== 'access') {
      throw new UnauthorizedException('Tipo de token inválido');
    }
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Cuenta inactiva o inexistente');
    }
    return {
      id: payload.sub,
      email: payload.email,
      name: payload.name,
      roles: payload.roles ?? [],
      permissions: payload.permissions ?? [],
    };
  }
}
