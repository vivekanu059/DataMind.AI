import { Response, NextFunction } from 'express';
import { prisma } from '../db/prisma'; 
import { AuthRequest } from './authMiddleware'; // Make sure this path matches your setup
import fs from 'fs';

export const enforceTierLimits = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        if (!req.file || !req.user?.id) return next();

        // 1. Query the absolute latest tier from the database
        const activeUser = await prisma.user.findUnique({ 
            where: { id: req.user.id },
            select: { tier: true }
        });

        // 2. Enforce the 5MB limit ONLY if they are truly on the FREE tier
        if (activeUser?.tier === 'FREE' && req.file.size > 5 * 1024 * 1024) {
            
            // Clean up the file multer just saved
            fs.unlink(req.file.path, (err) => {
                if (err) console.error("Failed to delete oversized file:", err);
            });

            return res.status(403).json({ 
                error: "File size exceeds 5MB limit for the Free tier. Toggle to PRO mode to process enterprise-scale datasets." 
            });
        }

        next();
    } catch (error) {
        console.error("Tier Validation Error:", error);
        res.status(500).json({ error: "Failed to validate account tier limits." });
    }
};