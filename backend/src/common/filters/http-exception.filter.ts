import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Error interno del servidor';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      if (typeof res === 'string') {
        message = this.sanitize(res);
      } else if (typeof res === 'object' && res !== null) {
        const body = res as { message?: string | string[] };
        if (Array.isArray(body.message)) {
          message = body.message.join('. ');
        } else if (typeof body.message === 'string') {
          message = this.sanitize(body.message);
        }
      }
    } else {
      this.logger.error(
        exception instanceof Error ? exception.message : 'Error desconocido',
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    response.status(status).json({
      statusCode: status,
      message,
    });
  }

  /** Elimina nombres de clases/librerías del framework de los mensajes al cliente. */
  private sanitize(text: string): string {
    return text.replace(/^[A-Za-z]+Exception:\s*/, '');
  }
}
