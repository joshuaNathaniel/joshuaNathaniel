// Renders the profile's stats card, once per GitHub theme, from the GraphQL API.
// Usage: GH_TOKEN=... node render-stats.mjs <output-dir>
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const LOGIN = 'joshuaNathaniel';

const QUERY = `
  fragment Latest on Repository {
    name
    releases(first: 30, orderBy: { field: CREATED_AT, direction: DESC }) {
      nodes { tagName publishedAt }
    }
  }
  query ($login: String!, $merged: String!) {
    user(login: $login) {
      createdAt
      contributionsCollection {
        contributionCalendar { totalContributions }
        commitContributionsByRepository(maxRepositories: 100) {
          contributions { totalCount }
          repository {
            isPrivate
            languages(first: 10, orderBy: { field: SIZE, direction: DESC }) {
              totalSize
              edges { size node { name } }
            }
          }
        }
      }
    }
    merged: search(query: $merged, type: ISSUE, first: 1) { issueCount }
    axx: repository(owner: "nimbusxr", name: "axx") { ...Latest }
    stormbreaker: repository(owner: "nimbusxr", name: "stormbreaker") { ...Latest }
  }`;

const THEMES = {
  dark: { surface: '#0a0a0a', border: '#262626', ink: '#fafafa', second: '#b3b3b3', muted: '#8a8a8a', bar: '#3987e5' },
  light: { surface: '#fafafa', border: '#d4d4d4', ink: '#0a0a0a', second: '#4a4a4a', muted: '#6b6b6b', bar: '#2a78d6' },
};

const WIDTH = 880;
const HEIGHT = 240;
const MONO = "ui-monospace,SFMono-Regular,'SF Mono',Menlo,Consolas,'Liberation Mono',monospace";
const SANS = "system-ui,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif";

async function fetchData() {
  const response = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, 'User-Agent': LOGIN },
    body: JSON.stringify({
      query: QUERY,
      variables: { login: LOGIN, merged: `author:${LOGIN} is:pr is:merged is:public` },
    }),
  });
  const { data, errors } = await response.json();
  if (errors?.length || !data) throw new Error(JSON.stringify(errors ?? response.status));
  return data;
}

// Each public repository's commits, split across its languages by code size.
function topLanguages(repositories, limit = 5) {
  const weights = new Map();
  for (const { contributions, repository } of repositories) {
    const { totalSize, edges } = repository.languages;
    if (repository.isPrivate || !totalSize) continue;
    for (const { size, node } of edges) {
      if (['JSON', 'YAML', 'Markdown'].includes(node.name)) continue; // Data and docs, not code.
      weights.set(node.name, (weights.get(node.name) ?? 0) + (contributions.totalCount * size) / totalSize);
    }
  }
  const total = [...weights.values()].reduce((sum, weight) => sum + weight, 0);
  return [...weights]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, weight]) => ({ name, share: weight / total }));
}

function latestRelease(repository) {
  const release = repository.releases.nodes.find(({ tagName }) => /^v\d/.test(tagName));
  return release && { name: repository.name, tag: release.tagName, date: shortDate(release.publishedAt) };
}

const shortDate = (iso, options = {}) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC', ...options });

const escapeXml = (value) =>
  String(value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[ch]);

const text = (x, y, className, value) => `<text x="${x}" y="${y}" class="${className}">${escapeXml(value)}</text>`;

// A horizontal bar: square at its baseline, 4px rounded at the data end.
function bar(x, y, width, height) {
  const radius = Math.min(4, width);
  return `<path class="bar" d="M${x} ${y}h${(width - radius).toFixed(1)}a${radius} ${radius} 0 0 1 ${radius} ${radius}v${height - 2 * radius}a${radius} ${radius} 0 0 1 -${radius} ${radius}H${x}z"/>`;
}

function renderCard(colors, stats) {
  const { contributions, merged, years, since, releases, languages, updated } = stats;
  const parts = [];

  parts.push(text(32, 42, 'label', `activity · updated ${updated}`));

  const tiles = [
    [32, contributions.toLocaleString('en-US'), 'contributions', 'last 12 months'],
    [190, merged.toLocaleString('en-US'), 'merged PRs', 'public, all time'],
    [342, years, 'years on GitHub', `since ${since}`],
  ];
  for (const [x, value, label, detail] of tiles) {
    parts.push(text(x, 102, 'figure', value), text(x, 128, 'label strong', label), text(x, 147, 'label', detail));
  }

  parts.push(`<path class="rule" d="M32 168.5H488M520.5 32V208"/>`);
  parts.push(text(32, 193, 'label', 'latest releases'));
  releases.forEach(({ name, tag, date }, index) => {
    const x = 32 + index * 228;
    parts.push(
      `<text x="${x}" y="216" class="label"><tspan class="strong">${escapeXml(name)} ${escapeXml(tag)}</tspan>  ${escapeXml(date)}</text>`,
    );
  });

  parts.push(text(552, 42, 'label', 'languages, by commits'));

  const baseline = 642;
  const longest = 160;
  const largest = languages[0]?.share ?? 1;
  languages.forEach(({ name, share }, index) => {
    const y = 80 + index * 28;
    const width = Math.max(2, (share / largest) * longest);
    const percent = share < 0.01 ? '<1%' : `${Math.round(share * 100)}%`;
    parts.push(
      text(552, y + 10, 'label strong', name),
      bar(baseline, y, Number(width.toFixed(1)), 12),
      text(baseline + width + 8, y + 10, 'label', percent),
    );
  });

  const summary =
    `${contributions} contributions in the last 12 months, ${merged} merged public pull requests, ${years} years on GitHub. ` +
    `Top languages by commits: ${languages.map(({ name, share }) => `${name} ${Math.round(share * 100)}%`).join(', ')}.`;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH}" height="${HEIGHT}" role="img" aria-labelledby="t d">` +
    `<title id="t">GitHub activity for ${LOGIN}</title><desc id="d">${escapeXml(summary)}</desc>` +
    `<style>text{font-family:${MONO};font-size:13px;fill:${colors.muted}}` +
    `.strong{fill:${colors.second}}.figure{font-family:${SANS};font-size:42px;font-weight:600;fill:${colors.ink}}` +
    `.rule{stroke:${colors.border};fill:none}.bar{fill:${colors.bar}}</style>` +
    `<rect x=".5" y=".5" width="${WIDTH - 1}" height="${HEIGHT - 1}" rx="12" fill="${colors.surface}" stroke="${colors.border}"/>` +
    parts.join('') +
    `</svg>\n`
  );
}

const outputDir = process.argv[2];
if (!outputDir) throw new Error('usage: render-stats.mjs <output-dir>');

const data = await fetchData();
const collection = data.user.contributionsCollection;
const joined = new Date(data.user.createdAt);
const now = new Date();

const stats = {
  contributions: collection.contributionCalendar.totalContributions,
  merged: data.merged.issueCount,
  years: Math.floor((now - joined) / (365.25 * 24 * 60 * 60 * 1000)),
  since: joined.getUTCFullYear(),
  releases: [latestRelease(data.axx), latestRelease(data.stormbreaker)].filter(Boolean),
  languages: topLanguages(collection.commitContributionsByRepository),
  updated: shortDate(now.toISOString(), { year: 'numeric' }),
};

await mkdir(outputDir, { recursive: true });
for (const [theme, colors] of Object.entries(THEMES)) {
  await writeFile(join(outputDir, `stats-${theme}.svg`), renderCard(colors, stats));
}
console.log(stats);
