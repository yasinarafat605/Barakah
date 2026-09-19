import fs from 'fs';
import path from 'path';

const projectRoot = path.resolve(__dirname, '../../..');

function collectTypeScriptFiles(relativePath: string): string[] {
  const absolutePath = path.join(projectRoot, relativePath);
  if (!fs.existsSync(absolutePath)) return [];
  if (fs.statSync(absolutePath).isFile()) return [absolutePath];
  return fs.readdirSync(absolutePath, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === '__tests__' || entry.name === 'migrations') return [];
    const child = path.join(absolutePath, entry.name);
    return entry.isDirectory()
      ? collectTypeScriptFiles(path.relative(projectRoot, child))
      : /\.tsx?$/.test(entry.name) ? [child] : [];
  });
}

const auditedFiles = [
  ...collectTypeScriptFiles('src/domain'),
  ...collectTypeScriptFiles('src/db'),
  ...collectTypeScriptFiles('app/(tabs)/accounts.tsx'),
  ...collectTypeScriptFiles('app/(tabs)/transactions.tsx'),
  ...collectTypeScriptFiles('app/modal.tsx'),
  ...collectTypeScriptFiles('app/debts'),
  ...collectTypeScriptFiles('app/counterparties'),
  ...collectTypeScriptFiles('app/plan'),
];

const prohibitedMoneyPatterns: [string, RegExp][] = [
  ['parseFloat', /\bparseFloat\s*\(/],
  ['decimal toFixed', /\.toFixed\s*\(/],
  ['floating-point rounding', /\bMath\.(?:round|floor|ceil)\s*\(/],
  ['major/minor division by 100', /\/\s*100\b/],
  ['major/minor multiplication by 100', /\*\s*100\b/],
  ['removed Money.fromMajorUnits API', /\bfromMajorUnits\s*\(/],
  ['removed Money.toMajorUnits API', /\btoMajorUnits\s*\(/],
  ['removed Money.multiply API', /\.multiply\s*\(/],
  ['decimal-string Number conversion', /\bNumber\s*\(\s*(?:(?:decimal|normalized|raw|input)(?:String|Text|Value|Str)\b|['"][+-]?\d+[.,]\d)/],
];

describe('Monetary application source integrity', () => {
  it('audits the intended financial application surfaces', () => {
    expect(auditedFiles.length).toBeGreaterThan(20);
  });

  it.each(auditedFiles.map((file) => [path.relative(projectRoot, file), file]))(
    '%s contains no prohibited floating-point monetary pattern',
    (_relativePath, absolutePath) => {
      const source = fs.readFileSync(absolutePath, 'utf8');
      for (const [description, pattern] of prohibitedMoneyPatterns) {
        expect({ description, match: source.match(pattern)?.[0] }).toEqual({ description, match: undefined });
      }
    }
  );
});
