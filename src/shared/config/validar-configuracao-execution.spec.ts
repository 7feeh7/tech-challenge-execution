import { validarConfiguracaoExecution } from './validar-configuracao-execution';

describe('validarConfiguracaoExecution', () => {
  const baseDev: Record<string, string> = {
    NODE_ENV: 'development',
    SQS_VISIBILITY_TIMEOUT_SECONDS: '720',
    OUTBOX_REIVINDICACAO_MS: '480000',
    TERMINATION_GRACE_PERIOD_SECONDS: '870',
    OUTBOX_GSI_MAX_PAGINAS: '8',
    DYNAMODB_OPERATION_DEADLINE_MS: '12000',
    SQS_OPERATION_DEADLINE_MS: '45000',
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
        TERMINATION_GRACE_PERIOD_SECONDS: '870',
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
        TERMINATION_GRACE_PERIOD_SECONDS: '870',
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
        TERMINATION_GRACE_PERIOD_SECONDS: '870',
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
        TERMINATION_GRACE_PERIOD_SECONDS: '870',
        OUTBOX_GSI_MAX_PAGINAS: '8',
      }),
    ).toThrow(/DYNAMODB_ENDPOINT/);
  });

  describe('mesma fórmula do cálculo de prazos', () => {
    it('aceita o grace period exatamente no mínimo calculado e recusa 1 s abaixo', () => {
      expect(() =>
        validarConfiguracaoExecution({
          ...baseDev,
          TERMINATION_GRACE_PERIOD_SECONDS: '864',
        }),
      ).not.toThrow();
      expect(() =>
        validarConfiguracaoExecution({
          ...baseDev,
          TERMINATION_GRACE_PERIOD_SECONDS: '863',
        }),
      ).toThrow(/TERMINATION_GRACE_PERIOD_SECONDS \(863\).*\(864\)/);
    });

    it('aceita o lease exatamente no mínimo calculado e recusa 1 ms abaixo', () => {
      expect(() =>
        validarConfiguracaoExecution({
          ...baseDev,
          OUTBOX_REIVINDICACAO_MS: '435000',
        }),
      ).not.toThrow();
      expect(() =>
        validarConfiguracaoExecution({
          ...baseDev,
          OUTBOX_REIVINDICACAO_MS: '434999',
        }),
      ).toThrow(/OUTBOX_REIVINDICACAO_MS \(434999\).*\(435000\)/);
    });

    it('recusa a partida sem OUTBOX_REIVINDICACAO_MS: o default de runtime (300000) é menor que o mínimo', () => {
      const { OUTBOX_REIVINDICACAO_MS: _ausente, ...semLease } = baseDev;
      expect(() =>
        validarConfiguracaoExecution({ ...semLease, NODE_ENV: 'production' }),
      ).toThrow(/OUTBOX_REIVINDICACAO_MS \(300000\).*\(435000\)/);
    });

    it('aceita a visibilidade exatamente no mínimo calculado e recusa 1 s abaixo', () => {
      expect(() =>
        validarConfiguracaoExecution({
          ...baseDev,
          SQS_VISIBILITY_TIMEOUT_SECONDS: '633',
        }),
      ).not.toThrow();
      expect(() =>
        validarConfiguracaoExecution({
          ...baseDev,
          SQS_VISIBILITY_TIMEOUT_SECONDS: '632',
        }),
      ).toThrow(/SQS_VISIBILITY_TIMEOUT_SECONDS \(632\).*\(633\)/);
    });

    it('recalcula os mínimos com OUTBOX_GSI_MAX_PAGINAS, lotes e deadlines informados', () => {
      // 16 páginas: ciclo do publicador = 192000 + 405000 + 192000 = 789000,
      // acima do consumidor (603000); encerramento = 789000 + 159000 + 72000 + 30000 = 1050000.
      expect(() =>
        validarConfiguracaoExecution({
          ...baseDev,
          OUTBOX_GSI_MAX_PAGINAS: '16',
          TERMINATION_GRACE_PERIOD_SECONDS: '1049',
        }),
      ).toThrow(/TERMINATION_GRACE_PERIOD_SECONDS \(1049\).*\(1050\)/);
      expect(() =>
        validarConfiguracaoExecution({
          ...baseDev,
          OUTBOX_GSI_MAX_PAGINAS: '16',
          TERMINATION_GRACE_PERIOD_SECONDS: '1050',
        }),
      ).not.toThrow();

      expect(() =>
        validarConfiguracaoExecution({
          ...baseDev,
          OUTBOX_PUBLISHER_LOTE: '10',
          OUTBOX_REIVINDICACAO_MS: '480000',
        }),
      ).toThrow(/OUTBOX_REIVINDICACAO_MS \(480000\).*\(840000\)/);

      expect(() =>
        validarConfiguracaoExecution({
          ...baseDev,
          DYNAMODB_OPERATION_DEADLINE_MS: '20000',
        }),
      ).toThrow(/OUTBOX_REIVINDICACAO_MS/);
    });
  });
  describe('deadlines AWS derivados como no runtime', () => {
    const {
      DYNAMODB_OPERATION_DEADLINE_MS: _d,
      SQS_OPERATION_DEADLINE_MS: _s,
      ...semDeadlines
    } = baseDev;
    // Lease e visibilidade folgados: só o encerramento (ou o termo sob teste) pode recusar.
    const producaoSemDeadlines = {
      ...semDeadlines,
      NODE_ENV: 'production',
      OUTBOX_REIVINDICACAO_MS: '2000000',
      SQS_VISIBILITY_TIMEOUT_SECONDS: '2000',
    };

    it('recusa produção sem DYNAMODB_OPERATION_DEADLINE_MS quando AWS_SDK_MAX_ATTEMPTS eleva o deadline derivado (4000 × 10 = 40000 ms)', () => {
      expect(() =>
        validarConfiguracaoExecution({
          ...producaoSemDeadlines,
          SQS_OPERATION_DEADLINE_MS: '45000',
          AWS_SDK_MAX_ATTEMPTS: '10',
        }),
      ).toThrow(/TERMINATION_GRACE_PERIOD_SECONDS \(870\).*\(2090\)/);
    });

    it('recusa produção sem SQS_OPERATION_DEADLINE_MS quando as tentativas elevam o deadline derivado (12000 × 10 = 120000 ms)', () => {
      expect(() =>
        validarConfiguracaoExecution({
          ...semDeadlines,
          NODE_ENV: 'production',
          DYNAMODB_OPERATION_DEADLINE_MS: '12000',
          AWS_SDK_MAX_ATTEMPTS: '10',
        }),
      ).toThrow(/OUTBOX_REIVINDICACAO_MS \(480000\).*\(810000\)/);
    });

    it('deriva o deadline SQS de SQS_REQUEST_TIMEOUT_MS, e SQS_HTTP_ATTEMPT_TIMEOUT_MS tem precedência', () => {
      const ambiente = {
        ...semDeadlines,
        NODE_ENV: 'production',
        DYNAMODB_OPERATION_DEADLINE_MS: '12000',
      };
      expect(() =>
        validarConfiguracaoExecution({
          ...ambiente,
          SQS_REQUEST_TIMEOUT_MS: '30000',
        }),
      ).toThrow(/OUTBOX_REIVINDICACAO_MS \(480000\).*\(660000\)/);
      expect(() =>
        validarConfiguracaoExecution({
          ...ambiente,
          SQS_REQUEST_TIMEOUT_MS: '30000',
          SQS_HTTP_ATTEMPT_TIMEOUT_MS: '12000',
        }),
      ).not.toThrow(/OUTBOX_REIVINDICACAO_MS/);
    });

    it('deriva o deadline DynamoDB de DYNAMODB_HTTP_ATTEMPT_TIMEOUT_MS × tentativas', () => {
      expect(() =>
        validarConfiguracaoExecution({
          ...baseDev,
          DYNAMODB_OPERATION_DEADLINE_MS: undefined as unknown as string,
          DYNAMODB_HTTP_ATTEMPT_TIMEOUT_MS: '8000',
        }),
      ).toThrow(/OUTBOX_REIVINDICACAO_MS \(480000\)/);
    });

    it('deadlines explícitos determinam o cálculo independentemente das tentativas', () => {
      expect(() =>
        validarConfiguracaoExecution({
          ...baseDev,
          AWS_SDK_MAX_ATTEMPTS: '10',
          DYNAMODB_HTTP_ATTEMPT_TIMEOUT_MS: '9000',
          SQS_HTTP_ATTEMPT_TIMEOUT_MS: '30000',
        }),
      ).not.toThrow();
      expect(() =>
        validarConfiguracaoExecution({
          ...baseDev,
          AWS_SDK_MAX_ATTEMPTS: '1',
          TERMINATION_GRACE_PERIOD_SECONDS: '863',
        }),
      ).toThrow(/\(863\).*\(864\)/);
    });

    it('recusa AWS_SDK_MAX_ATTEMPTS que não é inteiro positivo', () => {
      for (const invalido of ['3.5', 'dez', '0']) {
        expect(() =>
          validarConfiguracaoExecution({
            ...baseDev,
            AWS_SDK_MAX_ATTEMPTS: invalido,
          }),
        ).toThrow(/AWS_SDK_MAX_ATTEMPTS/);
      }
    });
  });
});
