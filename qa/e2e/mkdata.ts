import { writeFile } from "node:fs/promises";
import ExcelJS from "exceljs";
import iconv from "iconv-lite";
import { actPhoto, SAMPLE_ACT } from "../../tests/fixtures/actImage";
const D = process.argv[2] ?? "./qa-data";
(async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Смета");
  ws.addRow(["ЛОКАЛЬНАЯ СМЕТА — ТЕСТОВЫЕ ДАННЫЕ QA"]);
  ws.addRow([]);
  ws.addRow(["№ п/п", "Шифр расценки", "Наименование работ", "Ед. изм.", "Количество", "Цена за ед., сом", "Стоимость, сом", "Корпус", "Этап"]);
  ws.addRow(["Раздел 1. Монолитные работы"]);
  ws.addRow([1, "06-01-015", "Монолитные колонны и стены", "м3", 500, 12500, 6250000, "К1", "Каркас"]);
  ws.addRow([2, "06-01-034", "Монолитные перекрытия", "м3", 400, 11800, 4720000, "К1", "Каркас"]);
  ws.addRow(["Раздел 2. Изоляция"]);
  ws.addRow([3, "08-01-003", "Гидроизоляция фундаментов", "м2", 1000, 650, 650000, "К1", "Нулевой цикл"]);
  ws.addRow([4, "47-01-001", "Озеленение территории", "м2", 2000, 450, 900000, "К1", "Благоустройство"]);
  ws.addRow(["Итого", null, null, null, null, null, 12520000]);
  await wb.xlsx.writeFile(`${D}/estimate.xlsx`);
  await writeFile(`${D}/act.jpg`, await actPhoto(SAMPLE_ACT, -1.5));
  const csv = [
    "Карточка счета 1636 (ТЕСТОВЫЕ ДАННЫЕ QA)",
    "Период;Документ;Счет Дт;Счет Кт;Сумма;Контрагент;Объект строительства;Статья затрат;Содержание",
    "15.10.2026;Поступление услуг 00012;1636;3110;1 500 000,00;ОсОО Тест-Монолит;Корпус 1;Монолитные работы;Колонны, акт АВР-15",
    "16.10.2026;Поступление материалов 00031;1636;3110;48 000,00;ОсОО Бетон;Корпус 1;Материалы;Бетон В25",
    "18.10.2026;Платёжное поручение 101;3110;1210;1 000 000,00;ОсОО Тест-Монолит;;;Оплата по договору Д-02/26",
  ].join("\r\n");
  await writeFile(`${D}/1c.csv`, iconv.encode(csv, "win1251"));
  // повреждённые и неподдерживаемые файлы для негативных сценариев
  await writeFile(`${D}/broken.xlsx`, Buffer.from("PK\x03\x04 это не настоящий xlsx"));
  await writeFile(`${D}/fake.jpg`, Buffer.from("<html>not an image</html>"));
  await writeFile(`${D}/empty.csv`, Buffer.alloc(0));
  await writeFile(`${D}/script.exe`, Buffer.from("MZ\x90\x00"));
  const ws2 = new ExcelJS.Workbook(); ws2.addWorksheet("x").addRow(["просто", "текст", "без", "заголовков"]);
  await ws2.xlsx.writeFile(`${D}/noheaders.xlsx`);
})();
