import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { SecureNotesController } from './secure-notes.controller';
import { SecureNotesService } from './secure-notes.service';

@Module({
  imports: [AuditModule],
  controllers: [SecureNotesController],
  providers: [SecureNotesService],
})
export class SecureNotesModule {}
