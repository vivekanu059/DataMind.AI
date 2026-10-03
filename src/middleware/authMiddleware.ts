import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthRequest extends Request {
    user?: {
        id: string;
    };
}

export const requireAuth = (req: AuthRequest, res: Response, next: NextFunction) => {
    let token: string | undefined;

    // 1. Check Authorization header
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.split(' ')[1];
    } 
    // 2. Check query parameter (Required for EventSource / SSE streams)
    else if (req.query && req.query.token) {
        token = req.query.token as string;
    }

    if (!token) {
        return res.status(401).json({ error: "Unauthorized. Missing token." });
    }

    try {
        if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is missing");
        
        const decoded = jwt.verify(token, process.env.JWT_SECRET) as { id: string };
        req.user = decoded;
        
        next();
    } catch (error) {
        return res.status(401).json({ error: "Unauthorized. Token expired or invalid." });
    }
};