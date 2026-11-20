export interface JwtPayload {
  sub: string;
  email?: string;
  perfil: string;
  iss?: string;
  aud?: string | string[];
  iat?: number;
  exp?: number;
}

export interface RequisicaoAutenticada {
  headers: { authorization?: string };
  user?: JwtPayload;
  params?: Record<string, string>;
}
