import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from './permissions.guard';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { PermissionCode } from '../enums/permissions.enum';

describe('PermissionsGuard', () => {
  const reflector = {
    getAllAndOverride: jest.fn(),
  } as unknown as Reflector;

  const ctx = {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({
        user: {
          id: 'u1',
          email: 'a@unach.mx',
          name: 'A',
          roles: ['Editor'],
          permissions: ['products:read', 'products:create'],
        },
      }),
    }),
  } as unknown as ExecutionContext;

  beforeEach(() => jest.clearAllMocks());

  it('permite rutas públicas', () => {
    (reflector.getAllAndOverride as jest.Mock).mockImplementation((key: string) =>
      key === IS_PUBLIC_KEY ? true : undefined,
    );
    expect(new PermissionsGuard(reflector).canActivate(ctx)).toBe(true);
  });

  it('permite cuando el usuario tiene todos los permisos requeridos', () => {
    (reflector.getAllAndOverride as jest.Mock).mockImplementation((key: string) => {
      if (key === IS_PUBLIC_KEY) return false;
      if (key === PERMISSIONS_KEY) return [PermissionCode.ProductsRead, PermissionCode.ProductsCreate];
      return undefined;
    });
    expect(new PermissionsGuard(reflector).canActivate(ctx)).toBe(true);
  });

  it('rechaza cuando falta un permiso', () => {
    (reflector.getAllAndOverride as jest.Mock).mockImplementation((key: string) => {
      if (key === IS_PUBLIC_KEY) return false;
      if (key === PERMISSIONS_KEY) return [PermissionCode.ProductsDelete];
      return undefined;
    });
    expect(() => new PermissionsGuard(reflector).canActivate(ctx)).toThrow('Permisos insuficientes');
  });
});
