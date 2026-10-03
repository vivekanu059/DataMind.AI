import { Response } from 'express';
import { prisma } from '../db/prisma';
import { AuthRequest } from '../middleware/authMiddleware';

const REFILL_INTERVAL_HOURS = 4;
const FREE_MAX_TOKENS = 500;
const PRO_MAX_TOKENS = 10000;

export const getWalletStatus = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.id;
        if (!userId) return res.status(401).json({ error: "Unauthorized" });

        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) return res.status(404).json({ error: "User not found" });

        const maxTokens = user.tier === 'PRO' ? PRO_MAX_TOKENS : FREE_MAX_TOKENS;
        
        // Calculate hours since the tokens were last updated
        const lastUpdate = user.updatedAt.getTime();
        const now = Date.now();
        const hoursElapsed = (now - lastUpdate) / (1000 * 60 * 60);

        // If 4 hours have passed OR the user has more tokens than they should (bug fix), reset it
        if (hoursElapsed >= REFILL_INTERVAL_HOURS || user.tokenBalance > maxTokens) {
            const updatedUser = await prisma.user.update({
                where: { id: userId },
                data: { tokenBalance: maxTokens }
            });
            return res.json({ tier: updatedUser.tier, balance: updatedUser.tokenBalance });
        }

        // Otherwise, return current balance
        res.json({ tier: user.tier, balance: user.tokenBalance });
    } catch (error) {
        console.error("Wallet Error:", error);
        res.status(500).json({ error: "Failed to fetch wallet status" });
    }
};

export const toggleDemoTier = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.id;
        if (!userId) return res.status(401).json({ error: "Unauthorized" });

        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) return res.status(404).json({ error: "User not found" });

        if (user.tier === 'FREE') {
            await prisma.user.update({
                where: { id: userId },
                data: { tier: 'PRO', tokenBalance: PRO_MAX_TOKENS }
            });
            res.json({ message: "Upgraded to PRO", tier: 'PRO', balance: PRO_MAX_TOKENS });
        } else {
            await prisma.user.update({
                where: { id: userId },
                data: { tier: 'FREE', tokenBalance: FREE_MAX_TOKENS }
            });
            res.json({ message: "Downgraded to FREE", tier: 'FREE', balance: FREE_MAX_TOKENS });
        }
    } catch (error) {
        console.error("Tier Toggle Error:", error);
        res.status(500).json({ error: "Failed to toggle tier" });
    }
};