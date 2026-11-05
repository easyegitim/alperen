import { createHmac, randomBytes } from "node:crypto";

// IYZWSv2 (resmi iyzipay-node SDK utils.generateHashV2 ile birebir):
//   signature = HMAC_SHA256(secretKey, randomKey + uriPath + JSON.stringify(body)) hex
//   Authorization: IYZWSv2 base64("apiKey:<key>&randomKey:<rnd>&signature:<hex>")
export function buildAuthorization(apiKey: string, secretKey: string, uriPath: string, bodyJson: string, randomKey: string): string {
  const signature = createHmac("sha256", secretKey).update(randomKey + uriPath + bodyJson).digest("hex");
  return `IYZWSv2 ${Buffer.from([`apiKey:${apiKey}`, `randomKey:${randomKey}`, `signature:${signature}`].join("&")).toString("base64")}`;
}

export function randomKey(): string {
  return `${Math.floor(Date.now() / 1000)}${randomBytes(6).toString("hex")}`;
}
