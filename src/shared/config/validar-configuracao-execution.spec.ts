import { validarConfiguracaoExecution } from './validar-configuracao-execution';

describe('validarConfiguracaoExecution', () => {
  const baseDev: Record<string, string> = {
    NODE_ENV: 'development',
    SQS_VISIBILITY_TIMEOUT_SECONDS: '720',
    OUTBOX_REIVINDICACAO_MS: '480000',
    TERMINATION_GRACE_PERIOD_SECONDS: '850',
    OUTBOX_GSI_MAX_PAGINAS: '8',
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

  it('recusa grace period abaixo do pior caso de encerramento', () => {
    expect(() =>
      validarConfiguracaoExecution({
        ...baseDev,
        TERMINATION_GRACE_PERIOD_SECONDS: '60',
      }),
    ).toThrow(/TERMINATION_GRACE_PERIOD_SECONDS/);
  });

  it('aceita configuração de produção completa sem expor segredos na mensagem', () => {
    const chave = `-----BEGIN PUBLIC KEY-----\nMIIB\n-----END PUBLIC KEY-----`;
    expect(() =>
      validarConfiguracaoExecution({
        NODE_ENV: 'production',
        JWT_PUBLIC_KEY: chave,
        JWT_ISSUER: 'oficina',
        JWT_AUDIENCE: 'execution',
        OS_SERVICE_TOKEN: 'token-sintetico',
        OS_SERVICE_BASE_URL: 'http://os.svc',
        SQS_EXECUTION_IN_URL: 'https://sqs.aws/in',
        SQS_EXECUTION_IN_DLQ_URL: 'https://sqs.aws/dlq',
        SQS_OS_IN_URL: 'https://sqs.aws/os',
        DYNAMODB_TAREFAS_TABLE: 'tarefas',
        DYNAMODB_OUTBOX_TABLE: 'outbox',
        DYNAMODB_MENSAGENS_PROCESSADAS_TABLE: 'proc',
        SQS_VISIBILITY_TIMEOUT_SECONDS: '720',
        OUTBOX_REIVINDICACAO_MS: '480000',
        TERMINATION_GRACE_PERIOD_SECONDS: '850',
        OUTBOX_GSI_MAX_PAGINAS: '8',
      }),
    ).not.toThrow();
  });

  it('recusa OS_SERVICE_TOKEN ausente em produção', () => {
    const chave = `-----BEGIN PUBLIC KEY-----\nMIIB\n-----END PUBLIC KEY-----`;
    let mensagem = '';
    try {
      validarConfiguracaoExecution({
        NODE_ENV: 'production',
        JWT_PUBLIC_KEY: chave,
        JWT_ISSUER: 'oficina',
        JWT_AUDIENCE: 'execution',
        OS_SERVICE_BASE_URL: 'http://os.svc',
        SQS_EXECUTION_IN_URL: 'https://sqs.aws/in',
        SQS_EXECUTION_IN_DLQ_URL: 'https://sqs.aws/dlq',
        SQS_OS_IN_URL: 'https://sqs.aws/os',
        DYNAMODB_TAREFAS_TABLE: 'tarefas',
        DYNAMODB_OUTBOX_TABLE: 'outbox',
        DYNAMODB_MENSAGENS_PROCESSADAS_TABLE: 'proc',
        SQS_VISIBILITY_TIMEOUT_SECONDS: '720',
        OUTBOX_REIVINDICACAO_MS: '480000',
        TERMINATION_GRACE_PERIOD_SECONDS: '850',
        OUTBOX_GSI_MAX_PAGINAS: '8',
      });
    } catch (erro) {
      mensagem = erro instanceof Error ? erro.message : String(erro);
    }
    expect(mensagem).toMatch(/OS_SERVICE_TOKEN/);
    expect(mensagem).not.toContain('token-sintetico');
  });

  it('recusa JWT_PUBLIC_KEY inválida em produção', () => {
    expect(() =>
      validarConfiguracaoExecution({
        NODE_ENV: 'production',
        JWT_PUBLIC_KEY: 'nao-pem',
        JWT_ISSUER: 'oficina',
        JWT_AUDIENCE: 'execution',
        OS_SERVICE_TOKEN: 'x',
        OS_SERVICE_BASE_URL: 'http://os.svc',
        SQS_EXECUTION_IN_URL: 'https://sqs.aws/in',
        SQS_EXECUTION_IN_DLQ_URL: 'https://sqs.aws/dlq',
        SQS_OS_IN_URL: 'https://sqs.aws/os',
        DYNAMODB_TAREFAS_TABLE: 'tarefas',
        DYNAMODB_OUTBOX_TABLE: 'outbox',
        DYNAMODB_MENSAGENS_PROCESSADAS_TABLE: 'proc',
        SQS_VISIBILITY_TIMEOUT_SECONDS: '720',
        OUTBOX_REIVINDICACAO_MS: '480000',
        TERMINATION_GRACE_PERIOD_SECONDS: '850',
        OUTBOX_GSI_MAX_PAGINAS: '8',
      }),
    ).toThrow(/JWT_PUBLIC_KEY/);
  });

  it('recusa OUTBOX_GSI_MAX_PAGINAS inválido', () => {
    expect(() =>
      validarConfiguracaoExecution({
        ...baseDev,
        OUTBOX_GSI_MAX_PAGINAS: '0',
      }),
    ).toThrow(/OUTBOX_GSI_MAX_PAGINAS|maior que zero/);
    expect(() =>
      validarConfiguracaoExecution({
        ...baseDev,
        OUTBOX_GSI_MAX_PAGINAS: '1.5',
      }),
    ).toThrow(/inteiro positivo/);
  });

  it('recusa grace period abaixo do pior caso recalculado', () => {
    expect(() =>
      validarConfiguracaoExecution({
        ...baseDev,
        TERMINATION_GRACE_PERIOD_SECONDS: '720',
      }),
    ).toThrow(/TERMINATION_GRACE_PERIOD_SECONDS/);
  });

  it('recusa DYNAMODB_ENDPOINT em produção', () => {
    const chave = `-----BEGIN PUBLIC KEY-----\nMIIB\n-----END PUBLIC KEY-----`;
    expect(() =>
      validarConfiguracaoExecution({
        NODE_ENV: 'production',
        JWT_PUBLIC_KEY: chave,
        JWT_ISSUER: 'oficina',
        JWT_AUDIENCE: 'execution',
        OS_SERVICE_TOKEN: 'x',
        OS_SERVICE_BASE_URL: 'http://os.svc',
        DYNAMODB_ENDPOINT: 'http://localhost:8000',
        SQS_EXECUTION_IN_URL: 'https://sqs.aws/in',
        SQS_EXECUTION_IN_DLQ_URL: 'https://sqs.aws/dlq',
        SQS_OS_IN_URL: 'https://sqs.aws/os',
        DYNAMODB_TAREFAS_TABLE: 'tarefas',
        DYNAMODB_OUTBOX_TABLE: 'outbox',
        DYNAMODB_MENSAGENS_PROCESSADAS_TABLE: 'proc',
        SQS_VISIBILITY_TIMEOUT_SECONDS: '720',
        OUTBOX_REIVINDICACAO_MS: '480000',
        TERMINATION_GRACE_PERIOD_SECONDS: '850',
        OUTBOX_GSI_MAX_PAGINAS: '8',
      }),
    ).toThrow(/DYNAMODB_ENDPOINT/);
  });
});
