# packages/llm/fixtures

`FakeTransport` (`OGRENMEN_LLM=fake`) için v2 rota fikstürleri. Dizin adı rota adıdır (`src/routes.ts`
`ROUTE_NAMES`): `<rota>.json` ya da `<rota>/*.json`. Dosyalar adlarına göre sıralanır, rotanın sözleşmesine
(`@ogrenmen/contracts`) uyan ilk dosya döner. `bad-*` ve `injection*` adlı dosyalar atlanır. Fikstür yoksa
sözleşmenin `fixtures/<şema>/valid/*.json` örneği, o da yoksa şemadan üretilen en küçük örnek kullanılır.

Sahte taşıma yalnız bu dizini okur; `OGRENMEN_LLM_FIXTURES` başka bir dizine yönlendirir.
