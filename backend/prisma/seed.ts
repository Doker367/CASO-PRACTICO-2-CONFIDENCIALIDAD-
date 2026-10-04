import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

const PERMISSIONS = [
  { code: 'products:read', area: 'products', action: 'read', description: 'Visualizar productos' },
  { code: 'products:create', area: 'products', action: 'create', description: 'Crear productos' },
  { code: 'products:update', area: 'products', action: 'update', description: 'Modificar productos' },
  { code: 'products:delete', area: 'products', action: 'delete', description: 'Eliminar productos' },
  { code: 'categories:read', area: 'categories', action: 'read', description: 'Visualizar categorías' },
  { code: 'categories:write', area: 'categories', action: 'write', description: 'Crear o modificar categorías' },
  { code: 'categories:delete', area: 'categories', action: 'delete', description: 'Eliminar categorías' },
  { code: 'users:read', area: 'users', action: 'read', description: 'Visualizar usuarios' },
  { code: 'users:manage', area: 'users', action: 'manage', description: 'Gestionar usuarios y roles asignados' },
  { code: 'roles:manage', area: 'roles', action: 'manage', description: 'Crear, modificar y eliminar roles y permisos' },
  { code: 'permissions:read', area: 'permissions', action: 'read', description: 'Visualizar catálogo de permisos' },
  { code: 'audit:read', area: 'audit', action: 'read', description: 'Consultar el registro de auditoría' },
];

const ROLES: Record<string, string[]> = {
  Administrador: PERMISSIONS.map((p) => p.code),
  Editor: [
    'products:read',
    'products:create',
    'products:update',
    'products:delete',
    'categories:read',
    'categories:write',
    'categories:delete',
  ],
  'Usuario Regular': ['products:read', 'categories:read'],
};

async function main() {
  console.log('[seed] Sincronizando permisos...');
  for (const p of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { code: p.code },
      update: { description: p.description, area: p.area, action: p.action },
      create: p,
    });
  }

  console.log('[seed] Sincronizando roles...');
  for (const [roleName, codes] of Object.entries(ROLES)) {
    const role = await prisma.role.upsert({
      where: { name: roleName },
      update: { description: `Rol ${roleName}`, isSystem: true },
      create: { name: roleName, description: `Rol ${roleName}`, isSystem: true },
    });

    const perms = await prisma.permission.findMany({ where: { code: { in: codes } } });
    for (const perm of perms) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } },
        update: {},
        create: { roleId: role.id, permissionId: perm.id },
      });
    }
  }

  console.log('[seed] Sincronizando categorías y productos...');
  const catNames = ['Electrónica', 'Oficina', 'Hogar', 'Deportes'];
  const categories: Record<string, string> = {};
  for (const name of catNames) {
    const cat = await prisma.category.upsert({
      where: { name },
      update: {},
      create: { name },
    });
    categories[name] = cat.id;
  }

  const products = [
    { name: 'Teclado mecánico RGB', sku: 'TEC-001', description: 'Switches rojos, retroiluminación RGB', price: 899.0, stock: 25, categoryId: categories['Electrónica'] },
    { name: 'Monitor 27" 4K', sku: 'MON-002', description: 'Panel IPS, HDR400', price: 6499.0, stock: 10, categoryId: categories['Electrónica'] },
    { name: 'Mouse inalámbrico', sku: 'MOU-003', description: 'DPI regulable, batería 70h', price: 449.0, stock: 40, categoryId: categories['Electrónica'] },
    { name: 'Cuaderno profesional A4', sku: 'OFC-004', description: '200 hojas, pasta dura', price: 89.0, stock: 120, categoryId: categories['Oficina'] },
    { name: 'Silla ergonómica', sku: 'OFC-005', description: 'Soporte lumbar regulable', price: 2899.0, stock: 8, categoryId: categories['Oficina'] },
    { name: 'Lámpara de escritorio LED', sku: 'HOG-006', description: '3 temperaturas de color', price: 349.0, stock: 30, categoryId: categories['Hogar'] },
    { name: 'Set de utensilios cocina', sku: 'HOG-007', description: 'Acero inoxidable, 6 piezas', price: 599.0, stock: 15, categoryId: categories['Hogar'] },
    { name: 'Mancuerna 10 kg', sku: 'DEP-008', description: 'Recubierta en neopreno', price: 499.0, stock: 20, categoryId: categories['Deportes'] },
    { name: 'Bicicleta estática', sku: 'DEP-009', description: '8 niveles de resistencia', price: 4599.0, stock: 5, categoryId: categories['Deportes'] },
    { name: 'Audífonos con cancelación', sku: 'TEC-010', description: 'Bluetooth 5.3, 30h de batería', price: 1999.0, stock: 18, categoryId: categories['Electrónica'] },
  ];

  for (const p of products) {
    await prisma.product.upsert({
      where: { sku: p.sku },
      update: { name: p.name, description: p.description, price: p.price, stock: p.stock, categoryId: p.categoryId },
      create: p,
    });
  }

  console.log('[seed] Sincronizando usuarios demo...');
  const adminRole = await prisma.role.findUniqueOrThrow({ where: { name: 'Administrador' } });
  const editorRole = await prisma.role.findUniqueOrThrow({ where: { name: 'Editor' } });
  const userRole = await prisma.role.findUniqueOrThrow({ where: { name: 'Usuario Regular' } });

  const users = [
    { name: 'Administrador UNACH', email: 'admin@unach.mx', password: 'Admin123!', roleId: adminRole.id },
    { name: 'Editor Contenidos', email: 'editor@unach.mx', password: 'Editor123!', roleId: editorRole.id },
    { name: 'Usuario Regular', email: 'usuario@unach.mx', password: 'Usuario123!', roleId: userRole.id },
  ];

  for (const u of users) {
    const passwordHash = await argon2.hash(u.password, { type: argon2.argon2id });
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: { name: u.name, passwordHash },
      create: { name: u.name, email: u.email, passwordHash },
    });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: u.roleId } },
      update: {},
      create: { userId: user.id, roleId: u.roleId },
    });
  }

  console.log('[seed] Listo.');
  console.log('  admin@unach.mx / Admin123!');
  console.log('  editor@unach.mx / Editor123!');
  console.log('  usuario@unach.mx / Usuario123!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
