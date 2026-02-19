import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { InvitesRepository } from './invites.repository';
import { ConnectionsRepository } from '../connections/connections.repository';
import { EmailService } from '../email/email.service';
import { CreateInviteDto } from './dto/create-invite.dto';

@Injectable()
export class InvitesService {
  constructor(
    private invitesRepository: InvitesRepository,
    private connectionsRepository: ConnectionsRepository,
    private emailService: EmailService,
  ) {}

  async sendInvite(
    userId: string,
    userEmail: string,
    userName: string,
    userCompany: string | null,
    dto: CreateInviteDto,
  ) {
    // Rate limit: max 10 invites per 24h
    const recentCount = await this.invitesRepository.countRecentByUser(userId);
    if (recentCount >= 10) {
      throw new BadRequestException(
        'Rate limit exceeded. Maximum 10 invites per 24 hours.',
      );
    }

    // Prevent self-invite
    if (dto.email.toLowerCase() === userEmail.toLowerCase()) {
      throw new BadRequestException('You cannot invite yourself.');
    }

    // Check if invitee already has an account
    const existingUser = await this.connectionsRepository.findUserByEmail(
      dto.email.toLowerCase(),
    );

    if (existingUser) {
      // Check if connection already exists
      const existingConnection =
        await this.connectionsRepository.findExistingConnection(
          userId,
          existingUser.id,
        );

      if (existingConnection) {
        const status = existingConnection.status;
        if (status === 'accepted') {
          return {
            alreadyUser: true,
            alreadyConnected: true,
            message: 'You are already connected with this user.',
          };
        }
        return {
          alreadyUser: true,
          alreadyConnected: false,
          pendingRequest: true,
          message: 'A connection request is already pending with this user.',
        };
      }
      const connection = await this.connectionsRepository.create({
        senderId: userId,
        receiverId: existingUser.id,
        status: 'pending',
      });
      await this.emailService.sendConnectionRequestEmail(
        existingUser.email,
        existingUser.name,
        userName,
        userCompany,
      );

      return {
        alreadyUser: true,
        alreadyConnected: false,
        connection,
        message: `Connection request sent to ${existingUser.name}. They will need to accept it.`,
      };
    }

    // Check for existing pending invite
    const existingInvite =
      await this.invitesRepository.findExistingPendingInvite(
        userId,
        dto.email.toLowerCase(),
      );

    if (existingInvite) {
      // Revoke old invite and create a fresh one (can't recover token from hash)
      await this.invitesRepository.updateStatus(existingInvite.id, 'revoked');
    }

    // Generate token
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    // Create invite (expires in 7 days)
    const invite = await this.invitesRepository.create({
      invitedEmail: dto.email.toLowerCase(),
      invitedName: dto.name,
      invitedByUserId: userId,
      tokenHash,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    // Send email
    const emailSent = await this.emailService.sendInviteEmail(
      dto.email,
      userName,
      userCompany,
      rawToken,
    );

    return {
      invite: this.formatInvite(invite),
      emailSent,
      message: emailSent
        ? `Invite sent to ${dto.email}.`
        : `Invite created for ${dto.email}, but email delivery failed. They can still accept via the invite link.`,
    };
  }

  async validateToken(rawToken: string) {
    const tokenHash = crypto
      .createHash('sha256')
      .update(rawToken)
      .digest('hex');

    const invite = await this.invitesRepository.findByTokenHash(tokenHash);

    if (!invite) {
      return { valid: false, status: 'not_found', message: 'Invalid invite link.' };
    }

    if (invite.status !== 'pending') {
      return {
        valid: false,
        status: invite.status,
        message: `This invite has already been ${invite.status}.`,
      };
    }

    if (new Date() > invite.expiresAt) {
      await this.invitesRepository.updateStatus(invite.id, 'expired');
      return { valid: false, status: 'expired', message: 'This invite has expired.' };
    }

    return {
      valid: true,
      status: 'pending',
      inviterName: invite.invitedBy.name,
      inviterCompany: invite.invitedBy.company,
      invitedEmail: invite.invitedEmail,
    };
  }

  async acceptInvite(rawToken: string, acceptingUserId: string, acceptingEmail: string) {
    const tokenHash = crypto
      .createHash('sha256')
      .update(rawToken)
      .digest('hex');

    const invite = await this.invitesRepository.findByTokenHash(tokenHash);

    if (!invite) {
      throw new NotFoundException('Invalid invite link.');
    }

    if (invite.status !== 'pending') {
      throw new BadRequestException(`This invite has already been ${invite.status}.`);
    }

    if (new Date() > invite.expiresAt) {
      await this.invitesRepository.updateStatus(invite.id, 'expired');
      throw new BadRequestException('This invite has expired.');
    }

    // Verify email matches
    if (invite.invitedEmail.toLowerCase() !== acceptingEmail.toLowerCase()) {
      throw new ForbiddenException(
        'This invite was sent to a different email address.',
      );
    }

    // Prevent accepting your own invite
    if (invite.invitedByUserId === acceptingUserId) {
      throw new BadRequestException('You cannot accept your own invite.');
    }

    // Create connection (skip if already exists)
    const existingConnection =
      await this.connectionsRepository.findExistingConnection(
        invite.invitedByUserId,
        acceptingUserId,
      );

    if (!existingConnection) {
      await this.connectionsRepository.create({
        senderId: invite.invitedByUserId,
        receiverId: acceptingUserId,
        status: 'accepted',
      });
    }

    // Mark invite as accepted
    await this.invitesRepository.updateStatus(
      invite.id,
      'accepted',
      acceptingUserId,
    );

    return {
      message: `Connected with ${invite.invitedBy.name}!`,
      inviterName: invite.invitedBy.name,
      inviterCompany: invite.invitedBy.company,
    };
  }

  async getMyInvites(userId: string) {
    const invites = await this.invitesRepository.findByInviter(userId);
    return invites.map((invite) => this.formatInvite(invite));
  }

  async revokeInvite(inviteId: string, userId: string) {
    const invites = await this.invitesRepository.findByInviter(userId);
    const invite = invites.find((i) => i.id === inviteId);

    if (!invite) {
      throw new NotFoundException('Invite not found.');
    }

    if (invite.status !== 'pending') {
      throw new BadRequestException('Only pending invites can be revoked.');
    }

    await this.invitesRepository.updateStatus(inviteId, 'revoked');

    return { message: 'Invite revoked.' };
  }

  private formatInvite(invite: any) {
    return {
      id: invite.id,
      invitedEmail: invite.invitedEmail,
      invitedName: invite.invitedName,
      status: invite.status,
      createdAt: invite.createdAt,
      expiresAt: invite.expiresAt,
      acceptedAt: invite.acceptedAt,
    };
  }

}
