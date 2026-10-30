// Bu dosya scripts/gen.ts tarafından üretilir; elle düzenlenmez (bun run gen).
// Cevap anahtarı taşıyan sözleşmelerin önceden derlenmiş doğrulayıcıları; yalnız src/answer-key.ts içe alır (Worker alamaz).
/* eslint-disable */
"use strict";
// Öğrenmen sözleşmeleri — çalışma zamanı çekirdeği (bağımlılıksız, düz ESM JavaScript).
//
// Bu dosya iki yerde kullanılır:
//   1. src/forbidden-words.ts ve src/index.ts doğrudan içe alır;
//   2. scripts/gen.ts metnini olduğu gibi src/generated/validators.js içine gömer
//      (Ajv standalone kodu böylece hiçbir require/import taşımaz; Worker yalnız onu yükler).
// Bu yüzden dosyada yalnız "export function" / "export const" bildirimleri bulunur ve
// başka modül içe alınmaz. Python eşleniği: python/ogrenmen_contracts/_core.py.

/**
 * Türkçe duyarlı küçük harfe çevirme ve İ/ı katlama: "TAHMİN", "TAHMIN", "tahmin"
 * aynı metne iner. Sıra: NFC, İ→i, I→ı, küçük harf, birleşik nokta (U+0307) silinir, ı→i.
 */
function ogrNormalizeTr(text) {
  return text
    .normalize('NFC')
    .replace(/İ/g, 'i')
    .replace(/I/g, 'ı')
    .toLowerCase()
    .replace(/̇/g, '')
    .replace(/ı/g, 'i');
}

/**
 * Yasaklı kelimenin aranacak biçimleri: normalize edilmiş kelime ve kelime "k" ile bitiyorsa
 * ünsüz yumuşaması (k → ğ) uğramış gövdesi ("çıkacak" → "çıkacağ": "çıkacağı", "çıkacağını").
 */
function ogrForbiddenStems(word) {
  const needle = ogrNormalizeTr(word);
  if (needle.length === 0) return [];
  return needle.endsWith('k') ? [needle, needle.slice(0, -1) + 'ğ'] : [needle];
}

/**
 * Kelime normalize edilmiş metnin herhangi bir yerinde geçiyor mu (BLUEPRINT §4: "geçerse"
 * düşer). Düz alt dize araması: "tahminen", "öntahmin", "TAHMİN" hepsi yakalanır.
 */
function ogrContainsForbidden(text, word) {
  const hay = ogrNormalizeTr(text);
  for (const stem of ogrForbiddenStems(word)) {
    if (hay.includes(stem)) return true;
  }
  return false;
}

/**
 * x-forbidden-words denetimi: verideki tüm metin DEĞERLERİNİ (anahtarlar hariç) derinlik
 * öncelikli gezer; ilk eşleşen yasaklı kelimeyi (listedeki yazımıyla) döner, yoksa null.
 */
function ogrFindForbiddenWord(data, words) {
  if (typeof data === 'string') {
    for (const w of words) {
      if (ogrContainsForbidden(data, w)) return w;
    }
    return null;
  }
  if (Array.isArray(data)) {
    for (const item of data) {
      const hit = ogrFindForbiddenWord(item, words);
      if (hit !== null) return hit;
    }
    return null;
  }
  if (data !== null && typeof data === 'object') {
    for (const key of Object.keys(data)) {
      const hit = ogrFindForbiddenWord(data[key], words);
      if (hit !== null) return hit;
    }
  }
  return null;
}

/** Dizenin kod noktası sayısı (Ajv runtime/ucs2length ile aynı; Python len() ile eşit). */
function ogrUcs2length(str) {
  const len = str.length;
  let length = 0;
  let pos = 0;
  let value;
  while (pos < len) {
    length++;
    value = str.charCodeAt(pos++);
    if (value >= 0xd800 && value <= 0xdbff && pos < len) {
      value = str.charCodeAt(pos);
      if ((value & 0xfc00) === 0xdc00) pos++;
    }
  }
  return length;
}

// --- Biçimler (format): ajv-formats "full" kipinin uuid/date/date-time/uri tanımlarıyla aynı ---

