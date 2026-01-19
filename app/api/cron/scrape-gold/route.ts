import { NextResponse } from 'next/server';
import { scrapeAndSave } from '@/lib/scraper';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// This endpoint is for scheduled cron jobs
export async function GET(request: Request) {
    // Simple authentication check
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET || 'your-secret-key-here';

    if (authHeader !== `Bearer ${cronSecret}`) {
        return NextResponse.json({
            success: false,
            error: 'Unauthorized'
        }, { status: 401 });
    }

    try {
        console.log('[CRON] Starting scheduled gold price scrape...');
        const results = await Promise.allSettled([scrapeAndSave('ccb'), scrapeAndSave('cmb')]);
        const successResults = results
            .filter((result): result is PromiseFulfilledResult<any> => result.status === 'fulfilled')
            .map((result) => result.value);
        console.log('[CRON] Successfully scraped and saved prices:', successResults.length);
        return NextResponse.json({
            success: true,
            data: successResults.map((result) => result.data),
            timestamp: new Date().toISOString()
        });

    } catch (error: any) {
        console.error('[CRON] Scraping error:', error);
        return NextResponse.json({
            success: false,
            error: error.message || 'Internal Server Error'
        }, { status: 500 });
    } finally {
    }
}
