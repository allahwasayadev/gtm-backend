import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: nodemailer.Transporter;
  private frontendUrl: string;
  private fromEmail: string;

  constructor() {
    this.frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    this.fromEmail = process.env.SMTP_FROM || process.env.SMTP_USER || '';

    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }

  async sendInviteEmail(
    to: string,
    inviterName: string,
    inviterCompany: string | null,
    token: string,
  ): Promise<boolean> {
    const acceptUrl = `${this.frontendUrl}/invite/accept?token=${token}`;
    const fromLine = inviterCompany
      ? `${inviterName} from ${inviterCompany}`
      : inviterName;

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px;">
        <h2 style="color: #1e293b; margin: 0 0 16px;">You've been invited to connect!</h2>
        <p style="color: #475569; font-size: 15px; line-height: 1.6; margin: 0 0 8px;">
          <strong>${fromLine}</strong> has invited you to connect on <strong>GTM Account Mapper</strong> — a tool for reps to compare account lists and find overlaps.
        </p>
        <p style="color: #475569; font-size: 15px; line-height: 1.6; margin: 0 0 24px;">
          Accept the invite to automatically connect and start seeing shared accounts.
        </p>
        <a href="${acceptUrl}" style="display: inline-block; background: #4f46e5; color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-weight: 600; font-size: 15px;">
          Accept Invite &amp; Connect
        </a>
        <p style="color: #94a3b8; font-size: 13px; margin: 24px 0 0;">
          Or copy this link: <a href="${acceptUrl}" style="color: #6366f1;">${acceptUrl}</a>
        </p>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 32px 0 16px;" />
        <p style="color: #94a3b8; font-size: 12px; margin: 0;">
          This invite expires in 7 days. If you didn't expect this, you can ignore this email.
        </p>
      </div>
    `;

    try {
      await this.transporter.sendMail({
        from: `GTM Account Mapper <${this.fromEmail}>`,
        to,
        subject: `${inviterName} invited you to connect on GTM Account Mapper`,
        html,
      });

      this.logger.log(`Invite email sent to ${to}`);
      return true;
    } catch (err) {
      this.logger.error(`Error sending invite email to ${to}:`, err);
      return false;
    }
  }

  async sendConnectionRequestEmail(
    to: string,
    recipientName: string,
    senderName: string,
    senderCompany: string | null,
  ): Promise<boolean> {
    const connectionsUrl = `${this.frontendUrl}/dashboard/connections`;
    const fromLine = senderCompany
      ? `${senderName} from ${senderCompany}`
      : senderName;

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px;">
        <h2 style="color: #1e293b; margin: 0 0 16px;">New Connection Request</h2>
        <p style="color: #334155; font-size: 15px; line-height: 1.6; margin: 0 0 14px;">
          Hi ${recipientName.split(' ')[0]},
        </p>
        <p style="color: #475569; font-size: 15px; line-height: 1.6; margin: 0 0 20px;">
          <strong>${fromLine}</strong> wants to connect with you on <strong>GTM Account Mapper</strong>.
        </p>
        <p style="color: #475569; font-size: 15px; line-height: 1.6; margin: 0 0 24px;">
          Accept the request to start seeing shared accounts and collaborate on deals.
        </p>
        <a href="${connectionsUrl}" style="display: inline-block; background: #4f46e5; color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-weight: 600; font-size: 15px;">
          View Connection Request
        </a>
        <p style="color: #94a3b8; font-size: 13px; margin: 24px 0 0;">
          Or copy this link: <a href="${connectionsUrl}" style="color: #6366f1;">${connectionsUrl}</a>
        </p>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 32px 0 16px;" />
        <p style="color: #94a3b8; font-size: 12px; margin: 0;">
          Thanks,<br />GTM Account Mapper
        </p>
      </div>
    `;

    try {
      await this.transporter.sendMail({
        from: `GTM Account Mapper <${this.fromEmail}>`,
        to,
        subject: `${senderName} wants to connect with you on GTM Account Mapper`,
        html,
      });

      this.logger.log(`Connection request email sent to ${to}`);
      return true;
    } catch (err) {
      this.logger.error(`Error sending connection request email to ${to}:`, err);
      return false;
    }
  }

  async sendNewOverlapsEmail(
    to: string,
    firstName: string,
    connectionName: string,
    ctaUrl: string,
  ): Promise<boolean> {
    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px;">
        <p style="color: #334155; font-size: 15px; line-height: 1.6; margin: 0 0 14px;">
          Hi ${firstName},
        </p>
        <p style="color: #475569; font-size: 15px; line-height: 1.6; margin: 0 0 20px;">
          New shared accounts were just identified between you and ${connectionName}.
        </p>
        <p style="color: #475569; font-size: 15px; line-height: 1.6; margin: 0 0 24px;">
          Log in to review the updated overlaps and see where alignment has expanded.
        </p>
        <a href="${ctaUrl}" style="display: inline-block; background: #4f46e5; color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-weight: 600; font-size: 15px;">
          View Your Overlaps
        </a>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 32px 0 16px;" />
        <p style="color: #94a3b8; font-size: 12px; margin: 0;">
          Thanks,<br />Ovrlap
        </p>
      </div>
    `;

    try {
      await this.transporter.sendMail({
        from: `GTM Account Mapper <${this.fromEmail}>`,
        to,
        subject: `New Overlaps Found in Ovrlap`,
        html,
      });

      this.logger.log(`New overlap email sent to ${to}`);
      return true;
    } catch (err: unknown) {
      this.logger.error(`Error sending new overlap email to ${to}:`, err);
      return false;
    }
  }

  async sendVerificationEmail(
    to: string,
    userName: string,
    code: string,
  ): Promise<boolean> {
    const firstName = userName.split(' ')[0];

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px;">
        <h2 style="color: #1e293b; margin: 0 0 16px;">Verify Your Email</h2>
        <p style="color: #334155; font-size: 15px; line-height: 1.6; margin: 0 0 14px;">
          Hi ${firstName},
        </p>
        <p style="color: #475569; font-size: 15px; line-height: 1.6; margin: 0 0 24px;">
          Welcome to <strong>GTM Account Mapper</strong>! Please use the verification code below to confirm your email address.
        </p>
        <div style="background: #f1f5f9; border-radius: 12px; padding: 24px; text-align: center; margin: 0 0 24px;">
          <span style="font-size: 32px; font-weight: 700; letter-spacing: 8px; color: #1e293b;">${code}</span>
        </div>
        <p style="color: #64748b; font-size: 14px; margin: 0 0 8px;">
          This code expires in <strong>15 minutes</strong>.
        </p>
        <p style="color: #64748b; font-size: 14px; margin: 0 0 24px;">
          If you didn't create an account, you can safely ignore this email.
        </p>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 32px 0 16px;" />
        <p style="color: #94a3b8; font-size: 12px; margin: 0;">
          Thanks,<br />GTM Account Mapper
        </p>
      </div>
    `;

    try {
      await this.transporter.sendMail({
        from: `GTM Account Mapper <${this.fromEmail}>`,
        to,
        subject: `Your verification code: ${code}`,
        html,
      });

      this.logger.log(`Verification email sent to ${to}`);
      return true;
    } catch (err: unknown) {
      this.logger.error(`Error sending verification email to ${to}:`, err);
      return false;
    }
  }

  async sendPasswordResetEmail(
    to: string,
    userName: string,
    token: string,
  ): Promise<boolean> {
    const firstName = userName.split(' ')[0];
    const resetUrl = `${this.frontendUrl}/reset-password?token=${token}`;

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px;">
        <h2 style="color: #1e293b; margin: 0 0 16px;">Reset Your Password</h2>
        <p style="color: #334155; font-size: 15px; line-height: 1.6; margin: 0 0 14px;">
          Hi ${firstName},
        </p>
        <p style="color: #475569; font-size: 15px; line-height: 1.6; margin: 0 0 24px;">
          We received a request to reset your password for your <strong>GTM Account Mapper</strong> account. Click the button below to set a new password.
        </p>
        <a href="${resetUrl}" style="display: inline-block; background: #4f46e5; color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-weight: 600; font-size: 15px;">
          Reset Password
        </a>
        <p style="color: #94a3b8; font-size: 13px; margin: 24px 0 0;">
          Or copy this link: <a href="${resetUrl}" style="color: #6366f1;">${resetUrl}</a>
        </p>
        <p style="color: #64748b; font-size: 14px; margin: 24px 0 8px;">
          This link expires in <strong>1 hour</strong>.
        </p>
        <p style="color: #64748b; font-size: 14px; margin: 0 0 24px;">
          If you didn't request a password reset, you can safely ignore this email. Your password will remain unchanged.
        </p>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 32px 0 16px;" />
        <p style="color: #94a3b8; font-size: 12px; margin: 0;">
          Thanks,<br />GTM Account Mapper
        </p>
      </div>
    `;

    try {
      await this.transporter.sendMail({
        from: `GTM Account Mapper <${this.fromEmail}>`,
        to,
        subject: `Reset your password – GTM Account Mapper`,
        html,
      });

      this.logger.log(`Password reset email sent to ${to}`);
      return true;
    } catch (err: unknown) {
      this.logger.error(`Error sending password reset email to ${to}:`, err);
      return false;
    }
  }
}
