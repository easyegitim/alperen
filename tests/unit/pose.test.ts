import { describe, expect, it } from "vitest";
import { eulerFromMatrix } from "@/lib/face/pose";

/** Sütun-öncelikli 4×4 döndürme matrisi üretir (R = Rz(roll) · Ry(yaw) · Rx(pitch)). */
function matrix(pitchDeg: number, yawDeg: number, rollDeg: number): number[] {
  const [a, b, c] = [pitchDeg, yawDeg, rollDeg].map((d) => (d * Math.PI) / 180);
  const cx = Math.cos(a), sx = Math.sin(a), cy = Math.cos(b), sy = Math.sin(b), cz = Math.cos(c), sz = Math.sin(c);
  // satır-öncelikli R
  const R = [
    [cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx],
    [sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx],
    [-sy, cy * sx, cy * cx],
  ];
  const m = new Array<number>(16).fill(0);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) m[c * 4 + r] = R[r][c]; // sütun-öncelikli
  m[15] = 1;
  return m;
}

describe("eulerFromMatrix (SPEC 7.3)", () => {
  it("birim matris → 0,0,0", () => {
    const p = eulerFromMatrix(matrix(0, 0, 0));
    expect(p.pitch).toBeCloseTo(0, 6);
    expect(p.yaw).toBeCloseTo(0, 6);
    expect(p.roll).toBeCloseTo(0, 6);
  });
  it("bilinen açıları geri bulur", () => {
    const p = eulerFromMatrix(matrix(7, -12, 4));
    expect(p.pitch).toBeCloseTo(7, 5);
    expect(p.yaw).toBeCloseTo(-12, 5);
    expect(p.roll).toBeCloseTo(4, 5);
  });
  it("Float32Array gibi ArrayLike girdiyi kabul eder", () => {
    const p = eulerFromMatrix(new Float32Array(matrix(0, 20, 0)));
    expect(p.yaw).toBeCloseTo(20, 3);
  });
});
