import { createHmac, createSign, generateKeyPairSync } from 'node:crypto';

export interface ParDeChavesRsa {
  publicKey: string;
  privateKey: string;
}

export function gerarParDeChavesRsa(): ParDeChavesRsa {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publicKey, privateKey };
}

function base64Url(valor: object | Buffer): string {
  const buffer = Buffer.isBuffer(valor)
    ? valor
    : Buffer.from(JSON.stringify(valor));
  return buffer.toString('base64url');
}

/** Assina um JWT RS256 sem depender de biblioteca, só para os testes. */
export function assinarJwtRs256(
  privateKey: string,
  payload: Record<string, unknown>,
  expiraEmSegundos = 300,
): string {
  const agora = Math.floor(Date.now() / 1000);
  const cabecalho = base64Url({ alg: 'RS256', typ: 'JWT' });
  const corpo = base64Url({
    iat: agora,
    exp: agora + expiraEmSegundos,
    ...payload,
  });
  const assinatura = createSign('RSA-SHA256')
    .update(`${cabecalho}.${corpo}`)
    .sign(privateKey);
  return `${cabecalho}.${corpo}.${base64Url(assinatura)}`;
}

/** Token HS256 assinado com o texto da chave pública: o ataque clássico de confusão de algoritmo. */
export function assinarJwtHs256(
  segredo: string,
  payload: Record<string, unknown>,
): string {
  const agora = Math.floor(Date.now() / 1000);
  const cabecalho = base64Url({ alg: 'HS256', typ: 'JWT' });
  const corpo = base64Url({ iat: agora, exp: agora + 300, ...payload });
  const assinatura = createHmac('sha256', segredo)
    .update(`${cabecalho}.${corpo}`)
    .digest();
  return `${cabecalho}.${corpo}.${base64Url(assinatura)}`;
}
