import { Response } from 'express';
import { prisma } from '../db/prisma';
import { AuthRequest } from '../middleware/authMiddleware';

export const mockUpgrade = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.id;
        if (!userId) return res.status(401).json({ error: "Unauthorized" });

        // Simulate a 1.5-second network delay to make it feel like a real transaction
        await new Promise(resolve => setTimeout(resolve, 1500));

        // Upgrade the user in the database
        const user = await prisma.user.update({
            where: { id: userId },
            data: { tier: 'PRO', tokenBalance: 10000 }
        });

        res.json({ 
            message: "Payment successful. Account upgraded!", 
            tier: user.tier, 
            balance: user.tokenBalance 
        });
    } catch (error) {
        console.error("Upgrade Error:", error);
        res.status(500).json({ error: "Failed to process upgrade." });
    }
};