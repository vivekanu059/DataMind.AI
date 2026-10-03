import 'dotenv/config';
import { Request, Response } from 'express';
import { executeQuery, getSchema } from '../db/duckdbEngine';
import { analysisQueue } from '../queue/analysisWorker';
import { processUploadedFile } from '../utils/fileUtils';
import { modelRouter } from '../gateway/modelRouter';
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { interactiveFollowupAgent } from '../agents/orchestrator';
import { prisma } from '../db/prisma';
import path from 'path';
import fs from 'fs';

// --- 1. The Fast Cashier: runAnalysis ---
export const runAnalysis = async (req: Request, res: Response) => {
    const question = req.body.question;
    const file = req.file;

    if (!file) return res.status(400).json({ error: "No dataset uploaded." });
    if (!question) return res.status(400).json({ error: "No question provided." });

    try {
        // 🛡️ FIX: Fetch the REAL authenticated user instead of a demo user
        const authReq = req as any;
        const userId = authReq.user?.id;
        if (!userId) return res.status(401).json({ error: "Unauthorized. Please log in." });

        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) return res.status(404).json({ error: "User not found." });

        // 1. File Size Guard (5MB limit for FREE tier)
        const MAX_FREE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
        if (user.tier === 'FREE' && file.size > MAX_FREE_SIZE_BYTES) {
            // Clean up the rejected file from disk
            fs.unlink(file.path, () => {});
            return res.status(403).json({ 
                error: "File size exceeds 5MB limit for the Free tier. Toggle to PRO mode to process enterprise-scale datasets." 
            });
        }

        // 2. Token Balance Guard (Requires at least 100 tokens per analysis)
        const REQUIRED_TOKENS = 100;
        if (user.tokenBalance < REQUIRED_TOKENS) {
            fs.unlink(file.path, () => {});
            return res.status(402).json({ 
                error: "Insufficient token quota. Toggle to PRO mode to refill tokens." 
            });
        }

        const { fileLocation, tableReference } = processUploadedFile(file);
        const schemaData = await executeQuery(`DESCRIBE SELECT * FROM ${tableReference}`);
        const rawSchema = JSON.stringify(schemaData);

        // Add job to BullMQ queue along with User Context
        const job = await analysisQueue.add('analyze-dataset', {
            fileLocation,
            tableReference,
            question,
            originalName: file.originalname,
            rawSchema,
            userId: user.id,
            userTier: user.tier
        });

        res.json({ jobId: job.id, message: "Job added to queue." });
    } catch (error: any) {
        if (file && file.path) fs.unlink(file.path, () => {});
        res.status(500).json({ error: error.message });
    }
};

// --- 2. Existing Data Cleaning Route ---
export const cleanDataset = async (req: Request, res: Response) => {
    const instructions = req.body.instructions || "";
    const file = req.file;

    if (!file) return res.status(400).json({ error: "No dataset uploaded." });

    try {
        // 🛡️ FIX: Secure the cleaning route with the same real-user tier validation
        const authReq = req as any;
        const userId = authReq.user?.id;
        if (!userId) return res.status(401).json({ error: "Unauthorized." });

        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) return res.status(404).json({ error: "User not found." });

        const MAX_FREE_SIZE_BYTES = 5 * 1024 * 1024;
        if (user.tier === 'FREE' && file.size > MAX_FREE_SIZE_BYTES) {
            fs.unlink(file.path, () => {});
            return res.status(403).json({ 
                error: "File size exceeds 5MB limit for the Free tier. Toggle to PRO mode to process enterprise-scale datasets." 
            });
        }

        const { fileLocation, tableReference } = processUploadedFile(file);
        const outputFileName = `cleaned_${Date.now()}.csv`;
        const outputPath = path.join('uploads', outputFileName).replace(/\\/g, '/');

        const schemaData = await executeQuery(`DESCRIBE SELECT * FROM ${tableReference}`);
        const rawSchema = JSON.stringify(schemaData);
        const activeInstructions = instructions.trim() ? instructions : "Standardize column names to lowercase, trim whitespace, remove duplicates.";

        const systemPrompt = new SystemMessage(`
        You are an elite Data Engineer. Write a single DuckDB SQL SELECT statement that cleans the dataset.

        Dataset Schema: ${rawSchema}
        Table reference: ${tableReference}
        Cleaning Instructions: "${activeInstructions}"

        CRITICAL RULES:
        1. Output ONLY the raw SQL SELECT statement. No markdown blocks, no JSON.
        2. Ensure column names with spaces are wrapped in double quotes.
        3. Make sure the query returns the fully cleaned dataset.
        `);

        const modelResponse: any = await modelRouter.routeExecution([
            systemPrompt,
            new HumanMessage("Write the DuckDB SELECT query now.")
        ]);

        let sql = Array.isArray(modelResponse.content) ? modelResponse.content.map((c: any) => c.text).join('') : modelResponse.content;
        sql = sql.replace(/^```sql/i, '').replace(/^```/, '').replace(/```$/, '').trim().replace(/;+$/, '');

        const copyQuery = `COPY (${sql}) TO '${outputPath}' (HEADER, FORMAT CSV)`;
        await executeQuery(copyQuery);

        res.json({ 
            success: true, 
            message: "Dataset successfully cleaned and exported.",
            downloadUrl: `/api/download/${outputFileName}` 
        });

    } catch (error: any) {
        if (file && file.path) fs.unlink(file.path, () => {});
        console.error("Cleaning Pipeline Error:", error);
        res.status(500).json({ error: error.message || "Failed to transform dataset." });
    }
};

// --- 3. Existing Chat Follow-up Route ---
export const handleFollowupQuery = async (req: Request, res: Response) => {
    const { userQuery, fileLocation, chatHistory, sessionId } = req.body; 
    try {
        if (sessionId) await prisma.chatMessage.create({ data: { sessionId, role: 'user', content: userQuery } });
        const schema = await getSchema(fileLocation);
        const result = await interactiveFollowupAgent(userQuery, fileLocation, schema, chatHistory || []);
        if (sessionId && result.answer) await prisma.chatMessage.create({ data: { sessionId, role: 'assistant', content: result.answer } });
        res.json(result);
    } catch (error: any) {
        console.error("Follow-up error:", error);
        res.status(500).json({ error: "Failed to answer follow-up query." });
    }
};