const OGR_UUID = /^(?:urn:uuid:)?[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const OGR_DATE = /^(\d\d\d\d)-(\d\d)-(\d\d)$/;
const OGR_DAYS = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const OGR_TIME = /^(\d\d):(\d\d):(\d\d(?:\.\d+)?)(z|([+-])(\d\d)(?::?(\d\d))?)?$/i;
const OGR_NOT_URI_FRAGMENT = /\/|:/;
const OGR_URI = /^(?:[a-z][a-z0-9+\-.]*:)(?:\/?\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:]|%[0-9a-f]{2})*@)?(?:\[(?:(?:(?:(?:[0-9a-f]{1,4}:){6}|::(?:[0-9a-f]{1,4}:){5}|(?:[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){4}|(?:(?:[0-9a-f]{1,4}:){0,1}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){3}|(?:(?:[0-9a-f]{1,4}:){0,2}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){2}|(?:(?:[0-9a-f]{1,4}:){0,3}[0-9a-f]{1,4})?::[0-9a-f]{1,4}:|(?:(?:[0-9a-f]{1,4}:){0,4}[0-9a-f]{1,4})?::)(?:[0-9a-f]{1,4}:[0-9a-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?))|(?:(?:[0-9a-f]{1,4}:){0,5}[0-9a-f]{1,4})?::[0-9a-f]{1,4}|(?:(?:[0-9a-f]{1,4}:){0,6}[0-9a-f]{1,4})?::)|[Vv][0-9a-f]+\.[a-z0-9\-._~!$&'()*+,;=:]+)\]|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)|(?:[a-z0-9\-._~!$&'()*+,;=]|%[0-9a-f]{2})*)(?::\d*)?(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*|\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*)?|(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*)(?:\?(?:[a-z0-9\-._~!$&'()*+,;=:@/?]|%[0-9a-f]{2})*)?(?:#(?:[a-z0-9\-._~!$&'()*+,;=:@/?]|%[0-9a-f]{2})*)?$/i;

function ogrIsLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

/** RFC 3339 full-date (YYYY-MM-DD; artık yıl denetimli). */
function ogrFormatDate(str) {
  const m = OGR_DATE.exec(str);
  if (!m) return false;
  const year = +m[1];
  const month = +m[2];
  const day = +m[3];
  return month >= 1 && month <= 12 && day >= 1 && day <= (month === 2 && ogrIsLeapYear(year) ? 29 : OGR_DAYS[month]);
}

/** RFC 3339 saat; saat dilimi zorunlu (z ya da ±hh:mm). */
function ogrFormatTime(str) {
  const m = OGR_TIME.exec(str);
  if (!m) return false;
  const hr = +m[1];
  const min = +m[2];
  const sec = +m[3];
  const tz = m[4];
  const tzSign = m[5] === '-' ? -1 : 1;
  const tzH = +(m[6] || 0);
  const tzM = +(m[7] || 0);
  if (tzH > 23 || tzM > 59 || !tz) return false;
  if (hr <= 23 && min <= 59 && sec < 60) return true;
  const utcMin = min - tzM * tzSign;
  const utcHr = hr - tzH * tzSign - (utcMin < 0 ? 1 : 0);
  return (utcHr === 23 || utcHr === -1) && (utcMin === 59 || utcMin === -1) && sec < 61;
}

/** RFC 3339 date-time (ayraç t, T ya da boşluk). */
function ogrFormatDateTime(str) {
  const parts = str.split(/t|\s/i);
  return parts.length === 2 && ogrFormatDate(parts[0]) && ogrFormatTime(parts[1]);
}

/** UUID (RFC 4122 biçimi; büyük/küçük harf duyarsız). */
function ogrFormatUuid(str) {
  return OGR_UUID.test(str);
}

/** Mutlak URI (RFC 3986). */
function ogrFormatUri(str) {
  return OGR_NOT_URI_FRAGMENT.test(str) && OGR_URI.test(str);
}

/** Şemalarda kullanılan biçimlerin tamamı; standalone doğrulayıcılar bu nesneyi kullanır. */
const ogrFormats = {
  date: ogrFormatDate,
  'date-time': ogrFormatDateTime,
  uri: ogrFormatUri,
  uuid: ogrFormatUuid,
};

export const answerKey = validate53;
const schema20 = {"$schema":"https://json-schema.org/draft/2020-12/schema","$id":"https://ogrenmen.easy/schemas/answer-key.json","title":"AnswerKey","description":"Cevap anahtarı: yalnız pipeline/seed ↔ register_answer_key. Worker bu şemayı içe almaz; secure.answer_keys satırının sözleşmesi.","x-version":"1.0","type":"object","additionalProperties":false,"required":["question_id","solution","sympy_status"],"properties":{"question_id":{"$ref":"common.json#/$defs/uuid"},"correct_option":{"$ref":"common.json#/$defs/optionKey"},"numeric_value":{"type":"string","description":"SymPy string: '7/8', '2*sqrt(3)'"},"numeric_tolerance":{"type":"number","minimum":0},"canonical_expr":{"type":"string","description":"sympy.sympify edilebilir ifade; stem_values ile çözülür"},"solution":{"type":"string","minLength":10,"maxLength":2000,"description":"Adım adım çözüm; doğrudan modda reveal_solution bunu döner"},"sympy_status":{"enum":["verified","failed","not_applicable"]},"sympy_report":{"type":"object","additionalProperties":false,"properties":{"expr":{"type":"string"},"value":{"type":"string"},"matched_option":{"type":["string","null"]},"note":{"type":"string"}}}},"oneOf":[{"required":["correct_option"]},{"required":["numeric_value"]}]};
const schema22 = {"type":"string","format":"uuid"};
const formats0 = ogrFormats.uuid;

function validate55(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate55.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(typeof data === "string"){
if(!(formats0(data))){
const err0 = {instancePath,schemaPath:"#/format",keyword:"format",params:{format: "uuid"},message:"must match format \""+"uuid"+"\""};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
}
else {
const err1 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
validate55.errors = vErrors;
return errors === 0;
}
validate55.evaluated = {"dynamicProps":false,"dynamicItems":false};

const schema23 = {"enum":["A","B","C","D"]};

function validate57(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate57.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(!((((data === "A") || (data === "B")) || (data === "C")) || (data === "D"))){
const err0 = {instancePath,schemaPath:"#/enum",keyword:"enum",params:{allowedValues: schema23.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
validate57.errors = vErrors;
return errors === 0;
}
validate57.evaluated = {"dynamicProps":false,"dynamicItems":false};

const func1 = ogrUcs2length;

function validate53(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
/*# sourceURL="https://ogrenmen.easy/schemas/answer-key.json" */;
let vErrors = null;
let errors = 0;
const evaluated0 = validate53.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
const _errs1 = errors;
let valid0 = false;
let passing0 = null;
const _errs2 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.correct_option === undefined){
const err0 = {instancePath,schemaPath:"#/oneOf/0/required",keyword:"required",params:{missingProperty: "correct_option"},message:"must have required property '"+"correct_option"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
}
var _valid0 = _errs2 === errors;
if(_valid0){
valid0 = true;
passing0 = 0;
}
const _errs3 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.numeric_value === undefined){
const err1 = {instancePath,schemaPath:"#/oneOf/1/required",keyword:"required",params:{missingProperty: "numeric_value"},message:"must have required property '"+"numeric_value"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
}
var _valid0 = _errs3 === errors;
if(_valid0 && valid0){
valid0 = false;
passing0 = [passing0, 1];
}
else {
if(_valid0){
valid0 = true;
passing0 = 1;
}
}
if(!valid0){
const err2 = {instancePath,schemaPath:"#/oneOf",keyword:"oneOf",params:{passingSchemas: passing0},message:"must match exactly one schema in oneOf"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
else {
errors = _errs1;
if(vErrors !== null){
if(_errs1){
vErrors.length = _errs1;
}
else {
vErrors = null;
}
}
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.question_id === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "question_id"},message:"must have required property '"+"question_id"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.solution === undefined){
const err4 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "solution"},message:"must have required property '"+"solution"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data.sympy_status === undefined){
const err5 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "sympy_status"},message:"must have required property '"+"sympy_status"+"'"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
for(const key0 in data){
if(!((((((((key0 === "question_id") || (key0 === "correct_option")) || (key0 === "numeric_value")) || (key0 === "numeric_tolerance")) || (key0 === "canonical_expr")) || (key0 === "solution")) || (key0 === "sympy_status")) || (key0 === "sympy_report"))){
const err6 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
if(data.question_id !== undefined){
if(!(validate55(data.question_id, {instancePath:instancePath+"/question_id",parentData:data,parentDataProperty:"question_id",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate55.errors : vErrors.concat(validate55.errors);
errors = vErrors.length;
}
}
if(data.correct_option !== undefined){
if(!(validate57(data.correct_option, {instancePath:instancePath+"/correct_option",parentData:data,parentDataProperty:"correct_option",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate57.errors : vErrors.concat(validate57.errors);
errors = vErrors.length;
}
}
if(data.numeric_value !== undefined){
if(typeof data.numeric_value !== "string"){
const err7 = {instancePath:instancePath+"/numeric_value",schemaPath:"#/properties/numeric_value/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
if(data.numeric_tolerance !== undefined){
let data3 = data.numeric_tolerance;
if((typeof data3 == "number") && (isFinite(data3))){
if(data3 < 0 || isNaN(data3)){
const err8 = {instancePath:instancePath+"/numeric_tolerance",schemaPath:"#/properties/numeric_tolerance/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
else {
const err9 = {instancePath:instancePath+"/numeric_tolerance",schemaPath:"#/properties/numeric_tolerance/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
if(data.canonical_expr !== undefined){
if(typeof data.canonical_expr !== "string"){
const err10 = {instancePath:instancePath+"/canonical_expr",schemaPath:"#/properties/canonical_expr/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
if(data.solution !== undefined){
let data5 = data.solution;
if(typeof data5 === "string"){
if(func1(data5) > 2000){
const err11 = {instancePath:instancePath+"/solution",schemaPath:"#/properties/solution/maxLength",keyword:"maxLength",params:{limit: 2000},message:"must NOT have more than 2000 characters"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
if(func1(data5) < 10){
const err12 = {instancePath:instancePath+"/solution",schemaPath:"#/properties/solution/minLength",keyword:"minLength",params:{limit: 10},message:"must NOT have fewer than 10 characters"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
else {
const err13 = {instancePath:instancePath+"/solution",schemaPath:"#/properties/solution/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
}
if(data.sympy_status !== undefined){
let data6 = data.sympy_status;
if(!(((data6 === "verified") || (data6 === "failed")) || (data6 === "not_applicable"))){
const err14 = {instancePath:instancePath+"/sympy_status",schemaPath:"#/properties/sympy_status/enum",keyword:"enum",params:{allowedValues: schema20.properties.sympy_status.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
if(data.sympy_report !== undefined){
let data7 = data.sympy_report;
if(data7 && typeof data7 == "object" && !Array.isArray(data7)){
for(const key1 in data7){
if(!((((key1 === "expr") || (key1 === "value")) || (key1 === "matched_option")) || (key1 === "note"))){
const err15 = {instancePath:instancePath+"/sympy_report",schemaPath:"#/properties/sympy_report/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key1},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
}
if(data7.expr !== undefined){
if(typeof data7.expr !== "string"){
const err16 = {instancePath:instancePath+"/sympy_report/expr",schemaPath:"#/properties/sympy_report/properties/expr/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
}
if(data7.value !== undefined){
if(typeof data7.value !== "string"){
const err17 = {instancePath:instancePath+"/sympy_report/value",schemaPath:"#/properties/sympy_report/properties/value/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
}
if(data7.matched_option !== undefined){
let data10 = data7.matched_option;
if((typeof data10 !== "string") && (data10 !== null)){
const err18 = {instancePath:instancePath+"/sympy_report/matched_option",schemaPath:"#/properties/sympy_report/properties/matched_option/type",keyword:"type",params:{type: schema20.properties.sympy_report.properties.matched_option.type},message:"must be string,null"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
}
if(data7.note !== undefined){
if(typeof data7.note !== "string"){
const err19 = {instancePath:instancePath+"/sympy_report/note",schemaPath:"#/properties/sympy_report/properties/note/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
}
}
else {
const err20 = {instancePath:instancePath+"/sympy_report",schemaPath:"#/properties/sympy_report/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
}
}
else {
const err21 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
validate53.errors = vErrors;
return errors === 0;
}
validate53.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const diagnosticKeys = validate59;
const schema24 = {"$schema":"https://json-schema.org/draft/2020-12/schema","$id":"https://ogrenmen.easy/schemas/diagnostic-keys.json","title":"DiagnosticKeys","description":"Teşhis cevap anahtarları (diagnostic/answer-keys.json): {madde kodu: anahtar}. Yalnız seed-keys.py okur; Worker ve LLM yolu içe almaz.","x-version":"1.0","type":"object","minProperties":1,"propertyNames":{"pattern":"^DIAG-[0-9]{4}\\.[0-9]+-[0-9]{2}$"},"additionalProperties":{"$ref":"#/$defs/key"},"$defs":{"key":{"type":"object","additionalProperties":false,"required":["correct_option","solution"],"properties":{"correct_option":{"$ref":"common.json#/$defs/optionKey"},"canonical_expr":{"type":"string","minLength":1,"description":"SymPy ifadesi; validate.py correct_option metnini verdiğini doğrular"},"numeric_value":{"type":"string","minLength":1},"numeric_tolerance":{"type":"number","minimum":0},"solution":{"type":"string","minLength":10,"maxLength":2000}}}}};
const pattern3 = new RegExp("^DIAG-[0-9]{4}\\.[0-9]+-[0-9]{2}$", "u");
const schema25 = {"type":"object","additionalProperties":false,"required":["correct_option","solution"],"properties":{"correct_option":{"$ref":"common.json#/$defs/optionKey"},"canonical_expr":{"type":"string","minLength":1,"description":"SymPy ifadesi; validate.py correct_option metnini verdiğini doğrular"},"numeric_value":{"type":"string","minLength":1},"numeric_tolerance":{"type":"number","minimum":0},"solution":{"type":"string","minLength":10,"maxLength":2000}}};

function validate61(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate61.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(!((((data === "A") || (data === "B")) || (data === "C")) || (data === "D"))){
const err0 = {instancePath,schemaPath:"#/enum",keyword:"enum",params:{allowedValues: schema23.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
validate61.errors = vErrors;
return errors === 0;
}
validate61.evaluated = {"dynamicProps":false,"dynamicItems":false};


function validate60(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate60.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.correct_option === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "correct_option"},message:"must have required property '"+"correct_option"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.solution === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "solution"},message:"must have required property '"+"solution"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
for(const key0 in data){
if(!(((((key0 === "correct_option") || (key0 === "canonical_expr")) || (key0 === "numeric_value")) || (key0 === "numeric_tolerance")) || (key0 === "solution"))){
const err2 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
}
if(data.correct_option !== undefined){
if(!(validate61(data.correct_option, {instancePath:instancePath+"/correct_option",parentData:data,parentDataProperty:"correct_option",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate61.errors : vErrors.concat(validate61.errors);
errors = vErrors.length;
}
}
if(data.canonical_expr !== undefined){
let data1 = data.canonical_expr;
if(typeof data1 === "string"){
if(func1(data1) < 1){
const err3 = {instancePath:instancePath+"/canonical_expr",schemaPath:"#/properties/canonical_expr/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
else {
const err4 = {instancePath:instancePath+"/canonical_expr",schemaPath:"#/properties/canonical_expr/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
if(data.numeric_value !== undefined){
let data2 = data.numeric_value;
if(typeof data2 === "string"){
if(func1(data2) < 1){
const err5 = {instancePath:instancePath+"/numeric_value",schemaPath:"#/properties/numeric_value/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
else {
const err6 = {instancePath:instancePath+"/numeric_value",schemaPath:"#/properties/numeric_value/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
if(data.numeric_tolerance !== undefined){
let data3 = data.numeric_tolerance;
if((typeof data3 == "number") && (isFinite(data3))){
if(data3 < 0 || isNaN(data3)){
const err7 = {instancePath:instancePath+"/numeric_tolerance",schemaPath:"#/properties/numeric_tolerance/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
else {
const err8 = {instancePath:instancePath+"/numeric_tolerance",schemaPath:"#/properties/numeric_tolerance/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
if(data.solution !== undefined){
let data4 = data.solution;
if(typeof data4 === "string"){
if(func1(data4) > 2000){
const err9 = {instancePath:instancePath+"/solution",schemaPath:"#/properties/solution/maxLength",keyword:"maxLength",params:{limit: 2000},message:"must NOT have more than 2000 characters"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if(func1(data4) < 10){
const err10 = {instancePath:instancePath+"/solution",schemaPath:"#/properties/solution/minLength",keyword:"minLength",params:{limit: 10},message:"must NOT have fewer than 10 characters"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
else {
const err11 = {instancePath:instancePath+"/solution",schemaPath:"#/properties/solution/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
}
else {
const err12 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
validate60.errors = vErrors;
return errors === 0;
}
validate60.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};


function validate59(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
/*# sourceURL="https://ogrenmen.easy/schemas/diagnostic-keys.json" */;
let vErrors = null;
let errors = 0;
const evaluated0 = validate59.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(Object.keys(data).length < 1){
const err0 = {instancePath,schemaPath:"#/minProperties",keyword:"minProperties",params:{limit: 1},message:"must NOT have fewer than 1 properties"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
for(const key0 in data){
const _errs1 = errors;
if(typeof key0 === "string"){
if(!pattern3.test(key0)){
const err1 = {instancePath,schemaPath:"#/propertyNames/pattern",keyword:"pattern",params:{pattern: "^DIAG-[0-9]{4}\\.[0-9]+-[0-9]{2}$"},message:"must match pattern \""+"^DIAG-[0-9]{4}\\.[0-9]+-[0-9]{2}$"+"\"",propertyName:key0};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
}
var valid0 = _errs1 === errors;
if(!valid0){
const err2 = {instancePath,schemaPath:"#/propertyNames",keyword:"propertyNames",params:{propertyName: key0},message:"property name must be valid"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
}
for(const key1 in data){
if(!(validate60(data[key1], {instancePath:instancePath+"/" + key1.replace(/~/g, "~0").replace(/\//g, "~1"),parentData:data,parentDataProperty:key1,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate60.errors : vErrors.concat(validate60.errors);
errors = vErrors.length;
}
}
}
else {
const err3 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
validate59.errors = vErrors;
return errors === 0;
}
validate59.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const diagnosticKeysKey = validate64;

function validate64(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate64.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.correct_option === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "correct_option"},message:"must have required property '"+"correct_option"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.solution === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "solution"},message:"must have required property '"+"solution"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
for(const key0 in data){
if(!(((((key0 === "correct_option") || (key0 === "canonical_expr")) || (key0 === "numeric_value")) || (key0 === "numeric_tolerance")) || (key0 === "solution"))){
const err2 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
}
if(data.correct_option !== undefined){
if(!(validate61(data.correct_option, {instancePath:instancePath+"/correct_option",parentData:data,parentDataProperty:"correct_option",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate61.errors : vErrors.concat(validate61.errors);
errors = vErrors.length;
}
}
if(data.canonical_expr !== undefined){
let data1 = data.canonical_expr;
if(typeof data1 === "string"){
if(func1(data1) < 1){
const err3 = {instancePath:instancePath+"/canonical_expr",schemaPath:"#/properties/canonical_expr/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
else {
const err4 = {instancePath:instancePath+"/canonical_expr",schemaPath:"#/properties/canonical_expr/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
if(data.numeric_value !== undefined){
let data2 = data.numeric_value;
if(typeof data2 === "string"){
if(func1(data2) < 1){
const err5 = {instancePath:instancePath+"/numeric_value",schemaPath:"#/properties/numeric_value/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
else {
const err6 = {instancePath:instancePath+"/numeric_value",schemaPath:"#/properties/numeric_value/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
if(data.numeric_tolerance !== undefined){
let data3 = data.numeric_tolerance;
if((typeof data3 == "number") && (isFinite(data3))){
if(data3 < 0 || isNaN(data3)){
const err7 = {instancePath:instancePath+"/numeric_tolerance",schemaPath:"#/properties/numeric_tolerance/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
else {
const err8 = {instancePath:instancePath+"/numeric_tolerance",schemaPath:"#/properties/numeric_tolerance/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
if(data.solution !== undefined){
let data4 = data.solution;
if(typeof data4 === "string"){
if(func1(data4) > 2000){
const err9 = {instancePath:instancePath+"/solution",schemaPath:"#/properties/solution/maxLength",keyword:"maxLength",params:{limit: 2000},message:"must NOT have more than 2000 characters"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if(func1(data4) < 10){
const err10 = {instancePath:instancePath+"/solution",schemaPath:"#/properties/solution/minLength",keyword:"minLength",params:{limit: 10},message:"must NOT have fewer than 10 characters"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
else {
const err11 = {instancePath:instancePath+"/solution",schemaPath:"#/properties/solution/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
}
else {
const err12 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
validate64.errors = vErrors;
return errors === 0;
}
validate64.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const questionGeneration = validate66;
const schema28 = {"$schema":"https://json-schema.org/draft/2020-12/schema","$id":"https://ogrenmen.easy/schemas/question-generation.json","title":"QuestionGeneration","description":"Tablet'in LLM'den istediği yapılandırılmış çıktı: tek zarfta item (question-item) ve key (answer-key, question_id hariç). Pipeline item'ı questions'a, key'i SymPy'den geçirip register_answer_key'e verir; key dosyaya yazılmaz.","x-version":"1.0","type":"object","additionalProperties":false,"required":["item","key"],"properties":{"schema_version":{"const":"1.0"},"item":{"$ref":"question-item.json"},"key":{"$ref":"#/$defs/key"}},"$defs":{"key":{"type":"object","additionalProperties":false,"required":["solution","sympy_status"],"description":"answer-key ile aynı alanlar, question_id hariç (soru henüz yazılmadı).","properties":{"correct_option":{"$ref":"common.json#/$defs/optionKey"},"numeric_value":{"type":"string","description":"SymPy string: '7/8', '2*sqrt(3)'"},"numeric_tolerance":{"type":"number","minimum":0},"canonical_expr":{"type":"string","description":"sympy.sympify edilebilir ifade; stem_values ile çözülür"},"solution":{"type":"string","minLength":10,"maxLength":2000,"description":"Adım adım çözüm; doğrudan modda reveal_solution bunu döner"},"sympy_status":{"enum":["verified","failed","not_applicable"]},"sympy_report":{"type":"object","additionalProperties":false,"properties":{"expr":{"type":"string"},"value":{"type":"string"},"matched_option":{"type":["string","null"]},"note":{"type":"string"}}}},"oneOf":[{"required":["correct_option"]},{"required":["numeric_value"]}]}}};
const schema29 = {"$schema":"https://json-schema.org/draft/2020-12/schema","$id":"https://ogrenmen.easy/schemas/question-item.json","title":"QuestionItem","description":"Soru maddesi. Cevap anahtarı BU NESNEDE YOKTUR (answer-key ayrı sözleşmedir).","x-version":"1.0","type":"object","additionalProperties":false,"required":["schema_version","curriculum_code","kind","skill_ids","stem","figure","source","verification"],"properties":{"schema_version":{"const":"1.0"},"id":{"$ref":"common.json#/$defs/uuid"},"curriculum_code":{"type":"string","pattern":"^[A-Z]{2,5}-[A-Z]{2,5}@[0-9]{4}\\.[0-9]+$","examples":["TYT-MAT@2026.1"]},"kind":{"enum":["mcq","numeric"]},"skill_ids":{"type":"array","minItems":1,"maxItems":3,"items":{"$ref":"common.json#/$defs/skillId"}},"stem":{"type":"string","minLength":10,"maxLength":900,"description":"Soru kökü; formüller düz metin/kod biçiminde; şekil varsa kök şekli kelimelerle de anlatır"},"stem_values":{"type":"object","additionalProperties":{"type":["number","string"]},"description":"Şekil denetiminin karşılaştırdığı değerler (kenar, açı, eksen)"},"figure":{"oneOf":[{"type":"null"},{"type":"object","additionalProperties":false,"required":["tool","code","alt_text"],"properties":{"tool":{"enum":["matplotlib","svg","tikz","vega-lite","schemdraw","rdkit","graphviz","latex","template"]},"code":{"type":"string","minLength":1,"maxLength":20000},"alt_text":{"type":"string","minLength":15,"maxLength":400,"description":"Şekli kelimelerle anlatır (Telegram altyazısı, alt)"},"expected_px":{"type":"object","additionalProperties":false,"properties":{"min_w":{"type":"integer"},"max_w":{"type":"integer"},"min_h":{"type":"integer"},"max_h":{"type":"integer"}}},"render":{"type":"object","additionalProperties":false,"properties":{"status":{"enum":["pending","rendered","failed"]},"png_path":{"type":"string"},"width_px":{"type":"integer"},"height_px":{"type":"integer"},"bytes":{"type":"integer"},"vision":{"enum":["pending","match","mismatch","not_applicable","skipped"]},"attempts":{"type":"integer","minimum":0,"maximum":3}}}}}]},"options":{"type":"array","minItems":4,"maxItems":4,"description":"Tam dört şık, anahtarlar sırayla A, B, C, D (yinelenen, eksik ya da sırası bozuk anahtar düşer; Telegram A·B·C·D düğmeleri ve grade_attempt aynı sırayı varsayar). En az iki şık misconception_tag=null taşır (doğru şık + en az bir etiketsiz çeldirici).","items":{"type":"object","additionalProperties":false,"required":["key","text","misconception_tag"],"properties":{"key":{"$ref":"common.json#/$defs/optionKey"},"text":{"type":"string","minLength":1,"maxLength":200},"misconception_tag":{"oneOf":[{"type":"null"},{"$ref":"common.json#/$defs/tag"}],"description":"Yanlış şıkkın kodladığı yanılgı. DOĞRU ŞIK BU DİZİDEN ÇIKARILAMAZ: doğru şık null taşır VE en az bir çeldirici de null taşır (en az iki null zorunlu); LLM ve öğrenci yolu şıkları app.strip_tags ile etiketsiz görür."}}},"contains":{"type":"object","required":["misconception_tag"],"properties":{"misconception_tag":{"type":"null"}}},"minContains":2,"allOf":[{"minItems":4,"maxItems":4,"prefixItems":[{"properties":{"key":{"const":"A"}}},{"properties":{"key":{"const":"B"}}},{"properties":{"key":{"const":"C"}}},{"properties":{"key":{"const":"D"}}}]}]},"difficulty":{"$ref":"common.json#/$defs/probability"},"source":{"enum":["template","llm","instructor","diagnostic"]},"template":{"type":"object","additionalProperties":false,"properties":{"id":{"type":"string"},"params":{"type":"object","additionalProperties":{"$ref":"template-params.json#/$defs/value"},"description":"Şablon parametreleri (template-params ile aynı değer kuralı: sayı, metin, mantıksal, null, bunların düz dizisi ya da bir düzey düz nesne)"}}},"verification":{"type":"object","additionalProperties":false,"required":["schema","sympy","render","vision","attempts","status"],"properties":{"schema":{"type":"boolean"},"sympy":{"enum":["verified","failed","not_applicable","pending"]},"render":{"enum":["ok","failed","size_mismatch","not_applicable","pending"]},"vision":{"enum":["match","mismatch","not_applicable","pending","skipped"]},"attempts":{"type":"integer","minimum":0,"maximum":3},"status":{"enum":["draft","pending_review","approved","rejected","retired"]},"review_note":{"type":["string","null"]}}},"provenance":{"type":"object","additionalProperties":false,"properties":{"model":{"type":"string"},"cost_usd":{"$ref":"common.json#/$defs/usd"},"prompt_version":{"type":"string"},"prompt_hash":{"type":"string"},"created_at":{"$ref":"common.json#/$defs/dateTime"}}}},"allOf":[{"if":{"properties":{"kind":{"const":"mcq"}}},"then":{"required":["options"]}},{"if":{"properties":{"kind":{"const":"numeric"}}},"then":{"not":{"required":["options"]}}},{"if":{"properties":{"verification":{"properties":{"status":{"const":"approved"}}}}},"then":{"properties":{"verification":{"properties":{"sympy":{"enum":["verified","not_applicable"]}}}}}}]};
const func12 = Object.prototype.hasOwnProperty;

function validate68(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate68.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(typeof data === "string"){
if(!(formats0(data))){
const err0 = {instancePath,schemaPath:"#/format",keyword:"format",params:{format: "uuid"},message:"must match format \""+"uuid"+"\""};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
}
else {
const err1 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
validate68.errors = vErrors;
return errors === 0;
}
validate68.evaluated = {"dynamicProps":false,"dynamicItems":false};

const schema31 = {"type":"string","pattern":"^[a-z]+(\\.[a-z0-9-]+)+$","examples":["tyt.mat.temel.rasyonel-sayilar"]};
const pattern5 = new RegExp("^[a-z]+(\\.[a-z0-9-]+)+$", "u");

function validate70(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate70.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(typeof data === "string"){
if(!pattern5.test(data)){
const err0 = {instancePath,schemaPath:"#/pattern",keyword:"pattern",params:{pattern: "^[a-z]+(\\.[a-z0-9-]+)+$"},message:"must match pattern \""+"^[a-z]+(\\.[a-z0-9-]+)+$"+"\""};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
}
else {
const err1 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
validate70.errors = vErrors;
return errors === 0;
}
validate70.evaluated = {"dynamicProps":false,"dynamicItems":false};


function validate72(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate72.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(!((((data === "A") || (data === "B")) || (data === "C")) || (data === "D"))){
const err0 = {instancePath,schemaPath:"#/enum",keyword:"enum",params:{allowedValues: schema23.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
validate72.errors = vErrors;
return errors === 0;
}
validate72.evaluated = {"dynamicProps":false,"dynamicItems":false};

const schema33 = {"type":"string","pattern":"^[a-z0-9-]+(\\.[a-z0-9-]+)+$","examples":["rasyonel.pay-payda-ayri-toplama"]};
const pattern6 = new RegExp("^[a-z0-9-]+(\\.[a-z0-9-]+)+$", "u");

function validate74(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate74.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(typeof data === "string"){
if(!pattern6.test(data)){
const err0 = {instancePath,schemaPath:"#/pattern",keyword:"pattern",params:{pattern: "^[a-z0-9-]+(\\.[a-z0-9-]+)+$"},message:"must match pattern \""+"^[a-z0-9-]+(\\.[a-z0-9-]+)+$"+"\""};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
}
else {
const err1 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
validate74.errors = vErrors;
return errors === 0;
}
validate74.evaluated = {"dynamicProps":false,"dynamicItems":false};

const schema34 = {"type":"number","minimum":0,"maximum":1};

function validate76(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate76.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if((typeof data == "number") && (isFinite(data))){
if(data > 1 || isNaN(data)){
const err0 = {instancePath,schemaPath:"#/maximum",keyword:"maximum",params:{comparison: "<=", limit: 1},message:"must be <= 1"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data < 0 || isNaN(data)){
const err1 = {instancePath,schemaPath:"#/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
}
else {
const err2 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
validate76.errors = vErrors;
return errors === 0;
}
validate76.evaluated = {"dynamicProps":false,"dynamicItems":false};

const schema36 = {"oneOf":[{"$ref":"#/$defs/leaf"},{"type":"object","minProperties":1,"maxProperties":12,"propertyNames":{"pattern":"^[a-z_][a-z0-9_]*$"},"additionalProperties":{"$ref":"#/$defs/leaf"}}]};
const schema37 = {"oneOf":[{"$ref":"#/$defs/scalar"},{"type":"array","maxItems":12,"items":{"$ref":"#/$defs/scalar"}}]};
const schema38 = {"type":["number","string","boolean","null"]};

function validate81(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate81.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if((((!((typeof data == "number") && (isFinite(data)))) && (typeof data !== "string")) && (typeof data !== "boolean")) && (data !== null)){
const err0 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: schema38.type},message:"must be number,string,boolean,null"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
validate81.errors = vErrors;
return errors === 0;
}
validate81.evaluated = {"dynamicProps":false,"dynamicItems":false};


function validate80(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate80.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
const _errs0 = errors;
let valid0 = false;
let passing0 = null;
const _errs1 = errors;
if(!(validate81(data, {instancePath,parentData,parentDataProperty,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate81.errors : vErrors.concat(validate81.errors);
errors = vErrors.length;
}
var _valid0 = _errs1 === errors;
if(_valid0){
valid0 = true;
passing0 = 0;
}
const _errs2 = errors;
if(Array.isArray(data)){
if(data.length > 12){
const err0 = {instancePath,schemaPath:"#/oneOf/1/maxItems",keyword:"maxItems",params:{limit: 12},message:"must NOT have more than 12 items"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
const len0 = data.length;
for(let i0=0; i0<len0; i0++){
if(!(validate81(data[i0], {instancePath:instancePath+"/" + i0,parentData:data,parentDataProperty:i0,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate81.errors : vErrors.concat(validate81.errors);
errors = vErrors.length;
}
}
}
else {
const err1 = {instancePath,schemaPath:"#/oneOf/1/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
var _valid0 = _errs2 === errors;
if(_valid0 && valid0){
valid0 = false;
passing0 = [passing0, 1];
}
else {
if(_valid0){
valid0 = true;
passing0 = 1;
var items0 = true;
}
}
if(!valid0){
const err2 = {instancePath,schemaPath:"#/oneOf",keyword:"oneOf",params:{passingSchemas: passing0},message:"must match exactly one schema in oneOf"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
else {
errors = _errs0;
if(vErrors !== null){
if(_errs0){
vErrors.length = _errs0;
}
else {
vErrors = null;
}
}
}
validate80.errors = vErrors;
evaluated0.items = items0;
return errors === 0;
}
validate80.evaluated = {"dynamicProps":false,"dynamicItems":true};

const pattern8 = new RegExp("^[a-z_][a-z0-9_]*$", "u");

function validate87(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate87.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
const _errs0 = errors;
let valid0 = false;
let passing0 = null;
const _errs1 = errors;
if(!(validate80(data, {instancePath,parentData,parentDataProperty,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate80.errors : vErrors.concat(validate80.errors);
errors = vErrors.length;
}
else {
var items0 = validate80.evaluated.items;
}
var _valid0 = _errs1 === errors;
if(_valid0){
valid0 = true;
passing0 = 0;
}
const _errs2 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(Object.keys(data).length > 12){
const err0 = {instancePath,schemaPath:"#/oneOf/1/maxProperties",keyword:"maxProperties",params:{limit: 12},message:"must NOT have more than 12 properties"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(Object.keys(data).length < 1){
const err1 = {instancePath,schemaPath:"#/oneOf/1/minProperties",keyword:"minProperties",params:{limit: 1},message:"must NOT have fewer than 1 properties"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
for(const key0 in data){
const _errs4 = errors;
if(typeof key0 === "string"){
if(!pattern8.test(key0)){
const err2 = {instancePath,schemaPath:"#/oneOf/1/propertyNames/pattern",keyword:"pattern",params:{pattern: "^[a-z_][a-z0-9_]*$"},message:"must match pattern \""+"^[a-z_][a-z0-9_]*$"+"\"",propertyName:key0};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
}
var valid1 = _errs4 === errors;
if(!valid1){
const err3 = {instancePath,schemaPath:"#/oneOf/1/propertyNames",keyword:"propertyNames",params:{propertyName: key0},message:"property name must be valid"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
for(const key1 in data){
if(!(validate80(data[key1], {instancePath:instancePath+"/" + key1.replace(/~/g, "~0").replace(/\//g, "~1"),parentData:data,parentDataProperty:key1,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate80.errors : vErrors.concat(validate80.errors);
errors = vErrors.length;
}
}
}
else {
const err4 = {instancePath,schemaPath:"#/oneOf/1/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
var _valid0 = _errs2 === errors;
if(_valid0 && valid0){
valid0 = false;
passing0 = [passing0, 1];
}
else {
if(_valid0){
valid0 = true;
passing0 = 1;
var props0 = true;
}
}
if(!valid0){
const err5 = {instancePath,schemaPath:"#/oneOf",keyword:"oneOf",params:{passingSchemas: passing0},message:"must match exactly one schema in oneOf"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
else {
errors = _errs0;
if(vErrors !== null){
if(_errs0){
vErrors.length = _errs0;
}
else {
vErrors = null;
}
}
}
validate87.errors = vErrors;
evaluated0.props = props0;
evaluated0.items = items0;
return errors === 0;
}
validate87.evaluated = {"dynamicProps":true,"dynamicItems":true};

const schema40 = {"type":"number","minimum":0};

function validate91(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate91.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if((typeof data == "number") && (isFinite(data))){
if(data < 0 || isNaN(data)){
const err0 = {instancePath,schemaPath:"#/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
}
else {
const err1 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
validate91.errors = vErrors;
return errors === 0;
}
validate91.evaluated = {"dynamicProps":false,"dynamicItems":false};

const schema41 = {"type":"string","format":"date-time"};
const formats4 = ogrFormats["date-time"];

function validate93(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate93.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(typeof data === "string"){
if(!(formats4(data))){
const err0 = {instancePath,schemaPath:"#/format",keyword:"format",params:{format: "date-time"},message:"must match format \""+"date-time"+"\""};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
}
else {
const err1 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
validate93.errors = vErrors;
return errors === 0;
}
validate93.evaluated = {"dynamicProps":false,"dynamicItems":false};

const pattern4 = new RegExp("^[A-Z]{2,5}-[A-Z]{2,5}@[0-9]{4}\\.[0-9]+$", "u");

function validate67(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
/*# sourceURL="https://ogrenmen.easy/schemas/question-item.json" */;
let vErrors = null;
let errors = 0;
const evaluated0 = validate67.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
const _errs2 = errors;
let valid1 = true;
const _errs3 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.kind !== undefined){
if("mcq" !== data.kind){
const err0 = {};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
}
}
var _valid0 = _errs3 === errors;
errors = _errs2;
if(vErrors !== null){
if(_errs2){
vErrors.length = _errs2;
}
else {
vErrors = null;
}
}
if(_valid0){
const _errs5 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.options === undefined){
const err1 = {instancePath,schemaPath:"#/allOf/0/then/required",keyword:"required",params:{missingProperty: "options"},message:"must have required property '"+"options"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
}
var _valid0 = _errs5 === errors;
valid1 = _valid0;
}
if(!valid1){
const err2 = {instancePath,schemaPath:"#/allOf/0/if",keyword:"if",params:{failingKeyword: "then"},message:"must match \"then\" schema"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
const _errs7 = errors;
let valid3 = true;
const _errs8 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.kind !== undefined){
if("numeric" !== data.kind){
const err3 = {};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
}
var _valid1 = _errs8 === errors;
errors = _errs7;
if(vErrors !== null){
if(_errs7){
vErrors.length = _errs7;
}
else {
vErrors = null;
}
}
if(_valid1){
const _errs10 = errors;
const _errs11 = errors;
const _errs12 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
let missing0;
if((data.options === undefined) && (missing0 = "options")){
const err4 = {};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
var valid5 = _errs12 === errors;
if(valid5){
const err5 = {instancePath,schemaPath:"#/allOf/1/then/not",keyword:"not",params:{},message:"must NOT be valid"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
else {
errors = _errs11;
if(vErrors !== null){
if(_errs11){
vErrors.length = _errs11;
}
else {
vErrors = null;
}
}
}
var _valid1 = _errs10 === errors;
valid3 = _valid1;
}
if(!valid3){
const err6 = {instancePath,schemaPath:"#/allOf/1/if",keyword:"if",params:{failingKeyword: "then"},message:"must match \"then\" schema"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
const _errs14 = errors;
let valid6 = true;
const _errs15 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.verification !== undefined){
let data2 = data.verification;
if(data2 && typeof data2 == "object" && !Array.isArray(data2)){
if(data2.status !== undefined){
if("approved" !== data2.status){
const err7 = {};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
}
}
}
var _valid2 = _errs15 === errors;
errors = _errs14;
if(vErrors !== null){
if(_errs14){
vErrors.length = _errs14;
}
else {
vErrors = null;
}
}
if(_valid2){
const _errs18 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.verification !== undefined){
let data4 = data.verification;
if(data4 && typeof data4 == "object" && !Array.isArray(data4)){
if(data4.sympy !== undefined){
let data5 = data4.sympy;
if(!((data5 === "verified") || (data5 === "not_applicable"))){
const err8 = {instancePath:instancePath+"/verification/sympy",schemaPath:"#/allOf/2/then/properties/verification/properties/sympy/enum",keyword:"enum",params:{allowedValues: schema29.allOf[2].then.properties.verification.properties.sympy.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
}
}
}
var _valid2 = _errs18 === errors;
valid6 = _valid2;
if(valid6){
var props0 = {};
props0.verification = true;
}
}
if(!valid6){
const err9 = {instancePath,schemaPath:"#/allOf/2/if",keyword:"if",params:{failingKeyword: "then"},message:"must match \"then\" schema"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if(props0 !== true){
props0 = props0 || {};
props0.kind = true;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.schema_version === undefined){
const err10 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "schema_version"},message:"must have required property '"+"schema_version"+"'"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if(data.curriculum_code === undefined){
const err11 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "curriculum_code"},message:"must have required property '"+"curriculum_code"+"'"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
if(data.kind === undefined){
const err12 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "kind"},message:"must have required property '"+"kind"+"'"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
if(data.skill_ids === undefined){
const err13 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "skill_ids"},message:"must have required property '"+"skill_ids"+"'"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
if(data.stem === undefined){
const err14 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "stem"},message:"must have required property '"+"stem"+"'"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
if(data.figure === undefined){
const err15 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "figure"},message:"must have required property '"+"figure"+"'"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
if(data.source === undefined){
const err16 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "source"},message:"must have required property '"+"source"+"'"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
if(data.verification === undefined){
const err17 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "verification"},message:"must have required property '"+"verification"+"'"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
for(const key0 in data){
if(!(func12.call(schema29.properties, key0))){
const err18 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
}
if(data.schema_version !== undefined){
if("1.0" !== data.schema_version){
const err19 = {instancePath:instancePath+"/schema_version",schemaPath:"#/properties/schema_version/const",keyword:"const",params:{allowedValue: "1.0"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
}
if(data.id !== undefined){
if(!(validate68(data.id, {instancePath:instancePath+"/id",parentData:data,parentDataProperty:"id",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate68.errors : vErrors.concat(validate68.errors);
errors = vErrors.length;
}
}
if(data.curriculum_code !== undefined){
let data8 = data.curriculum_code;
if(typeof data8 === "string"){
if(!pattern4.test(data8)){
const err20 = {instancePath:instancePath+"/curriculum_code",schemaPath:"#/properties/curriculum_code/pattern",keyword:"pattern",params:{pattern: "^[A-Z]{2,5}-[A-Z]{2,5}@[0-9]{4}\\.[0-9]+$"},message:"must match pattern \""+"^[A-Z]{2,5}-[A-Z]{2,5}@[0-9]{4}\\.[0-9]+$"+"\""};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
}
else {
const err21 = {instancePath:instancePath+"/curriculum_code",schemaPath:"#/properties/curriculum_code/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
}
if(data.kind !== undefined){
let data9 = data.kind;
if(!((data9 === "mcq") || (data9 === "numeric"))){
const err22 = {instancePath:instancePath+"/kind",schemaPath:"#/properties/kind/enum",keyword:"enum",params:{allowedValues: schema29.properties.kind.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
}
if(data.skill_ids !== undefined){
let data10 = data.skill_ids;
if(Array.isArray(data10)){
if(data10.length > 3){
const err23 = {instancePath:instancePath+"/skill_ids",schemaPath:"#/properties/skill_ids/maxItems",keyword:"maxItems",params:{limit: 3},message:"must NOT have more than 3 items"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
if(data10.length < 1){
const err24 = {instancePath:instancePath+"/skill_ids",schemaPath:"#/properties/skill_ids/minItems",keyword:"minItems",params:{limit: 1},message:"must NOT have fewer than 1 items"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
const len0 = data10.length;
for(let i0=0; i0<len0; i0++){
if(!(validate70(data10[i0], {instancePath:instancePath+"/skill_ids/" + i0,parentData:data10,parentDataProperty:i0,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate70.errors : vErrors.concat(validate70.errors);
errors = vErrors.length;
}
}
}
else {
const err25 = {instancePath:instancePath+"/skill_ids",schemaPath:"#/properties/skill_ids/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
}
if(data.stem !== undefined){
let data12 = data.stem;
if(typeof data12 === "string"){
if(func1(data12) > 900){
const err26 = {instancePath:instancePath+"/stem",schemaPath:"#/properties/stem/maxLength",keyword:"maxLength",params:{limit: 900},message:"must NOT have more than 900 characters"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
if(func1(data12) < 10){
const err27 = {instancePath:instancePath+"/stem",schemaPath:"#/properties/stem/minLength",keyword:"minLength",params:{limit: 10},message:"must NOT have fewer than 10 characters"};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
}
else {
const err28 = {instancePath:instancePath+"/stem",schemaPath:"#/properties/stem/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err28];
}
else {
vErrors.push(err28);
}
errors++;
}
}
if(data.stem_values !== undefined){
let data13 = data.stem_values;
if(data13 && typeof data13 == "object" && !Array.isArray(data13)){
for(const key1 in data13){
let data14 = data13[key1];
if((!((typeof data14 == "number") && (isFinite(data14)))) && (typeof data14 !== "string")){
const err29 = {instancePath:instancePath+"/stem_values/" + key1.replace(/~/g, "~0").replace(/\//g, "~1"),schemaPath:"#/properties/stem_values/additionalProperties/type",keyword:"type",params:{type: schema29.properties.stem_values.additionalProperties.type},message:"must be number,string"};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
}
}
else {
const err30 = {instancePath:instancePath+"/stem_values",schemaPath:"#/properties/stem_values/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err30];
}
else {
vErrors.push(err30);
}
errors++;
}
}
if(data.figure !== undefined){
let data15 = data.figure;
const _errs38 = errors;
let valid15 = false;
let passing0 = null;
const _errs39 = errors;
if(data15 !== null){
const err31 = {instancePath:instancePath+"/figure",schemaPath:"#/properties/figure/oneOf/0/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err31];
}
else {
vErrors.push(err31);
}
errors++;
}
var _valid3 = _errs39 === errors;
if(_valid3){
valid15 = true;
passing0 = 0;
}
const _errs41 = errors;
if(data15 && typeof data15 == "object" && !Array.isArray(data15)){
if(data15.tool === undefined){
const err32 = {instancePath:instancePath+"/figure",schemaPath:"#/properties/figure/oneOf/1/required",keyword:"required",params:{missingProperty: "tool"},message:"must have required property '"+"tool"+"'"};
if(vErrors === null){
vErrors = [err32];
}
else {
vErrors.push(err32);
}
errors++;
}
if(data15.code === undefined){
const err33 = {instancePath:instancePath+"/figure",schemaPath:"#/properties/figure/oneOf/1/required",keyword:"required",params:{missingProperty: "code"},message:"must have required property '"+"code"+"'"};
if(vErrors === null){
vErrors = [err33];
}
else {
vErrors.push(err33);
}
errors++;
}
if(data15.alt_text === undefined){
const err34 = {instancePath:instancePath+"/figure",schemaPath:"#/properties/figure/oneOf/1/required",keyword:"required",params:{missingProperty: "alt_text"},message:"must have required property '"+"alt_text"+"'"};
if(vErrors === null){
vErrors = [err34];
}
else {
vErrors.push(err34);
}
errors++;
}
for(const key2 in data15){
if(!(((((key2 === "tool") || (key2 === "code")) || (key2 === "alt_text")) || (key2 === "expected_px")) || (key2 === "render"))){
const err35 = {instancePath:instancePath+"/figure",schemaPath:"#/properties/figure/oneOf/1/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key2},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err35];
}
else {
vErrors.push(err35);
}
errors++;
}
}
if(data15.tool !== undefined){
let data16 = data15.tool;
if(!(((((((((data16 === "matplotlib") || (data16 === "svg")) || (data16 === "tikz")) || (data16 === "vega-lite")) || (data16 === "schemdraw")) || (data16 === "rdkit")) || (data16 === "graphviz")) || (data16 === "latex")) || (data16 === "template"))){
const err36 = {instancePath:instancePath+"/figure/tool",schemaPath:"#/properties/figure/oneOf/1/properties/tool/enum",keyword:"enum",params:{allowedValues: schema29.properties.figure.oneOf[1].properties.tool.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err36];
}
else {
vErrors.push(err36);
}
errors++;
}
}
if(data15.code !== undefined){
let data17 = data15.code;
if(typeof data17 === "string"){
if(func1(data17) > 20000){
const err37 = {instancePath:instancePath+"/figure/code",schemaPath:"#/properties/figure/oneOf/1/properties/code/maxLength",keyword:"maxLength",params:{limit: 20000},message:"must NOT have more than 20000 characters"};
if(vErrors === null){
vErrors = [err37];
}
else {
vErrors.push(err37);
}
errors++;
}
if(func1(data17) < 1){
const err38 = {instancePath:instancePath+"/figure/code",schemaPath:"#/properties/figure/oneOf/1/properties/code/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err38];
}
else {
vErrors.push(err38);
}
errors++;
}
}
else {
const err39 = {instancePath:instancePath+"/figure/code",schemaPath:"#/properties/figure/oneOf/1/properties/code/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err39];
}
else {
vErrors.push(err39);
}
errors++;
}
}
if(data15.alt_text !== undefined){
let data18 = data15.alt_text;
if(typeof data18 === "string"){
if(func1(data18) > 400){
const err40 = {instancePath:instancePath+"/figure/alt_text",schemaPath:"#/properties/figure/oneOf/1/properties/alt_text/maxLength",keyword:"maxLength",params:{limit: 400},message:"must NOT have more than 400 characters"};
if(vErrors === null){
vErrors = [err40];
}
else {
vErrors.push(err40);
}
errors++;
}
if(func1(data18) < 15){
const err41 = {instancePath:instancePath+"/figure/alt_text",schemaPath:"#/properties/figure/oneOf/1/properties/alt_text/minLength",keyword:"minLength",params:{limit: 15},message:"must NOT have fewer than 15 characters"};
if(vErrors === null){
vErrors = [err41];
}
else {
vErrors.push(err41);
}
errors++;
}
}
else {
const err42 = {instancePath:instancePath+"/figure/alt_text",schemaPath:"#/properties/figure/oneOf/1/properties/alt_text/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err42];
}
else {
vErrors.push(err42);
}
errors++;
}
}
if(data15.expected_px !== undefined){
let data19 = data15.expected_px;
if(data19 && typeof data19 == "object" && !Array.isArray(data19)){
for(const key3 in data19){
if(!((((key3 === "min_w") || (key3 === "max_w")) || (key3 === "min_h")) || (key3 === "max_h"))){
const err43 = {instancePath:instancePath+"/figure/expected_px",schemaPath:"#/properties/figure/oneOf/1/properties/expected_px/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key3},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err43];
}
else {
vErrors.push(err43);
}
errors++;
}
}
if(data19.min_w !== undefined){
let data20 = data19.min_w;
if(!(((typeof data20 == "number") && (!(data20 % 1) && !isNaN(data20))) && (isFinite(data20)))){
const err44 = {instancePath:instancePath+"/figure/expected_px/min_w",schemaPath:"#/properties/figure/oneOf/1/properties/expected_px/properties/min_w/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err44];
}
else {
vErrors.push(err44);
}
errors++;
}
}
if(data19.max_w !== undefined){
let data21 = data19.max_w;
if(!(((typeof data21 == "number") && (!(data21 % 1) && !isNaN(data21))) && (isFinite(data21)))){
const err45 = {instancePath:instancePath+"/figure/expected_px/max_w",schemaPath:"#/properties/figure/oneOf/1/properties/expected_px/properties/max_w/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err45];
}
else {
vErrors.push(err45);
}
errors++;
}
}
if(data19.min_h !== undefined){
let data22 = data19.min_h;
if(!(((typeof data22 == "number") && (!(data22 % 1) && !isNaN(data22))) && (isFinite(data22)))){
const err46 = {instancePath:instancePath+"/figure/expected_px/min_h",schemaPath:"#/properties/figure/oneOf/1/properties/expected_px/properties/min_h/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err46];
}
else {
vErrors.push(err46);
}
errors++;
}
}
if(data19.max_h !== undefined){
let data23 = data19.max_h;
if(!(((typeof data23 == "number") && (!(data23 % 1) && !isNaN(data23))) && (isFinite(data23)))){
const err47 = {instancePath:instancePath+"/figure/expected_px/max_h",schemaPath:"#/properties/figure/oneOf/1/properties/expected_px/properties/max_h/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err47];
}
else {
vErrors.push(err47);
}
errors++;
}
}
}
else {
const err48 = {instancePath:instancePath+"/figure/expected_px",schemaPath:"#/properties/figure/oneOf/1/properties/expected_px/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err48];
}
else {
vErrors.push(err48);
}
errors++;
}
}
if(data15.render !== undefined){
let data24 = data15.render;
if(data24 && typeof data24 == "object" && !Array.isArray(data24)){
for(const key4 in data24){
if(!(((((((key4 === "status") || (key4 === "png_path")) || (key4 === "width_px")) || (key4 === "height_px")) || (key4 === "bytes")) || (key4 === "vision")) || (key4 === "attempts"))){
const err49 = {instancePath:instancePath+"/figure/render",schemaPath:"#/properties/figure/oneOf/1/properties/render/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key4},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err49];
}
else {
vErrors.push(err49);
}
errors++;
}
}
if(data24.status !== undefined){
let data25 = data24.status;
if(!(((data25 === "pending") || (data25 === "rendered")) || (data25 === "failed"))){
const err50 = {instancePath:instancePath+"/figure/render/status",schemaPath:"#/properties/figure/oneOf/1/properties/render/properties/status/enum",keyword:"enum",params:{allowedValues: schema29.properties.figure.oneOf[1].properties.render.properties.status.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err50];
}
else {
vErrors.push(err50);
}
errors++;
}
}
if(data24.png_path !== undefined){
if(typeof data24.png_path !== "string"){
const err51 = {instancePath:instancePath+"/figure/render/png_path",schemaPath:"#/properties/figure/oneOf/1/properties/render/properties/png_path/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err51];
}
else {
vErrors.push(err51);
}
errors++;
}
}
if(data24.width_px !== undefined){
let data27 = data24.width_px;
if(!(((typeof data27 == "number") && (!(data27 % 1) && !isNaN(data27))) && (isFinite(data27)))){
const err52 = {instancePath:instancePath+"/figure/render/width_px",schemaPath:"#/properties/figure/oneOf/1/properties/render/properties/width_px/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err52];
}
else {
vErrors.push(err52);
}
errors++;
}
}
if(data24.height_px !== undefined){
let data28 = data24.height_px;
if(!(((typeof data28 == "number") && (!(data28 % 1) && !isNaN(data28))) && (isFinite(data28)))){
const err53 = {instancePath:instancePath+"/figure/render/height_px",schemaPath:"#/properties/figure/oneOf/1/properties/render/properties/height_px/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err53];
}
else {
vErrors.push(err53);
}
errors++;
}
}
if(data24.bytes !== undefined){
let data29 = data24.bytes;
if(!(((typeof data29 == "number") && (!(data29 % 1) && !isNaN(data29))) && (isFinite(data29)))){
const err54 = {instancePath:instancePath+"/figure/render/bytes",schemaPath:"#/properties/figure/oneOf/1/properties/render/properties/bytes/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err54];
}
else {
vErrors.push(err54);
}
errors++;
}
}
if(data24.vision !== undefined){
let data30 = data24.vision;
if(!(((((data30 === "pending") || (data30 === "match")) || (data30 === "mismatch")) || (data30 === "not_applicable")) || (data30 === "skipped"))){
const err55 = {instancePath:instancePath+"/figure/render/vision",schemaPath:"#/properties/figure/oneOf/1/properties/render/properties/vision/enum",keyword:"enum",params:{allowedValues: schema29.properties.figure.oneOf[1].properties.render.properties.vision.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err55];
}
else {
vErrors.push(err55);
}
errors++;
}
}
if(data24.attempts !== undefined){
let data31 = data24.attempts;
if(!(((typeof data31 == "number") && (!(data31 % 1) && !isNaN(data31))) && (isFinite(data31)))){
const err56 = {instancePath:instancePath+"/figure/render/attempts",schemaPath:"#/properties/figure/oneOf/1/properties/render/properties/attempts/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err56];
}
else {
vErrors.push(err56);
}
errors++;
}
if((typeof data31 == "number") && (isFinite(data31))){
if(data31 > 3 || isNaN(data31)){
const err57 = {instancePath:instancePath+"/figure/render/attempts",schemaPath:"#/properties/figure/oneOf/1/properties/render/properties/attempts/maximum",keyword:"maximum",params:{comparison: "<=", limit: 3},message:"must be <= 3"};
if(vErrors === null){
vErrors = [err57];
}
else {
vErrors.push(err57);
}
errors++;
}
if(data31 < 0 || isNaN(data31)){
const err58 = {instancePath:instancePath+"/figure/render/attempts",schemaPath:"#/properties/figure/oneOf/1/properties/render/properties/attempts/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err58];
}
else {
vErrors.push(err58);
}
errors++;
}
}
}
}
else {
const err59 = {instancePath:instancePath+"/figure/render",schemaPath:"#/properties/figure/oneOf/1/properties/render/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err59];
}
else {
vErrors.push(err59);
}
errors++;
}
}
}
else {
const err60 = {instancePath:instancePath+"/figure",schemaPath:"#/properties/figure/oneOf/1/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err60];
}
else {
vErrors.push(err60);
}
errors++;
}
var _valid3 = _errs41 === errors;
if(_valid3 && valid15){
valid15 = false;
passing0 = [passing0, 1];
}
else {
if(_valid3){
valid15 = true;
passing0 = 1;
}
}
if(!valid15){
const err61 = {instancePath:instancePath+"/figure",schemaPath:"#/properties/figure/oneOf",keyword:"oneOf",params:{passingSchemas: passing0},message:"must match exactly one schema in oneOf"};
if(vErrors === null){
vErrors = [err61];
}
else {
vErrors.push(err61);
}
errors++;
}
else {
errors = _errs38;
if(vErrors !== null){
if(_errs38){
vErrors.length = _errs38;
}
else {
vErrors = null;
}
}
}
}
if(data.options !== undefined){
let data32 = data.options;
if(Array.isArray(data32)){
if(data32.length > 4){
const err62 = {instancePath:instancePath+"/options",schemaPath:"#/properties/options/allOf/0/maxItems",keyword:"maxItems",params:{limit: 4},message:"must NOT have more than 4 items"};
if(vErrors === null){
vErrors = [err62];
}
else {
vErrors.push(err62);
}
errors++;
}
if(data32.length < 4){
const err63 = {instancePath:instancePath+"/options",schemaPath:"#/properties/options/allOf/0/minItems",keyword:"minItems",params:{limit: 4},message:"must NOT have fewer than 4 items"};
if(vErrors === null){
vErrors = [err63];
}
else {
vErrors.push(err63);
}
errors++;
}
const len1 = data32.length;
if(len1 > 0){
let data33 = data32[0];
if(data33 && typeof data33 == "object" && !Array.isArray(data33)){
if(data33.key !== undefined){
if("A" !== data33.key){
const err64 = {instancePath:instancePath+"/options/0/key",schemaPath:"#/properties/options/allOf/0/prefixItems/0/properties/key/const",keyword:"const",params:{allowedValue: "A"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err64];
}
else {
vErrors.push(err64);
}
errors++;
}
}
}
}
if(len1 > 1){
let data35 = data32[1];
if(data35 && typeof data35 == "object" && !Array.isArray(data35)){
if(data35.key !== undefined){
if("B" !== data35.key){
const err65 = {instancePath:instancePath+"/options/1/key",schemaPath:"#/properties/options/allOf/0/prefixItems/1/properties/key/const",keyword:"const",params:{allowedValue: "B"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err65];
}
else {
vErrors.push(err65);
}
errors++;
}
}
}
}
if(len1 > 2){
let data37 = data32[2];
if(data37 && typeof data37 == "object" && !Array.isArray(data37)){
if(data37.key !== undefined){
if("C" !== data37.key){
const err66 = {instancePath:instancePath+"/options/2/key",schemaPath:"#/properties/options/allOf/0/prefixItems/2/properties/key/const",keyword:"const",params:{allowedValue: "C"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err66];
}
else {
vErrors.push(err66);
}
errors++;
}
}
}
}
if(len1 > 3){
let data39 = data32[3];
if(data39 && typeof data39 == "object" && !Array.isArray(data39)){
if(data39.key !== undefined){
if("D" !== data39.key){
const err67 = {instancePath:instancePath+"/options/3/key",schemaPath:"#/properties/options/allOf/0/prefixItems/3/properties/key/const",keyword:"const",params:{allowedValue: "D"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err67];
}
else {
vErrors.push(err67);
}
errors++;
}
}
}
}
}
if(Array.isArray(data32)){
if(data32.length > 4){
const err68 = {instancePath:instancePath+"/options",schemaPath:"#/properties/options/maxItems",keyword:"maxItems",params:{limit: 4},message:"must NOT have more than 4 items"};
if(vErrors === null){
vErrors = [err68];
}
else {
vErrors.push(err68);
}
errors++;
}
if(data32.length < 4){
const err69 = {instancePath:instancePath+"/options",schemaPath:"#/properties/options/minItems",keyword:"minItems",params:{limit: 4},message:"must NOT have fewer than 4 items"};
if(vErrors === null){
vErrors = [err69];
}
else {
vErrors.push(err69);
}
errors++;
}
const len2 = data32.length;
for(let i1=0; i1<len2; i1++){
let data41 = data32[i1];
if(data41 && typeof data41 == "object" && !Array.isArray(data41)){
if(data41.key === undefined){
const err70 = {instancePath:instancePath+"/options/" + i1,schemaPath:"#/properties/options/items/required",keyword:"required",params:{missingProperty: "key"},message:"must have required property '"+"key"+"'"};
if(vErrors === null){
vErrors = [err70];
}
else {
vErrors.push(err70);
}
errors++;
}
if(data41.text === undefined){
const err71 = {instancePath:instancePath+"/options/" + i1,schemaPath:"#/properties/options/items/required",keyword:"required",params:{missingProperty: "text"},message:"must have required property '"+"text"+"'"};
if(vErrors === null){
vErrors = [err71];
}
else {
vErrors.push(err71);
}
errors++;
}
if(data41.misconception_tag === undefined){
const err72 = {instancePath:instancePath+"/options/" + i1,schemaPath:"#/properties/options/items/required",keyword:"required",params:{missingProperty: "misconception_tag"},message:"must have required property '"+"misconception_tag"+"'"};
if(vErrors === null){
vErrors = [err72];
}
else {
vErrors.push(err72);
}
errors++;
}
for(const key5 in data41){
if(!(((key5 === "key") || (key5 === "text")) || (key5 === "misconception_tag"))){
const err73 = {instancePath:instancePath+"/options/" + i1,schemaPath:"#/properties/options/items/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key5},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err73];
}
else {
vErrors.push(err73);
}
errors++;
}
}
if(data41.key !== undefined){
if(!(validate72(data41.key, {instancePath:instancePath+"/options/" + i1+"/key",parentData:data41,parentDataProperty:"key",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate72.errors : vErrors.concat(validate72.errors);
errors = vErrors.length;
}
}
if(data41.text !== undefined){
let data43 = data41.text;
if(typeof data43 === "string"){
if(func1(data43) > 200){
const err74 = {instancePath:instancePath+"/options/" + i1+"/text",schemaPath:"#/properties/options/items/properties/text/maxLength",keyword:"maxLength",params:{limit: 200},message:"must NOT have more than 200 characters"};
if(vErrors === null){
vErrors = [err74];
}
else {
vErrors.push(err74);
}
errors++;
}
if(func1(data43) < 1){
const err75 = {instancePath:instancePath+"/options/" + i1+"/text",schemaPath:"#/properties/options/items/properties/text/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err75];
}
else {
vErrors.push(err75);
}
errors++;
}
}
else {
const err76 = {instancePath:instancePath+"/options/" + i1+"/text",schemaPath:"#/properties/options/items/properties/text/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err76];
}
else {
vErrors.push(err76);
}
errors++;
}
}
if(data41.misconception_tag !== undefined){
let data44 = data41.misconception_tag;
const _errs93 = errors;
let valid28 = false;
let passing1 = null;
const _errs94 = errors;
if(data44 !== null){
const err77 = {instancePath:instancePath+"/options/" + i1+"/misconception_tag",schemaPath:"#/properties/options/items/properties/misconception_tag/oneOf/0/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err77];
}
else {
vErrors.push(err77);
}
errors++;
}
var _valid4 = _errs94 === errors;
if(_valid4){
valid28 = true;
passing1 = 0;
}
const _errs96 = errors;
if(!(validate74(data44, {instancePath:instancePath+"/options/" + i1+"/misconception_tag",parentData:data41,parentDataProperty:"misconception_tag",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate74.errors : vErrors.concat(validate74.errors);
errors = vErrors.length;
}
var _valid4 = _errs96 === errors;
if(_valid4 && valid28){
valid28 = false;
passing1 = [passing1, 1];
}
else {
if(_valid4){
valid28 = true;
passing1 = 1;
}
}
if(!valid28){
const err78 = {instancePath:instancePath+"/options/" + i1+"/misconception_tag",schemaPath:"#/properties/options/items/properties/misconception_tag/oneOf",keyword:"oneOf",params:{passingSchemas: passing1},message:"must match exactly one schema in oneOf"};
if(vErrors === null){
vErrors = [err78];
}
else {
vErrors.push(err78);
}
errors++;
}
else {
errors = _errs93;
if(vErrors !== null){
if(_errs93){
vErrors.length = _errs93;
}
else {
vErrors = null;
}
}
}
}
}
else {
const err79 = {instancePath:instancePath+"/options/" + i1,schemaPath:"#/properties/options/items/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err79];
}
else {
vErrors.push(err79);
}
errors++;
}
}
const _errs97 = errors;
const len3 = data32.length;
let valid29 = false;
let count0 = 0;
for(let i2=0; i2<len3; i2++){
let data45 = data32[i2];
const _errs98 = errors;
if(data45 && typeof data45 == "object" && !Array.isArray(data45)){
if(data45.misconception_tag === undefined){
const err80 = {instancePath:instancePath+"/options/" + i2,schemaPath:"#/properties/options/contains/required",keyword:"required",params:{missingProperty: "misconception_tag"},message:"must have required property '"+"misconception_tag"+"'"};
if(vErrors === null){
vErrors = [err80];
}
else {
vErrors.push(err80);
}
errors++;
}
if(data45.misconception_tag !== undefined){
if(data45.misconception_tag !== null){
const err81 = {instancePath:instancePath+"/options/" + i2+"/misconception_tag",schemaPath:"#/properties/options/contains/properties/misconception_tag/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err81];
}
else {
vErrors.push(err81);
}
errors++;
}
}
}
else {
const err82 = {instancePath:instancePath+"/options/" + i2,schemaPath:"#/properties/options/contains/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err82];
}
else {
vErrors.push(err82);
}
errors++;
}
var _valid5 = _errs98 === errors;
if(_valid5){
count0++;
if(count0 >= 2){
valid29 = true;
break;
}
}
}
if(!valid29){
const err83 = {instancePath:instancePath+"/options",schemaPath:"#/properties/options/contains",keyword:"contains",params:{minContains: 2},message:"must contain at least 2 valid item(s)"};
if(vErrors === null){
vErrors = [err83];
}
else {
vErrors.push(err83);
}
errors++;
}
else {
errors = _errs97;
if(vErrors !== null){
if(_errs97){
vErrors.length = _errs97;
}
else {
vErrors = null;
}
}
}
}
else {
const err84 = {instancePath:instancePath+"/options",schemaPath:"#/properties/options/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err84];
}
else {
vErrors.push(err84);
}
errors++;
}
}
if(data.difficulty !== undefined){
if(!(validate76(data.difficulty, {instancePath:instancePath+"/difficulty",parentData:data,parentDataProperty:"difficulty",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate76.errors : vErrors.concat(validate76.errors);
errors = vErrors.length;
}
}
if(data.source !== undefined){
let data48 = data.source;
if(!((((data48 === "template") || (data48 === "llm")) || (data48 === "instructor")) || (data48 === "diagnostic"))){
const err85 = {instancePath:instancePath+"/source",schemaPath:"#/properties/source/enum",keyword:"enum",params:{allowedValues: schema29.properties.source.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err85];
}
else {
vErrors.push(err85);
}
errors++;
}
}
if(data.template !== undefined){
let data49 = data.template;
if(data49 && typeof data49 == "object" && !Array.isArray(data49)){
for(const key6 in data49){
if(!((key6 === "id") || (key6 === "params"))){
const err86 = {instancePath:instancePath+"/template",schemaPath:"#/properties/template/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key6},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err86];
}
else {
vErrors.push(err86);
}
errors++;
}
}
if(data49.id !== undefined){
if(typeof data49.id !== "string"){
const err87 = {instancePath:instancePath+"/template/id",schemaPath:"#/properties/template/properties/id/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err87];
}
else {
vErrors.push(err87);
}
errors++;
}
}
if(data49.params !== undefined){
let data51 = data49.params;
if(data51 && typeof data51 == "object" && !Array.isArray(data51)){
for(const key7 in data51){
if(!(validate87(data51[key7], {instancePath:instancePath+"/template/params/" + key7.replace(/~/g, "~0").replace(/\//g, "~1"),parentData:data51,parentDataProperty:key7,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate87.errors : vErrors.concat(validate87.errors);
errors = vErrors.length;
}
}
}
else {
const err88 = {instancePath:instancePath+"/template/params",schemaPath:"#/properties/template/properties/params/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err88];
}
else {
vErrors.push(err88);
}
errors++;
}
}
}
else {
const err89 = {instancePath:instancePath+"/template",schemaPath:"#/properties/template/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err89];
}
else {
vErrors.push(err89);
}
errors++;
}
}
if(data.verification !== undefined){
let data53 = data.verification;
if(data53 && typeof data53 == "object" && !Array.isArray(data53)){
if(data53.schema === undefined){
const err90 = {instancePath:instancePath+"/verification",schemaPath:"#/properties/verification/required",keyword:"required",params:{missingProperty: "schema"},message:"must have required property '"+"schema"+"'"};
if(vErrors === null){
vErrors = [err90];
}
else {
vErrors.push(err90);
}
errors++;
}
if(data53.sympy === undefined){
const err91 = {instancePath:instancePath+"/verification",schemaPath:"#/properties/verification/required",keyword:"required",params:{missingProperty: "sympy"},message:"must have required property '"+"sympy"+"'"};
if(vErrors === null){
vErrors = [err91];
}
else {
vErrors.push(err91);
}
errors++;
}
if(data53.render === undefined){
const err92 = {instancePath:instancePath+"/verification",schemaPath:"#/properties/verification/required",keyword:"required",params:{missingProperty: "render"},message:"must have required property '"+"render"+"'"};
if(vErrors === null){
vErrors = [err92];
}
else {
vErrors.push(err92);
}
errors++;
}
if(data53.vision === undefined){
const err93 = {instancePath:instancePath+"/verification",schemaPath:"#/properties/verification/required",keyword:"required",params:{missingProperty: "vision"},message:"must have required property '"+"vision"+"'"};
if(vErrors === null){
vErrors = [err93];
}
else {
vErrors.push(err93);
}
errors++;
}
if(data53.attempts === undefined){
const err94 = {instancePath:instancePath+"/verification",schemaPath:"#/properties/verification/required",keyword:"required",params:{missingProperty: "attempts"},message:"must have required property '"+"attempts"+"'"};
if(vErrors === null){
vErrors = [err94];
}
else {
vErrors.push(err94);
}
errors++;
}
if(data53.status === undefined){
const err95 = {instancePath:instancePath+"/verification",schemaPath:"#/properties/verification/required",keyword:"required",params:{missingProperty: "status"},message:"must have required property '"+"status"+"'"};
if(vErrors === null){
vErrors = [err95];
}
else {
vErrors.push(err95);
}
errors++;
}
for(const key8 in data53){
if(!(((((((key8 === "schema") || (key8 === "sympy")) || (key8 === "render")) || (key8 === "vision")) || (key8 === "attempts")) || (key8 === "status")) || (key8 === "review_note"))){
const err96 = {instancePath:instancePath+"/verification",schemaPath:"#/properties/verification/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key8},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err96];
}
else {
vErrors.push(err96);
}
errors++;
}
}
if(data53.schema !== undefined){
if(typeof data53.schema !== "boolean"){
const err97 = {instancePath:instancePath+"/verification/schema",schemaPath:"#/properties/verification/properties/schema/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err97];
}
else {
vErrors.push(err97);
}
errors++;
}
}
if(data53.sympy !== undefined){
let data55 = data53.sympy;
if(!((((data55 === "verified") || (data55 === "failed")) || (data55 === "not_applicable")) || (data55 === "pending"))){
const err98 = {instancePath:instancePath+"/verification/sympy",schemaPath:"#/properties/verification/properties/sympy/enum",keyword:"enum",params:{allowedValues: schema29.properties.verification.properties.sympy.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err98];
}
else {
vErrors.push(err98);
}
errors++;
}
}
if(data53.render !== undefined){
let data56 = data53.render;
if(!(((((data56 === "ok") || (data56 === "failed")) || (data56 === "size_mismatch")) || (data56 === "not_applicable")) || (data56 === "pending"))){
const err99 = {instancePath:instancePath+"/verification/render",schemaPath:"#/properties/verification/properties/render/enum",keyword:"enum",params:{allowedValues: schema29.properties.verification.properties.render.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err99];
}
else {
vErrors.push(err99);
}
errors++;
}
}
if(data53.vision !== undefined){
let data57 = data53.vision;
if(!(((((data57 === "match") || (data57 === "mismatch")) || (data57 === "not_applicable")) || (data57 === "pending")) || (data57 === "skipped"))){
const err100 = {instancePath:instancePath+"/verification/vision",schemaPath:"#/properties/verification/properties/vision/enum",keyword:"enum",params:{allowedValues: schema29.properties.verification.properties.vision.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err100];
}
else {
vErrors.push(err100);
}
errors++;
}
}
if(data53.attempts !== undefined){
let data58 = data53.attempts;
if(!(((typeof data58 == "number") && (!(data58 % 1) && !isNaN(data58))) && (isFinite(data58)))){
const err101 = {instancePath:instancePath+"/verification/attempts",schemaPath:"#/properties/verification/properties/attempts/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err101];
}
else {
vErrors.push(err101);
}
errors++;
}
if((typeof data58 == "number") && (isFinite(data58))){
if(data58 > 3 || isNaN(data58)){
const err102 = {instancePath:instancePath+"/verification/attempts",schemaPath:"#/properties/verification/properties/attempts/maximum",keyword:"maximum",params:{comparison: "<=", limit: 3},message:"must be <= 3"};
if(vErrors === null){
vErrors = [err102];
}
else {
vErrors.push(err102);
}
errors++;
}
if(data58 < 0 || isNaN(data58)){
const err103 = {instancePath:instancePath+"/verification/attempts",schemaPath:"#/properties/verification/properties/attempts/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err103];
}
else {
vErrors.push(err103);
}
errors++;
}
}
}
if(data53.status !== undefined){
let data59 = data53.status;
if(!(((((data59 === "draft") || (data59 === "pending_review")) || (data59 === "approved")) || (data59 === "rejected")) || (data59 === "retired"))){
const err104 = {instancePath:instancePath+"/verification/status",schemaPath:"#/properties/verification/properties/status/enum",keyword:"enum",params:{allowedValues: schema29.properties.verification.properties.status.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err104];
}
else {
vErrors.push(err104);
}
errors++;
}
}
if(data53.review_note !== undefined){
let data60 = data53.review_note;
if((typeof data60 !== "string") && (data60 !== null)){
const err105 = {instancePath:instancePath+"/verification/review_note",schemaPath:"#/properties/verification/properties/review_note/type",keyword:"type",params:{type: schema29.properties.verification.properties.review_note.type},message:"must be string,null"};
if(vErrors === null){
vErrors = [err105];
}
else {
vErrors.push(err105);
}
errors++;
}
}
}
else {
const err106 = {instancePath:instancePath+"/verification",schemaPath:"#/properties/verification/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err106];
}
else {
vErrors.push(err106);
}
errors++;
}
}
if(data.provenance !== undefined){
let data61 = data.provenance;
if(data61 && typeof data61 == "object" && !Array.isArray(data61)){
for(const key9 in data61){
if(!(((((key9 === "model") || (key9 === "cost_usd")) || (key9 === "prompt_version")) || (key9 === "prompt_hash")) || (key9 === "created_at"))){
const err107 = {instancePath:instancePath+"/provenance",schemaPath:"#/properties/provenance/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key9},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err107];
}
else {
vErrors.push(err107);
}
errors++;
}
}
if(data61.model !== undefined){
if(typeof data61.model !== "string"){
const err108 = {instancePath:instancePath+"/provenance/model",schemaPath:"#/properties/provenance/properties/model/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err108];
}
else {
vErrors.push(err108);
}
errors++;
}
}
if(data61.cost_usd !== undefined){
if(!(validate91(data61.cost_usd, {instancePath:instancePath+"/provenance/cost_usd",parentData:data61,parentDataProperty:"cost_usd",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate91.errors : vErrors.concat(validate91.errors);
errors = vErrors.length;
}
}
if(data61.prompt_version !== undefined){
if(typeof data61.prompt_version !== "string"){
const err109 = {instancePath:instancePath+"/provenance/prompt_version",schemaPath:"#/properties/provenance/properties/prompt_version/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err109];
}
else {
vErrors.push(err109);
}
errors++;
}
}
if(data61.prompt_hash !== undefined){
if(typeof data61.prompt_hash !== "string"){
const err110 = {instancePath:instancePath+"/provenance/prompt_hash",schemaPath:"#/properties/provenance/properties/prompt_hash/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err110];
}
else {
vErrors.push(err110);
}
errors++;
}
}
if(data61.created_at !== undefined){
if(!(validate93(data61.created_at, {instancePath:instancePath+"/provenance/created_at",parentData:data61,parentDataProperty:"created_at",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate93.errors : vErrors.concat(validate93.errors);
errors = vErrors.length;
}
}
}
else {
const err111 = {instancePath:instancePath+"/provenance",schemaPath:"#/properties/provenance/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err111];
}
else {
vErrors.push(err111);
}
errors++;
}
}
}
else {
const err112 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err112];
}
else {
vErrors.push(err112);
}
errors++;
}
validate67.errors = vErrors;
return errors === 0;
}
validate67.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

const schema42 = {"type":"object","additionalProperties":false,"required":["solution","sympy_status"],"description":"answer-key ile aynı alanlar, question_id hariç (soru henüz yazılmadı).","properties":{"correct_option":{"$ref":"common.json#/$defs/optionKey"},"numeric_value":{"type":"string","description":"SymPy string: '7/8', '2*sqrt(3)'"},"numeric_tolerance":{"type":"number","minimum":0},"canonical_expr":{"type":"string","description":"sympy.sympify edilebilir ifade; stem_values ile çözülür"},"solution":{"type":"string","minLength":10,"maxLength":2000,"description":"Adım adım çözüm; doğrudan modda reveal_solution bunu döner"},"sympy_status":{"enum":["verified","failed","not_applicable"]},"sympy_report":{"type":"object","additionalProperties":false,"properties":{"expr":{"type":"string"},"value":{"type":"string"},"matched_option":{"type":["string","null"]},"note":{"type":"string"}}}},"oneOf":[{"required":["correct_option"]},{"required":["numeric_value"]}]};

function validate97(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate97.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(!((((data === "A") || (data === "B")) || (data === "C")) || (data === "D"))){
const err0 = {instancePath,schemaPath:"#/enum",keyword:"enum",params:{allowedValues: schema23.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
validate97.errors = vErrors;
return errors === 0;
}
validate97.evaluated = {"dynamicProps":false,"dynamicItems":false};


function validate96(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate96.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
const _errs1 = errors;
let valid0 = false;
let passing0 = null;
const _errs2 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.correct_option === undefined){
const err0 = {instancePath,schemaPath:"#/oneOf/0/required",keyword:"required",params:{missingProperty: "correct_option"},message:"must have required property '"+"correct_option"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
}
var _valid0 = _errs2 === errors;
if(_valid0){
valid0 = true;
passing0 = 0;
}
const _errs3 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.numeric_value === undefined){
const err1 = {instancePath,schemaPath:"#/oneOf/1/required",keyword:"required",params:{missingProperty: "numeric_value"},message:"must have required property '"+"numeric_value"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
}
var _valid0 = _errs3 === errors;
if(_valid0 && valid0){
valid0 = false;
passing0 = [passing0, 1];
}
else {
if(_valid0){
valid0 = true;
passing0 = 1;
}
}
if(!valid0){
const err2 = {instancePath,schemaPath:"#/oneOf",keyword:"oneOf",params:{passingSchemas: passing0},message:"must match exactly one schema in oneOf"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
else {
errors = _errs1;
if(vErrors !== null){
if(_errs1){
vErrors.length = _errs1;
}
else {
vErrors = null;
}
}
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.solution === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "solution"},message:"must have required property '"+"solution"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.sympy_status === undefined){
const err4 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "sympy_status"},message:"must have required property '"+"sympy_status"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
for(const key0 in data){
if(!(((((((key0 === "correct_option") || (key0 === "numeric_value")) || (key0 === "numeric_tolerance")) || (key0 === "canonical_expr")) || (key0 === "solution")) || (key0 === "sympy_status")) || (key0 === "sympy_report"))){
const err5 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
if(data.correct_option !== undefined){
if(!(validate97(data.correct_option, {instancePath:instancePath+"/correct_option",parentData:data,parentDataProperty:"correct_option",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate97.errors : vErrors.concat(validate97.errors);
errors = vErrors.length;
}
}
if(data.numeric_value !== undefined){
if(typeof data.numeric_value !== "string"){
const err6 = {instancePath:instancePath+"/numeric_value",schemaPath:"#/properties/numeric_value/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
if(data.numeric_tolerance !== undefined){
let data2 = data.numeric_tolerance;
if((typeof data2 == "number") && (isFinite(data2))){
if(data2 < 0 || isNaN(data2)){
const err7 = {instancePath:instancePath+"/numeric_tolerance",schemaPath:"#/properties/numeric_tolerance/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
else {
const err8 = {instancePath:instancePath+"/numeric_tolerance",schemaPath:"#/properties/numeric_tolerance/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
if(data.canonical_expr !== undefined){
if(typeof data.canonical_expr !== "string"){
const err9 = {instancePath:instancePath+"/canonical_expr",schemaPath:"#/properties/canonical_expr/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
if(data.solution !== undefined){
let data4 = data.solution;
if(typeof data4 === "string"){
if(func1(data4) > 2000){
const err10 = {instancePath:instancePath+"/solution",schemaPath:"#/properties/solution/maxLength",keyword:"maxLength",params:{limit: 2000},message:"must NOT have more than 2000 characters"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if(func1(data4) < 10){
const err11 = {instancePath:instancePath+"/solution",schemaPath:"#/properties/solution/minLength",keyword:"minLength",params:{limit: 10},message:"must NOT have fewer than 10 characters"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
else {
const err12 = {instancePath:instancePath+"/solution",schemaPath:"#/properties/solution/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
if(data.sympy_status !== undefined){
let data5 = data.sympy_status;
if(!(((data5 === "verified") || (data5 === "failed")) || (data5 === "not_applicable"))){
const err13 = {instancePath:instancePath+"/sympy_status",schemaPath:"#/properties/sympy_status/enum",keyword:"enum",params:{allowedValues: schema42.properties.sympy_status.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
}
if(data.sympy_report !== undefined){
let data6 = data.sympy_report;
if(data6 && typeof data6 == "object" && !Array.isArray(data6)){
for(const key1 in data6){
if(!((((key1 === "expr") || (key1 === "value")) || (key1 === "matched_option")) || (key1 === "note"))){
const err14 = {instancePath:instancePath+"/sympy_report",schemaPath:"#/properties/sympy_report/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key1},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
if(data6.expr !== undefined){
if(typeof data6.expr !== "string"){
const err15 = {instancePath:instancePath+"/sympy_report/expr",schemaPath:"#/properties/sympy_report/properties/expr/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
}
if(data6.value !== undefined){
if(typeof data6.value !== "string"){
const err16 = {instancePath:instancePath+"/sympy_report/value",schemaPath:"#/properties/sympy_report/properties/value/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
}
if(data6.matched_option !== undefined){
let data9 = data6.matched_option;
if((typeof data9 !== "string") && (data9 !== null)){
const err17 = {instancePath:instancePath+"/sympy_report/matched_option",schemaPath:"#/properties/sympy_report/properties/matched_option/type",keyword:"type",params:{type: schema42.properties.sympy_report.properties.matched_option.type},message:"must be string,null"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
}
if(data6.note !== undefined){
if(typeof data6.note !== "string"){
const err18 = {instancePath:instancePath+"/sympy_report/note",schemaPath:"#/properties/sympy_report/properties/note/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
}
}
else {
const err19 = {instancePath:instancePath+"/sympy_report",schemaPath:"#/properties/sympy_report/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
}
}
else {
const err20 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
validate96.errors = vErrors;
return errors === 0;
}
validate96.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};


function validate66(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
/*# sourceURL="https://ogrenmen.easy/schemas/question-generation.json" */;
let vErrors = null;
let errors = 0;
const evaluated0 = validate66.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.item === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "item"},message:"must have required property '"+"item"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.key === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "key"},message:"must have required property '"+"key"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
for(const key0 in data){
if(!(((key0 === "schema_version") || (key0 === "item")) || (key0 === "key"))){
const err2 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
}
if(data.schema_version !== undefined){
if("1.0" !== data.schema_version){
const err3 = {instancePath:instancePath+"/schema_version",schemaPath:"#/properties/schema_version/const",keyword:"const",params:{allowedValue: "1.0"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
if(data.item !== undefined){
if(!(validate67(data.item, {instancePath:instancePath+"/item",parentData:data,parentDataProperty:"item",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate67.errors : vErrors.concat(validate67.errors);
errors = vErrors.length;
}
}
if(data.key !== undefined){
if(!(validate96(data.key, {instancePath:instancePath+"/key",parentData:data,parentDataProperty:"key",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate96.errors : vErrors.concat(validate96.errors);
errors = vErrors.length;
}
}
}
else {
const err4 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
validate66.errors = vErrors;
return errors === 0;
}
validate66.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

export const questionGenerationKey = validate100;

function validate100(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate100.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
const _errs1 = errors;
let valid0 = false;
let passing0 = null;
const _errs2 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.correct_option === undefined){
const err0 = {instancePath,schemaPath:"#/oneOf/0/required",keyword:"required",params:{missingProperty: "correct_option"},message:"must have required property '"+"correct_option"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
}
var _valid0 = _errs2 === errors;
if(_valid0){
valid0 = true;
passing0 = 0;
}
const _errs3 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.numeric_value === undefined){
const err1 = {instancePath,schemaPath:"#/oneOf/1/required",keyword:"required",params:{missingProperty: "numeric_value"},message:"must have required property '"+"numeric_value"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
}
var _valid0 = _errs3 === errors;
if(_valid0 && valid0){
valid0 = false;
passing0 = [passing0, 1];
}
else {
if(_valid0){
valid0 = true;
passing0 = 1;
}
}
if(!valid0){
const err2 = {instancePath,schemaPath:"#/oneOf",keyword:"oneOf",params:{passingSchemas: passing0},message:"must match exactly one schema in oneOf"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
else {
errors = _errs1;
if(vErrors !== null){
if(_errs1){
vErrors.length = _errs1;
}
else {
vErrors = null;
}
}
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.solution === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "solution"},message:"must have required property '"+"solution"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.sympy_status === undefined){
const err4 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "sympy_status"},message:"must have required property '"+"sympy_status"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
for(const key0 in data){
if(!(((((((key0 === "correct_option") || (key0 === "numeric_value")) || (key0 === "numeric_tolerance")) || (key0 === "canonical_expr")) || (key0 === "solution")) || (key0 === "sympy_status")) || (key0 === "sympy_report"))){
const err5 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
if(data.correct_option !== undefined){
if(!(validate97(data.correct_option, {instancePath:instancePath+"/correct_option",parentData:data,parentDataProperty:"correct_option",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate97.errors : vErrors.concat(validate97.errors);
errors = vErrors.length;
}
}
if(data.numeric_value !== undefined){
if(typeof data.numeric_value !== "string"){
const err6 = {instancePath:instancePath+"/numeric_value",schemaPath:"#/properties/numeric_value/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
if(data.numeric_tolerance !== undefined){
let data2 = data.numeric_tolerance;
if((typeof data2 == "number") && (isFinite(data2))){
if(data2 < 0 || isNaN(data2)){
const err7 = {instancePath:instancePath+"/numeric_tolerance",schemaPath:"#/properties/numeric_tolerance/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
else {
const err8 = {instancePath:instancePath+"/numeric_tolerance",schemaPath:"#/properties/numeric_tolerance/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
if(data.canonical_expr !== undefined){
if(typeof data.canonical_expr !== "string"){
const err9 = {instancePath:instancePath+"/canonical_expr",schemaPath:"#/properties/canonical_expr/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
if(data.solution !== undefined){
let data4 = data.solution;
if(typeof data4 === "string"){
if(func1(data4) > 2000){
const err10 = {instancePath:instancePath+"/solution",schemaPath:"#/properties/solution/maxLength",keyword:"maxLength",params:{limit: 2000},message:"must NOT have more than 2000 characters"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if(func1(data4) < 10){
const err11 = {instancePath:instancePath+"/solution",schemaPath:"#/properties/solution/minLength",keyword:"minLength",params:{limit: 10},message:"must NOT have fewer than 10 characters"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
else {
const err12 = {instancePath:instancePath+"/solution",schemaPath:"#/properties/solution/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
if(data.sympy_status !== undefined){
let data5 = data.sympy_status;
if(!(((data5 === "verified") || (data5 === "failed")) || (data5 === "not_applicable"))){
const err13 = {instancePath:instancePath+"/sympy_status",schemaPath:"#/properties/sympy_status/enum",keyword:"enum",params:{allowedValues: schema42.properties.sympy_status.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
}
if(data.sympy_report !== undefined){
let data6 = data.sympy_report;
if(data6 && typeof data6 == "object" && !Array.isArray(data6)){
for(const key1 in data6){
if(!((((key1 === "expr") || (key1 === "value")) || (key1 === "matched_option")) || (key1 === "note"))){
const err14 = {instancePath:instancePath+"/sympy_report",schemaPath:"#/properties/sympy_report/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key1},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
if(data6.expr !== undefined){
if(typeof data6.expr !== "string"){
const err15 = {instancePath:instancePath+"/sympy_report/expr",schemaPath:"#/properties/sympy_report/properties/expr/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
}
if(data6.value !== undefined){
if(typeof data6.value !== "string"){
const err16 = {instancePath:instancePath+"/sympy_report/value",schemaPath:"#/properties/sympy_report/properties/value/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
}
if(data6.matched_option !== undefined){
let data9 = data6.matched_option;
if((typeof data9 !== "string") && (data9 !== null)){
const err17 = {instancePath:instancePath+"/sympy_report/matched_option",schemaPath:"#/properties/sympy_report/properties/matched_option/type",keyword:"type",params:{type: schema42.properties.sympy_report.properties.matched_option.type},message:"must be string,null"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
}
if(data6.note !== undefined){
if(typeof data6.note !== "string"){
const err18 = {instancePath:instancePath+"/sympy_report/note",schemaPath:"#/properties/sympy_report/properties/note/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
}
}
else {
const err19 = {instancePath:instancePath+"/sympy_report",schemaPath:"#/properties/sympy_report/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
}
}
else {
const err20 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
validate100.errors = vErrors;
return errors === 0;
}
validate100.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};
