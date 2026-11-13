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
    this.baseUrl = this.config.get<string>('APP_BASE_URL') ?? 'https://localhost:8443';
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
        <div style="font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;color:#1e293b">
          <h2 style="margin:0 0 8px;color:#0f172a">Verificación en dos pasos</h2>
          <p style="margin:0 0 16px;line-height:1.5">Usa este código para completar tu inicio de sesión:</p>
          <p style="font-size:32px;letter-spacing:8px;font-weight:700;margin:20px 0;text-align:center;color:#2563eb;font-family:monospace">${code}</p>
          <p style="margin:0 0 8px;line-height:1.5">Vence en <strong>${minutes} minutos</strong> y solo puede usarse una vez.</p>
          <p style="color:#64748b;font-size:13px;margin:0">Si no intentaste iniciar sesión, cambia tu contraseña de inmediato.</p>
        </div>`,
    });
    this.logger.log(`Código 2FA enviado: ${info.messageId ?? 'ok'} -> ${to}`);
  }

  async sendPasswordReset(to: string, resetToken: string): Promise<void> {
    const url = `${this.baseUrl}/reset-password?token=${encodeURIComponent(resetToken)}`;
    const info = await this.transporter.sendMail({
      from: this.from,
      to,
      subject: 'Recuperación de contraseña – Catálogo UNACH',
      text: `Recibimos una solicitud para restablecer tu contraseña. Visita el siguiente enlace (vence en 30 minutos):\n\n${url}\n\nSi no fuiste tú, ignora este mensaje.`,
      html: `
        <div style="font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;color:#1e293b">
          <h2 style="margin:0 0 12px;color:#0f172a;font-size:22px">Recuperación de contraseña</h2>
          <p style="margin:0 0 16px;line-height:1.5">Recibimos una solicitud para restablecer la contraseña asociada a tu cuenta en <strong>Catálogo UNACH</strong>.</p>
          <div style="text-align:center;margin:24px 0">
            <a href="${url}" style="background:#2563eb;color:#ffffff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">Restablecer mi contraseña</a>
          </div>
          <p style="font-size:14px;color:#64748b;line-height:1.5">Este enlace es de <strong>un solo uso</strong> y vencerá en <strong>30 minutos</strong>.</p>
          <p style="font-size:13px;color:#94a3b8;word-break:break-all;margin-top:16px">Si el botón no funciona, copia y pega el siguiente enlace en tu navegador:<br><a href="${url}" style="color:#2563eb">${url}</a></p>
          <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0" />
          <p style="font-size:12px;color:#94a3b8;margin:0">Si tú no solicitaste este cambio, puedes ignorar este mensaje de forma segura. Tu contraseña actual no cambiará.</p>
        </div>`,
    });
    this.logger.log(`Correo de recuperación enviado: ${info.messageId ?? 'ok'} -> ${to}`);
  }
}
