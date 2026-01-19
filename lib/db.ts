import { Pool } from 'pg';

const pool = new Pool({
  host: process.env.POSTGRES_HOST,
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

const DEFAULT_SCRAPER_URL_CCB =
  'https://lsjr.ccb.com/msmp/ecpweb/page/internet/dist/preciousMetalsDetail.html?CCB_EmpID=71693716&PM_PD_ID=261108522&Org_Inst_Rgon_Cd=JS&page=preciousMetalsDetail';
const DEFAULT_SCRAPER_URL_CMB =
  'https://mobile.cmbchina.com/IGoldSilver/goldsilver/product-detail.html?behavior_ShareIDTyp=1&behavior_FwTraceID=193c4468f8046c5adc0e8e64b9665fd2&behavior_FwChannel=APP&BbkNbr=125&SplCod=FJ067&PrdTyp=GLD&PrdCod=GLD0035&PrdStd=K0010&RcmID=&accountUid=&IsChangeJump=&accumulateFlag=&orderDetailFlag=&fromAttentionList=&ZxlCod=XL0101';

let initialized = false;

async function initDb() {
  if (!initialized) {
    const client = await pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS gold_prices (
          id SERIAL PRIMARY KEY,
          price NUMERIC(10, 2) NOT NULL,
          unit VARCHAR(50) NOT NULL,
          timestamp TIMESTAMPTZ NOT NULL
        );
      `);
      await client.query(`ALTER TABLE gold_prices ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'ccb';`);
      await client.query(`
        CREATE TABLE IF NOT EXISTS scraper_config (
          id SERIAL PRIMARY KEY,
          name VARCHAR(50) UNIQUE NOT NULL,
          value TEXT NOT NULL
        );
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_gold_prices_timestamp 
        ON gold_prices(timestamp DESC);
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_gold_prices_source_timestamp
        ON gold_prices(source, timestamp DESC);
      `);
      initialized = true;
      console.log('Database initialized successfully');
    } catch (error: any) {
      if (error?.code === '23505') {
        console.warn('Database initialization race detected, continuing:', error.detail || error.message);
        initialized = true;
      } else {
        console.error('Database initialization error:', error);
        throw error;
      }
    } finally {
      client.release();
    }
  }
}

export interface GoldPriceRow {
  id: number;
  price: number;
  unit: string;
  timestamp: string;
  source: string;
}

export interface CronConfig {
  enabled: boolean;
  expression: string | null;
}

export async function getScraperUrls(): Promise<{ ccb: string; cmb: string }> {
  await initDb();
  const client = await pool.connect();
  try {
    const result = await client.query(
      'SELECT name, value FROM scraper_config WHERE name = ANY($1)',
      [['scrape_url_ccb', 'scrape_url_cmb']],
    );
    let ccb = DEFAULT_SCRAPER_URL_CCB;
    let cmb = DEFAULT_SCRAPER_URL_CMB;
    for (const row of result.rows) {
      if (row.name === 'scrape_url_ccb' && row.value) {
        ccb = row.value;
      }
      if (row.name === 'scrape_url_cmb' && row.value) {
        cmb = row.value;
      }
    }
    await client.query(
      'INSERT INTO scraper_config (name, value) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING',
      ['scrape_url_ccb', ccb],
    );
    await client.query(
      'INSERT INTO scraper_config (name, value) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING',
      ['scrape_url_cmb', cmb],
    );
    return { ccb, cmb };
  } finally {
    client.release();
  }
}

export async function updateScraperUrls(urls: { ccb: string; cmb: string }): Promise<{ ccb: string; cmb: string }> {
  await initDb();
  const client = await pool.connect();
  try {
    await client.query(
      'INSERT INTO scraper_config (name, value) VALUES ($1, $2) ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value',
      ['scrape_url_ccb', urls.ccb],
    );
    await client.query(
      'INSERT INTO scraper_config (name, value) VALUES ($1, $2) ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value',
      ['scrape_url_cmb', urls.cmb],
    );
    return urls;
  } finally {
    client.release();
  }
}

export async function getCronConfig(): Promise<CronConfig> {
  await initDb();
  const client = await pool.connect();
  try {
    const result = await client.query(
      'SELECT name, value FROM scraper_config WHERE name = ANY($1)',
      [['cron_enabled', 'cron_expression']],
    );
    let enabled = false;
    let expression: string | null = null;
    for (const row of result.rows) {
      if (row.name === 'cron_enabled') {
        enabled = row.value === 'true';
      }
      if (row.name === 'cron_expression') {
        expression = row.value || null;
      }
    }
    return { enabled, expression };
  } finally {
    client.release();
  }
}

export async function saveCronConfig(
  enabled: boolean,
  expression: string | null,
): Promise<void> {
  await initDb();
  const client = await pool.connect();
  try {
    console.log('[cron-config] saveCronConfig called', {
      enabled,
      expression,
    });
    await client.query(
      'INSERT INTO scraper_config (name, value) VALUES ($1, $2) ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value',
      ['cron_enabled', enabled ? 'true' : 'false'],
    );
    await client.query(
      'INSERT INTO scraper_config (name, value) VALUES ($1, $2) ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value',
      ['cron_expression', expression ?? ''],
    );
  } finally {
    client.release();
  }
}

export async function addGoldPrice(price: number, unit: string, timestamp: string, source: string): Promise<GoldPriceRow> {
  await initDb();
  const client = await pool.connect();
  try {
    const result = await client.query(
      'INSERT INTO gold_prices (price, unit, timestamp, source) VALUES ($1, $2, $3, $4) RETURNING *',
      [price, unit, timestamp, source]
    );
    return {
      id: result.rows[0].id,
      price: parseFloat(result.rows[0].price),
      unit: result.rows[0].unit,
      timestamp: result.rows[0].timestamp,
      source: result.rows[0].source,
    };
  } finally {
    client.release();
  }
}

export async function getGoldHistory(limit: number = 100): Promise<GoldPriceRow[]> {
  await initDb();
  const client = await pool.connect();
  try {
    const result = await client.query(
      'SELECT id, price, unit, timestamp, source FROM gold_prices ORDER BY id DESC LIMIT $1',
      [limit]
    );
    return result.rows.map(row => ({
      id: row.id,
      price: parseFloat(row.price),
      unit: row.unit,
      timestamp: row.timestamp,
      source: row.source,
    }));
  } finally {
    client.release();
  }
}

export async function getGoldHistoryByDays(days: number | null = null, source: string = 'ccb'): Promise<GoldPriceRow[]> {
  await initDb();
  const client = await pool.connect();
  try {
    let query: string;
    let params: any[];

    if (days === null) {
      query = 'SELECT id, price, unit, timestamp, source FROM gold_prices WHERE source = $1 ORDER BY timestamp DESC';
      params = [source];
    } else {
      query = `
        SELECT id, price, unit, timestamp, source 
        FROM gold_prices 
        WHERE source = $1 AND timestamp >= NOW() - INTERVAL '${days} days'
        ORDER BY timestamp DESC
      `;
      params = [source];
    }

    const result = await client.query(query, params);
    return result.rows.map(row => ({
      id: row.id,
      price: parseFloat(row.price),
      unit: row.unit,
      timestamp: row.timestamp,
      source: row.source,
    }));
  } finally {
    client.release();
  }
}

export async function getLatestGoldPrice(source: string = 'ccb'): Promise<GoldPriceRow | null> {
  await initDb();
  const client = await pool.connect();
  try {
    const result = await client.query(
      'SELECT id, price, unit, timestamp, source FROM gold_prices WHERE source = $1 ORDER BY timestamp DESC LIMIT 1',
      [source]
    );
    if (result.rows.length === 0) return null;
    return {
      id: result.rows[0].id,
      price: parseFloat(result.rows[0].price),
      unit: result.rows[0].unit,
      timestamp: result.rows[0].timestamp,
      source: result.rows[0].source,
    };
  } finally {
    client.release();
  }
}
