import { chromium } from 'playwright';
import { addGoldPrice, getScraperUrls } from '@/lib/db';

type GoldSource = 'ccb' | 'cmb';

function parsePriceFromText(text: string, source: GoldSource) {
  const normalized = text.replace(/\s+/g, ' ');
  if (source === 'cmb') {
    const tenGramPatterns = [
      /10\s*克[^0-9¥￥]*[¥￥]?\s*(\d+(?:,\d{3})*(?:\.\d+)?)/,
      /[¥￥]\s*(\d+(?:,\d{3})*(?:\.\d+)?)\s*(?:元)?\s*\/?\s*10\s*克/,
      /(\d+(?:,\d{3})*(?:\.\d+)?)\s*元\s*\/?\s*10\s*克/,
    ];
    for (const pattern of tenGramPatterns) {
      const match = normalized.match(pattern);
      if (match) {
        const totalPrice = parseFloat(match[1].replace(/,/g, ''));
        return {
          price: totalPrice / 10,
          unit: '元/克',
          fullText: `${totalPrice}元/10克`,
        };
      }
    }
    const cmbCandidates = Array.from(
      normalized.matchAll(/(\d+(?:,\d{3})*(?:\.\d+)?)\s*元/g),
    ).map((m) => parseFloat(m[1].replace(/,/g, '')));
    if (cmbCandidates.length > 0) {
      const totalPrice = Math.max(...cmbCandidates);
      return {
        price: totalPrice / 10,
        unit: '元/克',
        fullText: `${totalPrice}元/10克`,
      };
    }
    return null;
  }

  const perGramMatch = normalized.match(/(\d+(?:,\d{3})*(?:\.\d+)?)\s*元\/克/);
  if (perGramMatch) {
    const price = parseFloat(perGramMatch[1].replace(/,/g, ''));
    return {
      price,
      unit: '元/克',
      fullText: perGramMatch[0],
    };
  }

  const candidates = Array.from(normalized.matchAll(/(\d+(?:,\d{3})*(?:\.\d+)?)\s*元/g)).map(
    (m) => parseFloat(m[1].replace(/,/g, '')),
  );
  const symbolMatches = Array.from(
    normalized.matchAll(/[¥￥]\s*(\d+(?:,\d{3})*(?:\.\d+)?)/g),
  ).map((m) => parseFloat(m[1].replace(/,/g, '')));
  candidates.push(...symbolMatches);

  if (candidates.length > 0) {
    const totalPrice = Math.max(...candidates);
    return {
      price: totalPrice,
      unit: '元/克',
      fullText: `${totalPrice}元/克`,
    };
  }

  return null;
}

export async function scrapeAndSave(source: GoldSource = 'ccb') {
  let browser: any;
  try {
    const urls = await getScraperUrls().catch(() => ({
      ccb: 'https://lsjr.ccb.com/msmp/ecpweb/page/internet/dist/preciousMetalsDetail.html?CCB_EmpID=71693716&PM_PD_ID=261108522&Org_Inst_Rgon_Cd=JS&page=preciousMetalsDetail',
      cmb: 'https://mobile.cmbchina.com/IGoldSilver/goldsilver/product-detail.html?behavior_ShareIDTyp=1&behavior_FwTraceID=193c4468f8046c5adc0e8e64b9665fd2&behavior_FwChannel=APP&BbkNbr=125&SplCod=FJ067&PrdTyp=GLD&PrdCod=GLD0035&PrdStd=K0010&RcmID=&accountUid=&IsChangeJump=&accumulateFlag=&orderDetailFlag=&fromAttentionList=&ZxlCod=XL0101',
    }));
    const url = source === 'cmb' ? urls.cmb : urls.ccb;

    console.log('Scraper using url:', url);

    browser = await chromium.launch({
      headless: true,
      args: ['--disable-dev-shm-usage', '--no-sandbox'],
    });
    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    await page.goto(url);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => null);

    const bodyText = await page.evaluate(() => document.body.innerText || '');
    const html = await page.content();
    const domPrice = await page.evaluate((currentSource: any) => {
      const extractValue = (text: string) => {
        const match = text.match(/(\d+(?:,\d{3})*(?:\.\d+)?)/);
        if (!match) {
          return null;
        }
        const value = parseFloat(match[1].replace(/,/g, ''));
        return Number.isNaN(value) ? null : value;
      };
      if (currentSource === 'cmb') {
        const nodes = Array.from(document.querySelectorAll('.price-info-amount'));
        const values = nodes
          .map((node) => {
            const aria = node.getAttribute('aria-label') || '';
            const ariaValue = extractValue(aria);
            if (ariaValue !== null) {
              return ariaValue;
            }
            return extractValue((node.textContent || '').trim());
          })
          .filter((value): value is number => value !== null);
        if (values.length === 0) {
          return null;
        }
        return Math.max(...values);
      }
      const priceNode = document.querySelector('.price');
      if (!priceNode) {
        return null;
      }
      return extractValue((priceNode.textContent || '').trim());
    }, source);
    const data =
      domPrice && domPrice > 0
        ? source === 'cmb'
          ? { price: domPrice / 10, unit: '元/克', fullText: `${domPrice}元/10克` }
          : { price: domPrice, unit: '元/克', fullText: `${domPrice}元/克` }
        : parsePriceFromText(`${bodyText} ${html}`, source);

    if (!data) {
      throw new Error('Price pattern not found on page');
    }

    const timestamp = new Date().toISOString();
    await addGoldPrice(data.price, data.unit, timestamp, source);
    console.log('Scraper success', data.price, timestamp);
    return { data, timestamp, source };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}
