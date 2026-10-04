import { AllExceptionsFilter } from './http-exception.filter';
import { ArgumentsHost, HttpException, HttpStatus, Logger } from '@nestjs/common';

describe('AllExceptionsFilter', () => {
  const json = jest.fn();
  const status = jest.fn(() => ({ json }));
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
      getRequest: () => ({}),
    }),
  } as unknown as ArgumentsHost;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  it('devuelve mensaje controlado en errores internos sin filtrar stack', () => {
    new AllExceptionsFilter().catch(new Error('DB password is X at /etc/secret'), host);
    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(json).toHaveBeenCalledWith({
      statusCode: 500,
      message: 'Error interno del servidor',
    });
  });

  it('propaga mensajes de HttpException conocidos', () => {
    new AllExceptionsFilter().catch(new HttpException('Credenciales inválidas', 401), host);
    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({ statusCode: 401, message: 'Credenciales inválidas' });
  });
});
