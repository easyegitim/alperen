/**
 * Sahte sağlayıcı: zincir mantığı (düşüş, cooldown, onarım) gerçek sağlayıcı kimlikleriyle sınanabilsin
 * diye her sağlayıcı kimliği için bir `FakeProvider` kurulur ve hepsi tek bir `FakeBackend`'e bağlanır.
 * Arka uç (fixtures/llm/<amaç>/*.json seçim kuralı §2.3) `test/fakes/providers.ts`'tedir.
 */
import type { CompleteRequest, CompleteResult, Provider, ProviderId } from './types.ts';

export interface FakeBackend {
  complete(providerId: ProviderId, req: CompleteRequest): Promise<CompleteResult>;
}

export class FakeProvider implements Provider {
  constructor(
    readonly id: ProviderId,
    readonly paid: boolean,
    private readonly backend: FakeBackend,
  ) {}

  complete(req: CompleteRequest): Promise<CompleteResult> {
    return this.backend.complete(this.id, req);
  }
}
