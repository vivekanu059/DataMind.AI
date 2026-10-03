import dotenv from 'dotenv';
import { requireAuth } from './middleware/authMiddleware';
// Force dotenv to load from the absolute root path
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import cron from 'node-cron';
import { prisma } from './db/prisma';
import { runAnalysis, handleFollowupQuery, cleanDataset } from './controllers/analysisController';
import { getSessionHistory, getSessionById, exportReportToWord, deleteSessionById } from './controllers/sessionControllers';
import { googleLogin, registerWithEmail, loginWithEmail } from './controllers/authController';
import { mockUpgrade } from './controllers/paymentController';

import { getWalletStatus, toggleDemoTier } from './controllers/walletController';


// Add these to your routes section:


// 🛡️ 1. Boot up the background worker

import './queue/analysisWorker';
// 🛡️ 2. Import the queue events listener for the live stream
import { analysisQueueEvents } from './queue/analysisWorker';



if (!fs.existsSync('uploads')) {
    fs.mkdirSync('uploads');
}

const upload = multer({ dest: 'uploads/' });
const app = express();

app.use(cors());
app.use(express.json()); 
app.use('/uploads', express.static('uploads'));

// Core Analysis Routes
app.post('/api/analyze', requireAuth, upload.single('dataset'), runAnalysis);
app.post('/api/clean', requireAuth, upload.single('dataset'), cleanDataset);
app.post('/api/chat', requireAuth, handleFollowupQuery);
app.get('/api/wallet', requireAuth, getWalletStatus);
app.post('/api/demo/toggle-tier', requireAuth, toggleDemoTier);
app.post('/api/auth/google', googleLogin);



// Keep auth routes public (no requireAuth middleware)
app.post('/api/auth/google', googleLogin);
app.post('/api/auth/register', registerWithEmail);
app.post('/api/auth/login', loginWithEmail);


// Replace the old Razorpay routes with this:
app.post('/api/payments/mock-upgrade', requireAuth, mockUpgrade);

// 🛡️ THE NEW STREAMING ROUTE: Pipes BullMQ progress to React
app.get('/api/stream/:jobId', requireAuth, (req, res) => {
    const { jobId } = req.params;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const onProgress = ({ jobId: id, data }: any) => {
        if (id === jobId) res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    const onCompleted = ({ jobId: id, returnvalue }: any) => {
        if (id === jobId) {
            res.write(`data: ${JSON.stringify({ stage: 'COMPLETE', message: 'Analysis Complete!', data: returnvalue })}\n\n`);
            res.end();
            cleanup();
        }
    };

    const onFailed = ({ jobId: id, failedReason }: any) => {
        if (id === jobId) {
            res.write(`data: ${JSON.stringify({ stage: 'ERROR', message: failedReason })}\n\n`);
            res.end();
            cleanup();
        }
    };

    analysisQueueEvents.on('progress', onProgress);
    analysisQueueEvents.on('completed', onCompleted);
    analysisQueueEvents.on('failed', onFailed);

    const cleanup = () => {
        analysisQueueEvents.off('progress', onProgress);
        analysisQueueEvents.off('completed', onCompleted);
        analysisQueueEvents.off('failed', onFailed);
    };

    req.on('close', cleanup);
});

// Download & Session Routes
app.get('/api/download/:filename', requireAuth, (req, res) => {
    const filenameParam = req.params.filename;
    const filename = Array.isArray(filenameParam) ? filenameParam[0] : filenameParam;
    if (typeof filename !== 'string' || filename.includes('..') || filename.includes('/')) return res.status(403).send('Invalid filename.');
    const filePath = path.join(process.cwd(), 'uploads', filename);
    if (fs.existsSync(filePath)) res.download(filePath, filename);
    else res.status(404).send('File not found.');
});

app.get('/api/sessions', requireAuth, getSessionHistory);
app.get('/api/sessions/:id', requireAuth, getSessionById);
app.get('/api/sessions/:id/export/word', requireAuth, exportReportToWord);
app.delete('/api/sessions/:id', requireAuth, deleteSessionById);



// Maintenance
cron.schedule('0 0 * * *', async () => {
    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
    try {
        await prisma.session.deleteMany({ where: { createdAt: { lt: sixtyDaysAgo } } });
    } catch (error) {}
});

app.listen(3000, () => {
    console.log("🚀 Enterprise AI Data Analyst server running on http://localhost:3000");
});
// 🛡️ Global fail-safes to prevent background network drops from crashing the server
process.on('uncaughtException', (err: any) => {
    if (err.code === 'ECONNRESET') {
        console.warn('[Network Warning] A background connection was reset (ECONNRESET).');
    } else {
        console.error('Uncaught Exception:', err);
    }
});

process.on('unhandledRejection', (reason: any) => {
    if (reason?.code === 'ECONNRESET') {
        console.warn('[Network Warning] A background promise connection was reset (ECONNRESET).');
    } else {
        console.error('Unhandled Rejection:', reason);
    }
});