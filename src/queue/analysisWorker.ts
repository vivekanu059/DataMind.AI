import 'dotenv/config';
import { Worker, Queue, QueueEvents } from 'bullmq';
import Redis from 'ioredis';
import { executeQuery } from '../db/duckdbEngine';
import { modelRouter } from '../gateway/modelRouter';
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { prisma } from '../db/prisma';

// 🛡️ IMPORT YOUR LANGGRAPH MULTI-AGENT PIPELINE
import { dashboardGraph } from '../agents/dashboardGraph';

// 1. Bulletproof Upstash Redis Connection
// 1. Bulletproof Upstash Redis Connection
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
// Inside your src/queue/analysisWorker.ts

const connection = new Redis(redisUrl, {
    maxRetriesPerRequest: null, // Strictly required by BullMQ
    enableReadyCheck: false,
    keepAlive: 30000,           // Increased keep-alive interval
    connectTimeout: 15000,      // Timeout for initial connection
    family: 4,                  // Forces IPv4 resolution
    tls: redisUrl.startsWith('rediss://') ? { rejectUnauthorized: false } : undefined,
    
    retryStrategy(times) {
        return Math.min(times * 200, 5000); // Back off up to 5 seconds between retries
    }
});

// 🛡️ CRITICAL: Catch and log Redis errors cleanly instead of letting them crash/spam the terminal
connection.on('error', (err: any) => {
    if (err.code === 'ECONNRESET') {
        console.warn('⚠️ Redis connection was reset by the server. Reconnecting...');
    } else {
        console.error('Redis Error:', err);
    }
});

export const analysisQueue = new Queue('analysis-queue', { connection });
export const analysisQueueEvents = new QueueEvents('analysis-queue', { connection });

// --- Helper Functions ---
const executeWithSelfHealing = async (initialSql: string, rawSchema: string, tableReference: string, contextDescription: string, job: any, maxRetries = 2) => {
    let currentSql = initialSql;
    const sanitizeSQL = (sql: string) => sql ? sql.replace(/`/g, '"').replace(/\\"/g, '"').replace(/\\\\"/g, '"').replace(/;+$/, '') : "";

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await executeQuery(sanitizeSQL(currentSql));
        } catch (error: any) {
            const healMsg = `[Self-Healing] Attempt ${attempt} failed for "${contextDescription}". Repairing SQL...`;
            await job.updateProgress({ stage: "HEALING", message: healMsg });
            
            if (attempt === maxRetries) throw error; 

            const healPrompt = new SystemMessage(`
            You are an elite DuckDB SQL Data Engineer. A query you generated crashed the database.
            Target Table: EXACTLY ${tableReference}
            Schema: ${rawSchema}
            FAILED QUERY: ${currentSql}
            DATABASE ERROR: ${error.message}
            Return ONLY the raw, valid DuckDB SQL SELECT statement.
            `);

            const healResponse: any = await modelRouter.routeExecution([healPrompt, new HumanMessage("Fix the SQL.")]);
            currentSql = Array.isArray(healResponse.content) ? healResponse.content.map((c: any) => c.text).join('') : healResponse.content;
            currentSql = currentSql.replace(/^```sql/i, '').replace(/^```/, '').replace(/```$/, '').trim();
        }
    }
    return [];
};

// 2. The Background Worker
export const analysisWorker = new Worker('analysis-queue', async (job) => {
    // 🛡️ Extracted userId and userTier passed from analysisController.ts
    const { fileLocation, tableReference, question, originalName, rawSchema, userId, userTier } = job.data;

    await job.updateProgress({ stage: "SYNTHESIZING", message: "Executing LangGraph Multi-Agent Pipeline..." });
    
    // 🛡️ LANGGRAPH INTEGRATION
    const initialInputs = {
        userObjective: question,
        rawSchema: rawSchema,
        tableReference: tableReference,
    };

    const graphResult = await dashboardGraph.invoke(initialInputs);
    const blueprint = graphResult.finalBlueprint;

    if (!blueprint || typeof blueprint !== 'object') {
        throw new Error("Multi-Agent Graph failed to generate a valid dashboard blueprint after maximum retries.");
    }

    await job.updateProgress({ stage: "EXECUTING", message: "Running analytical SQL queries in DuckDB..." });
    
    // 🛡️ DUCKDB EXECUTION LOOPS
    const availableFilters: any[] = [];
    if (Array.isArray(blueprint.filterQueries)) {
        for (const fq of blueprint.filterQueries) {
            try {
                const queryRes = await executeWithSelfHealing(fq.query, rawSchema, tableReference, `Filter ${fq.column}`, job);
                availableFilters.push({ column: fq.column, label: fq.label, options: queryRes.map((r: any) => String(r.val)).filter(Boolean) });
            } catch (e) { console.error(`Filter Query Failed`); }
        }
    }

    let drillDownData: any[] = [];
    if (blueprint.drillDownQuery) {
        try { drillDownData = await executeWithSelfHealing(blueprint.drillDownQuery, rawSchema, tableReference, "Drill-down payload", job); } 
        catch (e) {}
    }

    let successfulCharts = 0;
    for (const chart of blueprint.charts || []) {
        if (chart.sql) {
            try {
                await job.updateProgress({ stage: "EXECUTING", message: `Building chart: ${chart.title}` });
                chart.data = await executeWithSelfHealing(chart.sql, rawSchema, tableReference, chart.title, job);
                if (chart.data.length > 0) successfulCharts++;
                delete chart.sql;
            } catch (e) { chart.data = []; }
        }
    }

    let anomalies: any[] = [];
    if (blueprint.anomaliesQuery) {
        try { anomalies = await executeWithSelfHealing(blueprint.anomaliesQuery, rawSchema, tableReference, "Anomalies", job); } 
        catch (e) {}
    }

    await job.updateProgress({ stage: "PERSISTING", message: "Persisting dashboard & deducting token quota..." });

    // 🛡️ SAAS TOKEN DEDUCTION & SESSION EXPIRATION LOGIC
    const isFree = userTier === 'FREE';
    // Free Tier sessions expire in 24 hours; Pro Tier sessions stay permanently (null)
    const expiresAt = isFree ? new Date(Date.now() + 24 * 60 * 60 * 1000) : null;

    // 1. Deduct 100 tokens from the User Wallet
    if (userId) {
        await (prisma as any).user.update({
            where: { id: userId },
            data: { tokenBalance: { decrement: 100 } }
        });
    }

    // 2. Create the Session linked to User and Expiration
    const session = await prisma.session.create({
        data: {
            userId: userId,
            expiresAt: expiresAt,
            title: question.length > 40 ? question.substring(0, 40) + '...' : question,
            dataset: { create: { originalName, filePath: fileLocation, schemaSnapshot: rawSchema } },
            dashboard: { create: { summary: blueprint.summary, detailedReport: blueprint.detailedReport, availableFilters, dataPayload: drillDownData, charts: blueprint.charts, anomalies, recommendations: blueprint.recommendations } }
        }
    });

    // Return payload to SSE stream
    return {
        sessionId: session.id,
        summary: blueprint.summary,
        detailedReport: blueprint.detailedReport,
        availableFilters,
        drillDownData,
        charts: blueprint.charts,
        anomalies,
        recommendations: blueprint.recommendations,
        fileLocation
    };

}, { connection, concurrency: 3 });

analysisWorker.on('failed', (job, err) => {
    console.error(`[BullMQ] Job ${job?.id} failed: ${err.message}`);
});