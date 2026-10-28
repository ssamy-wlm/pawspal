import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..', '..', '..');

describe('shared design files', () => {
  it('keeps the app copy of the tokens identical to design/tokens.json', () => {
    const source = readFileSync(join(root, 'design/tokens.json'), 'utf8');
    const copy = readFileSync(join(__dirname, '..', 'src/theme/tokens.json'), 'utf8');
    expect(JSON.parse(copy)).toEqual(JSON.parse(source));
  });

  it('generates the illustrations and legal bundles', () => {
    const svg = readFileSync(join(__dirname, '..', 'src/illustrations/index.ts'), 'utf8');
    const legal = readFileSync(join(__dirname, '..', 'src/legal/index.ts'), 'utf8');
    expect(svg).toContain('pawspalIcon');
    expect(legal).toContain('termsOfService');
    expect(legal).toContain('privacyPolicy');
    expect(legal).toContain('communityGuidelines');
  });
});

describe('screens use the theme, not hard-coded colours', () => {
  const dir = join(__dirname, '..', 'app');
  const files = (d: string): string[] =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(d, e.name)) : [join(d, e.name)]));

  it.each(files(dir).filter((f) => f.endsWith('.tsx')))('%s has no hex colours', (file) => {
    const code = readFileSync(file, 'utf8');
    expect(code.match(/#[0-9A-Fa-f]{3,8}\b/g) ?? []).toEqual([]);
  });
});
