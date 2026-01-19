import { NextResponse } from 'next/server';
import { ensureCronStartedFromDb, getCronStatus, startCron, stopCron } from '@/lib/cron';
import { getCronConfig, saveCronConfig } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

void ensureCronStartedFromDb();

export async function GET() {
  try {
    const dbConfig = await getCronConfig();
    const runtimeStatus = getCronStatus();

    if (dbConfig.enabled && dbConfig.expression && !runtimeStatus.enabled) {
      try {
        startCron(dbConfig.expression);
      } catch (e: any) {
        console.error('[cron-config] Failed to auto-start cron from DB config:', e?.message || e);
      }
    }

    const status = getCronStatus();
    return NextResponse.json({
      success: true,
      data: {
        enabled: dbConfig.enabled || status.enabled,
        expression: dbConfig.expression || status.expression,
      },
    });
  } catch (e: any) {
    console.error('[cron-config] GET error:', e);
    return NextResponse.json(
      { success: false, error: e?.message || 'Internal Server Error' },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { enabled, intervalMinutes, expression } = body || {};

    const current = await getCronConfig();

    if (enabled === false) {
      stopCron();
      await saveCronConfig(false, current.expression);
    } else if (enabled === true) {
      let expr: string | null = null;

      if (typeof expression === 'string' && expression.trim().length > 0) {
        expr = expression.trim();
      } else if (intervalMinutes) {
        const minutes = parseInt(intervalMinutes, 10);
        if (!minutes || minutes < 1 || minutes > 720) {
          return NextResponse.json(
            { success: false, error: 'Invalid minutes' },
            { status: 400 },
          );
        }
        expr = `*/${Math.max(1, minutes)} * * * *`;
      }

      if (!expr) {
        return NextResponse.json(
          { success: false, error: 'Missing cron expression' },
          { status: 400 },
        );
      }

      try {
        startCron(expr);
      } catch (e: any) {
        console.error('[cron-config] Failed to start cron with expression:', expr, e);
        return NextResponse.json(
          { success: false, error: e?.message || 'Invalid cron expression' },
          { status: 400 },
        );
      }

      await saveCronConfig(true, expr);
    }

    const dbConfig = await getCronConfig();
    console.log('[cron-config] POST saved dbConfig:', dbConfig);
    return NextResponse.json({ success: true, data: dbConfig });
  } catch (e: any) {
    console.error('[cron-config] POST error:', e);
    return NextResponse.json(
      { success: false, error: e?.message || 'Bad Request' },
      { status: 400 },
    );
  }
}
