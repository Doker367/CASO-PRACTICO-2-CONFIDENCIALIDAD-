import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { SecureNotesService } from './secure-notes.service';
import { CreateSecureNoteDto } from './dto/secure-note.dto';
import { CryptoService } from '../crypto/crypto.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { PermissionCode } from '../common/enums/permissions.enum';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';

@Controller({ path: 'secure-notes', version: '1' })
export class SecureNotesController {
  constructor(
    private readonly notes: SecureNotesService,
    private readonly crypto: CryptoService,
  ) {}

  @Get('crypto-info')
  @RequirePermissions(PermissionCode.NotesRead)
  cryptoInfo() {
    return this.crypto.info();
  }

  @Get()
  @RequirePermissions(PermissionCode.NotesRead)
  findAll(@CurrentUser() user: AuthUser) {
    return this.notes.findAll(user.id);
  }

  @Get(':id/verify')
  @RequirePermissions(PermissionCode.NotesRead)
  verify(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.notes.verify(id, user.id);
  }

  @Get(':id')
  @RequirePermissions(PermissionCode.NotesRead)
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.notes.findOne(id, user.id);
  }

  @Post()
  @RequirePermissions(PermissionCode.NotesManage)
  create(
    @Body() dto: CreateSecureNoteDto,
    @CurrentUser() user: AuthUser,
    @Ip() ip: string,
    @Req() req: Request,
  ) {
    return this.notes.create(dto, user, ip, req.headers['user-agent']);
  }

  @Delete(':id')
  @RequirePermissions(PermissionCode.NotesManage)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Ip() ip: string,
    @Req() req: Request,
  ) {
    return this.notes.remove(id, user, ip, req.headers['user-agent']);
  }
}
