import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SecureNote } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CryptoService } from '../crypto/crypto.service';
import { CreateSecureNoteDto } from './dto/secure-note.dto';

export interface SecureNoteView {
  id: string;
  title: string;
  /** Texto claro descifrado por la API. null si la integridad está comprometida. */
  body: string | null;
  createdAt: Date;
  updatedAt: Date;
  status: 'ok' | 'decryption_error';
  error?: string;
  /** Representación exacta que vive en PostgreSQL (columna body_encrypted). */
  stored: {
    column: 'secure_notes.body_encrypted';
    value: string;
    decoded: {
      v: number;
      alg: string;
      keyId: string;
      iv: string;
      tag: string;
      ciphertext: string;
    } | null;
  };
  encryption: {
    algorithm: string;
    keyId: string;
    aad: string;
  };
  signature: {
    algorithm: 'RSA-PSS';
    hash: 'SHA-256';
    keyId: string;
    value: string;
    valid: boolean;
  };
}

@Injectable()
export class SecureNotesService {
  private readonly logger = new Logger(SecureNotesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
  ) {}

  async findAll(userId: string): Promise<SecureNoteView[]> {
    const notes = await this.prisma.secureNote.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return notes.map((note) => this.toView(note));
  }

  async findOne(id: string, userId: string): Promise<SecureNoteView> {
    return this.toView(await this.requireOwned(id, userId));
  }

  async create(
    dto: CreateSecureNoteDto,
    actor: { id: string; email: string },
    ip: string,
    userAgent?: string,
  ): Promise<SecureNoteView> {
    const id = randomUUID();
    const title = dto.title.trim();
    const body = dto.body;

    // 1) El dato entra en claro y se cifra ANTES de tocar la base de datos.
    const bodyEncrypted = this.crypto.encrypt(body, this.crypto.noteAad(id, actor.id));

    // 2) Se firma el documento (payload canónico + hash del cuerpo).
    const payload = this.crypto.noteSigningPayload({
      id,
      userId: actor.id,
      title,
      body,
    });
    const signature = this.crypto.sign(payload);
    const cryptoInfo = this.crypto.info();

    const note = await this.prisma.$transaction(async (tx) => {
      const created = await tx.secureNote.create({
        data: {
          id,
          userId: actor.id,
          title,
          bodyEncrypted,
          signature,
          encryptionKeyId: cryptoInfo.encryption.keyId,
          signingKeyId: cryptoInfo.signing.keyId,
        },
      });
      await this.audit.record(
        {
          userId: actor.id,
          email: actor.email,
          action: 'secure_notes.create',
          resource: 'secure_note',
          resourceId: created.id,
          detail: 'Nota cifrada con AES-256-GCM y firmada con RSA-PSS',
          ipAddress: ip,
          userAgent,
        },
        tx,
      );
      return created;
    });

    return this.toView(note);
  }

  async verify(id: string, userId: string) {
    const note = await this.requireOwned(id, userId);
    const view = this.toView(note);
    return {
      id: view.id,
      decryptionOk: view.status === 'ok',
      signatureValid: view.signature.valid,
      encryptionKeyId: view.encryption.keyId,
      signingKeyId: view.signature.keyId,
      message: view.signature.valid
        ? 'Firma RSA-PSS válida: el contenido no ha sido alterado.'
        : 'Firma inválida: el contenido o la firma fueron alterados.',
    };
  }

  async remove(
    id: string,
    actor: { id: string; email: string },
    ip: string,
    userAgent?: string,
  ): Promise<void> {
    const note = await this.requireOwned(id, actor.id);
    await this.prisma.$transaction(async (tx) => {
      await tx.secureNote.delete({ where: { id: note.id } });
      await this.audit.record(
        {
          userId: actor.id,
          email: actor.email,
          action: 'secure_notes.delete',
          resource: 'secure_note',
          resourceId: id,
          ipAddress: ip,
          userAgent,
        },
        tx,
      );
    });
  }

  private async requireOwned(id: string, userId: string): Promise<SecureNote> {
    const note = await this.prisma.secureNote.findFirst({ where: { id, userId } });
    if (!note) throw new NotFoundException('Nota no encontrada');
    return note;
  }

  /**
   * Descifra y verifica la firma al leer. Si algo falla, no se devuelve texto
   * claro: se expone el error de integridad para que la UI lo muestre.
   */
  private toView(note: SecureNote): SecureNoteView {
    const aad = this.crypto.noteAad(note.id, note.userId);
    let decoded: SecureNoteView['stored']['decoded'] = null;
    try {
      decoded = this.crypto.parseEncrypted(note.bodyEncrypted);
    } catch {
      decoded = null;
    }

    const base = {
      id: note.id,
      title: note.title,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
      stored: {
        column: 'secure_notes.body_encrypted' as const,
        value: note.bodyEncrypted,
        decoded,
      },
      encryption: {
        algorithm: 'AES-256-GCM',
        keyId: note.encryptionKeyId,
        aad,
      },
      signature: {
        algorithm: 'RSA-PSS' as const,
        hash: 'SHA-256' as const,
        keyId: note.signingKeyId,
        value: note.signature,
        valid: false,
      },
    };

    try {
      const body = this.crypto.decrypt(note.bodyEncrypted, aad);
      const payload = this.crypto.noteSigningPayload({
        id: note.id,
        userId: note.userId,
        title: note.title,
        body,
      });
      const valid = this.crypto.verify(payload, note.signature);
      return { ...base, body, status: 'ok', signature: { ...base.signature, valid } };
    } catch (err) {
      this.logger.warn(
        `No se pudo descifrar la nota ${note.id}: ${
          err instanceof Error ? err.message : 'error desconocido'
        }`,
      );
      return {
        ...base,
        body: null,
        status: 'decryption_error',
        error:
          'No fue posible descifrar o autenticar el dato. El criptograma pudo haber sido alterado.',
      };
    }
  }
}
