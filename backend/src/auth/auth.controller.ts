import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
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

interface RefreshRequest extends Request {
  user: { sub: string; tokenHash: string };
}

@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('register')
  @HttpCode(HttpStatus.ACCEPTED)
  async register(
    @Body() dto: RegisterDto,
    @Ip() ip: string,
    @Req() req: Request,
  ) {
    await this.auth.register(dto, ip, req.headers['user-agent']);
    return {
      message:
        'Si el correo es válido y no estaba registrado, la cuenta quedó creada. Inicia sesión para continuar.',
    };
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Ip() ip: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const session = await this.auth.login(dto, ip, req.headers['user-agent']);
    // Con 2FA activo no hay sesión todavía: se devuelve el reto y el código va por correo.
    if ('mfaRequired' in session) return session;
    this.auth.setRefreshCookie(res, session.refreshToken);
    return { accessToken: session.accessToken, user: session.user };
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('2fa/verify')
  @HttpCode(HttpStatus.OK)
  async verifyTwoFactor(
    @Body() dto: VerifyTwoFactorDto,
    @Ip() ip: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const session = await this.auth.verifyTwoFactor(dto, ip, req.headers['user-agent']);
    this.auth.setRefreshCookie(res, session.refreshToken);
    return { accessToken: session.accessToken, user: session.user };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('2fa/resend')
  @HttpCode(HttpStatus.OK)
  async resendTwoFactor(
    @Body() dto: ResendTwoFactorDto,
    @Ip() ip: string,
    @Req() req: Request,
  ) {
    return this.auth.resendTwoFactor(dto, ip, req.headers['user-agent']);
  }

  @Get('2fa/status')
  @HttpCode(HttpStatus.OK)
  twoFactorStatus(@CurrentUser() user: AuthUser) {
    return this.auth.twoFactorStatus(user.id);
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('2fa/setup')
  @HttpCode(HttpStatus.OK)
  setupTwoFactor(@CurrentUser() user: AuthUser, @Ip() ip: string, @Req() req: Request) {
    return this.auth.setupTwoFactor(user.id, ip, req.headers['user-agent']);
  }

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('2fa/confirm')
  @HttpCode(HttpStatus.OK)
  confirmTwoFactor(
    @CurrentUser() user: AuthUser,
    @Body() dto: ConfirmTwoFactorDto,
    @Ip() ip: string,
    @Req() req: Request,
  ) {
    const cookies = req.cookies as Record<string, string | undefined> | undefined;
    return this.auth.confirmTwoFactor(
      user.id,
      dto,
      ip,
      req.headers['user-agent'],
      cookies?.refreshToken,
    );
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('2fa/disable')
  @HttpCode(HttpStatus.OK)
  disableTwoFactor(
    @CurrentUser() user: AuthUser,
    @Body() dto: DisableTwoFactorDto,
    @Ip() ip: string,
    @Req() req: Request,
  ) {
    return this.auth.disableTwoFactor(user.id, dto, ip, req.headers['user-agent']);
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @UseGuards(AuthGuard('jwt-refresh'))
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: RefreshRequest,
    @Ip() ip: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const session = await this.auth.refresh(
      req.user.sub,
      req.user.tokenHash,
      ip,
      req.headers['user-agent'],
    );
    this.auth.setRefreshCookie(res, session.refreshToken);
    return { accessToken: session.accessToken, user: session.user };
  }

  @Public()
  @UseGuards(AuthGuard('jwt-refresh'))
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() req: RefreshRequest,
    @Ip() ip: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.auth.logout(req.user.sub, req.user.tokenHash, ip, req.headers['user-agent']);
    this.auth.clearRefreshCookie(res);
  }

  @Post('change-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body() dto: ChangePasswordDto,
    @Ip() ip: string,
    @Req() req: Request,
  ) {
    await this.auth.changePassword(user.id, dto, ip, req.headers['user-agent']);
  }

  @Get('me')
  @HttpCode(HttpStatus.OK)
  me(@CurrentUser() user: AuthUser) {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      roles: user.roles,
      permissions: user.permissions,
    };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('forgot-password')
  @HttpCode(HttpStatus.ACCEPTED)
  async forgotPassword(@Body() dto: ForgotPasswordDto, @Ip() ip: string, @Req() req: Request) {
    await this.auth.forgotPassword(dto, ip, req.headers['user-agent']);
    return { message: 'Si el correo existe, se enviará un enlace de recuperación.' };
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async resetPassword(@Body() dto: ResetPasswordDto, @Ip() ip: string, @Req() req: Request) {
    await this.auth.resetPassword(dto, ip, req.headers['user-agent']);
  }
}
