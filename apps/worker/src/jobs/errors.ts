/** Yeniden denenmesi anlamsız hata (yapılandırma eksik, geçersiz yük, bulunamayan kayıt): iş dead_letter kuyruğuna gider. */
export class PermanentJobError extends Error {
  constructor(
    message: string,
    readonly code: string = 'OGR-JOB-100',
  ) {
    super(message);
    this.name = 'PermanentJobError';
  }
}
