/** P4 tarz kütüphanesi işleri (kayıt defterine tek satırla girer): alım + kümeleme, tarza özel üretim, kapsama yenilemesi. */
import type { AnyJobDefinition } from './types.js';
import { styleCoverageRefreshJob } from './style-coverage-refresh.js';
import { styleIngestJob } from './style-ingest.js';
import { styleQuestionGenJob } from './style-question-gen.js';

/** ingest_exam_source (0037) style.ingest atar; style.ingest → style.coverage.refresh → style.question_gen. */
export const STYLE_JOBS: readonly AnyJobDefinition[] = [styleIngestJob, styleCoverageRefreshJob, styleQuestionGenJob];
/** Açık olması zorunlu kuyruklar (startup-checks REQUIRED_QUEUES). */
export const STYLE_QUEUES = ['style.ingest', 'style.coverage.refresh', 'style.question_gen'] as const;
