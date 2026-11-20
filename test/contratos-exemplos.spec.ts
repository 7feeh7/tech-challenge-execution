import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const exemplosDir = join(__dirname, '..', 'docs', 'contratos', 'exemplos');

describe('Exemplos JSON dos contratos do Execution', () => {
  const arquivos = readdirSync(exemplosDir).filter((f) => f.endsWith('.json'));

  it.each(arquivos)('%s é JSON válido e contém eventType', (arquivo) => {
    const conteudo = readFileSync(join(exemplosDir, arquivo), 'utf-8');
    const envelope = JSON.parse(conteudo) as {
      eventType?: string;
      version?: number;
      source?: string;
    };

    expect(envelope.eventType).toMatch(/^execution\./);
    expect(envelope.version).toBe(1);
    expect(typeof envelope.source).toBe('string');
  });
});
