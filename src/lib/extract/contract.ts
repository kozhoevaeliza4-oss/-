/**
 * Извлечение реквизитов договора из текста (правила на регулярных выражениях).
 * Каждое найденное значение возвращается с источником (страница и фрагмент) и требует проверки человеком.
 * Если значение не найдено — поле не заполняется.
 */
import { detectCurrency, normalizeNumber, parseDocDate } from "./normalize";

export interface ExtractedValue {
  field: ContractField;
  value: string;
  raw: string;
  page: number;
  pageLabel: string;
  fragment: string;
}

export type ContractField =
  | "number"
  | "date"
  | "contractorName"
  | "contractorInn"
  | "subject"
  | "objectText"
  | "totalAmount"
  | "currency"
  | "startDate"
  | "endDate"
  | "paymentTerms";

export const CONTRACT_FIELD_LABELS: Record<ContractField, string> = {
  number: "Номер договора",
  date: "Дата договора",
  contractorName: "Подрядчик",
  contractorInn: "ИНН подрядчика",
  subject: "Предмет договора",
  objectText: "Объект",
  totalAmount: "Сумма договора",
  currency: "Валюта",
  startDate: "Начало работ",
  endDate: "Окончание работ",
  paymentTerms: "Условия оплаты",
};

const DATE_RE = String.raw`(?:«?\s*\d{1,2}\s*»?\s+[а-яё]+\s+\d{4}\s*г?\.?|\d{1,2}[./]\d{1,2}[./]\d{2,4})`;

