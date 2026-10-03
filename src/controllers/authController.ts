import { Request, Response } from 'express';
import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import { prisma } from '../db/prisma';
import bcrypt from 'bcrypt';

// Initialize the Google Client
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

export const googleLogin = async (req: Request, res: Response) => {
    try {
        const { token } = req.body;
        if (!token) return res.status(400).json({ error: "No token provided" });

        // 1. Verify the token with Google
        const ticket = await googleClient.verifyIdToken({
            idToken: token,
            audience: process.env.GOOGLE_CLIENT_ID,
        });

        const payload = ticket.getPayload();
        if (!payload || !payload.email) {
            return res.status(400).json({ error: "Invalid Google token payload" });
        }

        const { sub: googleId, email, name, picture } = payload;

        // 2. Find or Create the User in PostgreSQL
        const user = await prisma.user.upsert({
            where: { email },
            update: { 
                name: name || "User", 
                avatar: picture 
            },
            create: {
                googleId,
                email,
                name: name || "User",
                avatar: picture,
                tier: 'FREE',
                tokenBalance: 500 // The initial Free Tier hook
            }
        });

        // 3. Generate a stateless JWT for your API
        if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is missing");
        
        const apiToken = jwt.sign(
            { id: user.id }, 
            process.env.JWT_SECRET, 
            { expiresIn: '7d' } // Users stay logged in for 7 days
        );

        // 4. Send the API token and user data back to React
        res.json({
            token: apiToken,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                avatar: user.avatar,
                tier: user.tier,
                tokenBalance: user.tokenBalance
            }
        });

    } catch (error: any) {
        console.error("Google Auth Error:", error);
        res.status(401).json({ error: "Authentication failed." });
    }
};



// Helper function to generate JWTs
const generateToken = (userId: string) => {
    if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is missing");
    return jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: '7d' });
};

export const registerWithEmail = async (req: Request, res: Response) => {
    try {
        const { email, password, name } = req.body;
        if (!email || !password || !name) {
            return res.status(400).json({ error: "Email, password, and name are required." });
        }

        const existingUser = await prisma.user.findUnique({ where: { email } });
        if (existingUser) {
            return res.status(400).json({ error: "An account with this email already exists." });
        }

        // 🛡️ Hash the password securely
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const user = await prisma.user.create({
            data: {
                email,
                name,
                password: hashedPassword,
                tier: 'FREE',
                tokenBalance: 500
            }
        });

        const token = generateToken(user.id);
        res.status(201).json({
            token,
            user: { id: user.id, name: user.name, email: user.email, tier: user.tier, tokenBalance: user.tokenBalance }
        });
    } catch (error) {
        console.error("Registration error:", error);
        res.status(500).json({ error: "Registration failed." });
    }
};

export const loginWithEmail = async (req: Request, res: Response) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: "Email and password are required." });
        }

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || !user.password) {
            return res.status(401).json({ error: "Invalid email or password." });
        }

        // 🛡️ Compare the provided password against the stored hash
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ error: "Invalid email or password." });
        }

        const token = generateToken(user.id);
        res.json({
            token,
            user: { id: user.id, name: user.name, email: user.email, tier: user.tier, tokenBalance: user.tokenBalance, avatar: user.avatar }
        });
    } catch (error) {
        console.error("Login error:", error);
        res.status(500).json({ error: "Login failed." });
    }
};