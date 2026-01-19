import cron from 'node-cron';
import { getCronConfig } from '@/lib/db';
import { scrapeAndSave } from '@/lib/scraper';

let task: ReturnType<typeof cron.schedule> | null = null;
let cronExpression: string | null = null;
let autoStartDone = false;
let autoStartInProgress = false;

export function getCronStatus() {
  return {
    enabled: !!task,
    expression: cronExpression,
  };
}

export function stopCron() {
  if (task) {
    task.stop();
    task = null;
  }
  cronExpression = null;
}

export function startCron(expression: string) {
  stopCron();
  const trimmed = expression.trim();
  const validator = (cron as any).validate as ((expr: string) => boolean) | undefined;
  if (validator && !validator(trimmed)) {
    throw new Error('Invalid cron expression');
  }
  cronExpression = trimmed;
  task = cron.schedule(trimmed, async () => {
    try {
      await scrapeAndSave();
    } catch (e) {}
  });
}

export async function ensureCronStartedFromDb() {
  if (autoStartDone || autoStartInProgress) {
    return;
  }
  autoStartInProgress = true;
  try {
    const dbConfig = await getCronConfig();
    if (dbConfig.enabled && dbConfig.expression) {
      if (!getCronStatus().enabled) {
        startCron(dbConfig.expression);
      }
      try {
        await scrapeAndSave();
      } catch (e) {}
    }
  } finally {
    autoStartInProgress = false;
    autoStartDone = true;
  }
}
