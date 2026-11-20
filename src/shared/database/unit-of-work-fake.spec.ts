import { UnitOfWorkFake } from './unit-of-work-fake';

describe('UnitOfWorkFake', () => {
  it('executa trabalho e registra contexto', async () => {
    const uow = new UnitOfWorkFake();
    await uow.executar(async (ctx) => {
      expect(ctx).toBeDefined();
    });
    expect(uow.contextos.length).toBe(1);
  });

  it('simula falha no commit', async () => {
    const uow = new UnitOfWorkFake();
    await expect(
      uow.executar(async (ctx) => {
        ctx.falharAoConfirmar = true;
      }),
    ).rejects.toThrow('falha simulada no commit');
  });

  it('rejeita transação aninhada', async () => {
    const uow = new UnitOfWorkFake();
    await expect(
      uow.executar(async () => {
        await uow.executar(async () => undefined);
      }),
    ).rejects.toThrow('Transação aninhada');
  });
});
