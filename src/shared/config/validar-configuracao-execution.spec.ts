import { validarConfiguracaoExecution } from './validar-configuracao-execution';

describe('validarConfiguracaoExecution', () => {
  const baseDev: Record<string, string> = {
    NODE_ENV: 'development',
    SQS_VISIBILITY_TIMEOUT_SECONDS: '720',
    OUTBOX_REIVINDICACAO_MS: '480000',
    TERMINATION_GRACE_PERIOD_SECONDS: '720',
  };

  it('aceita configuração de desenvolvimento mínima', () => {
    expect(() => validarConfiguracaoExecution(baseDev)).not.toThrow();
  });

  it('recusa JWT_SECRET legado', () => {
    expect(() =>
      validarConfiguracaoExecution({ ...baseDev, JWT_SECRET: 'x' }),
    ).toThrow(/JWT_SECRET/);
  });

  it('recusa flag de processador inválida', () => {
    expect(() =>
      validarConfiguracaoExecution({
        ...baseDev,
        SQS_CONSUMER_HABILITADO: 'sim',
      }),
    ).toThrow(/SQS_CONSUMER_HABILITADO/);
  });

  it('recusa prazos incoerentes', () => {
    expect(() =>
      validarConfiguracaoExecution({
        ...baseDev,
        OUTBOX_REIVINDICACAO_MS: '1000',
      }),
    ).toThrow(/OUTBOX_REIVINDICACAO_MS/);
  });

  it('em produção exige segredos obrigatórios', () => {
    expect(() =>
      validarConfiguracaoExecution({
        ...baseDev,
        NODE_ENV: 'production',
      }),
    ).toThrow(/JWT_PUBLIC_KEY/);
  });

  it('recusa visibilidade abaixo do pior caso', () => {
    expect(() =>
      validarConfiguracaoExecution({
        ...baseDev,
        SQS_VISIBILITY_TIMEOUT_SECONDS: '30',
      }),
    ).toThrow(/SQS_VISIBILITY_TIMEOUT_SECONDS/);
  });

  it('recusa deadline SQS menor que long polling', () => {
    expect(() =>
      validarConfiguracaoExecution({
        ...baseDev,
        SQS_OPERATION_DEADLINE_MS: '5000',
        SQS_LONG_POLL_SECONDS: '10',
      }),
    ).toThrow(/SQS_OPERATION_DEADLINE_MS/);
  });
});
