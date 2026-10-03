import { Request, Response } from 'express';
import { prisma } from '../db/prisma';
import fs from 'fs';
import path from 'path';
import type { AuthRequest } from '../middleware/authMiddleware';
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx';

// Fetch sidebar history (Grouped by recent)
export const getSessionHistory = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.id;
        if (!userId) return res.status(401).json({ error: "Unauthorized" });

        const sessions = await prisma.session.findMany({
            where: { userId }, // 🛡️ Data Isolation per user
            select: { id: true, title: true, createdAt: true },
            orderBy: { createdAt: 'desc' }
        });
        res.json(sessions);
    } catch (error) {
        console.error("Database Error in getSessionHistory:", error);
        res.status(500).json({ error: "Failed to fetch history" });
    }
};

export const getSessionById = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.id;
        const sessionId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

        const session = await prisma.session.findFirst({
            where: { id: sessionId, userId }, // 🛡️ Ensure user owns this session
            include: { dashboard: true, dataset: true, messages: { orderBy: { createdAt: 'asc' } } }
        });
        
        if (!session) return res.status(404).json({ error: "Session not found" });

        const formattedData = {
            sessionId: session.id,
            summary: session.dashboard?.summary,
            detailedReport: session.dashboard?.detailedReport,
            availableFilters: session.dashboard?.availableFilters || [],
            drillDownData: session.dashboard?.dataPayload || [], 
            charts: session.dashboard?.charts || [],
            anomalies: session.dashboard?.anomalies || [],
            recommendations: session.dashboard?.recommendations || [],
            fileLocation: session.dataset?.filePath || ""
        };

        res.json(formattedData);
    } catch (error) {
        console.error("Database Error in getSessionById:", error);
        res.status(500).json({ error: "Failed to load session" });
    }
};

// Export the detailed report as a Word Document



export const exportReportToWord = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.id;
        const sessionId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

        if (!userId) return res.status(401).json({ error: "Unauthorized" });

        const session = await prisma.session.findFirst({
            where: { id: sessionId, userId },
            include: { dashboard: true }
        });

        if (!session || !(session as any).dashboard) {
            return res.status(404).json({ error: "Session or report data not found" });
        }

        const dash = (session as any).dashboard;

        // 🛡️ Construct the native Word Document
        const doc = new Document({
            sections: [{
                properties: {},
                children: [
                    new Paragraph({
                        text: session.title || "DataMind AI Analytical Report",
                        heading: HeadingLevel.TITLE,
                        spacing: { after: 400 }
                    }),
                    
                    new Paragraph({ text: "Executive Summary", heading: HeadingLevel.HEADING_1, spacing: { before: 400, after: 200 } }),
                    new Paragraph({ text: dash.summary || "No summary available." }),
                    
                    new Paragraph({ text: "Detailed Analysis", heading: HeadingLevel.HEADING_1, spacing: { before: 400, after: 200 } }),
                    new Paragraph({ text: dash.detailedReport || "No detailed report available." }),

                    // Only add Recommendations section if data exists
                    ...(dash.recommendations && (dash.recommendations as string[]).length > 0 ? [
                        new Paragraph({ text: "Strategic Recommendations", heading: HeadingLevel.HEADING_1, spacing: { before: 400, after: 200 } }),
                        ...(dash.recommendations as string[]).map(rec => 
                            new Paragraph({ text: `• ${rec}`, spacing: { after: 100 } })
                        )
                    ] : []),

                    // Only add Anomalies section if data exists
                    ...(dash.anomalies && (dash.anomalies as string[]).length > 0 ? [
                        new Paragraph({ text: "Detected Anomalies", heading: HeadingLevel.HEADING_1, spacing: { before: 400, after: 200 } }),
                        ...(dash.anomalies as string[]).map(anomaly => 
                            new Paragraph({ text: `• ${anomaly}`, spacing: { after: 100 } })
                        )
                    ] : [])
                ]
            }]
        });

        // 🛡️ Convert to binary buffer and set strict Word headers
        const buffer = await Packer.toBuffer(doc);

        res.setHeader('Content-Disposition', `attachment; filename="DataMind_Analysis_${sessionId.substring(0,6)}.docx"`);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        res.setHeader('Content-Length', buffer.length);
        
        return res.send(buffer);

    } catch (error) {
        console.error("Export Error:", error);
        return res.status(500).json({ error: "Failed to generate Word document." });
    }
};

export const deleteSessionById = async (req: Request, res: Response) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    try {
        // 1. Fetch the session first to get the physical file path
        const session = await prisma.session.findUnique({
            where: { id },
            include: { dataset: true }
        });

        if (!session) {
            return res.status(404).json({ error: "Session not found." });
        }

        // 2. Delete the record from PostgreSQL 
        // (Prisma will automatically delete associated dashboards/datasets if onDelete: Cascade is set in schema.prisma)
        await prisma.session.delete({
            where: { id }
        });

        // 3. Clean up the physical file from the server to save disk space
        if (session.dataset?.filePath) {
            const fullPath = path.join(process.cwd(), session.dataset.filePath);
            if (fs.existsSync(fullPath)) {
                fs.unlinkSync(fullPath);
            }
        }

        res.json({ success: true, message: "Session and associated files deleted successfully." });
    } catch (error: any) {
        console.error("Delete session error:", error);
        res.status(500).json({ error: "Failed to delete session." });
    }
};