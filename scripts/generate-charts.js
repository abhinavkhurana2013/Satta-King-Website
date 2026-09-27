import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const chartHtmlPath = path.join(rootDir, 'chart.html');
const template = fs.readFileSync(chartHtmlPath, 'utf8');

export const MARKETS = [
  {
    slug: 'disawer',
    aliases: ['disawar'],
    name: 'Disawer',
    drawTime: '05:15 AM',
    title: 'Disawer Chart 2026 – [SATTAKINGFAST]',
    desc: 'Check Disawer Chart today, [SATTAKINGFAST] live record chart, monthly results, and previous results updated in real-time.'
  },
  {
    slug: 'dehli-noon',
    aliases: ['delhi-noon'],
    name: 'Dehli Noon',
    drawTime: '03:15 PM',
    title: 'Dehli Noon Chart 2026 – [SATTAKINGFAST]',
    desc: 'Check Dehli Noon Chart today, [SATTAKINGFAST] live record chart, monthly results, and previous results updated in real-time.'
  },
  {
    slug: 'punjab-day',
    aliases: [],
    name: 'Punjab Day',
    drawTime: '05:15 PM',
    title: 'Punjab Day Chart 2026 – [SATTAKINGFAST]',
    desc: 'Check Punjab Day Chart today, [SATTAKINGFAST] live record chart, monthly results, and previous results updated in real-time.'
  },
  {
    slug: 'faridabad',
    aliases: [],
    name: 'Faridabad',
    drawTime: '06:15 PM',
    title: 'Faridabad Chart 2026 – [SATTAKINGFAST]',
    desc: 'Check Faridabad Chart today, [SATTAKINGFAST] live record chart, monthly results, and previous results updated in real-time.'
  },
  {
    slug: 'new-faridabad',
    aliases: [],
    name: 'New Faridabad',
    drawTime: '07:15 PM',
    title: 'New Faridabad Chart 2026 – [SATTAKINGFAST]',
    desc: 'Check New Faridabad Chart today, [SATTAKINGFAST] live record chart, monthly results, and previous results updated in real-time.'
  },
  {
    slug: 'gaziabad',
    aliases: ['ghaziabad'],
    name: 'Gaziabad',
    drawTime: '08:45 PM',
    title: 'Gaziabad Chart 2026 – [SATTAKINGFAST]',
    desc: 'Check Gaziabad Chart today, [SATTAKINGFAST] live record chart, monthly results, and previous results updated in real-time.'
  },
  {
    slug: 'new-gaziabad',
    aliases: ['new-ghaziabad-chart'],
    name: 'New Gaziabad',
    drawTime: '09:30 PM',
    title: 'New Gaziabad Chart 2026 – [SATTAKINGFAST]',
    desc: 'Check New Gaziabad Chart today, [SATTAKINGFAST] live record chart, monthly results, and previous results updated in real-time.'
  },
  {
    slug: 'gali',
    aliases: [],
    name: 'Gali',
    drawTime: '11:45 PM',
    title: 'Gali Chart 2026 – [SATTAKINGFAST]',
    desc: 'Check Gali Chart today, [SATTAKINGFAST] live record chart, monthly results, and previous results updated in real-time.'
  }
];

function generateMarketPage(market, filename) {
  let content = template;

  // Replace Title & Description
  content = content.replace(
    /<title>.*?<\/title>/s,
    `<title>${market.title}</title>`
  );
  content = content.replace(
    /<meta name="description" content=".*?" \/>/s,
    `<meta name="description" content="${market.desc}" />`
  );

  // Replace Canonical & OG
  content = content.replace(
    /<link rel="canonical" href=".*?" \/>/s,
    `<link rel="canonical" href="https://sattakingfast.vercel.app/${market.slug}" />`
  );
  content = content.replace(
    /<meta property="og:title" content=".*?" \/>/s,
    `<meta property="og:title" content="${market.title}" />`
  );
  content = content.replace(
    /<meta property="og:description" content=".*?" \/>/s,
    `<meta property="og:description" content="${market.desc}" />`
  );
  content = content.replace(
    /<meta property="og:url" content=".*?" \/>/s,
    `<meta property="og:url" content="https://sattakingfast.vercel.app/${market.slug}" />`
  );

  // Replace headings
  content = content.replace(
    /<h1 id="page-market-name"[^>]*>.*?<\/h1>/s,
    `<h1 id="page-market-name" class="text-2xl sm:text-3xl font-black text-amber-400 tracking-wide mt-1.5 uppercase">${market.name} Record Chart</h1>`
  );
  content = content.replace(
    /<p id="page-draw-time"[^>]*>.*?<\/p>/s,
    `<p id="page-draw-time" class="text-xs text-slate-400 font-semibold mt-0.5">Daily Draw Time: ${market.drawTime}</p>`
  );

  const outPath = path.join(rootDir, `${filename}.html`);
  fs.writeFileSync(outPath, content, 'utf8');
  console.log(`Generated: ${filename}.html`);
}

for (const m of MARKETS) {
  generateMarketPage(m, m.slug);
  for (const alias of m.aliases) {
    generateMarketPage(m, alias);
  }
}

console.log('Successfully generated all market chart HTML pages!');
