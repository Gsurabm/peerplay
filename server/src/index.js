import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { Server } from 'socket.io';

import { config } from './config.js';
import { migrate, db } from './db/index.js';
import { setIo } from './realtime/io.js';
import { attachRealtime } from './realtime/index.js';
import { startEngine } from './services/matches.js';
import { sweepQueue } from './services/matchmaking.js';
import { recordRankSnapshot } from './services/rankings.js';
import { resumePendingPayouts } from './services/withdrawals.js';

import authRoutes from './routes/auth.js';
import profileRoutes from './routes/profile.js';
import walletRoutes from './routes/wallet.js';
import paymentRoutes from './routes/payments.js';
import withdrawalRoutes from './routes/withdrawals.js';
import matchRoutes from './routes/matches.js';
import leaderboardRoutes from './routes/leaderboards.js';
import notificationRoutes from './routes/notifications.js';
import reportRoutes from './routes/reports.js';
import referralRoutes from './routes/referrals.js';
import adminRoutes from './routes/admin.js';
import { publicLinks } from './services/publicLinks.js';

migrate();

const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(cors({ origin: true, credentials: true }));

app.use((req, _res, next) => {
  if (req.path.startsWith('/api')) {
    const device = req.headers['x-device-signals'];
    if (device) req.rawDeviceSignals = device;
  }
  next();
});

// Lightweight failure log - makes signup/login problems diagnosable in production.
app.use((req, res, next) => {
  if (!req.path.startsWith('/api')) return next();
  if (res.statusCode < 400) return next();
  res.on('finish', () => {
    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim();
    console.warn(`[api] ${res.statusCode} ${req.method} ${req.path} ip=${ip} ua=${(req.headers['user-agent'] || '').slice(0, 60)}`);
  });
  return next();
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'peerplay', version: config.version, time: new Date().toISOString() });
});

app.get('/api/config', (_req, res) => {
  res.json({
    public_links: publicLinks(),
    platform_fee_bps: config.platformFeeBps,
    min_stake_cents: config.minStakeCents,
    stake_step_cents: config.stakeStepCents,
    min_deposit_cents: config.minDepositCents,
    min_withdraw_cents: config.minWithdrawCents,
    withdraw_floor_cents: config.withdrawFloorCents,
    journey_length: config.journeyLength,
    move_timer_sec: config.moveTimerSec,
    recovery_sec: config.recoverySec,
    max_draws: config.maxDraws,
    draw_penalty_bps: config.drawPenaltyBps,
    version: config.version,
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/withdrawals', withdrawalRoutes);
app.use('/api/matches', matchRoutes);
app.use('/api/leaderboards', leaderboardRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/referrals', referralRoutes);
app.use('/api/admin', adminRoutes);

app.use('/uploads', express.static(config.uploadsDir, { maxAge: '7d' }));

// Static SPA (built web client). API + uploads are handled above.
if (fs.existsSync(config.webDist)) {
  app.use(express.static(config.webDist, { index: false, maxAge: '1h' }));
  app.get(/^\/(?!api|uploads|socket\.io).*/, (_req, res) => {
    res.sendFile(path.join(config.webDist, 'index.html'));
  });
} else {
  app.get('/', (_req, res) => {
    res.status(200).send(
      '<h1>PeerPlay API</h1><p>The web client has not been built yet. Run <code>npm run build</code> in <code>web/</code>.</p>',
    );
  });
}

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) console.error('[api]', err);
  res.status(status).json({ error: err.message || 'Server error', code: err.code || 'server_error' });
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true, credentials: true },
  transports: ['polling', 'websocket'],
  pingInterval: 20000,
  pingTimeout: 25000,
});
setIo(io);
attachRealtime(io);

startEngine();
resumePendingPayouts();

// Background jobs
setInterval(() => {
  try {
    sweepQueue();
  } catch (err) {
    console.error('[jobs] queue sweep', err);
  }
}, 3000).unref?.();

setInterval(() => {
  try {
    db.prepare(`UPDATE queue_entries SET status = 'expired' WHERE status = 'waiting' AND created_at < ?`).run(
      new Date(Date.now() - 15 * 60 * 1000).toISOString(),
    );
    db.prepare(`UPDATE challenges SET status = 'expired' WHERE status = 'pending' AND expires_at < ?`).run(new Date().toISOString());
  } catch (err) {
    console.error('[jobs] cleanup', err);
  }
}, 60000).unref?.();

setInterval(() => {
  try {
    recordRankSnapshot('overall');
    recordRankSnapshot('weekly');
  } catch (err) {
    console.error('[jobs] ranking snapshot', err);
  }
}, 15 * 60 * 1000).unref?.();

server.listen(config.port, config.host, () => {
  console.log(`\n  PeerPlay API listening on http://${config.host}:${config.port}`);
  console.log(`  Web client: ${fs.existsSync(config.webDist) ? config.webDist : 'not built yet'}\n`);
});

export default app;
