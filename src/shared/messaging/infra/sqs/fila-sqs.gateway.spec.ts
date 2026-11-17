import { ConfigService } from '@nestjs/config';
import { FilaSqsGateway } from './fila-sqs.gateway';

const sendMock = jest.fn();

jest.mock('@aws-sdk/client-sqs', () => ({
  SQSClient: jest.fn().mockImplementation(() => ({ send: sendMock })),
  ReceiveMessageCommand: jest.fn(),
  DeleteMessageCommand: jest.fn(),
  SendMessageCommand: jest.fn(),
}));

describe('FilaSqsGateway', () => {
  beforeEach(() => {
    sendMock.mockReset();
  });

  it('ignora mensagens sem corpo ou receipt handle', async () => {
    sendMock.mockResolvedValue({
      Messages: [{ Body: undefined, ReceiptHandle: 'rh' }],
    });
    const config = {
      get: jest.fn(() => undefined),
    } as unknown as ConfigService;
    const gateway = new FilaSqsGateway(config);
    await expect(gateway.receber('https://sqs.local/in')).resolves.toEqual([]);
  });

  it('recebe e mapeia mensagens da fila', async () => {
    sendMock.mockResolvedValue({
      Messages: [{ Body: '{"ok":true}', ReceiptHandle: 'rh' }],
    });
    const config = {
      get: jest.fn(() => undefined),
    } as unknown as ConfigService;
    const gateway = new FilaSqsGateway(config);
    const mensagens = await gateway.receber('https://sqs.local/in', 1);
    expect(mensagens[0]?.corpo).toContain('ok');
  });

  it('confirma e envia mensagens', async () => {
    sendMock.mockResolvedValue({});
    const config = {
      get: jest.fn(() => undefined),
    } as unknown as ConfigService;
    const gateway = new FilaSqsGateway(config);
    await gateway.confirmar('https://sqs.local/in', 'rh');
    await gateway.enviar('https://sqs.local/in', { ok: true }, 'corr');
    await gateway.enviarCorpoBruto(
      'https://sqs.local/in',
      '{"ok":true}',
      'corr',
    );
    expect(sendMock).toHaveBeenCalledTimes(3);
  });
});
