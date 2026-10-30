// core.js için tip bildirimleri (çekirdek düz JavaScript'tir; scripts/gen.ts metnini gömer).

export declare function ogrNormalizeTr(text: string): string;
export declare function ogrForbiddenStems(word: string): string[];
export declare function ogrContainsForbidden(text: string, word: string): boolean;
export declare function ogrFindForbiddenWord(data: unknown, words: readonly string[]): string | null;
export declare function ogrUcs2length(str: string): number;
export declare function ogrFormatDate(str: string): boolean;
export declare function ogrFormatTime(str: string): boolean;
export declare function ogrFormatDateTime(str: string): boolean;
export declare function ogrFormatUuid(str: string): boolean;
export declare function ogrFormatUri(str: string): boolean;
export declare const ogrFormats: {
  readonly date: (str: string) => boolean;
  readonly 'date-time': (str: string) => boolean;
  readonly uri: (str: string) => boolean;
  readonly uuid: (str: string) => boolean;
};
