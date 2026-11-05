// SPEC 7.3: sütun-öncelikli 4×4 matristen Euler açıları (derece). İşaretler /debug/landmarks'ta doğrulanır.
const deg = (r: number) => (r * 180) / Math.PI;

export type Pose = { pitch: number; yaw: number; roll: number };

export function eulerFromMatrix(m: ArrayLike<number>): Pose {
  const r00 = m[0],
    r10 = m[1],
    r20 = m[2],
    r21 = m[6],
    r22 = m[10];
  return {
    pitch: deg(Math.atan2(r21, r22)),
    yaw: deg(Math.atan2(-r20, Math.hypot(r21, r22))),
    roll: deg(Math.atan2(r10, r00)),
  };
}
