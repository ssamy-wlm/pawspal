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

describe('screens and components use the theme, not hard-coded colours', () => {
  const files = (d: string): string[] =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(d, e.name)) : [join(d, e.name)]));
  const source = [...files(join(__dirname, '..', 'app')), ...files(join(__dirname, '..', 'src', 'components')), join(__dirname, '..', 'src', 'theme', 'index.tsx')]
    .filter((f) => /\.tsx?$/.test(f));

  it('checks the files it should', () => {
    expect(source.length).toBeGreaterThan(30);
  });

  it.each(source)('%s has no hex or rgb colours', (file) => {
    const code = readFileSync(file, 'utf8');
    expect(code.match(/#[0-9A-Fa-f]{3,8}\b/g) ?? []).toEqual([]);
    expect(code.match(/\brgba?\(/g) ?? []).toEqual([]);
  });

  it('has no hard-coded font names outside the theme', () => {
    for (const file of source.filter((f) => !f.endsWith(join('theme', 'index.tsx')) && !f.endsWith('_layout.tsx'))) {
      expect([file, /['"](Poppins|Cairo)_\d+['"]/.test(readFileSync(file, 'utf8'))]).toEqual([file, false]);
    }
  });
});
