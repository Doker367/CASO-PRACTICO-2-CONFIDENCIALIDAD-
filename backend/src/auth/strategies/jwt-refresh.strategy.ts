import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';
import * as crypto from 'crypto';
import { requireSecret } from './jwt.strategy';

interface RefreshPayload {
  sub: string;
  jti: string;
  typ: 'refresh';
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(Strategy, 'jwt-refresh') {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (req: Request) => {
          const body = req.body as { refreshToken?: string } | undefined;
          return body?.refreshToken ?? (req.cookies?.refreshToken as string | undefined) ?? null;
        },
      ]),
      ignoreExpiration: false,
      secretOrKey: requireSecret(config, 'JWT_REFRESH_SECRET'),
      passReqToCallback: true,
    });
  }

  validate(req: Request, payload: RefreshPayload) {
    if (payload.typ !== 'refresh') {
      throw new UnauthorizedException('Tipo de token inválido');
    }
    const token =
      (req.body as { refreshToken?: string } | undefined)?.refreshToken ??
      (req.cookies?.refreshToken as string | undefined);
    if (!token) throw new UnauthorizedException('Refresh token ausente');
    return { sub: payload.sub, jti: payload.jti, token, tokenHash: hashToken(token) };
  }
}
