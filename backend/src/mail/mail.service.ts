import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: nodemailer.Transporter;
  private readonly from: string;
  private readonly baseUrl: string;

  constructor(private readonly config: ConfigService) {
    this.from = this.config.get<string>('MAIL_FROM') ?? 'no-reply@unach.local';
    this.baseUrl = this.config.get<string>('APP_BASE_URL') ?? 'http://localhost';
    this.transporter = nodemailer.createTransport({
      host: this.config.get<string>('SMTP_HOST') ?? 'localhost',
      port: Number(this.config.get('SMTP_PORT') ?? 1025),
      secure: false,
      auth:
        this.config.get('SMTP_USER') && this.config.get('SMTP_PASS')
          ? { user: this.config.get('SMTP_USER'), pass: this.config.get('SMTP_PASS') }
          : undefined,
    });
  }

  async sendTwoFactorCode(to: string, code: string, minutes: number): Promise<void> {
    const info = await this.transporter.sendMail({
      from: this.from,
      to,
      subject: 'Tu código de verificación',
      text: `Tu código de verificación es: ${code}\n\nVence en ${minutes} minutos y solo puede usarse una vez. Si no intentaste iniciar sesión, cambia tu contraseña de inmediato.`,
      html: `
        <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto">
          <h2 style="margin:0 0 8px">Verificación en dos pasos</h2>
          <p>Usa este código para completar tu inicio de sesión:</p>
          <p style="font-size:30px;letter-spacing:8px;font-weight:700;margin:16px 0">${code}</p>
          <p>Vence en <strong>${minutes} minutos</strong> y solo puede usarse una vez.</p>
          <p style="color:#666">Si no intentaste iniciar sesión, cambia tu contraseña de inmediato.</p>
        </div>`,
    });
    this.logger.log(`Código 2FA enviado: ${info.messageId ?? 'ok'} -> ${to}`);
  }

  async sendPasswordReset(to: string, resetToken: string): Promise<void> {
    const url = `${this.baseUrl}/reset-password?token=${encodeURIComponent(resetToken)}`;
    const info = await this.transporter.sendMail({
      from: this.from,
      to,
      subject: 'Recuperación de contraseña',
      text: `Recibimos una solicitud para restablecer tu contraseña. Visita el siguiente enlace (vence en 30 minutos):\n\n${url}\n\nSi no fuiste tú, ignora este mensaje.`,
      html: `<p>Recibimos una solicitud para restablecer tu contraseña.</p><p><a href="${url}">Restablecer contraseña</a> (vence en 30 minutos).</p><p>Si no fuiste tú, ignora este mensaje.</p>`,
    });
    this.logger.log(`Correo de recuperación enviado: ${info.messageId ?? 'ok'} -> ${to}`);
  }
}
