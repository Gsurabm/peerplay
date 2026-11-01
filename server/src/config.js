import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 4000),
  host: process.env.HOST || '0.0.0.0',
  jwtSecret: process.env.JWT_SECRET || 'peerplay-dev-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '30d',
  dbFile: process.env.DB_FILE || path.join(__dirname, '../data/peerplay.db'),
  webDist: process.env.WEB_DIST || path.join(__dirname, '../../web/dist'),
  uploadsDir: process.env.UPLOADS_DIR || path.join(__dirname, '../uploads'),
  deviceSalt: process.env.DEVICE_SALT || 'peerplay-device-salt-v1',
  webhookSecret: process.env.WEBHOOK_SECRET || 'peerplay-webhook-secret-v1',
  platformFeeBps: Number(process.env.PLATFORM_FEE_BPS || 2500), // 2500 bps = 25%
  minStakeCents: 1000, // KSh 10
  stakeStepCents: 500, // KSh 5 multiples
  minDepositCents: 5000, // KSh 50
  minWithdrawCents: 5000, // KSh 50
  withdrawFloorCents: 5000, // balance may not fall below KSh 50
  journeyLength: 5,
  moveTimerSec: 15,
  recoverySec: 30,
  maxDraws: 3,
  drawPenaltyBps: 500, // 5% of original combined stake
  referralBonusCents: 1000, // KSh 10, paid when invitee completes journey
  largeWithdrawalCents: 20000, // KSh 200 - identity verification required
  paymentBaseUrl: process.env.PAYMENT_BASE_URL || '',
  version: '1.0.0',
};

export const PLATFORM_FEE_LABEL = '25%';
