import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type { JwtPayload, RequisicaoAutenticada } from '../jwt-payload';
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
    private readonly configService: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const rotaPublica = this.reflector.getAllAndOverride<boolean>(
      IS_PUBLIC_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (rotaPublica) return true;

    const request = context.switchToHttp().getRequest<RequisicaoAutenticada>();
    const token = this.extrairToken(request);
    if (!token) {
      throw new UnauthorizedException('Token de autenticação não fornecido.');
    }

    try {
      const payload = await this.verificarToken(token);
      this.validarClaims(payload);
      request.user = payload;
    } catch {
      throw new UnauthorizedException('Token inválido ou expirado.');
    }

    return true;
  }

  private async verificarToken(token: string): Promise<JwtPayload> {
    // A chave pública vem do JwtModule; o Execution nunca emite tokens (D6.3).
    return this.jwtService.verifyAsync<JwtPayload>(token, {
      algorithms: ['RS256'],
    });
  }

  private validarClaims(payload: JwtPayload): void {
    if (!payload.sub || !payload.perfil) {
      throw new UnauthorizedException('Token sem identificação do usuário.');
    }

    const emissor = this.configService.get<string>('JWT_ISSUER');
    if (emissor && payload.iss !== emissor) {
      throw new UnauthorizedException('Issuer inválido.');
    }

    const audiencia = this.configService.get<string>('JWT_AUDIENCE');
    if (audiencia) {
      const audiencias = Array.isArray(payload.aud)
        ? payload.aud
        : payload.aud
          ? [payload.aud]
          : [];
      if (!audiencias.includes(audiencia)) {
        throw new UnauthorizedException('Audience inválida.');
      }
    }
  }

  private extrairToken(request: RequisicaoAutenticada): string | undefined {
    const [tipo, token] = request.headers.authorization?.split(' ') ?? [];
    return tipo === 'Bearer' ? token : undefined;
  }
}
