// base64 → Blob, fetch("data:…") kullanmadan (CSP connect-src data: izin vermez; SPEC 16.4). Saf; birim testli.
export function base64ToBlob(base64: string, mimeType: string): Blob {
  const bin = atob(base64.replace(/^data:[^,]*,/, "").replace(/\s+/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}
