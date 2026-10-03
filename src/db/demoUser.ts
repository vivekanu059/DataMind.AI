import { prisma } from './prisma';

// This acts as a fake "authentication" layer for your portfolio demo
export const getDemoUser = async () => {
    // Try to find the first user
    const userDelegate = (prisma as unknown as {
        user: typeof prisma extends { user: infer T } ? T : any;
    }).user;
    let user = await userDelegate.findFirst();
    
    // If the database is completely empty, create the default demo user
    if (!user) {
        user = await userDelegate.create({
            data: {
                tier: 'FREE',
                tokenBalance: 500
            }
        });
    }
    
    return user;
};