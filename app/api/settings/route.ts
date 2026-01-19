import { NextResponse } from 'next/server';
import { getScraperUrls, updateScraperUrls, getCronConfig, saveCronConfig } from '@/lib/db';
import { ensureCronStartedFromDb, startCron, stopCron } from '@/lib/cron';

export const dynamic = 'force-dynamic';

void ensureCronStartedFromDb();

export async function GET() {
  try {
    const [scrapeUrls, cronConfig] = await Promise.all([
      getScraperUrls(),
      getCronConfig()
    ]);

    return NextResponse.json({
      success: true,
      data: {
        scrapeUrls,
        cron: cronConfig
      }
    });
  } catch (error: any) {
    return NextResponse.json({
      success: false,
      error: error.message || 'Internal Server Error'
    }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { scrapeUrls, cron } = body;

    // Validate inputs
    if (!scrapeUrls || typeof scrapeUrls.ccb !== 'string' || typeof scrapeUrls.cmb !== 'string') {
      return NextResponse.json({ success: false, error: 'Invalid scrapeUrls' }, { status: 400 });
    }
    if (cron && (typeof cron.enabled !== 'boolean' || (cron.expression && typeof cron.expression !== 'string'))) {
      return NextResponse.json({ success: false, error: 'Invalid cron config' }, { status: 400 });
    }

    // Save settings
    await updateScraperUrls(scrapeUrls);
    
    if (cron) {
      await saveCronConfig(cron.enabled, cron.expression);
      
      // Handle cron runtime state
      if (cron.enabled && cron.expression) {
        try {
          startCron(cron.expression);
        } catch (e: any) {
          console.error('Failed to start cron:', e);
          return NextResponse.json({ 
            success: true, 
            warning: 'Settings saved but failed to start cron: ' + e.message 
          });
        }
      } else {
        stopCron();
      }
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Settings update error:', error);
    return NextResponse.json({
      success: false,
      error: error.message || 'Internal Server Error'
    }, { status: 500 });
  }
}
