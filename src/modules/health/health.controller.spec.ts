import { HealthController } from './health.controller';

describe('HealthController', () => {
  const controller = new HealthController();

  it('liveness responde ok', () => {
    expect(controller.liveness()).toEqual({ status: 'ok' });
  });

  it('readiness responde ok', () => {
    expect(controller.readiness()).toEqual({ status: 'ok' });
  });
});