function fragmentAround(text: string, index: number, len: number): string {
  const start = Math.max(0, index - 40);
  const end = Math.min(text.length, index + len + 60);
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

export function extractContractFields(pages: { page: number; label: string; text: string }[]): ExtractedValue[] {
  const found = new Map<ContractField, ExtractedValue>();
  const put = (field: ContractField, value: string | null, raw: string, p: { page: number; label: string; text: string }, index: number) => {
    if (!value || found.has(field)) return;
    found.set(field, { field, value, raw: raw.trim(), page: p.page, pageLabel: p.label, fragment: fragmentAround(p.text, index, raw.length) });
  };

  for (const p of pages) {
    const t = p.text;
    // Номер и дата: «ДОГОВОР ПОДРЯДА № 15/26 от 12 марта 2026 г.»
    let m = new RegExp(String.raw`договор[а-я]*(?:\s+[а-я]+){0,3}?\s*№\s*([\p{L}\p{N}\-/.]+)(?:\s+от\s+(${DATE_RE}))?`, "iu").exec(t);
    if (m) {
      put("number", m[1].replace(/[.,]$/, ""), m[0], p, m.index);
      if (m[2]) put("date", parseDocDate(m[2]), m[2], p, m.index);
    }
    if (!found.has("date")) {
      m = new RegExp(String.raw`(?:г\.\s*[А-ЯЁ][а-яё\-]+|Бишкек|Ош)[\s,]+(${DATE_RE})`).exec(t);
      if (m) put("date", parseDocDate(m[1]), m[1], p, m.index);
    }
    // ИНН (КР — 14 цифр, РФ/РК — 10–12)
    m = /ИНН[:\s]*([0-9]{10,14})/i.exec(t);
    if (m) {
      // ИНН подрядчика ищем рядом со словами «Подрядчик/Исполнитель», иначе — последний ИНН в тексте
      const contractorBlock = /(подрядчик|исполнитель)[\s\S]{0,400}?ИНН[:\s]*([0-9]{10,14})/i.exec(t);
      if (contractorBlock) put("contractorInn", contractorBlock[2], contractorBlock[0].slice(-25), p, contractorBlock.index + contractorBlock[0].length - 25);
    }
    // Подрядчик: «..., именуемое в дальнейшем «Подрядчик»»
    m = /((?:ОсОО|ООО|ОАО|ЗАО|АО|ИП|ЧП|Общество с ограниченной ответственностью|Индивидуальный предприниматель)\s*[«"“][^»"”]{2,80}[»"”]|(?:ИП|ЧП)\s+[А-ЯЁ][а-яё]+\s+[А-ЯЁ]\.\s?[А-ЯЁ]\.)(?:(?!именуем)[^.]){0,200}?именуем\S*\s+в\s+дальнейшем\s+[«"“]?(Подрядчик|Исполнитель|Субподрядчик)/i.exec(t);
    if (m) put("contractorName", m[1].replace(/\s+/g, " "), m[1], p, m.index);
    // Предмет
    m = /предмет\s+договора[\s.:\d]*([^\n]{10,300})/i.exec(t) ?? /обязуется\s+(?:выполнить|осуществить)\s+([^.]{10,300})/i.exec(t);
    if (m) put("subject", m[1].replace(/\s+/g, " ").trim(), m[1], p, m.index);
    // Объект
    m = /(?:на\s+объекте|по\s+объекту|объект[а-я]*\s*:)[:\s]*[«"“]?([^»"”\n.;]{5,200})/i.exec(t);
    if (m) put("objectText", m[1].trim(), m[1], p, m.index);
    // Сумма: «Общая стоимость работ по Договору составляет 12 500 000 (...) сом»
    m = /(?:общая\s+)?(?:стоимость|цена|сумма)\s+(?:работ\s+)?(?:по\s+(?:настоящему\s+)?договору\s+)?(?:составляет|равна|определена\s+в\s+размере)\s*[:\-]?\s*([\d\s .,]{3,25})(?:\s*\([^)]*\))?\s*(сом\S*|KGS|руб\S*|долл\S*|USD|тенге|KZT|евро|EUR)?/i.exec(t);
    if (m) {
      const n = normalizeNumber(m[1]);
      if (n.ok && n.value) put("totalAmount", n.value, m[0], p, m.index);
      const cur = m[2] ? detectCurrency(m[2]) : null;
      if (cur) put("currency", cur, m[2], p, m.index);
    }
    // Сроки
    m = new RegExp(String.raw`(?:начал[оа]\s+работ|срок\s+начала)[^\d«]{0,40}(${DATE_RE})`, "i").exec(t);
    if (m) put("startDate", parseDocDate(m[1]), m[1], p, m.index);
    m = new RegExp(String.raw`(?:окончани[ея]\s+работ|завершени[ея]\s+работ|срок\s+окончания)[^\d«]{0,40}(${DATE_RE})`, "i").exec(t);
    if (m) put("endDate", parseDocDate(m[1]), m[1], p, m.index);
    if (!found.has("startDate") || !found.has("endDate")) {
      m = new RegExp(String.raw`с\s+(${DATE_RE})\s+по\s+(${DATE_RE})`, "i").exec(t);
      if (m) {
        put("startDate", parseDocDate(m[1]), m[1], p, m.index);
        put("endDate", parseDocDate(m[2]), m[2], p, m.index);
      }
    }
    // Оплата: первое предложение раздела об оплате
    m = /(?:порядок\s+(?:и\s+условия\s+)?(?:оплаты|расч[её]тов)|условия\s+оплаты)[\s.:\d]*([^\n]{15,400})/i.exec(t) ?? /(аванс[^.]{10,300}\.)/i.exec(t);
    if (m) put("paymentTerms", m[1].replace(/\s+/g, " ").trim(), m[1], p, m.index);
  }
  if (!found.has("currency")) {
    const all = pages.map((p) => p.text).join("\n");
    const cur = detectCurrency(all);
    const p = pages[0];
    if (cur && p) put0(found, { field: "currency", value: cur, raw: cur, page: p.page, pageLabel: p.label, fragment: "валюта определена по тексту документа" });
  }
  return [...found.values()];
}

function put0(map: Map<ContractField, ExtractedValue>, v: ExtractedValue) {
  if (!map.has(v.field)) map.set(v.field, v);
}
