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
}
